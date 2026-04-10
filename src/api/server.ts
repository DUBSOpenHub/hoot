import express from "express";
import type { Request, Response, NextFunction } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";
import { sendToOrchestrator, getWorkers, cancelCurrentMessage, getLastRouteResult, getOfflineQueueDepth } from "../copilot/orchestrator.js";
import { sendPhoto } from "../telegram/bot.js";
import { config, persistModel, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, MAX_PROMPT_LENGTH } from "../config.js";
import { getRouterConfig, updateRouterConfig } from "../copilot/router.js";
import { searchMemories, getAuditLog, logAudit } from "../store/db.js";
import { listSkills, removeSkill } from "../copilot/skills.js";
import { restartDaemon } from "../daemon.js";
import { API_TOKEN_PATH, ensureHootHome } from "../paths.js";
import { getAllBreakers } from "../resilience/circuit-breaker.js";
import { getMetrics } from "../observability/metrics.js";
import { createLogger } from "../observability/logger.js";

const log = createLogger("server");

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/metrics" || req.path === "/status") return next();
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }; // 60000 ms window
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({ error: "Too Many Requests" });
    return;
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (entry.resetAt < now) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

let apiToken: string | null = null;
try {
  if (existsSync(API_TOKEN_PATH)) {
    apiToken = readFileSync(API_TOKEN_PATH, "utf-8").trim();
  } else {
    ensureHootHome();
    apiToken = randomBytes(32).toString("hex");
    writeFileSync(API_TOKEN_PATH, apiToken, { mode: 0o600 });
  }
} catch (err) {
  log.error("Failed to load/generate API token", { err: String(err) });
  process.exit(1);
}

const app = express();
app.use(express.json());

app.use((_req: Request, res: Response, next: NextFunction) => {
  const origin = _req.headers.origin;
  const allowed = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  res.setHeader("Access-Control-Allow-Origin", allowed && origin ? origin : "http://localhost:3333");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (_req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
});

app.use(rateLimit);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!apiToken || req.path === "/status" || req.path === "/metrics") return next();
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${apiToken}`) {
    logAudit("auth_reject", req.ip ?? "unknown", { path: req.path, method: req.method }, "api");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

const sseClients = new Map<string, Response>();
let connectionCounter = 0;

app.get("/status", (_req: Request, res: Response) => {
  const breakers: Record<string, unknown> = {};
  for (const [name, breaker] of getAllBreakers()) {
    breakers[name] = breaker.getSnapshot();
  }
  res.json({
    status: "ok",
    workers: Array.from(getWorkers().values()).map((w) => ({
      name: w.name,
      workingDir: w.workingDir,
      status: w.status,
    })),
    queueDepth: getOfflineQueueDepth(),
    circuitBreakers: breakers,
  });
});

app.get("/sessions", (_req: Request, res: Response) => {
  const workers = Array.from(getWorkers().values()).map((w) => ({
    name: w.name,
    workingDir: w.workingDir,
    status: w.status,
    lastOutput: w.lastOutput?.slice(0, 500),
  }));
  res.json(workers);
});

app.get("/stream", (req: Request, res: Response) => {
  const connectionId = `tui-${++connectionCounter}`;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "connected", connectionId })}\n\n`);

  sseClients.set(connectionId, res);

  const heartbeat = setInterval(() => {
    res.write(`:ping\n\n`);
  }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(connectionId);
  });
});

app.post("/message", (req: Request, res: Response) => {
  const { prompt, connectionId } = req.body as { prompt?: string; connectionId?: string };

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing 'prompt' in request body" });
    return;
  }

  if (prompt.length > MAX_PROMPT_LENGTH) { // 50_000 char limit
    res.status(400).json({ error: "Prompt exceeds 50,000 character limit" });
    return;
  }

  if (!connectionId || !sseClients.has(connectionId)) {
    res.status(400).json({ error: "Missing or invalid 'connectionId'. Connect to /stream first." });
    return;
  }

  sendToOrchestrator(
    prompt,
    { type: "tui", connectionId },
    (text: string, done: boolean) => {
      const sseRes = sseClients.get(connectionId);
      if (sseRes) {
        const event: Record<string, unknown> = {
          type: done ? "message" : "delta",
          content: text,
        };
        if (done) {
          const routeResult = getLastRouteResult();
          if (routeResult) {
            event.route = {
              model: routeResult.model,
              routerMode: routeResult.routerMode,
              tier: routeResult.tier,
              ...(routeResult.overrideName ? { overrideName: routeResult.overrideName } : {}),
            };
          }
        }
        sseRes.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }
  );

  res.json({ status: "queued" });
});

