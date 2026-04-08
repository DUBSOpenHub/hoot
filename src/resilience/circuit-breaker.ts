import { CIRCUIT_BREAKER_THRESHOLD, CIRCUIT_BREAKER_RESET_MS, CIRCUIT_BREAKER_MAX_RESET_MS } from "../config.js";

export type BreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  name?: string;
  failureThreshold?: number;
  windowMs?: number;
  resetTimeoutMs?: number;
  maxResetTimeoutMs?: number;
}

export class BreakerOpenError extends Error {
  constructor(breakerName: string, resetInMs: number) {
    super(
      `Service temporarily unavailable (circuit open: ${breakerName}). ` +
      `Auto-retry in ${Math.ceil(resetInMs / 1000)}s.`
    );
    this.name = "BreakerOpenError";
  }
}

export class CircuitBreaker {
  readonly name: string;
  private _state: BreakerState = "closed";
  private failures = 0;
  private lastFailureAt?: number;
  private openedAt?: number;
  private openCount = 0;
  private _currentResetMs: number;
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly baseResetMs: number;
  private readonly maxResetMs: number;

  constructor(opts?: CircuitBreakerOptions) {
    this.name = opts?.name ?? 'default';
    this.failureThreshold = opts?.failureThreshold ?? CIRCUIT_BREAKER_THRESHOLD;
    this.windowMs = opts?.windowMs ?? 60_000;
    this.baseResetMs = opts?.resetTimeoutMs ?? CIRCUIT_BREAKER_RESET_MS;
    this.maxResetMs = opts?.maxResetTimeoutMs ?? CIRCUIT_BREAKER_MAX_RESET_MS;
    this._currentResetMs = this.baseResetMs;
  }

  /** @deprecated Use baseResetMs — kept for backward compat in snapshot consumers */
  get resetTimeoutMs(): number {
    return this._currentResetMs;
  }

  get state(): BreakerState {
    return this._state;
  }

  getState(): BreakerState {
    this.tick();
    return this._state;
  }

  reset(): void {
    this._state = 'closed';
    this.failures = 0;
    this.openCount = 0;
    this._currentResetMs = this.baseResetMs;
    this.lastFailureAt = undefined;
    this.openedAt = undefined;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    return this.execute(fn);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.tick();

    if (this._state === "open") {
      const elapsed = Date.now() - (this.openedAt ?? 0);
      const remaining = this._currentResetMs - elapsed;
      throw new BreakerOpenError(this.name, Math.max(0, remaining));
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  getSnapshot(): { state: BreakerState; failures: number; lastFailureAt?: number; openCount: number; currentResetMs: number } {
    return {
      state: this._state,
      failures: this.failures,
      lastFailureAt: this.lastFailureAt,
      openCount: this.openCount,
      currentResetMs: this._currentResetMs,
    };
  }

  private computeResetMs(): number {
    // First open uses base timeout; backoff starts on consecutive opens
    if (this.openCount <= 1) return this.baseResetMs;
    const exp = Math.min(this.maxResetMs, this.baseResetMs * (2 ** (this.openCount - 1)));
    const jitter = Math.floor(Math.random() * 0.2 * exp);
    return exp + jitter;
  }

  private tick(): void {
    if (this._state === "open") {
      const elapsed = Date.now() - (this.openedAt ?? 0);
      if (elapsed >= this._currentResetMs) {
        this._state = "half-open";
      }
    }
    // Reset failure count if outside the window
    if (this.lastFailureAt && (Date.now() - this.lastFailureAt) > this.windowMs) {
      this.failures = 0;
      if (this._state === "closed") this.lastFailureAt = undefined;
    }
  }

  private onSuccess(): void {
    if (this._state === "half-open") {
      this._state = "closed";
      this.failures = 0;
      this.openCount = 0;
      this._currentResetMs = this.baseResetMs;
      this.lastFailureAt = undefined;
      this.openedAt = undefined;
    } else if (this._state === "closed") {
      this.failures = 0;
      this.lastFailureAt = undefined;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureAt = Date.now();

    if (this._state === "half-open" || this.failures >= this.failureThreshold) {
      this._state = "open";
      this.openedAt = Date.now();
      this.openCount++;
      this._currentResetMs = this.computeResetMs();
    }
  }
}

const _breakers = new Map<string, CircuitBreaker>();

export function createBreaker(opts?: CircuitBreakerOptions): CircuitBreaker {
  const breaker = new CircuitBreaker(opts);
  _breakers.set(opts?.name ?? 'default', breaker);
  return breaker;
}

export function getAllBreakers(): Map<string, CircuitBreaker> {
  return _breakers;
}
