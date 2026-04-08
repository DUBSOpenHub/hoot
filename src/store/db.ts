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
      CREATE TABLE IF NOT EXISTS hoot_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    // Migrate legacy table name
    try {
      const hasLegacy = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='hoot_state'`).get();
      if (hasLegacy) {
        db.exec(`INSERT OR IGNORE INTO hoot_state (key, value) SELECT key, value FROM hoot_state`);
        db.exec(`DROP TABLE hoot_state`);
      }
    } catch {}
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


    db.exec(`
      CREATE TABLE IF NOT EXISTS queued_messages (
        id              TEXT PRIMARY KEY,
        prompt          TEXT NOT NULL,
        source_type     TEXT NOT NULL,
        source_channel  TEXT,
        status          TEXT NOT NULL DEFAULT 'queued'
                        CHECK(status IN ('queued', 'processing')),
        attempts        INTEGER NOT NULL DEFAULT 0,
        available_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        last_error      TEXT,
        created_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_queued_messages_status_available ON queued_messages(status, available_at, created_at)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id            TEXT PRIMARY KEY,
        kind          TEXT NOT NULL DEFAULT 'marathon',
        prompt        TEXT NOT NULL,
        step_count    INTEGER NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
        current_step  INTEGER NOT NULL DEFAULT 0,
        result        TEXT,
        error         TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        started_at    INTEGER,
        finished_at   INTEGER
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS job_steps (
        id            TEXT PRIMARY KEY,
        job_id        TEXT NOT NULL,
        step_index    INTEGER NOT NULL,
        prompt        TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
        output        TEXT,
        error         TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        started_at    INTEGER,
        finished_at   INTEGER,
        FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
        UNIQUE(job_id, step_index)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_job_steps_job_status ON job_steps(job_id, status, step_index)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS job_events (
        id            TEXT PRIMARY KEY,
        job_id        TEXT NOT NULL,
        event_type    TEXT NOT NULL,
        payload       TEXT,
        created_at    INTEGER NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_job_events_job_created ON job_events(job_id, created_at)`);


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

// Hackathon #48: TTL cache for hot-path reads (from GPT-5.4)
interface CacheEntry<T> { value: T; expires: number }
const _stateCache = new Map<string, CacheEntry<string | undefined>>();
const STATE_CACHE_TTL = 60_000;

export function getState(key: string): string | undefined {
  const cached = _stateCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const db = getDb();
  const row = db.prepare(`SELECT value FROM hoot_state WHERE key = ?`).get(key) as { value: string } | undefined;
  _stateCache.set(key, { value: row?.value, expires: Date.now() + STATE_CACHE_TTL });
  return row?.value;
}

export function setState(key: string, value: string): void {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO hoot_state (key, value) VALUES (?, ?)`).run(key, value);
  _stateCache.set(key, { value, expires: Date.now() + STATE_CACHE_TTL });
}

export function deleteState(key: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM hoot_state WHERE key = ?`).run(key);
  _stateCache.delete(key);
}

export function logConversation(role: "user" | "assistant" | "system", content: string, source: string): void {
  const db = getDb();
  db.prepare(`INSERT INTO conversation_log (role, content, source) VALUES (?, ?, ?)`).run(role, content, source);
  _recentConvCache = undefined; // invalidate cache on new entry
  logInsertCount++;
  if (logInsertCount % 50 === 0) {
    db.prepare(`DELETE FROM conversation_log WHERE id NOT IN (SELECT id FROM conversation_log ORDER BY id DESC LIMIT 200)`).run();
  }
}

// Hackathon #48: cache recent conversation (10s TTL)
let _recentConvCache: CacheEntry<string> | undefined;
const RECENT_CONV_TTL = 10_000;

export function getRecentConversation(limit = 20): string {
  if (_recentConvCache && _recentConvCache.expires > Date.now()) return _recentConvCache.value;
  const db = getDb();
  const rows = db.prepare(
    `SELECT role, content, source, ts FROM conversation_log ORDER BY id DESC LIMIT ?`
  ).all(limit) as { role: string; content: string; source: string; ts: string }[];

  if (rows.length === 0) return "";

  rows.reverse();

  const result = rows.map((r) => {
    const tag = r.role === "user" ? `[${r.source}] User`
      : r.role === "system" ? `[${r.source}] System`
      : "Hoot 🦉";
    const content = r.content.length > 500 ? r.content.slice(0, 500) + "…" : r.content;
    return `${tag}: ${content}`;
  }).join("\n\n");
  _recentConvCache = { value: result, expires: Date.now() + RECENT_CONV_TTL };
  return result;
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
  _memorySummaryCache = undefined; // invalidate cache
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
  if (result.changes > 0) _memorySummaryCache = undefined; // invalidate cache
  return result.changes > 0;
}

// Hackathon #48: cache memory summary (60s TTL)
let _memorySummaryCache: CacheEntry<string> | undefined;
const MEMORY_SUMMARY_TTL = 60_000;

export function getMemorySummary(): string {
  if (_memorySummaryCache && _memorySummaryCache.expires > Date.now()) return _memorySummaryCache.value;
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

  const result = sections.join("\n");
  _memorySummaryCache = { value: result, expires: Date.now() + MEMORY_SUMMARY_TTL };
  return result;
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

export interface QueuedMessageRecord {
  id: string;
  prompt: string;
  source_type: string;
  source_channel: string | null;
  attempts: number;
  created_at: number;
}

export function enqueueQueuedMessage(msg: {
  id: string;
  prompt: string;
  sourceType: string;
  sourceChannel?: string;
}): void {
  const db = getDb();
  const ts = Date.now();
  db.prepare(
    `INSERT OR REPLACE INTO queued_messages
     (id, prompt, source_type, source_channel, status, attempts, available_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', COALESCE((SELECT attempts FROM queued_messages WHERE id = ?), 0), ?, ?, ?)`
  ).run(msg.id, msg.prompt, msg.sourceType, msg.sourceChannel ?? null, msg.id, ts, ts, ts);
}

export function claimQueuedMessage(): QueuedMessageRecord | undefined {
  const db = getDb();
  const ts = Date.now();
  const row = db.prepare(
    `SELECT id, prompt, source_type, source_channel, attempts, created_at
     FROM queued_messages
     WHERE status = 'queued' AND available_at <= ?
     ORDER BY created_at ASC
     LIMIT 1`
  ).get(ts) as QueuedMessageRecord | undefined;

  if (!row) return undefined;

  db.prepare(
    `UPDATE queued_messages
     SET status = 'processing', attempts = attempts + 1, updated_at = ?
     WHERE id = ?`
  ).run(ts, row.id);

  return { ...row, attempts: row.attempts + 1 };
}

export function requeueQueuedMessage(id: string, err?: string, delayMs = 30_000): void {
  const db = getDb();
  const ts = Date.now();
  db.prepare(
    `UPDATE queued_messages
     SET status = 'queued', last_error = ?, available_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(err ?? null, ts + delayMs, ts, id);
}

export function completeQueuedMessage(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM queued_messages WHERE id = ?`).run(id);
}

export function clearQueuedMessages(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM queued_messages`).run();
  return result.changes;
}

export function getQueuedMessageDepth(): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS count FROM queued_messages`).get() as { count: number };
  return row.count;
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
