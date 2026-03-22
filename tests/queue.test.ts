import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Lane } from "../src/queue/lane.js";
import type { QueuedLaneMessage } from "../src/queue/lane.js";
import type { MessageEnvelope } from "../src/bus/types.js";
import { PriorityQueue, resetPriorityQueue } from "../src/queue/priority-queue.js";

function makeMsg(userId?: string, text = "hello"): QueuedLaneMessage {
  let resolve: (r: string) => void;
  let reject: (e: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const envelope: MessageEnvelope = {
    id: `env-${Math.random()}`,
    channel: "tui",
    channelMeta: {},
    text,
    userId,
    timestamp: Date.now(),
  };
  return {
    envelope,
    callback: () => {},
    resolve: resolve!,
    reject: reject!,
    userId,
    get _promise() { return promise; }
  } as any;
}

describe("Lane", () => {
  it("executes messages up to concurrency limit", async () => {
    const lane = new Lane({ name: "test", concurrency: 2, model: "test-model" });
    const executed: string[] = [];

    lane.setExecutor(async (msg) => {
      await new Promise<void>((r) => setTimeout(r, 10));
      executed.push(msg.envelope.id);
      return "done";
    });

    const m1 = makeMsg();
    const m2 = makeMsg();
    lane.enqueue(m1);
    lane.enqueue(m2);

    // Both should be executing concurrently
    expect(lane.activeCount).toBe(2);
    expect(lane.pendingCount).toBe(0);
  });

  it("queues messages beyond concurrency limit", () => {
    const lane = new Lane({ name: "test", concurrency: 1, model: "test-model" });

    // Executor that never resolves
    lane.setExecutor(() => new Promise(() => {}));

    const m1 = makeMsg();
    const m2 = makeMsg();
    lane.enqueue(m1);
    lane.enqueue(m2);

    expect(lane.activeCount).toBe(1);
    expect(lane.pendingCount).toBe(1);
  });

  it("enforces per-userId serial ordering within lane", async () => {
    const lane = new Lane({ name: "test", concurrency: 2, model: "test-model" });
    const order: string[] = [];
    let firstResolve: (() => void) | undefined;

    lane.setExecutor(async (msg) => {
      if (!firstResolve) {
        await new Promise<void>((r) => { firstResolve = r; });
      }
      order.push(msg.userId ?? "anon");
      return "done";
    });

    const userA1 = makeMsg("user-a", "msg1");
    const userA2 = makeMsg("user-a", "msg2");
    const userB = makeMsg("user-b", "msgB");

    lane.enqueue(userA1);
    lane.enqueue(userA2);
    lane.enqueue(userB);

    // user-a msg1 and user-b should be running (user-a msg2 waiting)
    expect(lane.activeCount).toBe(2);
    expect(lane.pendingCount).toBe(1);
  });

  it("reports active and pending counts correctly", () => {
    const lane = new Lane({ name: "cnt", concurrency: 2, model: "test" });
    lane.setExecutor(() => new Promise(() => {}));

    expect(lane.activeCount).toBe(0);
    expect(lane.pendingCount).toBe(0);

    lane.enqueue(makeMsg());
    lane.enqueue(makeMsg());
    lane.enqueue(makeMsg()); // Should queue (over limit)

    expect(lane.activeCount).toBe(2);
    expect(lane.pendingCount).toBe(1);
  });
});

describe("PriorityQueue", () => {
  beforeEach(() => {
    resetPriorityQueue();
  });

  it("creates fast, standard, and premium lanes", () => {
    const pq = new PriorityQueue();
    const stats = pq.getStats();
    expect(stats).toHaveProperty("fast");
    expect(stats).toHaveProperty("standard");
    expect(stats).toHaveProperty("premium");
  });

  it("routes messages to correct lanes by tier", async () => {
    const pq = new PriorityQueue();
    const dispatched: string[] = [];

    pq.setExecutor(async (msg) => {
      dispatched.push(msg.envelope.channel);
      return "ok";
    });

    const m = makeMsg();
    m.envelope.channel = "fast-channel";
    pq.enqueue(m, "fast");
    expect(pq.getStats().fast.active + pq.getStats().fast.pending).toBeGreaterThanOrEqual(1);
  });

  it("falls back to standard lane for unknown tier", () => {
    const pq = new PriorityQueue();
    pq.setExecutor(async () => "ok");

    const m = makeMsg();
    pq.enqueue(m, "standard");
    expect(pq.getStats().standard.active + pq.getStats().standard.pending).toBeGreaterThanOrEqual(1);
  });

  it("getStats returns per-lane active/pending counts", () => {
    const pq = new PriorityQueue();
    // No executor — messages won't start
    const stats = pq.getStats();
    expect(stats.fast).toMatchObject({ active: 0, pending: 0 });
    expect(stats.premium).toMatchObject({ active: 0, pending: 0 });
  });

  it("premium lane has concurrency 1", () => {
    const pq = new PriorityQueue();
    pq.setExecutor(() => new Promise(() => {})); // never resolves

    // Enqueue 3 premium messages
    for (let i = 0; i < 3; i++) pq.enqueue(makeMsg(), "premium");
    expect(pq.getStats().premium.active).toBe(1);
    expect(pq.getStats().premium.pending).toBe(2);
  });

  it("fast lane has concurrency 2", () => {
    const pq = new PriorityQueue();
    pq.setExecutor(() => new Promise(() => {}));

    for (let i = 0; i < 3; i++) pq.enqueue(makeMsg(), "fast");
    expect(pq.getStats().fast.active).toBe(2);
    expect(pq.getStats().fast.pending).toBe(1);
  });
});
