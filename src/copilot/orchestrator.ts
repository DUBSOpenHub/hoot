import { randomUUID } from "crypto";
import type { AIProvider, AIProviderSession } from "../providers/types.js";
import { createTools, type WorkerInfo } from "./tools.js";
import { getOrchestratorSystemMessage } from "./system-message.js";
import {
  config,
  DEFAULT_MODEL,
  featureFlags,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_RESET_MS,
  RESPONSE_IDLE_TIMEOUT_MS,
  RESPONSE_MAX_TIMEOUT_MS,
} from "../config.js";
import { loadMcpConfig } from "./mcp-config.js";
import * as skillsModule from "./skills.js";
import { initializeSkillLoader, selectRelevantSkillDirectories } from "./skill-loader.js";
import { resetClient } from "./client.js";
import {
  logConversation,
  getState,
  setState,
  deleteState,
  getMemorySummary,
  getRecentConversation,
  getPendingCheckpoints,
  deleteCheckpoint,
  enqueueQueuedMessage,
  claimQueuedMessage,
  requeueQueuedMessage,
  completeQueuedMessage,
  clearQueuedMessages,
  getQueuedMessageDepth,
} from "../store/db.js";
import { SESSIONS_DIR } from "../paths.js";
import { resolveModel, type Tier, type RouteResult } from "./router.js";
import { createBreaker } from "../resilience/circuit-breaker.js";
import { createLogger } from "../observability/logger.js";
import { getPriorityQueue } from "../queue/priority-queue.js";
import type { QueuedLaneMessage } from "../queue/lane.js";

const log = createLogger("orchestrator");

const sdkOrchestratorBreaker = createBreaker({
  name: "sdk.orchestrator",
  failureThreshold: CIRCUIT_BREAKER_THRESHOLD,
  windowMs: 60_000,
  resetTimeoutMs: CIRCUIT_BREAKER_RESET_MS,
});
const sdkClientBreaker = createBreaker({
  name: "sdk.client",
  failureThreshold: CIRCUIT_BREAKER_THRESHOLD,
  windowMs: 60_000,
  resetTimeoutMs: CIRCUIT_BREAKER_RESET_MS,
});

const MAX_RETRIES = 3;
const RECONNECT_DELAYS_MS = [1_000, 3_000, 10_000];
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const OFFLINE_QUEUE_NOTICE = "I'm having trouble reaching the AI backend. Your messages are queued and I'll process them when I'm back online.";

const ORCHESTRATOR_SESSION_KEY = "orchestrator_session_id";

export type MessageSource =
  | { type: "telegram"; chatId: number; messageId: number }
  | { type: "tui"; connectionId: string }
  | { type: "background" };

export type MessageCallback = (text: string, done: boolean) => void;

type LogFn = (direction: "in" | "out", source: string, text: string) => void;
let logMessage: LogFn = () => {};

export function setMessageLogger(fn: LogFn): void {
  logMessage = fn;
}

type ProactiveNotifyFn = (text: string, channel?: "telegram" | "tui") => void;
let proactiveNotifyFn: ProactiveNotifyFn | undefined;

export function setProactiveNotify(fn: ProactiveNotifyFn): void {
  proactiveNotifyFn = fn;
}

let copilotClient: AIProvider | undefined;
const workers = new Map<string, WorkerInfo>();
let healthCheckTimer: ReturnType<typeof setInterval> | undefined;

let currentSessionModel: string | undefined;
let recentTiers: Tier[] = [];
let lastRouteResult: RouteResult | undefined;

export function getLastRouteResult(): RouteResult | undefined {
  return lastRouteResult;
}

let orchestratorSession: AIProviderSession | undefined;
let sessionCreatePromise: Promise<AIProviderSession> | undefined;
let activeSkillDirectories: string[] = [];
let offlineDrainInProgress = false;

type QueuedMessage = {
  prompt: string;
  callback: MessageCallback;
  sourceChannel?: "telegram" | "tui";
  resolve: (value: string) => void;
  reject: (err: unknown) => void;
};
const messageQueue: QueuedMessage[] = [];
let processing = false;
let currentCallback: MessageCallback | undefined;
let currentSourceChannel: "telegram" | "tui" | undefined;

// Test hook: when true, __test__.setSession has installed a manual session
// that should be reused without attempting SDK client recovery or skill
// reconfiguration. This is never enabled in production.
let testSessionOverride = false;

