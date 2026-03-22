import { describe, it, expect, beforeEach, vi } from "vitest";
import { CircuitBreaker, BreakerOpenError, createBreaker, getAllBreakers } from "../src/resilience/circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("starts in closed state", () => {
    const breaker = new CircuitBreaker({ name: "test-closed" });
    expect(breaker.state).toBe("closed");
  });

  it("executes successful calls without interference", async () => {
    const breaker = new CircuitBreaker({ name: "test-success" });
    const result = await breaker.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
    expect(breaker.state).toBe("closed");
  });

  it("counts failures and opens after threshold (3)", async () => {
    const breaker = new CircuitBreaker({
      name: "test-threshold",
      failureThreshold: 3,
      windowMs: 60_000,
      resetTimeoutMs: 30_000,
    });

    const failFn = () => Promise.reject(new Error("SDK down"));

    // First 2 failures — should not open
    for (let i = 0; i < 2; i++) {
      await breaker.execute(failFn).catch(() => {});
      expect(breaker.state).toBe("closed");
    }

    // 3rd failure — should open
    await breaker.execute(failFn).catch(() => {});
    expect(breaker.state).toBe("open");
  });

  it("throws BreakerOpenError when open", async () => {
    const breaker = new CircuitBreaker({ name: "test-open", failureThreshold: 1 });
    await breaker.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    expect(breaker.state).toBe("open");

    await expect(breaker.execute(() => Promise.resolve("x")))
      .rejects.toBeInstanceOf(BreakerOpenError);
  });

  it("BreakerOpenError message includes breaker name", async () => {
    const breaker = new CircuitBreaker({ name: "my-breaker", failureThreshold: 1 });
    await breaker.execute(() => Promise.reject(new Error("fail"))).catch(() => {});

    try {
      await breaker.execute(() => Promise.resolve("x"));
    } catch (err) {
      expect(err).toBeInstanceOf(BreakerOpenError);
      expect((err as Error).message).toContain("my-breaker");
    }
  });

  it("transitions to half-open after resetTimeoutMs", async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      name: "test-halfopen",
      failureThreshold: 1,
      resetTimeoutMs: 30_000,
    });

    await breaker.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    expect(breaker.state).toBe("open");

    // Advance time past reset timeout
    vi.advanceTimersByTime(31_000);

    // Next call should probe (half-open)
    const result = await breaker.execute(() => Promise.resolve("probe"));
    expect(result).toBe("probe");
    expect(breaker.state).toBe("closed");

    vi.useRealTimers();
  });

  it("re-opens on failure in half-open state", async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      name: "test-reopen",
      failureThreshold: 1,
      resetTimeoutMs: 30_000,
    });

    await breaker.execute(() => Promise.reject(new Error("fail1"))).catch(() => {});
    vi.advanceTimersByTime(31_000);
    // Probe fails
    await breaker.execute(() => Promise.reject(new Error("fail2"))).catch(() => {});
    expect(breaker.state).toBe("open");

    vi.useRealTimers();
  });

  it("getSnapshot returns state, failures, lastFailureAt", async () => {
    const breaker = new CircuitBreaker({ name: "test-snapshot", failureThreshold: 3 });
    await breaker.execute(() => Promise.reject(new Error("x"))).catch(() => {});
    const snap = breaker.getSnapshot();
    expect(snap.state).toBe("closed");
    expect(snap.failures).toBe(1);
    expect(snap.lastFailureAt).toBeDefined();
  });

  it("resets failure count after windowMs", async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      name: "test-window",
      failureThreshold: 3,
      windowMs: 60_000,
    });

    // 2 failures
    await breaker.execute(() => Promise.reject(new Error("x"))).catch(() => {});
    await breaker.execute(() => Promise.reject(new Error("x"))).catch(() => {});

    // Advance past window
    vi.advanceTimersByTime(61_000);

    // Failures should be reset; 3 more needed to trip
    await breaker.execute(() => Promise.reject(new Error("x"))).catch(() => {});
    expect(breaker.state).toBe("closed"); // Not yet at threshold

    vi.useRealTimers();
  });

  it("createBreaker registers in global registry", () => {
    const breaker = createBreaker({ name: "registered-breaker" });
    expect(getAllBreakers().has("registered-breaker")).toBe(true);
  });
});