app.post("/cancel", async (_req: Request, res: Response) => {
  const cancelled = await cancelCurrentMessage();
  for (const [, sseRes] of sseClients) {
    sseRes.write(
      `data: ${JSON.stringify({ type: "cancelled" })}\n\n`
    );
  }
  res.json({ status: "ok", cancelled });
});

app.get("/model", (_req: Request, res: Response) => {
  res.json({ model: config.copilotModel });
});
app.post("/model", async (req: Request, res: Response) => {
  const { model } = req.body as { model?: string };
  if (!model || typeof model !== "string") {
    res.status(400).json({ error: "Missing 'model' in request body" });
    return;
  }
  try {
    const { getClient } = await import("../copilot/client.js");
    const client = await getClient();
    const models = await client.listModels();
    const match = models.find((m) => m.id === model);
    if (!match) {
      const suggestions = models
        .filter((m) => m.id.includes(model) || m.id.toLowerCase().includes(model.toLowerCase()))
        .map((m) => m.id);
      const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
      res.status(400).json({ error: `Model '${model}' not found.${hint}` });
      return;
    }
  } catch {
  }
  const previous = config.copilotModel;
  config.copilotModel = model;
  persistModel(model);
  res.json({ previous, current: model });
});

app.get("/auto", (_req: Request, res: Response) => {
  const routerConfig = getRouterConfig();
  const lastRoute = getLastRouteResult();
  res.json({
    ...routerConfig,
    currentModel: config.copilotModel,
    lastRoute: lastRoute || null,
  });
});

app.post("/auto", (req: Request, res: Response) => {
  const body = req.body as Partial<{
    enabled: boolean;
    tierModels: Record<string, string>;
    cooldownMessages: number;
  }>;

  const updated = updateRouterConfig(body);
  console.log(`[hoot] Auto-routing ${updated.enabled ? "enabled" : "disabled"}`); // legacy

  res.json(updated);
});

app.get("/memory", (_req: Request, res: Response) => {
  const memories = searchMemories(undefined, undefined, 100);
  res.json(memories);
});

app.get("/skills", (_req: Request, res: Response) => {
  const skills = listSkills();
  res.json(skills);
});

app.delete("/skills/:slug", (req: Request, res: Response) => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const result = removeSkill(slug);
  if (!result.ok) {
    res.status(400).json({ error: result.message });
  } else {
    res.json({ ok: true, message: result.message });
  }
});

app.post("/restart", (_req: Request, res: Response) => {
  res.json({ status: "restarting" });
  setTimeout(() => {
    restartDaemon().catch((err) => {
      console.error("[hoot] Restart failed:", err);
    });
  }, 500);
});

app.get("/audit", (_req: Request, res: Response) => {
  const entries = getAuditLog(100);
  res.json(entries);
});

app.get("/metrics", (_req: Request, res: Response) => {
  const metrics = getMetrics();
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(metrics.render());
});

app.post("/auth/rotate", (_req: Request, res: Response) => {
  ensureHootHome();
  const newToken = randomBytes(32).toString("hex");
  try {
    writeFileSync(API_TOKEN_PATH, newToken, { mode: 0o600 });
    apiToken = newToken;
    for (const [id, sseRes] of sseClients) {
      sseRes.write(`data: ${JSON.stringify({ type: "auth_rotated" })}\n\n`);
      sseRes.end();
      sseClients.delete(id);
    }
    logAudit("auth_rotate", "api", { message: "API token rotated" }, "api");
    res.json({ status: "ok", message: "Token rotated. Reconnect with new token." });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/send-photo", async (req: Request, res: Response) => {
  const { photo, caption } = req.body as { photo?: string; caption?: string };

  if (!photo || typeof photo !== "string") {
    res.status(400).json({ error: "Missing 'photo' (file path or URL) in request body" });
    return;
  }

  try {
    await sendPhoto(photo, caption);
    res.json({ status: "sent" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export function startApiServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(config.apiPort, "127.0.0.1", () => {
      log.info("HTTP API listening", { port: config.apiPort });
      resolve();
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${config.apiPort} is already in use. Is another Hoot 🦉 instance running?`));
      } else {
        reject(err);
      }
    });
  });
}

export function broadcastToSSE(text: string): void {
  for (const [, res] of sseClients) {
    res.write(
      `data: ${JSON.stringify({ type: "message", content: text })}\n\n`
    );
  }
}

export { app };
