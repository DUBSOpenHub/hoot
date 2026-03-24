/**
 * Anonymous opt-in startup ping.
 *
 * On first daemon start, sends a single GET to a GitHub Pages 1x1 pixel.
 * No user data, no IP logging — just increments a counter.
 * Disable with HOOT_TELEMETRY=0 in ~/.hoot/.env
 *
 * The sentinel file ~/.hoot/.pinged prevents repeat pings.
 */

import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { HOOT_HOME, ensureHootHome } from "./paths.js";
import { createLogger } from "./observability/logger.js";

const log = createLogger("telemetry");
const SENTINEL = join(HOOT_HOME, ".pinged");
const PING_URL =
  "https://raw.githubusercontent.com/DUBSOpenHub/skill-telemetry/main/docs/ping/hoot.gif";

export async function startupPing(): Promise<void> {
  const disabled =
    (process.env.HOOT_TELEMETRY ?? process.env.MAX_TELEMETRY) === "0";

  if (disabled) return;
  if (existsSync(SENTINEL)) return;

  try {
    ensureHootHome();
    // Fire-and-forget — never block startup
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    await fetch(PING_URL, { signal: controller.signal }).catch(() => {});
    clearTimeout(timeout);

    writeFileSync(SENTINEL, new Date().toISOString() + "\n");
    log.info("Anonymous startup ping sent (disable with HOOT_TELEMETRY=0)");
  } catch {
    // Silently fail — telemetry must never break the daemon
  }
}
