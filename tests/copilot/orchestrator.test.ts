import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, AIProviderSession } from "../../src/providers/types.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush(): Promise<void> {
  return Promise.resolve();
}

function makeSession(id: string, sendImpl?: () => Promise<string>) {
  const deltas: Array<(text: string) => void> = [];
  const toolStarts: Array<(toolName: string) => void> = [];
  const toolCompletes: Array<(toolName: string, result: string) => void> = [];

  const session: AIProviderSession & {
    emitDelta: (text: string) => void;
    emitToolStart: (toolName?: string) => void;
    emitToolComplete: (toolName?: string, result?: string) => void;
  } = {
    id,
    sendAndWait: vi.fn(() => sendImpl ? sendImpl() : Promise.resolve("ok")),
    onDelta: vi.fn((handler) => { deltas.push(handler); }),
    onToolStart: vi.fn((handler) => { toolStarts.push(handler); }),
    onToolComplete: vi.fn((handler) => { toolCompletes.push(handler); }),
    abort: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    emitDelta(text: string) {
      deltas.forEach((handler) => handler(text));
    },
    emitToolStart(toolName = "bash") {
      toolStarts.forEach((handler) => handler(toolName));
    },
    emitToolComplete(toolName = "bash", result = "done") {
      toolCompletes.forEach((handler) => handler(toolName, result));
    },
  };

  return session;
}

