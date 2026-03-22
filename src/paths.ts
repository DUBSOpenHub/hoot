import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

export const HOOT_HOME = join(homedir(), ".max"); // backward compat: ~/.max/ stays

export const DB_PATH = join(HOOT_HOME, "max.db");

export const ENV_PATH = join(HOOT_HOME, ".env");

export const SKILLS_DIR = join(HOOT_HOME, "skills");

export const PLUGINS_DIR = join(HOOT_HOME, "plugins");

export const SESSIONS_DIR = join(HOOT_HOME, "sessions");

export const HISTORY_PATH = join(HOOT_HOME, "tui_history");

export const TUI_DEBUG_LOG_PATH = join(HOOT_HOME, "tui-debug.log");

export const API_TOKEN_PATH = join(HOOT_HOME, "api-token");

/** @deprecated Use HOOT_HOME */
export const MAX_HOME = HOOT_HOME;

export function ensureHootHome(): void {
  mkdirSync(HOOT_HOME, { recursive: true });
}

/** @deprecated Use ensureHootHome */
export const ensureMaxHome = ensureHootHome;
