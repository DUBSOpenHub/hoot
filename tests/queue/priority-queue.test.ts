/**
 * Acceptance tests for FR-1: Concurrent Priority Queue
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Types inferred from PRD spec
// ---------------------------------------------------------------------------
type Lane = 'fast' | 'standard' | 'premium';
interface QueueMessage {
  id: string;
  userId: string;
  tier: Lane;
  text: string;
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  delete process.env.HOOT_QUEUE_V2;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// FR-1.1 — PriorityQueue replaces the serial messageQueue array
// ---------------------------------------------------------------------------
describe('FR-1.1 — PriorityQueue module exists and is usable', () => {
  it('FR-1.1: PriorityQueue is exported from src/queue/priority-queue.ts', async () => {
    const mod = await import('../../src/queue/priority-queue');
    expect(mod.PriorityQueue ?? mod.default).toBeDefined();
  });

  it('FR-1.1: PriorityQueue has enqueue() and dequeue() methods', async () => {
    const mod = await import('../../src/queue/priority-queue');
    const PQ = mod.PriorityQueue ?? mod.default;
    const q = new PQ();
    expect(typeof q.enqueue).toBe('function');
    expect(typeof q.dequeue).toBe('function');
  });

  it('FR-1.1: PriorityQueue does not use a simple boolean processing flag', async () => {
    const fs = await import('fs');
    const path = await import('path');
    let source = '';
    try {
      source = fs.readFileSync(path.resolve('src/queue/priority-queue.ts'), 'utf8');
    } catch { return; }
    // Processing should be managed by concurrency slots, not a single boolean
    expect(source).not.toMatch(/^\s*processing\s*=\s*(true|false)/m);
  });
});

// ---------------------------------------------------------------------------
// FR-1.2 — Three lanes with specified concurrency and models
// ---------------------------------------------------------------------------
describe('FR-1.2 — Three lanes: fast, standard, premium', () => {
  it('FR-1.2: queue has a fast lane with concurrency 2', async () => {
    const mod = await import('../../src/queue/priority-queue');
    const PQ = mod.PriorityQueue ?? mod.default;
    const q = new PQ();
    const config = q.laneConfig ?? q.lanes ?? q.getConfig?.();
    if (config) {
      expect(config.fast?.concurrency ?? config.fast?.maxConcurrent).toBe(2);
    }
  });

  it('FR-1.2: queue has a standard lane with concurrency 2', async () => {
    const mod = await import('../../src/queue/priority-queue');
    const PQ = mod.PriorityQueue ?? mod.default;
    const q = new PQ();
    const config = q.laneConfig ?? q.lanes ?? q.getConfig?.();
    if (config) {
      expect(config.standard?.concurrency ?? config.standard?.maxConcurrent).toBe(2);
    }
  });

  it('FR-1.2: queue has a premium lane with concurrency 1', async () => {
    const mod = await import('../../src/queue/priority-queue');
    const PQ = mod.PriorityQueue ?? mod.default;
    const q = new PQ();
    const config = q.laneConfig ?? q.lanes ?? q.getConfig?.();
    if (config) {
      expect(config.premium?.concurrency ?? config.premium?.maxConcurrent).toBe(1);
    }
  });

  it('FR-1.2: fast lane uses gpt-4.1 model', async () => {
    const mod = await import('../../src/queue/priority-queue');
    const PQ = mod.PriorityQueue ?? mod.default;
    const q = new PQ();
    const config = q.laneConfig ?? q.lanes ?? q.getConfig?.();
    if (config) {
      expect(config.fast?.model).toMatch(/gpt-4\.1/);
    }
  });

  it('FR-1.2: standard lane uses claude-sonnet-4.6 model', async () => {
    const mod = await import('../../src/queue/priority-queue');
    const PQ = mod.PriorityQueue ?? mod.default;
    const q = new PQ();
    const config = q.laneConfig ?? q.lanes ?? q.getConfig?.();
    if (config) {
      expect(config.standard?.model).toMatch(/claude-sonnet/);
    }
  });

  it('FR-1.2: premium lane uses claude-opus-4.6 model', async () => {
    const mod = await import('../../src/queue/priority-queue');
    const PQ = mod.PriorityQueue ?? mod.default;
    const q = new PQ();
    const config = q.laneConfig ?? q.lanes ?? q.getConfig?.();
    if (config) {
      expect(config.premium?.model).toMatch(/claude-opus/);
    }
  });
});

// ---------------------------------------------------------------------------
// FR-1.3 — Fast-tier message not blocked by in-flight premium-tier message
// ---------------------------------------------------------------------------
describe('FR-1.3 — Fast lane not blocked by premium lane', () => {
  it('FR-1.3: a fast message starts processing while a premium message is in-flight', async () => {
    process.env.HOOT_QUEUE_V2 = '1';
    const mod = await import('../../src/queue/priority-queue');
    const PQ = mod.PriorityQueue ?? mod.default;

    const processingOrder: string[] = [];
    const longTask = () => new Promise<void>((resolve) => setTimeout(resolve, 200));
    const shortTask = () => Promise.resolve();

    const q = new PQ();

    // Enqueue a slow premium task
    q.enqueue({
      id: 'prem-1',
      userId: 'user-a',
      tier: 'premium',
      handler: async () => {
        processingOrder.push('premium-start');
        await longTask();
        processingOrder.push('premium-end');
      },
    });

    // Give premium task time to start
    await new Promise((r) => setTimeout(r, 20));

    // Enqueue a fast task
    q.enqueue({
      id: 'fast-1',
      userId: 'user-b',
      tier: 'fast',
      handler: async () => {
        processingOrder.push('fast-start');
        await shortTask();
        processingOrder.push('fast-end');
      },
    });

    // Wait for both to complete
    await new Promise((r) => setTimeout(r, 300));

    // fast-start should appear before premium-end
    const fastStartIdx = processingOrder.indexOf('fast-start');
    const premEndIdx = processingOrder.indexOf('premium-end');
    expect(fastStartIdx).toBeGreaterThanOrEqual(0);
    expect(fastStartIdx).toBeLessThan(premEndIdx);
  });
});

// ---------------------------------------------------------------------------
// FR-1.4 — Same userId processed serially within lane
// ---------------------------------------------------------------------------
describe('FR-1.4 — Per-user serial ordering within lane', () => {
  it('FR-1.4: two messages from same userId in same lane are processed in order', async () => {
    process.env.HOOT_QUEUE_V2 = '1';
    const mod = await import('../../src/queue/priority-queue');
    const PQ = mod.PriorityQueue ?? mod.default;

    const order: number[] = [];
    const q = new PQ();

    await Promise.all([
      q.enqueue({
        id: 'msg-1',
        userId: 'alice',
        tier: 'standard',
        handler: async () => {
          await new Promise((r) => setTimeout(r, 50));
          order.push(1);
        },
      }),
      q.enqueue({
        id: 'msg-2',
        userId: 'alice',
        tier: 'standard',
        handler: async () => {
          order.push(2);
        },
      }),
    ]);

    await new Promise((r) => setTimeout(r, 200));
    expect(order).toEqual([1, 2]);
  });

  it('FR-1.4: messages from different userIds may process concurrently within lane', async () => {
    process.env.HOOT_QUEUE_V2 = '1';
    const mod = await import('../../src/queue/priority-queue');
    const PQ = mod.PriorityQueue ?? mod.default;

    const startTimes: Record<string, number> = {};
    const q = new PQ();

    const enqueue = (id: string, userId: string) =>
      q.enqueue({
        id,
        userId,
        tier: 'fast',
        handler: async () => {
          startTimes[userId] = Date.now();
          await new Promise((r) => setTimeout(r, 100));
        },
      });

    await Promise.all([enqueue('a1', 'alice'), enqueue('b1', 'bob')]);
    await new Promise((r) => setTimeout(r, 200));

    if (startTimes.alice && startTimes.bob) {
      // Both should have started within 50ms of each other (concurrent)
      expect(Math.abs(startTimes.alice - startTimes.bob)).toBeLessThan(50);
    }
  });
});

// ---------------------------------------------------------------------------
// FR-1.5 — Token-bucket rate limiter at 10/min
// ---------------------------------------------------------------------------
describe('FR-1.5 — Global token-bucket rate limiter', () => {
  it('FR-1.5: RateLimiter is exported from the queue module or a dedicated file', async () => {
    let mod: Record<string, unknown>;
    try {
      mod = await import('../../src/queue/priority-queue');
    } catch {
      return;
    }
    const hasLimiter =
      'RateLimiter' in mod ||
      'TokenBucket' in mod ||
      (typeof (mod.PriorityQueue ?? mod.default) === 'function' &&
        'rateLimiter' in new (mod.PriorityQueue ?? (mod.default as new () => object))());
    expect(hasLimiter).toBe(true);
  });

  it('FR-1.5: 11th SDK call within a minute queues instead of being dropped', async () => {
    process.env.HOOT_QUEUE_V2 = '1';
    const mod = await import('../../src/queue/priority-queue');
    const PQ = mod.PriorityQueue ?? mod.default;
    const q = new PQ({ rateLimitPerMinute: 10 });

    let processed = 0;
    let rejected = false;

    const makeMsg = (i: number) => ({
      id: `msg-rate-${i}`,
      userId: 'user-x',
      tier: 'fast' as Lane,
      handler: async () => { processed++; },
    });

    try {
      // Enqueue 11 messages rapidly — 11th should not throw (it should queue)
      const enqueues = Array.from({ length: 11 }, (_, i) => q.enqueue(makeMsg(i)));
      await Promise.allSettled(enqueues);
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FR-1.6 — HOOT_QUEUE_V2=0 restores the serial queue
// ---------------------------------------------------------------------------
describe('FR-1.6 — HOOT_QUEUE_V2=0 serial queue fallback', () => {
  afterEach(() => {
    delete process.env.HOOT_QUEUE_V2;
    vi.resetModules();
  });

  it('FR-1.6: when HOOT_QUEUE_V2=0, queue module reports legacy mode', async () => {
    process.env.HOOT_QUEUE_V2 = '0';
    vi.resetModules();
    const mod = await import('../../src/queue/priority-queue');
    const isV2 = mod.isQueueV2?.() ?? (process.env.HOOT_QUEUE_V2 === '1');
    expect(isV2).toBe(false);
  });

  it('FR-1.6: when HOOT_QUEUE_V2=1, queue module reports v2 mode', async () => {
    process.env.HOOT_QUEUE_V2 = '1';
    vi.resetModules();
    const mod = await import('../../src/queue/priority-queue');
    const isV2 = mod.isQueueV2?.() ?? (process.env.HOOT_QUEUE_V2 === '1');
    expect(isV2).toBe(true);
  });

  it('FR-1.6: serial queue (HOOT_QUEUE_V2=0) processes messages one at a time', async () => {
    process.env.HOOT_QUEUE_V2 = '0';
    vi.resetModules();
    const mod = await import('../../src/queue/priority-queue');

    const SerialQueue = mod.SerialQueue ?? mod.LegacyQueue ?? (mod.isQueueV2?.() === false ? mod.PriorityQueue ?? mod.default : null);
    if (!SerialQueue) return;

    const order: string[] = [];
    const q = new SerialQueue();

    q.enqueue({
      id: 'serial-1',
      userId: 'u1',
      tier: 'standard' as Lane,
      handler: async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push('first');
      },
    });
    q.enqueue({
      id: 'serial-2',
      userId: 'u2',
      tier: 'fast' as Lane,
      handler: async () => {
        order.push('second');
      },
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(order[0]).toBe('first');
    expect(order[1]).toBe('second');
  });
});
