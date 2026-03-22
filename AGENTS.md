# Hoot 🦉 — AI Agent Architecture

## Overview

Hoot is a personal AI daemon with a pluggable AI backend (ships with [GitHub Copilot SDK](https://github.com/github/copilot-sdk) as the default; swap in Ollama, Anthropic, or OpenAI via the `AIProvider` interface). It runs as a background process (`~/.max/` — Hoot config directory, kept for backward compatibility) and exposes three channel interfaces — a Telegram bot, a terminal TUI, and a local HTTP API — all routed through a single **Orchestrator** brain. Agent logic is implemented as AI sessions via the `AIProvider`; background tasks are delegated to isolated **Worker** sessions; complexity routing is handled by a lightweight **Classifier** agent that keeps heavy models reserved for hard problems.

```
 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
 │  Telegram    │   │   TUI stdin  │   │  HTTP :7777  │
 │  bot.ts      │   │  tui/index   │   │  api/server  │
 └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
        │                  │                  │
        └──────────────────▼──────────────────┘
                   Channel Adapters
              (src/channels/{telegram,tui}.ts)
                           │
                    ┌──────▼──────┐
                    │  Message Bus │  ← EventEmitter (src/bus/index.ts)
                    └──────┬──────┘
                           │
              ┌────────────▼────────────┐
              │     Orchestrator         │  src/copilot/orchestrator.ts
              │  (main Copilot session)  │
              └────────────┬────────────┘
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────▼──────┐  ┌──────▼──────┐  ┌─────▼──────┐
   │ Classifier  │  │   Workers   │  │  Plugins   │
   │ gpt-4.1     │  │ pool.ts     │  │ manager.ts │
   └─────────────┘  └─────────────┘  └────────────┘
```

---

## Agent Roles

### Orchestrator — main brain (`src/copilot/orchestrator.ts`)

The Orchestrator holds the **primary AI session** (via the `AIProvider` interface). Every inbound message arrives here after passing through a channel adapter. The Orchestrator:

- Maintains conversation context across all channels.
- Calls the Classifier to select a model tier before dispatching.
- Exposes SDK tools (defined in `src/copilot/tools.ts`) — including `create_worker_session`, `send_to_worker`, `kill_worker`, `add_memory`, and skill management tools.
- Streams partial tokens back to the originating channel via the callback pattern.
- Cancels in-flight requests via `cancelCurrentMessage()`.

### Workers — background task agents (`src/copilot/tools.ts`, `src/workers/pool.ts`)

Workers are **independent AI sessions** created on demand for coding tasks, file operations, and long-running work. Key properties:

- Isolated working directory (enforced at creation time).
- Non-blocking dispatch: the Orchestrator returns immediately while the worker runs.
- On completion the worker routes the result back to the channel that originated the task (`originChannel`).
- Maximum **5** concurrent workers (`MAX_CONCURRENT_WORKERS` in `tools.ts`).
- Worker timeout defaults to **10 minutes** (`WORKER_TIMEOUT` env var, ms).

### Classifier — model router (`src/copilot/classifier.ts`)

A dedicated `gpt-4.1` session that classifies each incoming message into one of three complexity tiers within 8 seconds:

| Tier | Model class | Use cases |
|------|-------------|-----------|
| `FAST` | Lightweight | Greetings, trivial Q&A, simple lookups |
| `STANDARD` | Mid-tier | Coding tasks, file ops, tool usage |
| `PREMIUM` | Flagship | Architecture, deep analysis, system design |

Falls back to heuristic routing if the classifier session is unavailable. The active tier model mapping is configurable via `POST /auto` and stored in `~/.max/.env`.

---

## Message Bus (`src/bus/index.ts`)

A typed `EventEmitter` wrapper that decouples producers from consumers. Events are dispatched via `process.nextTick` (non-blocking). The singleton `getBus()` is passed to all subsystems at daemon startup.

Key events (`src/bus/types.ts`):

| Event | Payload | Emitted by |
|-------|---------|------------|
| `message.incoming` | `{ text, channel }` | Channel adapters |
| `message.completed` | `{ text, channel }` | Orchestrator |
| `message.error` | `{ error, channel }` | Orchestrator |
| `worker.completed` | `{ name, result }` | Worker handler |
| `worker.failed` | `{ name, error }` | Worker handler |

Plugins subscribe to bus events in their `onLoad` callback and must unsubscribe in `onUnload`.

---

## Channel Adapters (`src/channels/`)

Each channel is a thin adapter that:

1. Authenticates the inbound request (bearer token for HTTP; Telegram user-ID whitelist for the bot).
2. Calls `sendToOrchestrator(prompt, source, callback)` on the Orchestrator.
3. Streams incremental tokens back to the client (SSE for TUI, Telegram `sendMessage` for bot).

| Adapter | File | Transport |
|---------|------|-----------|
| Telegram | `src/channels/telegram.ts` | grammY long-poll |
| TUI | `src/channels/tui.ts` | SSE over `GET /stream` |
| HTTP | `src/api/server.ts` | REST + SSE |

---

## Plugin System (`src/plugins/`)

Plugins are Node.js CommonJS modules placed in `~/.max/plugins/<name>/index.js`. They are loaded when `MAX_PLUGINS_ENABLED=1` and hot-reloaded on file change.

### Plugin contract (`src/plugins/types.ts`)

```typescript
export interface HootPlugin {
  name: string;
  version: string;
  onLoad(ctx: PluginContext): Promise<void>;
  onUnload?(): Promise<void>;
}
```

The `PluginContext` passed to `onLoad` provides:

| Property | Type | Purpose |
|----------|------|---------|
| `bus` | `MessageBus` | Subscribe to / emit bus events |
| `registerTool(tool)` | `(Tool) => void` | Add a Copilot SDK tool to the Orchestrator |
| `addApiRoute(method, path, handler)` | function | Mount an authenticated Express route |
| `getDb()` | `Database` | Access the SQLite database |
| `log` | `Logger` | Pre-tagged structured logger |
| `config` | `Readonly<{...}>` | Read-only feature flags and config |

### Creating a custom plugin agent

```
~/.max/plugins/
└── my-plugin/
    └── index.js    ← CommonJS module exporting HootPlugin
```

**Minimal example:**

```javascript
// ~/.max/plugins/my-plugin/index.js
const { defineTool } = require("@github/copilot-sdk");
const { z } = require("zod");

module.exports = {
  name: "my-plugin",
  version: "1.0.0",

  async onLoad(ctx) {
    // Subscribe to bus events
    const unsub = ctx.bus.on("worker.completed", (data) => {
      ctx.log.info("Worker finished", { name: data.name });
    });

    // Register a new Copilot SDK tool
    ctx.registerTool(
      defineTool("greet", {
        description: "Greet someone by name",
        parameters: z.object({ name: z.string() }),
        handler: async ({ name }) => `Hello, ${name}!`,
      })
    );

    // Mount a custom API route (automatically bearer-authenticated)
    ctx.addApiRoute("get", "/my-plugin/status", (_req, res) => {
      res.json({ ok: true });
    });
  },

  async onUnload() {
    // Release resources, remove event listeners
  },
};
```

Enable plugins and restart:

```bash
echo "MAX_PLUGINS_ENABLED=1" >> ~/.max/.env
hoot restart
```

---

## Worker Pool Lifecycle (`src/workers/pool.ts`)

When `MAX_POOL_ENABLED=1`, AI sessions are reused across tasks to eliminate the per-task session-creation overhead.

```
           start()
              │
              ▼
    ┌─────────────────┐
    │  Warm pool       │  ← minWarm=2 sessions pre-created
    │  (available=true)│
    └────────┬────────┘
             │  checkout(workingDir)
             ▼
    ┌─────────────────┐
    │  Checked-out     │  ← session.sendAndWait(prompt, timeout)
    │  (available=false│
    └────────┬────────┘
             │  checkin(session)  ← on task completion
             ▼
    ┌─────────────────┐
    │  Warm pool       │  ← if not expired (default 30 min)
    └─────────────────┘
             │  expired or maxTotal reached
             ▼
          discard()  →  session.close()
```

Pool defaults: `minWarm=2`, `maxTotal=5`, `maxSessionAge=30 min`.

If the pool is at capacity and all sessions are checked out, `checkout()` enqueues the caller and resolves as soon as a session is returned.

---

## Circuit Breaker (`src/resilience/circuit-breaker.ts`)

All AI backend calls are wrapped in a `CircuitBreaker` to prevent cascading failures.

**States:**

```
  closed ──(≥3 failures in 60s)──▶ open ──(30s timeout)──▶ half-open
    ▲                                                           │
    └──────────────────(1 success)─────────────────────────────┘
```

| Parameter | Default | Env override |
|-----------|---------|--------------|
| `failureThreshold` | 3 | — |
| `windowMs` | 60 000 ms | — |
| `resetTimeoutMs` | 30 000 ms | — |

Breaker state for all named breakers is exposed at `GET /status` under `circuitBreakers`. When open, calls immediately throw `BreakerOpenError` with a countdown to auto-retry.

```typescript
// Usage pattern
const breaker = createBreaker({ name: "ai-provider" });
const result = await breaker.execute(() => session.sendAndWait(prompt));
```

---

## Observability (`src/observability/logger.ts`)

Every module calls `createLogger("component-name")` for a structured logger. Output format is controlled by `MAX_LOG_FORMAT`:

| Value | Output |
|-------|--------|
| `json` (default) | `{"ts":"…","level":"info","component":"server","msg":"…"}` |
| `pretty` | Colour-coded human-readable lines to stdout/stderr |
| `legacy` | Plain `console.log` passthrough |

Log level is controlled by `MAX_LOG_LEVEL` (default: `info`).

---

## Key Feature Flags

| Flag | Default | Effect |
|------|---------|--------|
| `MAX_QUEUE_V2=1` | off | Enable 3-lane concurrent priority queue |
| `MAX_POOL_ENABLED=1` | off | Enable worker session pool |
| `MAX_ENCRYPT_DB=1` | off | Enable XOR-obfuscated SQLite at rest |
| `MAX_PLUGINS_ENABLED=1` | off | Load plugins from `~/.max/plugins/` |
| `MAX_SELF_EDIT=1` | off | Allow Hoot to edit its own source files |
| `MAX_LOG_FORMAT` | `json` | `json` \| `pretty` \| `legacy` |
| `MAX_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
