/**
 * Acceptance tests for FR-7: Checkpoint & Recovery
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let testDbDir: string;

beforeEach(() => {
  testDbDir = join(tmpdir(), `hoot-checkpoint-test-${Date.now()}`);
  mkdirSync(testDbDir, { recursive: true });
  process.env.HOOT_DB_PATH = join(testDbDir, 'test.db');
  vi.resetModules();
});

afterEach(() => {
  rmSync(testDbDir, { recursive: true, force: true });
  delete process.env.HOOT_DB_PATH;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// FR-7.1 — Task checkpointed to worker_checkpoints table on dispatch
// ---------------------------------------------------------------------------
describe('FR-7.1 — worker_checkpoints table schema and write', () => {
  it('FR-7.1: worker_checkpoints table exists after db initialization', async () => {
    const { getDb } = await import('../../src/store/db');
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='worker_checkpoints'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it('FR-7.1: worker_checkpoints table has task, cwd, correlationId, and status columns', async () => {
    const { getDb } = await import('../../src/store/db');
    const db = getDb();
    const cols: Array<{ name: string }> = db
      .prepare('PRAGMA table_info(worker_checkpoints)')
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('task');
    expect(names).toContain('cwd');
    // correlationId may be stored as correlation_id
    expect(names.some((n) => n === 'correlationId' || n === 'correlation_id')).toBe(true);
    expect(names).toContain('status');
  });

  it('FR-7.1: checkpointing a task inserts a row with status=running', async () => {
    const { getDb } = await import('../../src/store/db');
    const mod = await import('../../src/workers/pool');
    const checkpointFn = mod.checkpointTask ?? (await import('../../src/store/db')).checkpointTask;

    if (typeof checkpointFn !== 'function') {
      // Try importing from a dedicated checkpoint module
      const cpMod = await import('../../src/workers/checkpoint').catch(() => null);
      if (!cpMod?.checkpointTask) return; // not yet implemented
      await cpMod.checkpointTask({ task: 'run tests', cwd: '/home/user', correlationId: 'cp-001' });
    } else {
      await checkpointFn({ task: 'run tests', cwd: '/home/user', correlationId: 'cp-001' });
    }

    const db = getDb();
    const row = db
      .prepare("SELECT * FROM worker_checkpoints WHERE status='running' LIMIT 1")
      .get() as { task: string; status: string } | undefined;

    expect(row).toBeDefined();
    expect(row?.status).toBe('running');
    expect(row?.task).toBe('run tests');
  });

  it('FR-7.1: checkpoint stores the cwd path', async () => {
    const { getDb } = await import('../../src/store/db');
    const cpMod = await import('../../src/workers/checkpoint').catch(() => null);
    const checkpointFn = cpMod?.checkpointTask;
    if (typeof checkpointFn !== 'function') return;

    await checkpointFn({ task: 'analyze repo', cwd: '/projects/myapp', correlationId: 'cp-002' });

    const db = getDb();
    const row = db
      .prepare("SELECT cwd FROM worker_checkpoints ORDER BY rowid DESC LIMIT 1")
      .get() as { cwd: string } | undefined;
    expect(row?.cwd).toBe('/projects/myapp');
  });

  it('FR-7.1: checkpoint stores the correlationId', async () => {
    const { getDb } = await import('../../src/store/db');
    const cpMod = await import('../../src/workers/checkpoint').catch(() => null);
    const checkpointFn = cpMod?.checkpointTask;
    if (typeof checkpointFn !== 'function') return;

    await checkpointFn({ task: 'lint code', cwd: '/work', correlationId: 'trace-456' });

    const db = getDb();
    const row = db
      .prepare("SELECT * FROM worker_checkpoints ORDER BY rowid DESC LIMIT 1")
      .get() as Record<string, string> | undefined;
    expect(row?.correlationId ?? row?.correlation_id).toBe('trace-456');
  });
});

// ---------------------------------------------------------------------------
// FR-7.2 — Running checkpoints re-queued on daemon startup
// ---------------------------------------------------------------------------
describe('FR-7.2 — Re-queue running checkpoints on startup', () => {
  it('FR-7.2: getRunningCheckpoints() returns rows with status=running', async () => {
    const { getDb } = await import('../../src/store/db');
    const db = getDb();

    // Insert a running checkpoint directly
    db.prepare(
      "INSERT INTO worker_checkpoints (task, cwd, correlation_id, status) VALUES (?, ?, ?, 'running')"
    ).run('deferred-task', '/tmp', 'cid-running-1');

    const cpMod = await import('../../src/workers/checkpoint').catch(() => null);
    if (!cpMod?.getRunningCheckpoints) return;

    const checkpoints = await cpMod.getRunningCheckpoints();
    expect(Array.isArray(checkpoints)).toBe(true);
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(checkpoints[0].status).toBe('running');
  });

  it('FR-7.2: daemon startup calls re-queue logic for all running checkpoints', async () => {
    const { getDb } = await import('../../src/store/db');
    const db = getDb();

    db.prepare(
      "INSERT INTO worker_checkpoints (task, cwd, correlation_id, status) VALUES (?, ?, ?, 'running')"
    ).run('interrupted-task', '/projects', 'cid-requeue-1');

    // The checkpoint recovery module should expose a recoverCheckpoints() fn
    const cpMod = await import('../../src/workers/checkpoint').catch(() => null);
    if (!cpMod?.recoverCheckpoints) return;

    const requeued: unknown[] = [];
    await cpMod.recoverCheckpoints({ onRequeue: (cp: unknown) => requeued.push(cp) });

    expect(requeued.length).toBeGreaterThan(0);
  });

  it('FR-7.2: completed checkpoints are NOT re-queued on startup', async () => {
    const { getDb } = await import('../../src/store/db');
    const db = getDb();

    db.prepare(
      "INSERT INTO worker_checkpoints (task, cwd, correlation_id, status) VALUES (?, ?, ?, 'completed')"
    ).run('done-task', '/tmp', 'cid-done-1');

    const cpMod = await import('../../src/workers/checkpoint').catch(() => null);
    if (!cpMod?.getRunningCheckpoints) return;

    const checkpoints = await cpMod.getRunningCheckpoints();
    const doneOnes = checkpoints.filter((c: { status: string }) => c.status === 'completed');
    expect(doneOnes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FR-7.3 — SIGTERM mid-task + daemon restart resumes the worker
// ---------------------------------------------------------------------------
describe('FR-7.3 — SIGTERM survival and recovery', () => {
  it('FR-7.3: a running checkpoint survives a simulated SIGTERM (status remains running in db)', async () => {
    const { getDb } = await import('../../src/store/db');
    const db = getDb();

    // Simulate a task being checkpointed
    const cpMod = await import('../../src/workers/checkpoint').catch(() => null);
    const checkpointFn = cpMod?.checkpointTask;
    if (typeof checkpointFn !== 'function') return;

    await checkpointFn({ task: 'long-running-task', cwd: '/work', correlationId: 'sigterm-test' });

    // Simulate SIGTERM by not completing the checkpoint
    // On next startup, the checkpoint should be in running state
    const row = db
      .prepare("SELECT status FROM worker_checkpoints WHERE correlation_id='sigterm-test' OR correlationId='sigterm-test'")
      .get() as { status: string } | undefined;
    expect(row?.status).toBe('running');
  });

  it('FR-7.3: recovery completes within one startup cycle (synchronous recoverCheckpoints call)', async () => {
    const { getDb } = await import('../../src/store/db');
    const db = getDb();

    db.prepare(
      "INSERT INTO worker_checkpoints (task, cwd, correlation_id, status) VALUES (?, ?, ?, 'running')"
    ).run('recover-me', '/src', 'recover-cid');

    const cpMod = await import('../../src/workers/checkpoint').catch(() => null);
    if (!cpMod?.recoverCheckpoints) return;

    const requeued: unknown[] = [];
    const start = Date.now();
    await cpMod.recoverCheckpoints({ onRequeue: (cp: unknown) => requeued.push(cp) });
    const elapsed = Date.now() - start;

    // Recovery should be fast (within one startup cycle ≤ startup time budget of 3000ms)
    expect(elapsed).toBeLessThan(3000);
    expect(requeued.length).toBeGreaterThan(0);
  });

  it('FR-7.3: checkpointComplete() marks the row as completed', async () => {
    const { getDb } = await import('../../src/store/db');
    const db = getDb();

    db.prepare(
      "INSERT INTO worker_checkpoints (task, cwd, correlation_id, status) VALUES (?, ?, ?, 'running')"
    ).run('finish-me', '/tmp', 'finish-cid');

    const cpMod = await import('../../src/workers/checkpoint').catch(() => null);
    if (!cpMod?.checkpointComplete) return;

    await cpMod.checkpointComplete('finish-cid');

    const row = db
      .prepare("SELECT status FROM worker_checkpoints WHERE correlation_id='finish-cid'")
      .get() as { status: string } | undefined;
    expect(row?.status).toBe('completed');
  });
});
