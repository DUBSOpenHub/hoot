import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { readFileSync, writeFileSync } from "fs";
import { ENV_PATH, ensureHootHome } from "./paths.js";

loadEnv({ path: ENV_PATH });
loadEnv(); // also check cwd for backwards compat

// Named defaults — import these instead of using magic numbers
export const DEFAULT_API_PORT = 7777;
export const DEFAULT_WORKER_TIMEOUT_MS = 600_000;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 100;
export const MAX_PROMPT_LENGTH = 50_000;
export const POOL_MIN_WARM = 2;
export const POOL_MAX_TOTAL = 5;
export const POOL_SESSION_AGE_MS = 30 * 60 * 1000;
export const CIRCUIT_BREAKER_THRESHOLD = 3;
export const CIRCUIT_BREAKER_RESET_MS = 30_000;
export const RESPONSE_IDLE_TIMEOUT_MS = 120_000;
export const RESPONSE_MAX_TIMEOUT_MS = 600_000;

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  AUTHORIZED_USER_ID: z.string().min(1).optional(),
  API_PORT: z.string().optional(),
  COPILOT_MODEL: z.string().optional(),
  WORKER_TIMEOUT: z.string().optional(),
});

const raw = configSchema.parse(process.env);

const parsedUserId = raw.AUTHORIZED_USER_ID
  ? parseInt(raw.AUTHORIZED_USER_ID, 10)
  : undefined;
const parsedPort = parseInt(raw.API_PORT || String(DEFAULT_API_PORT), 10);

if (parsedUserId !== undefined && (Number.isNaN(parsedUserId) || parsedUserId <= 0)) {
  throw new Error(`AUTHORIZED_USER_ID must be a positive integer, got: "${raw.AUTHORIZED_USER_ID}"`);
}
if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
  throw new Error(`API_PORT must be 1-65535, got: "${raw.API_PORT}"`);
}

const parsedWorkerTimeout = raw.WORKER_TIMEOUT
  ? Number(raw.WORKER_TIMEOUT)
  : DEFAULT_WORKER_TIMEOUT_MS;

if (!Number.isInteger(parsedWorkerTimeout) || parsedWorkerTimeout <= 0) {
  throw new Error(`WORKER_TIMEOUT must be a positive integer (ms), got: "${raw.WORKER_TIMEOUT}"`);
}

export const DEFAULT_MODEL = "claude-sonnet-4.6";

let _copilotModel = raw.COPILOT_MODEL || DEFAULT_MODEL;

export const config = {
  telegramBotToken: raw.TELEGRAM_BOT_TOKEN,
  authorizedUserId: parsedUserId,
  apiPort: parsedPort,
  workerTimeoutMs: parsedWorkerTimeout,
  get copilotModel(): string {
    return _copilotModel;
  },
  set copilotModel(model: string) {
    _copilotModel = model;
  },
  get telegramEnabled(): boolean {
    return !!this.telegramBotToken && this.authorizedUserId !== undefined;
  },
  get selfEditEnabled(): boolean {
    return (process.env.HOOT_SELF_EDIT ?? process.env.MAX_SELF_EDIT) === "1";
  },
};

function persistEnvVar(key: string, value: string): void {
  ensureHootHome();
  try {
    const content = readFileSync(ENV_PATH, "utf-8");
    const lines = content.split("\n");
    let found = false;
    const updated = lines.map((line) => {
      if (line.startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!found) updated.push(`${key}=${value}`);
    writeFileSync(ENV_PATH, updated.join("\n"));
  } catch {
    writeFileSync(ENV_PATH, `${key}=${value}\n`);
  }
}

export function persistModel(model: string): void {
  persistEnvVar("COPILOT_MODEL", model);
}

export const featureFlags = {
  get queueV2(): boolean { return (process.env.HOOT_QUEUE_V2 ?? process.env.MAX_QUEUE_V2) !== "0"; },

  get poolEnabled(): boolean { return (process.env.HOOT_POOL_ENABLED ?? process.env.MAX_POOL_ENABLED) !== "0"; },

  get encryptDb(): boolean { return (process.env.HOOT_ENCRYPT_DB ?? process.env.MAX_ENCRYPT_DB) === "1"; },

  get logFormat(): "json" | "pretty" | "legacy" {
    const v = (process.env.HOOT_LOG_FORMAT ?? process.env.MAX_LOG_FORMAT) ?? "json";
    return (["json", "pretty", "legacy"] as const).includes(v as "json" | "pretty" | "legacy")
      ? v as "json" | "pretty" | "legacy"
      : "json";
  },

  get pluginsEnabled(): boolean { return (process.env.HOOT_PLUGINS_ENABLED ?? process.env.MAX_PLUGINS_ENABLED) === "1"; },
} as const;
