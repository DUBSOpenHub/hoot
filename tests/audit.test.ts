import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";

// Test helpers that mirror the audit log functions but use a temp DB
function setupTestDb() {
  const dir = join(tmpdir(), `hoot-audit-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "test.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_checkpoints (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id TEXT NOT NULL,
      name           TEXT NOT NULL UNIQUE,
      working_dir    TEXT NOT NULL,
      prompt         TEXT NOT NULL,
      started_at     INTEGER NOT NULL,
      origin_channel TEXT,
      status         TEXT NOT NULL DEFAULT 'running'
    )
  `);

  return { db, dir };
}

function logAuditInDb(db: Database.Database, action: string, actor: string, detail: Record<string, unknown>, channel?: string) {
  db.prepare(
    `INSERT INTO audit_log (action, actor, detail, channel) VALUES (?, ?, ?, ?)`
  ).run(action, actor, JSON.stringify(detail), channel ?? null);
}

function getAuditLogFromDb(db: Database.Database, limit = 100) {
  return db.prepare(
    `SELECT id, ts, action, actor, detail, channel FROM audit_log ORDER BY id DESC LIMIT ?`
  ).all(limit);
}

function insertCheckpointInDb(db: Database.Database, cp: {
  correlation_id: string;
  name: string;
  working_dir: string;
  prompt: string;
  started_at: number;
  origin_channel?: string;
}) {
  db.prepare(
    `INSERT OR REPLACE INTO worker_checkpoints
     (correlation_id, name, working_dir, prompt, started_at, origin_channel, status)
     VALUES (?, ?, ?, ?, ?, ?, 'running')`
  ).run(cp.correlation_id, cp.name, cp.working_dir, cp.prompt, cp.started_at, cp.origin_channel ?? null);
}

function deleteCheckpointInDb(db: Database.Database, name: string) {
  db.prepare(`DELETE FROM worker_checkpoints WHERE name = ?`).run(name);
}

function getPendingCheckpointsFromDb(db: Database.Database) {
  return db.prepare(
    `SELECT correlation_id, name, working_dir, prompt, started_at, origin_channel
     FROM worker_checkpoints WHERE status = 'running'`
  ).all();
}

describe("Audit Log helpers", () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    const setup = setupTestDb();
    db = setup.db;
    tmpDir = setup.dir;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("inserts an audit entry", () => {
    logAuditInDb(db, "auth_reject", "user-123", { path: "/message" }, "telegram");
    const entries = getAuditLogFromDb(db, 10) as any[];
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("auth_reject");
    expect(entries[0].actor).toBe("user-123");
    expect(entries[0].channel).toBe("telegram");
    const detail = JSON.parse(entries[0].detail);
    expect(detail.path).toBe("/message");
  });

  it("inserts multiple entries and returns in reverse order", () => {
    logAuditInDb(db, "restart", "daemon", {});
    logAuditInDb(db, "model_switch", "user", { model: "gpt-4.1" });
    logAuditInDb(db, "worker_create", "daemon", { name: "auth-fix" });

    const entries = getAuditLogFromDb(db, 10) as any[];
    expect(entries).toHaveLength(3);
    expect(entries[0].action).toBe("worker_create"); // Most recent first
    expect(entries[2].action).toBe("restart"); // Oldest last
  });

  it("detail is valid JSON", () => {
    logAuditInDb(db, "model_switch", "daemon", { from: "sonnet", to: "opus", reason: "auto" });
    const entries = getAuditLogFromDb(db, 1) as any[];
    const detail = JSON.parse(entries[0].detail);
    expect(detail.from).toBe("sonnet");
    expect(detail.to).toBe("opus");
  });

  it("handles null channel gracefully", () => {
    logAuditInDb(db, "restart", "daemon", { version: "1.0" });
    const entries = getAuditLogFromDb(db, 1) as any[];
    expect(entries[0].channel).toBeNull();
  });
});

describe("Worker Checkpoints", () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    const setup = setupTestDb();
    db = setup.db;
    tmpDir = setup.dir;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("inserts a checkpoint", () => {
    insertCheckpointInDb(db, {
      correlation_id: "corr-1",
      name: "auth-worker",
      working_dir: "/home/user/project",
      prompt: "Fix the auth module",
      started_at: Date.now(),
      origin_channel: "telegram",
    });

    const checkpoints = getPendingCheckpointsFromDb(db) as any[];
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].name).toBe("auth-worker");
    expect(checkpoints[0].origin_channel).toBe("telegram");
  });

  it("deletes a checkpoint after completion", () => {
    insertCheckpointInDb(db, {
      correlation_id: "corr-2",
      name: "bg-worker",
      working_dir: "/tmp",
      prompt: "Do something",
      started_at: Date.now(),
    });

    deleteCheckpointInDb(db, "bg-worker");
    const checkpoints = getPendingCheckpointsFromDb(db) as any[];
    expect(checkpoints).toHaveLength(0);
  });

  it("getPendingCheckpoints returns only running status", () => {
    insertCheckpointInDb(db, {
      correlation_id: "corr-3",
      name: "worker-1",
      working_dir: "/tmp",
      prompt: "task 1",
      started_at: Date.now(),
    });
    insertCheckpointInDb(db, {
      correlation_id: "corr-4",
      name: "worker-2",
      working_dir: "/tmp",
      prompt: "task 2",
      started_at: Date.now(),
    });

    // Delete one
    deleteCheckpointInDb(db, "worker-1");

    const checkpoints = getPendingCheckpointsFromDb(db) as any[];
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].name).toBe("worker-2");
  });

  it("upserts checkpoint if name already exists (OR REPLACE)", () => {
    const cp = {
      correlation_id: "corr-5",
      name: "unique-worker",
      working_dir: "/tmp/old",
      prompt: "old task",
      started_at: 1000,
    };
    insertCheckpointInDb(db, cp);
    insertCheckpointInDb(db, { ...cp, working_dir: "/tmp/new", prompt: "new task" });

    const checkpoints = getPendingCheckpointsFromDb(db) as any[];
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].working_dir).toBe("/tmp/new");
  });
});
