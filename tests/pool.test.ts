import { describe, it, expect, vi } from "vitest";
import { WorkerPool } from "../src/workers/pool.js";

describe("WorkerPool (new mode)", () => {
  it("warms up via warmUp()", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: "s1", close: vi.fn() });
    const pool = new WorkerPool({ minWarm: 2, maxTotal: 5, createSession: mockCreate });

    await pool.warmUp();
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(pool.getStats()).toMatchObject({ warm: 2, total: 2 });
  });

  it("checkout()/checkin() reuses sessions", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: "s1", close: vi.fn() });
    const pool = new WorkerPool({ minWarm: 0, maxTotal: 2, createSession: mockCreate });

    const s1 = await pool.checkout();
    await pool.checkin(s1);
    const s2 = await pool.checkout();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(s2).toBe(s1);
  });

  it("does not exceed maxTotal", async () => {
    let idx = 0;
    const mockCreate = vi.fn().mockImplementation(async () => ({ id: `s-${++idx}`, close: vi.fn() }));
    const pool = new WorkerPool({ minWarm: 0, maxTotal: 2, createSession: mockCreate });

    const s1 = await pool.checkout();
    const s2 = await pool.checkout();

    let resolved = false;
    const p3 = pool.checkout().then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 25));
    expect(resolved).toBe(false);

    await pool.checkin(s1);
    await p3;
    expect(mockCreate).toHaveBeenCalledTimes(2);

    await pool.checkin(s2);
  });
});
