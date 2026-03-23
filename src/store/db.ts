import Database from "better-sqlite3";
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { dirname } from "path";
import { DB_PATH, ensureHootHome } from "../paths.js";
// Encryption: HKDF-SHA256 key derivation with salt "max-db-v1" (see migrate-encrypt.ts)
import { deriveDbKey } from "./migrate-encrypt.js";
import { createLogger } from "../observability/logger.js";

const log = createLogger("db");

let db: Database.Database | undefined;
let logInsertCount = 0;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = (process.env.HOOT_DB_PATH ?? process.env.MAX_DB_PATH) ?? DB_PATH;
    if (process.env.HOOT_DB_PATH || process.env.MAX_DB_PATH) {
      try { mkdirSync(dirname(dbPath), { recursive: true }); } catch {}
    } else {
      ensureHootHome();
    }

    // Clean up orphaned WAL/SHM files that can prevent DB from opening
    const walPath = dbPath + "-wal";
    const shmPath = dbPath + "-shm";
    let walCleanupAttempted = false;
    if (existsSync(walPath) || existsSync(shmPath)) {
      try {
        // Try opening normally first — WAL files are expected during normal operation
        const testDb = new Database(dbPath);
        testDb.close();
      } catch {
        // DB can't be opened with existing WAL/SHM — they're orphaned
        walCleanupAttempted = true;
        log.warn("Removing orphaned WAL/SHM files to recover database", { walPath, shmPath });
        try { if (existsSync(walPath)) unlinkSync(walPath); } catch {}
        try { if (existsSync(shmPath)) unlinkSync(shmPath); } catch {}
      }
    }

    let openPath = dbPath;
    if ((process.env.HOOT_ENCRYPT_DB ?? process.env.MAX_ENCRYPT_DB) === '1' && existsSync(dbPath)) {
      const header = readFileSync(dbPath).slice(0, 16);
      if (!header.toString('ascii').startsWith('SQLite format 3')) {
        try {
          const key = deriveDbKey(process.env.HOOT_TOKEN_PATH ?? process.env.MAX_TOKEN_PATH);
          const keyBytes = Buffer.from(key, 'hex');
          const bytes = readFileSync(dbPath);
          for (let i = 0; i < bytes.length; i++) bytes[i] ^= keyBytes[i % keyBytes.length];
          const tmpPath = dbPath + '.decrypted-tmp';
          writeFileSync(tmpPath, bytes);
          openPath = tmpPath;
        } catch { /* fall through, let Database() throw */ }
      }
    }

    db = new Database(openPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS worker_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        copilot_session_id TEXT,
        working_dir TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        last_output TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS max_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'unknown',
        ts DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL CHECK(category IN ('preference', 'fact', 'project', 'person', 'routine')),
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        ts      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        action  TEXT NOT NULL,
        actor   TEXT NOT NULL,
        detail  TEXT NOT NULL,
        channel TEXT
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_ts     ON audit_log(ts DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS worker_checkpoints (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        task           TEXT NOT NULL DEFAULT '',
        cwd            TEXT NOT NULL DEFAULT '',
        correlation_id TEXT NOT NULL DEFAULT '',
        correlationId  TEXT NOT NULL DEFAULT '',
        status         TEXT NOT NULL DEFAULT 'running'
                       CHECK(status IN ('running', 'completed', 'failed')),
        started_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        name           TEXT,
        working_dir    TEXT,
        prompt         TEXT,
        origin_channel TEXT
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS worker_pool_state (
        session_id      TEXT PRIMARY KEY,
        status          TEXT NOT NULL DEFAULT 'warm'
                        CHECK(status IN ('warm', 'checked-out')),
        created_at      INTEGER NOT NULL,
        checked_out_at  INTEGER,
        working_dir     TEXT
      )
    `);

    try {
      db.prepare(`INSERT INTO conversation_log (role, content, source) VALUES ('system', '__migration_test__', 'test')`).run();
      db.prepare(`DELETE FROM conversation_log WHERE content = '__migration_test__'`).run();
    } catch {
      db.exec(`ALTER TABLE conversation_log RENAME TO conversation_log_old`);
      db.exec(`
        CREATE TABLE conversation_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'unknown',
          ts DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`INSERT INTO conversation_log (role, content, source, ts) SELECT role, content, source, ts FROM conversation_log_old`);
      db.exec(`DROP TABLE conversation_log_old`);
    }
    db.prepare(`DELETE FROM conversation_log WHERE id NOT IN (SELECT id FROM conversation_log ORDER BY id DESC LIMIT 200)`).run();
  }
  return db;
}

export function getState(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM max_state WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value;
}

export function setState(key: string, value: string): void {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO max_state (key, value) VALUES (?, ?)`).run(key, value);
}

export function deleteState(key: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM max_state WHERE key = ?`).run(key);
}

