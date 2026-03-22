import { randomUUID } from "crypto";
import type { AIProvider, AIProviderSession } from "../providers/types.js";
import { createTools, type WorkerInfo } from "./tools.js";
import { getOrchestratorSystemMessage } from "./system-message.js";
import { config, DEFAULT_MODEL, featureFlags, CIRCUIT_BREAKER_THRESHOLD, CIRCUIT_BREAKER_RESET_MS } from "../config.js";
import { loadMcpConfig } from "./mcp-config.js";
import { getSkillDirectories } from "./skills.js";
import { resetClient } from "./client.js";
import { logConversation, getState, setState, deleteState, getMemorySummary, getRecentConversation, getPendingCheckpoints, logAudit } from "../store/db.js";
import { SESSIONS_DIR } from "../paths.js";
import { resolveModel, type Tier, type RouteResult } from "./router.js";
import { createBreaker } from "../resilience/circuit-breaker.js";
import { createLogger } from "../observability/logger.js";
import { getPriorityQueue } from "../queue/priority-queue.js";
import type { QueuedLaneMessage } from "../queue/lane.js";

const log = createLogger("orchestrator");

const sdkOrchestratorBreaker = createBreaker({ name: "sdk.orchestrator", failureThreshold: CIRCUIT_BREAKER_THRESHOLD, windowMs: 60_000, resetTimeoutMs: CIRCUIT_BREAKER_RESET_MS });
const sdkClientBreaker = createBreaker({ name: "sdk.client", failureThreshold: CIRCUIT_BREAKER_THRESHOLD, windowMs: 60_000, resetTimeoutMs: CIRCUIT_BREAKER_RESET_MS });

const MAX_RETRIES = 3;
const RECONNECT_DELAYS_MS = [1_000, 3_000, 10_000];
const HEALTH_CHECK_INTERVAL_MS = 30_000;

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

export function getCurrentSourceChannel(): "telegram" | "tui" | undefined {
  return currentSourceChannel;
}

function getSessionConfig() {
  const tools = createTools({
    provider: copilotClient!,
    workers,
    onWorkerComplete: feedBackgroundResult,
  });
  const mcpServers = loadMcpConfig();
  const skillDirectories = getSkillDirectories();
  return { tools, mcpServers, skillDirectories };
}

export function feedBackgroundResult(workerName: string, result: string): void {
  const worker = workers.get(workerName);
  const channel = worker?.originChannel;
  const prompt = `[Background task completed] Worker '${workerName}' finished:\n\n${result}`;
  sendToOrchestrator(
    prompt,
    { type: "background" },
    (_text, done) => {
      if (done && proactiveNotifyFn) {
        proactiveNotifyFn(_text, channel);
      }
    }
  );
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
    resetPromise = resetClient().then((c) => {
      log.info("Client reset successful", { state: c.getState() });
      copilotClient = c;
      return c;
    }).finally(() => { resetPromise = undefined; });
  }
  return resetPromise;
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
      }
    } catch (err) {
      log.error("Health check error", { err: err instanceof Error ? err.message : String(err) });
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

async function ensureOrchestratorSession(): Promise<AIProviderSession> {
  if (orchestratorSession) return orchestratorSession;
  if (sessionCreatePromise) return sessionCreatePromise;

  sessionCreatePromise = createOrResumeSession();
  try {
    const session = await sessionCreatePromise;
    orchestratorSession = session;
    return session;
  } finally {
    sessionCreatePromise = undefined;
  }
}

async function createOrResumeSession(): Promise<AIProviderSession> {
  const provider = await ensureClient();
  const { tools, mcpServers, skillDirectories } = getSessionConfig();
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
        60_000
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
        }).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          worker.lastOutput = msg;
          feedBackgroundResult(name, `Worker '${name}' recovery failed: ${msg}`);
        }).finally(() => {
          const { deleteCheckpoint } = require("../store/db.js");
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
  const { mcpServers, skillDirectories } = getSessionConfig();

  try {
    const models = await provider.listModels();
    const configured = config.copilotModel;
    const isAvailable = models.some((m) => m.id === configured);
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
  const session = await ensureOrchestratorSession();
  currentCallback = callback;

  let accumulated = "";
  let toolCallExecuted = false;
  session.onToolComplete(() => {
    toolCallExecuted = true;
  });
  session.onDelta((deltaContent) => {
    if (toolCallExecuted && accumulated.length > 0 && !accumulated.endsWith("\n")) {
      accumulated += "\n";
    }
    toolCallExecuted = false;
    accumulated += deltaContent;
    callback(accumulated, false);
  });

  try {
    log.info("Sending to SDK", { promptLength: prompt.length });
    const timeoutMs = 30_000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Response timed out after 30s")), timeoutMs)
    );
    const finalContent = await sdkOrchestratorBreaker.execute(() =>
      Promise.race([session.sendAndWait(prompt, timeoutMs), timeoutPromise])
    );
    log.info("SDK responded RAW", { 
      type: typeof finalContent, 
      value: typeof finalContent === 'string' ? finalContent.slice(0, 300) : String(finalContent),
      length: typeof finalContent === 'string' ? finalContent.length : -1,
      accumulatedLength: accumulated.length 
    });
    return finalContent || accumulated || "(No response)";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/closed|destroy|disposed|invalid|expired|not found/i.test(msg)) {
      log.warn("Session appears dead, will recreate", { msg });
      orchestratorSession = undefined;
      currentSessionModel = undefined;
      deleteState(ORCHESTRATOR_SESSION_KEY);
    }
    throw err;
  } finally {
    currentCallback = undefined;
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
    currentSourceChannel = item.sourceChannel;
    try {
      const routeResult = await resolveModel(item.prompt, currentSessionModel || config.copilotModel, recentTiers, copilotClient);
      if (routeResult.switched) {
        log.info("Auto: model switch", { model: routeResult.model, reason: routeResult.overrideName || routeResult.tier });
        config.copilotModel = routeResult.model;
        orchestratorSession = undefined;
        deleteState(ORCHESTRATOR_SESSION_KEY);
      }
      if (routeResult.tier) {
        recentTiers.push(routeResult.tier);
        if (recentTiers.length > 5) recentTiers = recentTiers.slice(-5);
      }
      lastRouteResult = routeResult;

      const result = await executeOnSession(item.prompt, item.callback);
      log.info("processQueue resolving", { resultLength: result?.length, first200: result?.slice(0, 200) });
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    }
    currentSourceChannel = undefined;
  }

  processing = false;
}

function isRecoverableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|disconnect|connection|EPIPE|ECONNRESET|ECONNREFUSED|socket|closed|ENOENT|spawn|not found|expired|stale/i.test(msg);
}

export async function sendToOrchestrator(
  prompt: string,
  source: MessageSource,
  callback: MessageCallback
): Promise<void> {
  const sourceLabel =
    source.type === "telegram" ? "telegram" :
    source.type === "tui" ? "tui" : "background";
  logMessage("in", sourceLabel, prompt);

  const taggedPrompt = source.type === "background"
    ? prompt
    : `[via ${sourceLabel}] ${prompt}`;
  const logRole = source.type === "background" ? "system" : "user";
  const sourceChannel: "telegram" | "tui" | undefined =
    source.type === "telegram" ? "telegram" :
    source.type === "tui" ? "tui" : undefined;

  const correlationId = `msg-${Date.now()}`;

  void (async () => {
    try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const finalContent = await new Promise<string>((resolve, reject) => {
          if (featureFlags.queueV2) {
            const pq = getPriorityQueue();
            pq.setExecutor(async (msg) => {
              const route = await resolveModel(msg.envelope.text, currentSessionModel || config.copilotModel, recentTiers, copilotClient);
              if (route.switched) {
                log.info("Auto: model switch", { model: route.model, reason: route.overrideName || route.tier });
                config.copilotModel = route.model;
                orchestratorSession = undefined;
                deleteState(ORCHESTRATOR_SESSION_KEY);
              }
              if (route.tier) {
                recentTiers.push(route.tier);
                if (recentTiers.length > 5) recentTiers = recentTiers.slice(-5);
              }
              lastRouteResult = route;
              currentSourceChannel = msg.envelope.channel as "telegram" | "tui" | undefined;
              const result = await executeOnSession(msg.envelope.text, msg.callback);
              currentSourceChannel = undefined;
              return result;
            });

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
              }).catch(reject);
          } else {
            messageQueue.push({ prompt: taggedPrompt, callback, sourceChannel, resolve, reject });
            processQueue();
          }
        });
        log.info("Promise resolved in sendToOrchestrator", { finalContentLength: finalContent?.length, first200: finalContent?.slice(0, 200) });
        callback(finalContent, true);
        try { logMessage("out", sourceLabel, finalContent); } catch { /* best-effort */ }
        try { logConversation(logRole, prompt, sourceLabel); } catch { /* best-effort */ }
        try { logConversation("assistant", finalContent, sourceLabel); } catch { /* best-effort */ }
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

        log.error("Error processing message", { msg, correlationId });
        const userMsg = /timed out/i.test(msg)
          ? "⏱️ That request timed out after 30s. This usually means a tool or service I tried to reach isn't connected yet. Try a simpler question, or ask me what I can do!"
          : `Error: ${msg}`;
        callback(userMsg, true);
        return;
      }
    }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Unhandled error in message pipeline", { error: msg, correlationId, source: sourceLabel });
      try { callback(`Error: ${msg}`, true); } catch { /* best-effort */ }
    }
  })();
}

export async function cancelCurrentMessage(): Promise<boolean> {
  const drained = messageQueue.length;
  while (messageQueue.length > 0) {
    const item = messageQueue.shift()!;
    item.reject(new Error("Cancelled"));
  }

  if (orchestratorSession && currentCallback) {
    try {
      await orchestratorSession.abort();
      log.info("Aborted in-flight request");
      return true;
    } catch (err) {
      log.error("Abort failed", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  return drained > 0;
}

export function getWorkers(): Map<string, WorkerInfo> {
  return workers;
}