describe("orchestrator", () => {
  const state = new Map<string, string>();
  let queued: Array<{ id: string; prompt: string; source_type: string; source_channel: string | null; attempts: number; created_at: number; available_at?: number }> = [];
  let mockResolveModel = vi.fn();
  let mockResetClient = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    process.env.HOOT_QUEUE_V2 = "0";
    process.env.HOOT_RESPONSE_IDLE_TIMEOUT_MS = "35000";
    process.env.HOOT_RESPONSE_MAX_TIMEOUT_MS = "70000";
    state.clear();
    queued = [];
    mockResolveModel = vi.fn(async (_prompt: string, currentModel: string) => ({
      model: currentModel,
      tier: null,
      switched: false,
      routerMode: "manual" as const,
    }));
    mockResetClient = vi.fn(async () => ({
      name: "reset-client",
      start: vi.fn(),
      stop: vi.fn(),
      getState: vi.fn(() => "connected"),
      listModels: vi.fn(async () => []),
      createSession: vi.fn(async () => makeSession("reset")),
      resumeSession: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.HOOT_QUEUE_V2;
    delete process.env.HOOT_RESPONSE_IDLE_TIMEOUT_MS;
    delete process.env.HOOT_RESPONSE_MAX_TIMEOUT_MS;
  });

  async function loadModule(opts?: { overrideResetClient?: () => Promise<any> }) {
    vi.doMock("../../src/copilot/tools.js", () => ({ createTools: () => [] }));
    vi.doMock("../../src/copilot/system-message.js", () => ({ getOrchestratorSystemMessage: () => "system" }));
    vi.doMock("../../src/copilot/mcp-config.js", () => ({ loadMcpConfig: () => ({}) }));
    vi.doMock("../../src/copilot/skills.js", () => ({ getSkillDirectories: () => ["/skills/all"], listSkills: () => [] }));
    vi.doMock("../../src/copilot/skill-loader.js", () => ({
      initializeSkillLoader: vi.fn(),
      resetSkillLoader: vi.fn(),
      selectRelevantSkillDirectories: vi.fn(() => ["/skills/matched"]),
    }));
    // resetClient must return a valid provider to avoid "Cannot read properties of undefined"
    const resetClientImpl = opts?.overrideResetClient ?? mockResetClient;
    vi.doMock("../../src/copilot/client.js", () => ({ resetClient: resetClientImpl }));
    vi.doMock("../../src/copilot/router.js", () => ({ resolveModel: mockResolveModel }));
    vi.doMock("../../src/observability/logger.js", () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    }));
    vi.doMock("../../src/queue/priority-queue.js", () => ({
      getPriorityQueue: () => ({
        setExecutor: vi.fn(),
        enqueue: vi.fn(),
      }),
    }));
    vi.doMock("../../src/resilience/circuit-breaker.js", () => ({
      createBreaker: () => ({
        execute: async <T>(fn: () => Promise<T>) => fn(),
        getState: () => "closed",
        getSnapshot: () => ({ state: "closed" }),
      }),
    }));
    vi.doMock("../../src/store/db.js", () => ({
      logConversation: vi.fn(),
      getState: vi.fn((key: string) => state.get(key)),
      setState: vi.fn((key: string, value: string) => { state.set(key, value); }),
      deleteState: vi.fn((key: string) => { state.delete(key); }),
      getMemorySummary: vi.fn(() => ""),
      getRecentConversation: vi.fn(() => ""),
      getPendingCheckpoints: vi.fn(() => []),
      deleteCheckpoint: vi.fn(),
      enqueueQueuedMessage: vi.fn((msg: { id: string; prompt: string; sourceType: string; sourceChannel?: string }) => {
        queued.push({
          id: msg.id,
          prompt: msg.prompt,
          source_type: msg.sourceType,
          source_channel: msg.sourceChannel ?? null,
          attempts: 0,
          created_at: Date.now(),
        });
      }),
      claimQueuedMessage: vi.fn(() => {
        const next = queued.shift();
        return next ? { ...next, attempts: next.attempts + 1 } : undefined;
      }),
      requeueQueuedMessage: vi.fn((id: string) => {
        const existing = queued.find((item) => item.id === id);
        if (existing) existing.attempts += 1;
      }),
      completeQueuedMessage: vi.fn((id: string) => {
        queued = queued.filter((item) => item.id !== id);
      }),
      clearQueuedMessages: vi.fn(() => {
        const count = queued.length;
        queued = [];
        return count;
      }),
      getQueuedMessageDepth: vi.fn(() => queued.length),
    }));

    return import("../../src/copilot/orchestrator.js");
  }

  it("keeps idle timeout alive while a tool is running", async () => {
    const mod = await loadModule();
    const send = deferred<string>();
    const session = makeSession("tool-heartbeat", () => send.promise);
    mod.__test__.setSession(session, "claude-sonnet-4.6", ["/skills/matched"]);

    let settled = false;
    const exec = mod.__test__.executeOnSession("use a tool", vi.fn());
    exec.then(() => { settled = true; }, () => { settled = true; });

    // Let executeOnSession attach event handlers before emitting tool start.
    await flush();
    await flush();
    session.emitToolStart("bash");
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();

    expect(settled).toBe(false);

    send.resolve("tool finished");
    await expect(exec).resolves.toBe("tool finished");
  });

  it("fails on max timeout", async () => {
    const mod = await loadModule();
    const send = deferred<string>();
    const session = makeSession("max-timeout", () => send.promise);
    mod.__test__.setSession(session, "claude-sonnet-4.6", ["/skills/matched"]);

    const exec = mod.__test__.executeOnSession("hang forever", vi.fn());
    const captured = exec.catch((err) => err as Error);
    await flush();
    session.emitToolStart("bash");
    await vi.advanceTimersByTimeAsync(70_001);

    await expect(captured).resolves.toMatchObject({ message: expect.stringMatching(/max timeout/i) });
  });

  it("recovers after a dead session", async () => {
    const freshSession = makeSession("fresh", () => Promise.resolve("fresh response"));
    const provider = {
      name: "mock",
      start: vi.fn(),
      stop: vi.fn(),
      getState: vi.fn(() => "connected"),
      listModels: vi.fn(async () => []),
      createSession: vi.fn(async () => freshSession),
      resumeSession: vi.fn(async () => { throw new Error("not found"); }),
    } as unknown as AIProvider;

    const mod = await loadModule({
      overrideResetClient: vi.fn(async () => provider),
    });
    const deadSession = makeSession("dead", () => Promise.reject(new Error("session closed")));

    mod.__test__.setProvider(provider);
    mod.__test__.setSession(deadSession, "claude-sonnet-4.6", ["/skills/matched"]);

    await expect(mod.__test__.executeOnSession("first try", vi.fn())).rejects.toThrow(/session closed/i);
    await expect(mod.__test__.executeOnSession("second try", vi.fn())).resolves.toBe("fresh response");
    expect((provider.createSession as any).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("retries recoverable send errors with backoff", async () => {
    const session = makeSession("retrying");
    (session.sendAndWait as any)
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce("eventual success");
    const provider = {
      name: "mock",
      start: vi.fn(),
      stop: vi.fn(),
      getState: vi.fn(() => "connected"),
      listModels: vi.fn(async () => []),
      createSession: vi.fn(),
      resumeSession: vi.fn(async () => { throw new Error("not found"); }),
    } as unknown as AIProvider;

    const mod = await loadModule({
      overrideResetClient: vi.fn(async () => provider),
    });

    mod.__test__.setProvider(provider);
    mod.__test__.setSession(session, "claude-sonnet-4.6", ["/skills/matched"]);

    const done = deferred<string>();
    await mod.sendToOrchestrator("retry please", { type: "tui", connectionId: "conn-1" }, (text, finished) => {
      if (finished) done.resolve(text);
    });

    await vi.advanceTimersByTimeAsync(14_000);

    await expect(done.promise).resolves.toBe("eventual success");
    expect(session.sendAndWait).toHaveBeenCalledTimes(4);
  });

  it("cancels the active message and drains queued work", async () => {
    const mod = await loadModule();
    const send = deferred<string>();
    const session = makeSession("cancel-me", () => send.promise);
    mod.__test__.setSession(session, "claude-sonnet-4.6", ["/skills/matched"]);

    await mod.sendToOrchestrator("first", { type: "tui", connectionId: "conn-1" }, vi.fn());
    await flush();
    await mod.sendToOrchestrator("second", { type: "tui", connectionId: "conn-1" }, vi.fn());
    await flush();

    expect(mod.__test__.getQueueDepth()).toBe(1);
    await expect(mod.cancelCurrentMessage()).resolves.toBe(true);
    expect(mod.__test__.getQueueDepth()).toBe(0);
    expect(session.abort).toHaveBeenCalledTimes(1);
  });

  it("switches models when the router requests it", async () => {
    mockResolveModel = vi.fn(async () => ({
      model: "claude-opus-4.6",
      tier: "premium",
      switched: true,
      routerMode: "auto" as const,
    }));
    const newSession = makeSession("new-session", () => Promise.resolve("switched response"));
    const provider = {
      name: "mock",
      start: vi.fn(),
      stop: vi.fn(),
      getState: vi.fn(() => "connected"),
      listModels: vi.fn(async () => []),
      createSession: vi.fn(async () => newSession),
      resumeSession: vi.fn(async () => { throw new Error("not found"); }),
    } as unknown as AIProvider;

    const mod = await loadModule({
      overrideResetClient: vi.fn(async () => provider),
    });
    const oldSession = makeSession("old-session", () => Promise.resolve("old"));

    mod.__test__.setProvider(provider);
    mod.__test__.setSession(oldSession, "gpt-4.1", ["/skills/matched"]);

    const done = deferred<string>();
    await mod.sendToOrchestrator("design a new layout", { type: "tui", connectionId: "conn-1" }, (text, finished) => {
      if (finished) done.resolve(text);
    });
    await flush();

    await expect(done.promise).resolves.toBe("switched response");
    expect(oldSession.destroy).toHaveBeenCalledTimes(1);
    expect((provider.createSession as any).mock.calls[0][0]).toMatchObject({ model: "claude-opus-4.6" });
  });
});
