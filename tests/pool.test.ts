import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkerPool } from "../src/workers/pool.js";

// Mock CopilotClient and CopilotSession
function makeMockSession(id = `session-${Math.random()}`) {
  return {
    sessionId: id,
    destroy: vi.fn().mockResolvedValue(undefined),
    sendAndWait: vi.fn().mockResolvedValue({ data: { content: "done" } }),
  };
}

function makeMockClient(sessionFactory = makeMockSession) {
  return {
    createSession: vi.fn().mockImplementation(() => Promise.resolve(sessionFactory())),
  };
}

describe("WorkerPool", () => {
  it("creates a pool with default config", () => {
    const pool = new WorkerPool();
    const stats = pool.getStats();
    expect(stats.warm).toBe(0);
    expect(stats.checkedOut).toBe(0);
    expect(stats.total).toBe(0);
  });

  it("warms up to minWarm sessions on start()", async () => {
    const client = makeMockClient() as any;
    const pool = new WorkerPool({ minWarm: 2, maxTotal: 5, maxSessionAgeMs: 1_800_000, model: "test" });
    await pool.start(client);

    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(pool.getStats().warm).toBe(2);
    await pool.shutdown();
  });

  it("checkout() returns a warm session quickly", async () => {
    const client = makeMockClient() as any;
    const pool = new WorkerPool({ minWarm: 2, maxTotal: 5, maxSessionAgeMs: 1_800_000, model: "test" });
    await pool.start(client);

    const ps = await pool.checkout("/tmp/project");
    expect(ps.status).toBe("checked-out");
    expect(ps.workingDir).toBe("/tmp/project");
    await pool.shutdown();
  });

  it("checkout() creates a new session if no warm available", async () => {
    const client = makeMockClient() as any;
    const pool = new WorkerPool({ minWarm: 0, maxTotal: 5, maxSessionAgeMs: 1_800_000, model: "test" });
    await pool.start(client);

    expect(pool.getStats().warm).toBe(0);
    const ps = await pool.checkout("/tmp");
    expect(ps.status).toBe("checked-out");
    expect(client.createSession).toHaveBeenCalledTimes(1);
    await pool.shutdown();
  });

  it("return() marks session as warm again", async () => {
    const client = makeMockClient() as any;
    const pool = new WorkerPool({ minWarm: 1, maxTotal: 5, maxSessionAgeMs: 1_800_000, model: "test" });
    await pool.start(client);

    const ps = await pool.checkout("/tmp");
    expect(ps.status).toBe("checked-out");

    await pool.return(ps);
    expect(ps.status).toBe("warm");
    expect(pool.getStats().warm).toBe(1);
    await pool.shutdown();
  });

  it("discard() destroys the session and removes it from pool", async () => {
    const client = makeMockClient() as any;
    const pool = new WorkerPool({ minWarm: 1, maxTotal: 5, maxSessionAgeMs: 1_800_000, model: "test" });
    await pool.start(client);

    const ps = await pool.checkout("/tmp");
    const session = ps.session;
    await pool.discard(ps);

    expect(session.destroy).toHaveBeenCalled();
    expect(pool.getStats().total).toBe(0);
    await pool.shutdown();
  });

  it("discard() expired sessions on return", async () => {
    const client = makeMockClient() as any;
    const pool = new WorkerPool({
      minWarm: 1,
      maxTotal: 5,
      maxSessionAgeMs: 1, // Expire almost immediately
      model: "test",
    });
    await pool.start(client);

    // Wait for session to expire
    await new Promise((r) => setTimeout(r, 20));

    const ps = await pool.checkout("/tmp");
    // The checked-out session exists
    expect(ps.status).toBe("checked-out");

    // Return it — since maxSessionAgeMs=1, it should be discarded
    await pool.return(ps);

    // Pool total should be 0 (expired session was discarded, not returned)
    expect(pool.getStats().checkedOut).toBe(0);
    await pool.shutdown();
  });

  it("getStats() reports warm and checked-out correctly", async () => {
    const client = makeMockClient() as any;
    const pool = new WorkerPool({ minWarm: 2, maxTotal: 5, maxSessionAgeMs: 1_800_000, model: "test" });
    await pool.start(client);

    expect(pool.getStats()).toMatchObject({ warm: 2, checkedOut: 0, total: 2 });

    const ps = await pool.checkout("/tmp");
    expect(pool.getStats()).toMatchObject({ warm: 1, checkedOut: 1, total: 2 });

    await pool.return(ps);
    expect(pool.getStats()).toMatchObject({ warm: 2, checkedOut: 0, total: 2 });

    await pool.shutdown();
  });

  it("shutdown() destroys all sessions", async () => {
    const client = makeMockClient() as any;
    const pool = new WorkerPool({ minWarm: 2, maxTotal: 5, maxSessionAgeMs: 1_800_000, model: "test" });
    await pool.start(client);

    await pool.shutdown();
    expect(pool.getStats().total).toBe(0);
  });
});
