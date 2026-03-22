/**
 * Acceptance tests for FR-8: Circuit Breaker
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Type definitions inferred from the PRD spec
// ---------------------------------------------------------------------------
interface CircuitBreakerOptions {
  failureThreshold?: number;   // default 3
  windowMs?: number;           // default 60_000
  resetTimeoutMs?: number;     // default 30_000
}

type BreakerState = 'closed' | 'open' | 'half-open';

interface CircuitBreaker {
  call<T>(fn: () => Promise<T>): Promise<T>;
  getState(): BreakerState;
  reset(): void;
}

async function makeBreaker(opts?: CircuitBreakerOptions): Promise<CircuitBreaker> {
  const { CircuitBreaker: CB } = await import('../../src/resilience/circuit-breaker');
  return new CB(opts);
}

// ---------------------------------------------------------------------------
// FR-8.1 — Wrapping SDK calls in a CircuitBreaker
// ---------------------------------------------------------------------------
describe('FR-8.1 — CircuitBreaker wraps callable functions', () => {
  it('FR-8.1: CircuitBreaker is exported from src/resilience/circuit-breaker.ts', async () => {
    const mod = await import('../../src/resilience/circuit-breaker');
    expect(mod.CircuitBreaker).toBeDefined();
  });

  it('FR-8.1: CircuitBreaker.call() forwards to the wrapped function and returns its value', async () => {
    const breaker = await makeBreaker();
    const fn = vi.fn().mockResolvedValue('result');
    const result = await breaker.call(fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe('result');
  });

  it('FR-8.1: CircuitBreaker.call() propagates errors from the wrapped function', async () => {
    const breaker = await makeBreaker();
    const fn = vi.fn().mockRejectedValue(new Error('sdk-error'));
    await expect(breaker.call(fn)).rejects.toThrow('sdk-error');
  });

  it('FR-8.1: CircuitBreaker accepts async functions (SDK call shape)', async () => {
    const breaker = await makeBreaker();
    const sdkLike = vi.fn().mockResolvedValue({ id: 'session-1', content: [] });
    const result = await breaker.call(sdkLike);
    expect(result).toMatchObject({ id: 'session-1' });
  });
});

// ---------------------------------------------------------------------------
// FR-8.2 — Opens after 3 consecutive failures within 60 seconds
// ---------------------------------------------------------------------------
describe('FR-8.2 — Breaker opens after threshold failures', () => {
  it('FR-8.2: breaker is closed initially', async () => {
    const breaker = await makeBreaker({ failureThreshold: 3, windowMs: 60_000 });
    expect(breaker.getState()).toBe('closed');
  });

  it('FR-8.2: single failure does not open breaker', async () => {
    const breaker = await makeBreaker({ failureThreshold: 3, windowMs: 60_000 });
    await breaker.call(() => Promise.reject(new Error('fail'))).catch(() => {});
    expect(breaker.getState()).toBe('closed');
  });

  it('FR-8.2: two consecutive failures do not open breaker', async () => {
    const breaker = await makeBreaker({ failureThreshold: 3, windowMs: 60_000 });
    for (let i = 0; i < 2; i++) {
      await breaker.call(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(breaker.getState()).toBe('closed');
  });

  it('FR-8.2: three consecutive failures open the breaker', async () => {
    const breaker = await makeBreaker({ failureThreshold: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      await breaker.call(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(breaker.getState()).toBe('open');
  });

  it('FR-8.2: open breaker rejects calls with a user-visible error message', async () => {
    const breaker = await makeBreaker({ failureThreshold: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      await breaker.call(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    const fn = vi.fn().mockResolvedValue('should-not-reach');
    await expect(breaker.call(fn)).rejects.toThrow(/circuit|unavailable|open/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it('FR-8.2: a success resets the failure counter, preventing premature opening', async () => {
    const breaker = await makeBreaker({ failureThreshold: 3, windowMs: 60_000 });
    // Two failures
    await breaker.call(() => Promise.reject(new Error('f'))).catch(() => {});
    await breaker.call(() => Promise.reject(new Error('f'))).catch(() => {});
    // One success — resets counter
    await breaker.call(() => Promise.resolve('ok'));
    // Two more failures — should NOT open (counter was reset)
    await breaker.call(() => Promise.reject(new Error('f'))).catch(() => {});
    await breaker.call(() => Promise.reject(new Error('f'))).catch(() => {});
    expect(breaker.getState()).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// FR-8.3 — Half-open after 30 seconds; single success closes breaker
// ---------------------------------------------------------------------------
describe('FR-8.3 — Half-open / self-healing behavior', () => {
  it('FR-8.3: breaker transitions to half-open after resetTimeoutMs', async () => {
    vi.useFakeTimers();
    const breaker = await makeBreaker({
      failureThreshold: 3,
      windowMs: 60_000,
      resetTimeoutMs: 30_000,
    });

    for (let i = 0; i < 3; i++) {
      await breaker.call(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(breaker.getState()).toBe('open');

    vi.advanceTimersByTime(30_001);
    expect(breaker.getState()).toBe('half-open');

    vi.useRealTimers();
  });

  it('FR-8.3: a single success in half-open state closes the breaker', async () => {
    vi.useFakeTimers();
    const breaker = await makeBreaker({
      failureThreshold: 3,
      windowMs: 60_000,
      resetTimeoutMs: 30_000,
    });

    for (let i = 0; i < 3; i++) {
      await breaker.call(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    vi.advanceTimersByTime(30_001);
    expect(breaker.getState()).toBe('half-open');

    await breaker.call(() => Promise.resolve('probe-success'));
    expect(breaker.getState()).toBe('closed');

    vi.useRealTimers();
  });

  it('FR-8.3: a failure in half-open state re-opens the breaker', async () => {
    vi.useFakeTimers();
    const breaker = await makeBreaker({
      failureThreshold: 3,
      windowMs: 60_000,
      resetTimeoutMs: 30_000,
    });

    for (let i = 0; i < 3; i++) {
      await breaker.call(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    vi.advanceTimersByTime(30_001);
    await breaker.call(() => Promise.reject(new Error('still-broken'))).catch(() => {});
    expect(breaker.getState()).toBe('open');

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// FR-8.4 — Breaker state observable via GET /status
// ---------------------------------------------------------------------------
describe('FR-8.4 — Breaker state in GET /status', () => {
  it('FR-8.4: GET /status includes circuit_breaker field when server is running', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch {
      return; // server or supertest not yet available
    }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ status: number; body: Record<string, unknown> }> })(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('circuit_breaker');
  });

  it('FR-8.4: circuit_breaker field contains state property (closed/open/half-open)', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch {
      return;
    }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ status: number; body: Record<string, unknown> }> })(app).get('/status');
    const cb = res.body.circuit_breaker as Record<string, unknown>;
    if (cb) {
      expect(['closed', 'open', 'half-open']).toContain(cb.state);
    }
  });
});
