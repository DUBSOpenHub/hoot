import { getClient, stopClient } from "./copilot/client.js";
import { initOrchestrator, setMessageLogger, setProactiveNotify, getWorkers } from "./copilot/orchestrator.js";
import { startApiServer, broadcastToSSE } from "./api/server.js";
import { createBot, startBot, stopBot, sendProactiveMessage } from "./telegram/bot.js";
import { getDb, closeDb, logAudit } from "./store/db.js";
import { config, featureFlags } from "./config.js";
import { getBus } from "./bus/index.js";
import { ChannelRouterImpl } from "./channels/router.js";
import { getTelegramAdapter } from "./channels/telegram.js";
import { getTuiAdapter } from "./channels/tui.js";
import { wireMetrics } from "./observability/metrics.js";
import { getPluginManager } from "./plugins/manager.js";
import { getWorkerPool } from "./workers/pool.js";
import { createLogger } from "./observability/logger.js";

const log = createLogger("daemon");
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { checkForUpdate } from "./update.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageVersion: string = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")).version;

function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\n/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

async function main(): Promise<void> {
  log.info("Starting Hoot 🦉 daemon...");
  if (config.selfEditEnabled) {
    log.warn("Self-edit mode enabled — Hoot 🦉 can modify its own source code");
  }

  const bus = getBus();
  const channelRouter = new ChannelRouterImpl();

  wireMetrics(bus);

  setMessageLogger((direction, source, text) => {
    const arrow = direction === "in" ? "⟶" : "⟵";
    log.info(`${source.padEnd(8)} ${arrow}  ${truncate(text)}`, { direction, source });
  });

  getDb();
  log.info("Database initialized");

  logAudit("restart", "daemon", { version: packageVersion }, "system");

  log.info("Starting Copilot SDK client...");
  const client = await getClient();
  log.info("Copilot SDK client ready");

  if (featureFlags.poolEnabled) {
    await getWorkerPool().start(client);
    log.info("Worker session pool started");
  }

  log.info("Creating orchestrator session...");
  await initOrchestrator(client);
  log.info("Orchestrator session ready");

  setProactiveNotify((text, channel) => {
    log.info(`bg-notify (${channel ?? "all"}) ⟵  ${truncate(text)}`);
    if (!channel || channel === "telegram") {
      if (config.telegramEnabled) sendProactiveMessage(text);
    }
    if (!channel || channel === "tui") {
      broadcastToSSE(text);
    }
  });

  await startApiServer();

  const telegramAdapter = getTelegramAdapter();
  const tuiAdapter = getTuiAdapter();
  channelRouter.register(telegramAdapter);
  channelRouter.register(tuiAdapter);
  await telegramAdapter.initialize(bus, channelRouter);
  await tuiAdapter.initialize(bus, channelRouter);

  if (config.telegramEnabled) {
    createBot();
    await startBot();
  } else if (!config.telegramBotToken && config.authorizedUserId === undefined) {
    log.info("Telegram not configured — skipping bot. Run 'hoot setup' to configure.");
  } else if (!config.telegramBotToken) {
    log.info("Telegram bot token missing — skipping bot. Run 'hoot setup' and enter your bot token.");
  } else {
    log.info("Telegram user ID missing — skipping bot. Run 'hoot setup' and enter your Telegram user ID.");
  }

  if (featureFlags.pluginsEnabled) {
    const pluginManager = getPluginManager();
    await pluginManager.loadAll();
    log.info("Plugin system initialized", { loaded: pluginManager.getLoaded().length });
  }

  log.info("Hoot 🦉 is fully operational.");

  checkForUpdate()
    .then(({ updateAvailable, current, latest }) => {
      if (updateAvailable) {
        log.info(`Update available: v${current} → v${latest}  —  run 'hoot update' to install`);
      }
    })
    .catch(() => {});

  if (config.telegramEnabled && process.env.MAX_RESTARTED === "1") {
    await sendProactiveMessage("I'm back online 🟢").catch(() => {});
    delete process.env.MAX_RESTARTED;
  }
}

let shutdownState: "idle" | "warned" | "shutting_down" = "idle";
async function shutdown(): Promise<void> {
  if (shutdownState === "shutting_down") {
    log.info("Forced exit.");
    process.exit(1);
  }

  const workers = getWorkers();
  const running = Array.from(workers.values()).filter(w => w.status === "running");

  if (running.length > 0 && shutdownState === "idle") {
    const names = running.map(w => w.name).join(", ");
    log.warn(`${running.length} active worker(s) will be destroyed: ${names}. Press Ctrl+C again to force.`);
    shutdownState = "warned";
    return;
  }

  shutdownState = "shutting_down";
  log.info("Shutting down... (Ctrl+C again to force)");

  const forceTimer = setTimeout(() => {
    log.warn("Shutdown timed out — forcing exit.");
    process.exit(1);
  }, 3000);
  forceTimer.unref();

  if (config.telegramEnabled) {
    try { await stopBot(); } catch { /* best effort */ }
  }

  if (featureFlags.pluginsEnabled) {
    try { await getPluginManager().shutdown(); } catch { /* best effort */ }
  }

  if (featureFlags.poolEnabled) {
    try { await getWorkerPool().shutdown(); } catch { /* best effort */ }
  }

  await Promise.allSettled(
    Array.from(workers.values()).map((w) => w.session.destroy())
  );
  workers.clear();

  try { await stopClient(); } catch { /* best effort */ }
  closeDb();
  log.info("Goodbye.");
  process.exit(0);
}

export async function restartDaemon(): Promise<void> {
  log.info("Restarting...");

  const activeWorkers = getWorkers();
  const runningCount = Array.from(activeWorkers.values()).filter(w => w.status === "running").length;
  if (runningCount > 0) {
    log.warn(`Destroying ${runningCount} active worker(s) for restart`);
  }

  if (config.telegramEnabled) {
    await sendProactiveMessage("Restarting — back in a sec ⏳").catch(() => {});
    try { await stopBot(); } catch { /* best effort */ }
  }

  await Promise.allSettled(
    Array.from(activeWorkers.values()).map((w) => w.session.destroy())
  );
  activeWorkers.clear();

  try { await stopClient(); } catch { /* best effort */ }
  closeDb();

  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    detached: true,
    stdio: "inherit",
    env: { ...process.env, MAX_RESTARTED: "1" },
  });
  child.unref();

  log.info("New process spawned. Exiting old process.");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection (kept alive)", { reason: String(reason) });
});
process.on("uncaughtException", (err) => {
  log.error("Uncaught exception — shutting down", { err: String(err) });
  process.exit(1);
});

main().catch((err) => {
  log.error("Fatal error", { err: String(err) });
  process.exit(1);
});
