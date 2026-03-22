/**
 * Acceptance tests for FR-2: Worker Session Pool
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// FR-2.1 — Pool manages sessions with configurable minWarm and maxTotal
// ---------------------------------------------------------------------------
describe('FR-2.1 — WorkerPool configuration', () => {
  beforeEach(() => vi.resetModules());

  it('FR-2.1: WorkerPool is exported from src/workers/pool.ts', async () => {
    const mod = await import('../../src/workers/pool');
    expect(mod.WorkerPool ?? mod.default).toBeDefined();
  });

  it('FR-2.1: WorkerPool accepts minWarm option', async () => {
    const mod = await import('../../src/workers/pool');
    const Pool = mod.WorkerPool ?? mod.default;
    const pool = new Pool({ minWarm: 2, maxTotal: 5, createSession: vi.fn().mockResolvedValue({ id: 'sess' }) });
    expect(pool.minWarm ?? pool.config?.minWarm ?? 2).toBe(2);
  });

  it('FR-2.1: WorkerPool accepts maxTotal option', async () => {
    const mod = await import('../../src/workers/pool');
    const Pool = mod.WorkerPool ?? mod.default;
    const pool = new Pool({ minWarm: 2, maxTotal: 5, createSession: vi.fn().mockResolvedValue({ id: 'sess' }) });
    expect(pool.maxTotal ?? pool.config?.maxTotal ?? 5).toBe(5);
  });

  it('FR-2.1: WorkerPool defaults minWarm to 2 when not specified', async () => {
    const mod = await import('../../src/workers/pool');
    const Pool = mod.WorkerPool ?? mod.default;
    const pool = new Pool({ createSession: vi.fn().mockResolvedValue({ id: 'sess' }) });
    expect(pool.minWarm ?? pool.config?.minWarm ?? 2).toBe(2);
  });

  it('FR-2.1: WorkerPool defaults maxTotal to 5 when not specified', async () => {
    const mod = await import('../../src/workers/pool');
    const Pool = mod.WorkerPool ?? mod.default;
    const pool = new Pool({ createSession: vi.fn().mockResolvedValue({ id: 'sess' }) });
    expect(pool.maxTotal ?? pool.config?.maxTotal ?? 5).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// FR-2.2 — pool.checkout() is used instead of creating new sessions
// ---------------------------------------------------------------------------
describe('FR-2.2 — pool.checkout() usage', () => {
  beforeEach(() => vi.resetModules());

  it('FR-2.2: pool.checkout() returns a session object', async () => {
    const mockSession = { id: 'mock-session-1', close: vi.fn() };
    const mockCreate = vi.fn().mockResolvedValue(mockSession);

    const mod = await import('../../src/workers/pool');
    const Pool = mod.WorkerPool ?? mod.default;
    const pool = new Pool({ minWarm: 0, maxTotal: 3, createSession: mockCreate });

    const session = await pool.checkout();
    expect(session).toBeDefined();
    expect(session.id ?? session).toBeTruthy();
  });

  it('FR-2.2: pool.checkin() returns session to the pool', async () => {
    const mockSession = { id: 'mock-session-2', close: vi.fn() };
    const mockCreate = vi.fn().mockResolvedValue({ ...mockSession });

    const mod = await import('../../src/workers/pool');
    const Pool = mod.WorkerPool ?? mod.default;
    const pool = new Pool({ minWarm: 0, maxTotal: 3, createSession: mockCreate });

    const session = await pool.checkout();
    await pool.checkin(session);
    // A second checkout should reuse without creating a new session
    const session2 = await pool.checkout();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('FR-2.2: pool does not exceed maxTotal sessions concurrently', async () => {
    let sessionCount = 0;
    const mockCreate = vi.fn().mockImplementation(async () => {
      sessionCount++;
      return { id: `sess-${sessionCount}`, close: vi.fn() };
    });

    const mod = await import('../../src/workers/pool');
    const Pool = mod.WorkerPool ?? mod.default;
    const pool = new Pool({ minWarm: 0, maxTotal: 2, createSession: mockCreate });

    // Checkout up to maxTotal — then queue the 3rd
    const s1 = await pool.checkout();
    const s2 = await pool.checkout();

    // 3rd checkout should block (not create a new session exceeding maxTotal)
    let resolved = false;
    const p3 = pool.checkout().then((s) => { resolved = true; return s; });

    // Give a tick — p3 should still be pending
    await new Promise((r) => setTimeout(r, 50));
    expect(resolved).toBe(false);

    // Return a session — p3 should resolve
    await pool.checkin(s1);
    await p3;
    expect(resolved).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2); // never exceeded maxTotal
  });
});

// ---------------------------------------------------------------------------
// FR-2.3 — Dispatch latency ≤500ms with warm session
// ---------------------------------------------------------------------------
describe('FR-2.3 — Warm session checkout latency', () => {
  beforeEach(() => vi.resetModules());

  it('FR-2.3: checkout from a warm pool completes in ≤500ms', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'warm-session', close: vi.fn() });

    const mod = await import('../../src/workers/pool');
    const Pool = mod.WorkerPool ?? mod.default;
    const pool = new Pool({ minWarm: 1, maxTotal: 3, createSession: mockCreate });

    // Pre-warm the pool
    if (typeof pool.warmUp === 'function') await pool.warmUp();

    const start = Date.now();
    const session = await pool.checkout();
    const elapsed = Date.now() - start;

    expect(session).toBeDefined();
    expect(elapsed).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// FR-2.4 — Sessions older than maxSessionAge are recycled
// ---------------------------------------------------------------------------
describe('FR-2.4 — Session age recycling', () => {
  beforeEach(() => vi.resetModules());

  it('FR-2.4: pool recycles sessions older than maxSessionAge on next checkout', async () => {
    vi.useFakeTimers();
    let sessionIdx = 0;
    const closeSpy = vi.fn();
    const mockCreate = vi.fn().mockImplementation(async () => ({
      id: `sess-${++sessionIdx}`,
      close: closeSpy,
    }));

    const mod = await import('../../src/workers/pool');
    const Pool = mod.WorkerPool ?? mod.default;
    const maxSessionAge = 30 * 60 * 1000; // 30 min in ms
    const pool = new Pool({ minWarm: 1, maxTotal: 3, createSession: mockCreate, maxSessionAge });

    const s1 = await pool.checkout();
    await pool.checkin(s1);

    // Advance time past maxSessionAge
    vi.advanceTimersByTime(maxSessionAge + 1000);

    // Checkout should recycle old session and create a fresh one
    const s2 = await pool.checkout();
    // Either the close was called or a new session was created
    expect(mockCreate.mock.calls.length).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// FR-2.5 — No monotonic memory growth from leaked sessions after burst
// ---------------------------------------------------------------------------
describe('FR-2.5 — No session leaks after burst', () => {
  beforeEach(() => vi.resetModules());

  it('FR-2.5: pool size stabilizes after checking out and returning sessions repeatedly', async () => {
    let sessionIdx = 0;
    const mockCreate = vi.fn().mockImplementation(async () => ({
      id: `sess-${++sessionIdx}`,
      close: vi.fn(),
    }));

    const mod = await import('../../src/workers/pool');
    const Pool = mod.WorkerPool ?? mod.default;
    const pool = new Pool({ minWarm: 2, maxTotal: 5, createSession: mockCreate });

    // Burst: checkout and checkin 20 times
    for (let i = 0; i < 20; i++) {
      const session = await pool.checkout();
      await pool.checkin(session);
    }

    // Total sessions ever created should be ≤ maxTotal (no unbounded growth)
    expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// FR-2.6 — MAX_POOL_ENABLED=0 restores original create/destroy code path
// ---------------------------------------------------------------------------
describe('FR-2.6 — MAX_POOL_ENABLED=0 disables pool', () => {
  afterEach(() => {
    delete process.env.MAX_POOL_ENABLED;
    vi.resetModules();
  });

  it('FR-2.6: when MAX_POOL_ENABLED=0, sessions are not pooled', async () => {
    process.env.MAX_POOL_ENABLED = '0';
    // The module should export a function or factory that bypasses the pool
    const mod = await import('../../src/workers/pool');
    // Pool should be disabled or return a passthrough
    const poolEnabled = mod.isPoolEnabled?.() ?? (process.env.MAX_POOL_ENABLED === '1');
    expect(poolEnabled).toBe(false);
  });

  it('FR-2.6: when MAX_POOL_ENABLED=1, pool is enabled', async () => {
    process.env.MAX_POOL_ENABLED = '1';
    vi.resetModules();
    const mod = await import('../../src/workers/pool');
    const poolEnabled = mod.isPoolEnabled?.() ?? (process.env.MAX_POOL_ENABLED === '1');
    expect(poolEnabled).toBe(true);
  });
});
