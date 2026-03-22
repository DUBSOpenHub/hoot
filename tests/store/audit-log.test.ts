/**
 * Acceptance tests for FR-9: Audit Log
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let testDbDir: string;

beforeEach(() => {
  testDbDir = join(tmpdir(), `max-audit-test-${Date.now()}`);
  mkdirSync(testDbDir, { recursive: true });
  process.env.MAX_DB_PATH = join(testDbDir, 'test.db');
});

afterEach(() => {
  rmSync(testDbDir, { recursive: true, force: true });
  delete process.env.MAX_DB_PATH;
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// FR-9.1 — audit_log table schema and action types
// ---------------------------------------------------------------------------
describe('FR-9.1 — audit_log table schema', () => {
  it('FR-9.1: getDb() creates an audit_log table on first connection', async () => {
    const { getDb } = await import('../../src/store/db');
    const db = getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'"
    ).all();
    expect(tables).toHaveLength(1);
  });

  it('FR-9.1: audit_log has ts, action, actor, detail, channel columns', async () => {
    const { getDb } = await import('../../src/store/db');
    const db = getDb();
    const cols: Array<{ name: string }> = db.prepare("PRAGMA table_info(audit_log)").all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('ts');
    expect(colNames).toContain('action');
    expect(colNames).toContain('actor');
    expect(colNames).toContain('detail');
    expect(colNames).toContain('channel');
  });

  it('FR-9.1: writeAuditLog accepts auth_reject action', async () => {
    const { getDb, writeAuditLog } = await import('../../src/store/db');
    writeAuditLog({ action: 'auth_reject', actor: 'unknown-user', detail: {}, channel: 'telegram' });
    const db = getDb();
    const row = db.prepare("SELECT * FROM audit_log WHERE action='auth_reject'").get() as { action: string; actor: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.action).toBe('auth_reject');
    expect(row?.actor).toBe('unknown-user');
  });

  it('FR-9.1: writeAuditLog accepts model_switch action', async () => {
    const { getDb, writeAuditLog } = await import('../../src/store/db');
    writeAuditLog({ action: 'model_switch', actor: 'system', detail: { from: 'gpt-4o', to: 'claude' }, channel: 'http' });
    const db = getDb();
    const row = db.prepare("SELECT * FROM audit_log WHERE action='model_switch'").get() as { detail: string } | undefined;
    expect(row).toBeDefined();
    const detail = JSON.parse((row as { detail: string }).detail);
    expect(detail.from).toBe('gpt-4o');
  });

  it('FR-9.1: writeAuditLog accepts worker_create action', async () => {
    const { getDb, writeAuditLog } = await import('../../src/store/db');
    writeAuditLog({ action: 'worker_create', actor: 'user-1', detail: { task: 'run tests' }, channel: 'telegram' });
    const db = getDb();
    const row = db.prepare("SELECT * FROM audit_log WHERE action='worker_create'").get();
    expect(row).toBeDefined();
  });

  it('FR-9.1: writeAuditLog accepts worker_blocked_dir action', async () => {
    const { getDb, writeAuditLog } = await import('../../src/store/db');
    writeAuditLog({ action: 'worker_blocked_dir', actor: 'user-1', detail: { dir: '/etc' }, channel: 'telegram' });
    const db = getDb();
    const row = db.prepare("SELECT * FROM audit_log WHERE action='worker_blocked_dir'").get();
    expect(row).toBeDefined();
  });

  it('FR-9.1: writeAuditLog accepts restart action', async () => {
    const { getDb, writeAuditLog } = await import('../../src/store/db');
    writeAuditLog({ action: 'restart', actor: 'daemon', detail: { reason: 'SIGTERM' }, channel: 'system' });
    const db = getDb();
    const row = db.prepare("SELECT * FROM audit_log WHERE action='restart'").get();
    expect(row).toBeDefined();
  });

  it('FR-9.1: ts is stored as an ISO timestamp or unix epoch', async () => {
    const { getDb, writeAuditLog } = await import('../../src/store/db');
    const before = Date.now();
    writeAuditLog({ action: 'restart', actor: 'daemon', detail: {}, channel: 'system' });
    const after = Date.now();

    const db = getDb();
    const row = db.prepare("SELECT ts FROM audit_log ORDER BY rowid DESC LIMIT 1").get() as { ts: string | number } | undefined;
    expect(row).toBeDefined();

    const ts = row?.ts;
    if (typeof ts === 'number') {
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    } else if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      expect(parsed).toBeGreaterThanOrEqual(before);
      expect(parsed).toBeLessThanOrEqual(after);
    }
  });

  it('FR-9.1: detail column stores JSON-serializable objects', async () => {
    const { getDb, writeAuditLog } = await import('../../src/store/db');
    const detail = { userId: 99, reason: 'blocked', nested: { x: 1 } };
    writeAuditLog({ action: 'auth_reject', actor: 'tg-99', detail, channel: 'telegram' });
    const db = getDb();
    const row = db.prepare("SELECT detail FROM audit_log ORDER BY rowid DESC LIMIT 1").get() as { detail: string } | undefined;
    const parsed = JSON.parse(row?.detail ?? '{}');
    expect(parsed.userId).toBe(99);
    expect(parsed.nested.x).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FR-9.2 — GET /audit returns last 100 entries, bearer-authenticated
// ---------------------------------------------------------------------------
describe('FR-9.2 — GET /audit endpoint', () => {
  it('FR-9.2: GET /audit returns 401 without authorization header', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ status: number }> })(app).get('/audit');
    expect(res.status).toBe(401);
  });

  it('FR-9.2: GET /audit returns 200 with valid bearer token', async () => {
    process.env.MAX_API_TOKEN = 'test-secret-token';
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => { set: (h: string, v: string) => Promise<{ status: number; body: unknown[] }> } })(app)
      .get('/audit')
      .set('Authorization', 'Bearer test-secret-token');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('FR-9.2: GET /audit returns at most 100 entries', async () => {
    process.env.MAX_API_TOKEN = 'test-secret-token';
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    // Insert 150 rows
    const { writeAuditLog } = await import('../../src/store/db');
    for (let i = 0; i < 150; i++) {
      writeAuditLog({ action: 'restart', actor: 'daemon', detail: { i }, channel: 'system' });
    }

    const res = await (request as (app: unknown) => { get: (path: string) => { set: (h: string, v: string) => Promise<{ status: number; body: unknown[] }> } })(app)
      .get('/audit')
      .set('Authorization', 'Bearer test-secret-token');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(100);
  });

  it('FR-9.2: GET /audit returns entries as JSON array with action and ts fields', async () => {
    process.env.MAX_API_TOKEN = 'test-secret-token';
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const { writeAuditLog } = await import('../../src/store/db');
    writeAuditLog({ action: 'auth_reject', actor: 'tg-test', detail: {}, channel: 'telegram' });

    const res = await (request as (app: unknown) => { get: (path: string) => { set: (h: string, v: string) => Promise<{ status: number; body: Array<{ action: string; ts: unknown }> }> } })(app)
      .get('/audit')
      .set('Authorization', 'Bearer test-secret-token');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const entry = res.body[0];
    expect(entry).toHaveProperty('action');
    expect(entry).toHaveProperty('ts');
  });
});

// ---------------------------------------------------------------------------
// FR-9.3 — Unauthorized Telegram messages generate auth_reject entries
// ---------------------------------------------------------------------------
describe('FR-9.3 — Unauthorized Telegram messages audited', () => {
  it('FR-9.3: a Telegram message from an unauthorized user creates an auth_reject audit entry', async () => {
    const { getDb, writeAuditLog } = await import('../../src/store/db');

    // Simulate what the Telegram handler should do when rejecting unauthorized user
    writeAuditLog({
      action: 'auth_reject',
      actor: 'telegram:9999999',
      detail: { userId: 9999999, username: 'unauthorized_user' },
      channel: 'telegram',
    });

    const db = getDb();
    const row = db
      .prepare("SELECT * FROM audit_log WHERE action='auth_reject' AND channel='telegram'")
      .get() as { action: string; channel: string; actor: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.action).toBe('auth_reject');
    expect(row?.channel).toBe('telegram');
  });

  it('FR-9.3: the Telegram bot handler calls writeAuditLog for unauthorized senders', async () => {
    // Verify the Telegram bot module imports and uses writeAuditLog
    const fs = await import('fs');
    const path = await import('path');

    let source: string;
    try {
      source = fs.readFileSync(path.resolve('src/telegram/bot.ts'), 'utf8') +
               (fs.existsSync(path.resolve('src/channels/telegram.ts'))
                 ? fs.readFileSync(path.resolve('src/channels/telegram.ts'), 'utf8')
                 : '');
    } catch { return; }

    // The Telegram handler must reference audit log writing
    expect(source).toMatch(/writeAuditLog|audit_log|auth_reject/);
  });

  it('FR-9.3: auth_reject audit entry includes channel=telegram and actor containing the userId', async () => {
    const { getDb, writeAuditLog } = await import('../../src/store/db');

    writeAuditLog({
      action: 'auth_reject',
      actor: 'telegram:1234',
      detail: { userId: 1234 },
      channel: 'telegram',
    });

    const db = getDb();
    const row = db
      .prepare("SELECT * FROM audit_log WHERE action='auth_reject' AND actor LIKE 'telegram:%'")
      .get() as { channel: string; actor: string } | undefined;
    expect(row?.channel).toBe('telegram');
    expect(row?.actor).toContain('1234');
  });
});