export function getCurrentSourceChannel(): "telegram" | "tui" | undefined {
  return currentSourceChannel;
}

function sameDirs(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((dir, idx) => dir === b[idx]);
}

function getSessionConfig(skillDirectoriesOverride?: string[]) {
  const tools = createTools({
    provider: copilotClient!,
    workers,
    onWorkerComplete: feedBackgroundResult,
  });
  const mcpServers = loadMcpConfig();
  const skillDirectories = skillDirectoriesOverride ?? skillsModule.getSkillDirectories();
  return { tools, mcpServers, skillDirectories };
}

export function feedBackgroundResult(workerName: string, result: string): void {
  const worker = workers.get(workerName);
  const channel = worker?.originChannel;
  const prompt = `[Background task completed] Worker '${workerName}' finished:\n\n${result}`;
  void sendToOrchestrator(prompt, { type: "background" }, (_text, done) => {
    if (done && proactiveNotifyFn) {
      proactiveNotifyFn(_text, channel);
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let resetPromise: Promise<AIProvider> | undefined;
async function ensureClient(): Promise<AIProvider> {
  if (copilotClient && copilotClient.getState() === "connected") {
    return copilotClient;
  }

  if (!resetPromise) {
    log.info("Client not connected, resetting", { state: copilotClient?.getState() ?? "null" });
    resetPromise = sdkClientBreaker.execute(() => resetClient())
      .then((client) => {
        log.info("Client reset successful", { state: client.getState() });
        copilotClient = client;
        return client;
      })
      .finally(() => {
        resetPromise = undefined;
      });
  }

  return resetPromise;
}

function isBreakerOpen(): boolean {
  return sdkOrchestratorBreaker.getState() === "open" || sdkClientBreaker.getState() === "open";
}

function startHealthCheck(): void {
  if (healthCheckTimer) return;
  healthCheckTimer = setInterval(async () => {
    if (!copilotClient) return;
    try {
      const state = copilotClient.getState();
      if (state !== "connected") {
        log.warn("Health check: client not connected, resetting", { state });
        await ensureClient();
        orchestratorSession = undefined;
        currentSessionModel = undefined;
        activeSkillDirectories = [];
      }
      await drainOfflineQueue();
    } catch (err) {
      log.error("Health check error", { err: err instanceof Error ? err.message : String(err) });
    }
  }, HEALTH_CHECK_INTERVAL_MS);
  healthCheckTimer.unref?.();
}

async function ensureOrchestratorSession(promptForSkills?: string): Promise<AIProviderSession> {
  // In test mode, when a manual session has been installed via __test__.setSession,
  // always reuse it and avoid touching the SDK client or skill configuration.
  if (orchestratorSession && testSessionOverride) {
    return orchestratorSession;
  }

  const requestedSkillDirectories = promptForSkills
    ? selectRelevantSkillDirectories(promptForSkills)
    : skillsModule.getSkillDirectories();

  if (orchestratorSession && sameDirs(activeSkillDirectories, requestedSkillDirectories)) {
    return orchestratorSession;
  }

  if (orchestratorSession && !sameDirs(activeSkillDirectories, requestedSkillDirectories)) {
    // Skill sets are part of the SDK session configuration. We can safely re-attach
    // to the same persistent session ID with a different skillDirectories set.
    try { await orchestratorSession.destroy(); } catch {}
    orchestratorSession = undefined;
    currentSessionModel = undefined;
    activeSkillDirectories = [];
    // Intentionally keep ORCHESTRATOR_SESSION_KEY so createOrResumeSession() can resume.
  }

  if (sessionCreatePromise) return sessionCreatePromise;

  sessionCreatePromise = createOrResumeSession(requestedSkillDirectories);
  try {
    const session = await sessionCreatePromise;
    orchestratorSession = session;
    activeSkillDirectories = [...requestedSkillDirectories];
    return session;
  } finally {
    sessionCreatePromise = undefined;
  }
}

async function createOrResumeSession(skillDirectoriesOverride: string[]): Promise<AIProviderSession> {
  const provider = await ensureClient();
  const { tools, mcpServers, skillDirectories } = getSessionConfig(skillDirectoriesOverride);
  const memorySummary = getMemorySummary();

  const infiniteSessions = {
    enabled: true,
    backgroundCompactionThreshold: 0.80,
    bufferExhaustionThreshold: 0.95,
  };

  const savedSessionId = getState(ORCHESTRATOR_SESSION_KEY);
  if (savedSessionId) {
    try {
      log.info("Resuming orchestrator session", { sessionId: savedSessionId.slice(0, 8) });
      const session = await provider.resumeSession(savedSessionId, {
        model: config.copilotModel,
        configDir: SESSIONS_DIR,
        streaming: true,
        systemMessage: getOrchestratorSystemMessage(memorySummary || undefined, { selfEditEnabled: config.selfEditEnabled }),
        tools,
        mcpServers,
        skillDirectories,
        infiniteSessions,
      });
      log.info("Resumed orchestrator session successfully");
      currentSessionModel = config.copilotModel;
      return session;
    } catch (err) {
      log.warn("Could not resume session, creating new", { err: err instanceof Error ? err.message : String(err) });
      deleteState(ORCHESTRATOR_SESSION_KEY);
    }
  }

  log.info("Creating new persistent orchestrator session");
  const session = await provider.createSession({
    model: config.copilotModel,
    configDir: SESSIONS_DIR,
    streaming: true,
    systemMessage: getOrchestratorSystemMessage(memorySummary || undefined, { selfEditEnabled: config.selfEditEnabled }),
    tools,
    mcpServers,
    skillDirectories,
    infiniteSessions,
  });

  setState(ORCHESTRATOR_SESSION_KEY, session.id);
  log.info("Created orchestrator session", { sessionId: session.id.slice(0, 8) });

  const recentHistory = getRecentConversation(10);
  if (recentHistory) {
    log.info("Injecting recent conversation context into new session");
    try {
      await session.sendAndWait(
        `[System: Session recovered] Your previous session was lost. Here's the recent conversation for context — do NOT respond to these messages, just absorb the context silently:\n\n${recentHistory}\n\n(End of recovery context. Wait for the next real message.)`,
        60_000,
      );
    } catch (err) {
      log.warn("Context recovery injection failed (non-fatal)", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  currentSessionModel = config.copilotModel;
  return session;
}

async function recoverWorkers(provider: AIProvider): Promise<void> {
  const checkpoints = getPendingCheckpoints();
  if (checkpoints.length === 0) return;
  log.info("Recovering interrupted workers", { count: checkpoints.length });

  for (const cp of checkpoints) {
    const { name, working_dir, prompt, origin_channel } = cp;
    log.info("Re-queuing recovered worker", { name });
    try {
      const session = await provider.createSession({
        model: config.copilotModel,
        configDir: SESSIONS_DIR,
        workingDirectory: working_dir,
      });
      const worker: WorkerInfo = {
        name,
        session,
        workingDir: working_dir,
        status: "running",
        startedAt: Date.now(),
        originChannel: origin_channel as "telegram" | "tui" | undefined,
      };
      workers.set(name, worker);

      session.sendAndWait(`(Recovered) Working directory: ${working_dir}\n\n${prompt}`, config.workerTimeoutMs)
        .then((result) => {
          worker.lastOutput = result || "No response";
          feedBackgroundResult(name, worker.lastOutput);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          worker.lastOutput = msg;
          feedBackgroundResult(name, `Worker '${name}' recovery failed: ${msg}`);
        })
        .finally(() => {
          deleteCheckpoint(name);
          session.destroy().catch(() => {});
          workers.delete(name);
        });
    } catch (err) {
      log.error("Worker recovery failed — task lost", { name, err: String(err) });
      if (proactiveNotifyFn) {
        proactiveNotifyFn(`Worker '${name}' could not be resumed — task was lost.`);
      }
    }
  }
}

export async function initOrchestrator(provider: AIProvider): Promise<void> {
  copilotClient = provider;
  initializeSkillLoader();
  const { mcpServers, skillDirectories } = getSessionConfig();

  try {
    const models = await provider.listModels();
    const configured = config.copilotModel;
    const isAvailable = models.some((model) => model.id === configured);
    if (!isAvailable) {
      log.warn("Configured model not available, falling back", { configured, fallback: DEFAULT_MODEL });
      config.copilotModel = DEFAULT_MODEL;
    }
  } catch (err) {
    log.warn("Could not validate model", { model: config.copilotModel, err: err instanceof Error ? err.message : String(err) });
  }

  log.info("MCP servers loaded", { count: Object.keys(mcpServers).length, servers: Object.keys(mcpServers).join(", ") || "(none)" });
  log.info("Skill directories", { dirs: skillDirectories.join(", ") || "(none)" });
  log.info("Persistent session mode — conversation history maintained by SDK");

  try {
    await recoverWorkers(provider);
  } catch (err) {
    log.error("Worker recovery encountered an error", { err: String(err) });
  }

  startHealthCheck();

  try {
    await ensureOrchestratorSession();
  } catch (err) {
    log.error("Failed to create initial session (will retry on first message)", { err: err instanceof Error ? err.message : String(err) });
  }
}

async function executeOnSession(prompt: string, callback: MessageCallback): Promise<string> {
  const session = await ensureOrchestratorSession(prompt);
  currentCallback = callback;

  let accumulated = "";
  let toolCallExecuted = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let hasActivity = false;
  let toolActive = false;

  function clearIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
  }

  function startIdleTimer(reject: (reason: Error) => void): void {
    // Only enforce idle timeout after we've seen some activity and no tool is running.
    if (!hasActivity || toolActive) return;
    clearIdleTimer();
    idleTimer = setTimeout(
      () => reject(new Error(`Response idle timeout — no activity for ${RESPONSE_IDLE_TIMEOUT_MS / 1000}s`)),
      RESPONSE_IDLE_TIMEOUT_MS,
    );
  }

  session.onToolComplete(() => {
    toolCallExecuted = true;
  });
  session.onDelta((deltaContent) => {
    if (toolCallExecuted && accumulated.length > 0 && !accumulated.endsWith("\n")) {
      accumulated += "\n";
    }
    toolCallExecuted = false;
    accumulated += deltaContent;
    hasActivity = true;
    toolActive = false;
    callback(accumulated, false);
  });

  try {
    log.info("Sending to SDK", { promptLength: prompt.length });

    const timeoutPromise = new Promise<never>((_, reject) => {
      session.onDelta(() => {
        hasActivity = true;
        toolActive = false;
        startIdleTimer(reject);
      });
      session.onToolStart?.(() => {
        hasActivity = true;
        toolActive = true;
        clearIdleTimer();
      });
      session.onToolComplete(() => {
        toolActive = false;
        startIdleTimer(reject);
      });
      maxTimer = setTimeout(
        () => reject(new Error(`Response max timeout — exceeded ${RESPONSE_MAX_TIMEOUT_MS / 1000}s limit`)),
        RESPONSE_MAX_TIMEOUT_MS,
      );
    });

    const finalContent = await sdkOrchestratorBreaker.execute(() =>
      Promise.race([session.sendAndWait(prompt, RESPONSE_MAX_TIMEOUT_MS), timeoutPromise]),
    );

    return finalContent || accumulated || "(No response)";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isIdle = /idle timeout/i.test(msg);
    const isMax = /max timeout/i.test(msg);
    const isDead = /closed|destroy|disposed|invalid|expired|not found|stale/i.test(msg);

    if (isIdle) {
      log.warn("Idle timeout — no activity detected", { idleMs: RESPONSE_IDLE_TIMEOUT_MS, accumulated: accumulated.length });
    } else if (isMax) {
      log.warn("Max wall-clock timeout reached", { maxMs: RESPONSE_MAX_TIMEOUT_MS, accumulated: accumulated.length });
    }

    if (isDead) {
      log.warn("Session appears dead, will recreate", { msg });
      orchestratorSession = undefined;
      currentSessionModel = undefined;
      activeSkillDirectories = [];
      deleteState(ORCHESTRATOR_SESSION_KEY);
    }

    throw err;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (maxTimer) clearTimeout(maxTimer);
    currentCallback = undefined;
  }
}

async function executePromptWithRouting(
  prompt: string,
  callback: MessageCallback,
  sourceChannel?: "telegram" | "tui",
): Promise<string> {
  currentSourceChannel = sourceChannel;
  try {
    const routeResult = await resolveModel(prompt, currentSessionModel || config.copilotModel, recentTiers, copilotClient);
    if (routeResult.switched) {
      log.info("Auto: model switch", { model: routeResult.model, reason: routeResult.overrideName || routeResult.tier });
      config.copilotModel = routeResult.model;
      try { await orchestratorSession?.destroy(); } catch {}
      orchestratorSession = undefined;
      currentSessionModel = undefined;
      activeSkillDirectories = [];
      deleteState(ORCHESTRATOR_SESSION_KEY);
    }
    if (routeResult.tier) {
      recentTiers.push(routeResult.tier);
      if (recentTiers.length > 5) recentTiers = recentTiers.slice(-5);
    }
    lastRouteResult = routeResult;
    const result = await executeOnSession(prompt, callback);
    await drainOfflineQueue();
    return result;
  } finally {
    currentSourceChannel = undefined;
  }
}

async function processQueue(): Promise<void> {
  if (processing) {
    if (messageQueue.length > 0) {
      log.info("Message queued", { queueDepth: messageQueue.length });
    }
    return;
  }
  processing = true;

  while (messageQueue.length > 0) {
    const item = messageQueue.shift()!;
    try {
      const result = await executePromptWithRouting(item.prompt, item.callback, item.sourceChannel);
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    }
  }

  processing = false;
}

function isRecoverableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|disconnect|connection|EPIPE|ECONNRESET|ECONNREFUSED|socket|closed|ENOENT|spawn|not found|expired|stale/i.test(msg);
}

function shouldQueueOffline(err?: unknown): boolean {
  if (isBreakerOpen()) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /circuit open|temporarily unavailable/i.test(msg);
}

function queueMessageForOffline(taggedPrompt: string, sourceLabel: string, sourceChannel: "telegram" | "tui" | undefined, prompt: string): void {
  enqueueQueuedMessage({
    id: randomUUID(),
    prompt: taggedPrompt,
    sourceType: sourceLabel,
    sourceChannel,
  });
  if (sourceLabel !== "background") {
    try { logConversation("user", prompt, sourceLabel); } catch { /* best effort */ }
  }
}

async function drainOfflineQueue(): Promise<void> {
  if (offlineDrainInProgress || getQueuedMessageDepth() === 0 || isBreakerOpen()) return;

  offlineDrainInProgress = true;
  try {
    while (!isBreakerOpen()) {
      const queued = claimQueuedMessage();
      if (!queued) break;
      try {
        const result = await executePromptWithRouting(queued.prompt, () => {}, queued.source_channel as "telegram" | "tui" | undefined);
        completeQueuedMessage(queued.id);
        try { logMessage("out", queued.source_type, result); } catch { /* best effort */ }
        try { logConversation("assistant", result, queued.source_type); } catch { /* best effort */ }
        proactiveNotifyFn?.(result, queued.source_channel as "telegram" | "tui" | undefined);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        requeueQueuedMessage(queued.id, msg);
        if (!isRecoverableError(err)) {
          proactiveNotifyFn?.(`Queued message failed: ${msg}`, queued.source_channel as "telegram" | "tui" | undefined);
        }
        break;
      }
    }
  } finally {
    offlineDrainInProgress = false;
  }
}

export function getOfflineQueueDepth(): number {
  return getQueuedMessageDepth();
}

export async function runInternalMessage(prompt: string): Promise<string> {
  return executePromptWithRouting(prompt, () => {}, undefined);
}

export async function sendToOrchestrator(
  prompt: string,
  source: MessageSource,
  callback: MessageCallback,
): Promise<void> {
  const sourceLabel =
    source.type === "telegram" ? "telegram"
      : source.type === "tui" ? "tui"
        : "background";
  logMessage("in", sourceLabel, prompt);

  const taggedPrompt = source.type === "background"
    ? prompt
    : `[via ${sourceLabel}] ${prompt}`;
  const logRole = source.type === "background" ? "system" : "user";
  const sourceChannel: "telegram" | "tui" | undefined =
    source.type === "telegram" ? "telegram"
      : source.type === "tui" ? "tui"
        : undefined;

  const correlationId = `msg-${Date.now()}`;

  if (source.type !== "background" && shouldQueueOffline()) {
    queueMessageForOffline(taggedPrompt, sourceLabel, sourceChannel, prompt);
    callback(OFFLINE_QUEUE_NOTICE, true);
    return;
  }

  void (async () => {
    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const finalContent = await new Promise<string>((resolve, reject) => {
            if (featureFlags.queueV2) {
              const pq = getPriorityQueue();
              pq.setExecutor(async (msg) => executePromptWithRouting(
                msg.envelope.text,
                msg.callback,
                msg.envelope.channel as "telegram" | "tui" | undefined,
              ));

              void resolveModel(taggedPrompt, currentSessionModel || config.copilotModel, recentTiers, copilotClient)
                .then((route) => {
                  const tier = route.tier ?? "standard";
                  const qMsg: QueuedLaneMessage = {
                    envelope: {
                      id: randomUUID(),
                      channel: sourceChannel ?? "api",
                      channelMeta: {},
                      text: taggedPrompt,
                      userId: sourceChannel,
                      timestamp: Date.now(),
                    },
                    callback,
                    resolve,
                    reject,
                    userId: sourceChannel,
                  };
                  pq.enqueue(qMsg, tier);
                })
                .catch(reject);
            } else {
              messageQueue.push({ prompt: taggedPrompt, callback, sourceChannel, resolve, reject });
              void processQueue();
            }
          });

          callback(finalContent, true);
          try { logMessage("out", sourceLabel, finalContent); } catch { /* best effort */ }
          try { logConversation(logRole, prompt, sourceLabel); } catch { /* best effort */ }
          try { logConversation("assistant", finalContent, sourceLabel); } catch { /* best effort */ }
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);

          if (/cancelled|abort/i.test(msg)) {
            return;
          }

          if (isRecoverableError(err) && attempt < MAX_RETRIES) {
            const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
            log.warn("Recoverable error, retrying", { msg, attempt: attempt + 1, maxRetries: MAX_RETRIES, delay, correlationId });
            await sleep(delay);
            try { await ensureClient(); } catch { /* will retry */ }
            continue;
          }

          if (source.type !== "background" && shouldQueueOffline(err)) {
            queueMessageForOffline(taggedPrompt, sourceLabel, sourceChannel, prompt);
            callback(OFFLINE_QUEUE_NOTICE, true);
            return;
          }

          log.error("Error processing message", { msg, correlationId });
          const userMsg = /idle timeout/i.test(msg)
            ? "⏱️ No activity detected for 2 minutes — the request may be stuck. Try again, or ask me something simpler!"
            : /max timeout/i.test(msg)
              ? "⏱️ That request hit the 10-minute safety limit. Try breaking it into smaller steps!"
              : /timed out/i.test(msg)
                ? "⏱️ That request timed out. This usually means a tool or service I tried to reach isn't connected yet. Try a simpler question, or ask me what I can do!"
                : `Error: ${msg}`;
          callback(userMsg, true);
          return;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Unhandled error in message pipeline", { error: msg, correlationId, source: sourceLabel });
      try { callback(`Error: ${msg}`, true); } catch { /* best effort */ }
    }
  })();
}

export async function cancelCurrentMessage(): Promise<boolean> {
  const drained = messageQueue.length;
  while (messageQueue.length > 0) {
    const item = messageQueue.shift()!;
    item.reject(new Error("Cancelled"));
  }
  const clearedOffline = clearQueuedMessages();

  if (orchestratorSession && currentCallback) {
    try {
      await orchestratorSession.abort();
      log.info("Aborted in-flight request");
      return true;
    } catch (err) {
      log.error("Abort failed", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  return drained + clearedOffline > 0;
}

export function getWorkers(): Map<string, WorkerInfo> {
  return workers;
}

export const __test__ = {
  executeOnSession,
  runInternalMessage,
  setProvider(provider: AIProvider | undefined) {
    copilotClient = provider;
  },
  setSession(session: AIProviderSession | undefined, model = config.copilotModel, skillDirectories: string[] = skillsModule.getSkillDirectories()) {
    orchestratorSession = session;
    currentSessionModel = session ? model : undefined;
    activeSkillDirectories = session ? [...skillDirectories] : [];
    testSessionOverride = !!session;
  },
  getQueueDepth() {
    return messageQueue.length;
  },
  resetState() {
    orchestratorSession = undefined;
    sessionCreatePromise = undefined;
    currentSessionModel = undefined;
    recentTiers = [];
    lastRouteResult = undefined;
    activeSkillDirectories = [];
    currentCallback = undefined;
    currentSourceChannel = undefined;
    processing = false;
    messageQueue.length = 0;
    copilotClient = undefined;
    testSessionOverride = false;
  },
};