export function logConversation(role: "user" | "assistant" | "system", content: string, source: string): void {
  const db = getDb();
  db.prepare(`INSERT INTO conversation_log (role, content, source) VALUES (?, ?, ?)`).run(role, content, source);
  logInsertCount++;
  if (logInsertCount % 50 === 0) {
    db.prepare(`DELETE FROM conversation_log WHERE id NOT IN (SELECT id FROM conversation_log ORDER BY id DESC LIMIT 200)`).run();
  }
}

export function getRecentConversation(limit = 20): string {
  const db = getDb();
  const rows = db.prepare(
    `SELECT role, content, source, ts FROM conversation_log ORDER BY id DESC LIMIT ?`
  ).all(limit) as { role: string; content: string; source: string; ts: string }[];

  if (rows.length === 0) return "";

  rows.reverse();

  return rows.map((r) => {
    const tag = r.role === "user" ? `[${r.source}] User`
      : r.role === "system" ? `[${r.source}] System`
      : "Hoot 🦉";
    const content = r.content.length > 500 ? r.content.slice(0, 500) + "…" : r.content;
    return `${tag}: ${content}`;
  }).join("\n\n");
}

export function addMemory(
  category: "preference" | "fact" | "project" | "person" | "routine",
  content: string,
  source: "user" | "auto" = "user"
): number {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO memories (category, content, source) VALUES (?, ?, ?)`
  ).run(category, content, source);
  return result.lastInsertRowid as number;
}

export function searchMemories(
  keyword?: string,
  category?: string,
  limit = 20
): { id: number; category: string; content: string; source: string; created_at: string }[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (keyword) {
    conditions.push(`content LIKE ?`);
    params.push(`%${keyword}%`);
  }
  if (category) {
    conditions.push(`category = ?`);
    params.push(category);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = db.prepare(
    `SELECT id, category, content, source, created_at FROM memories ${where} ORDER BY last_accessed DESC LIMIT ?`
  ).all(...params) as { id: number; category: string; content: string; source: string; created_at: string }[];

  if (rows.length > 0) {
    const placeholders = rows.map(() => "?").join(",");
    db.prepare(`UPDATE memories SET last_accessed = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...rows.map((r) => r.id));
  }

  return rows;
}

export function removeMemory(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getMemorySummary(): string {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, category, content FROM memories ORDER BY category, last_accessed DESC`
  ).all() as { id: number; category: string; content: string }[];

  if (rows.length === 0) return "";

  const grouped: Record<string, { id: number; content: string }[]> = {};
  for (const r of rows) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push({ id: r.id, content: r.content });
  }

  const sections = Object.entries(grouped).map(([cat, items]) => {
    const lines = items.map((i) => `  - [#${i.id}] ${i.content}`).join("\n");
    return `**${cat}**:\n${lines}`;
  });

  return sections.join("\n");
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}

export function logAudit(
  action: string,
  actor: string,
  detail: Record<string, unknown>,
  channel?: string
): void {
  try {
    const db = getDb();
    const ts = Date.now();
    db.prepare(
      `INSERT INTO audit_log (ts, action, actor, detail, channel) VALUES (?, ?, ?, ?, ?)`
    ).run(ts, action, actor, JSON.stringify(detail), channel ?? null);
    db.prepare(
      `DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT 10000)`
    ).run();
  } catch {
  }
}

export function getAuditLog(limit = 100): {
  id: number; ts: string; action: string; actor: string; detail: string; channel: string | null;
}[] {
  const db = getDb();
  return db.prepare(
    `SELECT id, ts, action, actor, detail, channel FROM audit_log ORDER BY id DESC LIMIT ?`
  ).all(limit) as { id: number; ts: string; action: string; actor: string; detail: string; channel: string | null }[];
}

export interface WorkerCheckpoint {
  correlation_id: string;
  name: string;
  working_dir: string;
  prompt: string;
  started_at: number;
  origin_channel?: string;
}

export function insertCheckpoint(cp: WorkerCheckpoint): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO worker_checkpoints
     (correlation_id, name, working_dir, prompt, started_at, origin_channel, status)
     VALUES (?, ?, ?, ?, ?, ?, 'running')`
  ).run(cp.correlation_id, cp.name, cp.working_dir, cp.prompt, cp.started_at, cp.origin_channel ?? null);
}

export function deleteCheckpoint(name: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM worker_checkpoints WHERE name = ?`).run(name);
}

export function getPendingCheckpoints(): WorkerCheckpoint[] {
  const db = getDb();
  return db.prepare(
    `SELECT correlation_id, name, working_dir, prompt, started_at, origin_channel
     FROM worker_checkpoints WHERE status = 'running'`
  ).all() as WorkerCheckpoint[];
}

export function writeAuditLog(opts: {
  action: string;
  actor: string;
  detail: Record<string, unknown>;
  channel?: string;
}): void {
  logAudit(opts.action, opts.actor, opts.detail, opts.channel);
}

// FR-5: Re-export encryption migration (uses HKDF crypto with salt "max-db-v1")
export { migrateToEncrypted } from './migrate-encrypt.js';
export { deriveDbKey };
