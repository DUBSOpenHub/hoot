import { POOL_MIN_WARM, POOL_MAX_TOTAL, POOL_SESSION_AGE_MS } from "../config.js";
import { createLogger } from "../observability/logger.js";
import type { AIProviderSession, AIProvider } from "../providers/types.js";
import { config } from "../config.js";
import { SESSIONS_DIR } from "../paths.js";

const log = createLogger("pool");

export interface WorkerPoolOptions<TSession extends { id: string; close?: () => void } = { id: string; close?: () => void }> {
  minWarm?: number;
  maxTotal?: number;
  /** Max age before a session is recycled (ms). */
  maxSessionAge?: number;
  /** Factory for creating a fresh warm session. */
  createSession?: (workingDir?: string) => Promise<TSession>;
}

interface PoolEntry<TSession extends { id: string; close?: () => void }> {
  session: TSession;
  createdAt: number;
  available: boolean;
  workingDir?: string;
}

const CHECKOUT_TIMEOUT_MS = 120_000;

export class WorkerPool<TSession extends { id: string; close?: () => void } = { id: string; close?: () => void }> {
  readonly minWarm: number;
  readonly maxTotal: number;

  private readonly _maxSessionAge: number;
  private _createSession?: (workingDir?: string) => Promise<TSession>;

  private _entries: Array<PoolEntry<TSession>> = [];
  private _waiters: Array<(s: TSession) => void> = [];
  private _started = false;

  constructor(opts?: WorkerPoolOptions<TSession>) {
    this.minWarm = opts?.minWarm ?? POOL_MIN_WARM;
    this.maxTotal = opts?.maxTotal ?? POOL_MAX_TOTAL;
    this._maxSessionAge = opts?.maxSessionAge ?? POOL_SESSION_AGE_MS;
    this._createSession = opts?.createSession;
  }

  /**
   * Binds this pool to a provider (default daemon path). If a createSession factory
   * was already supplied via constructor, this is a no-op other than warm-up.
   */
  async start(provider: AIProvider): Promise<void> {
    if (!this._createSession) {
      this._createSession = async (workingDir?: string) => {
        const session = await provider.createSession({
          model: config.copilotModel,
          configDir: SESSIONS_DIR,
          workingDirectory: workingDir,
        });
        const s = session as unknown as TSession;
        // Normalize for pool shutdown/recycle.
        if (!(s as any).close) {
          (s as any).close = () => {
            try { (session as unknown as AIProviderSession).destroy?.(); } catch {}
          };
        }
        return s;
      };
    }

    if (this._started) return;
    this._started = true;
    await this.warmUp();
    log.info("Worker pool started", { minWarm: this.minWarm, maxTotal: this.maxTotal });
  }

  async shutdown(): Promise<void> {
    const entries = this._entries;
    this._entries = [];
    this._waiters = [];
    await Promise.allSettled(
      entries.map(async (e) => {
        try { e.session.close?.(); } catch {}
      })
    );
    this._started = false;
    log.info("Worker pool shut down");
  }

  getStats(): { warm: number; checkedOut: number; total: number } {
    const warm = this._entries.filter((e) => e.available).length;
    const checkedOut = this._entries.filter((e) => !e.available).length;
    return { warm, checkedOut, total: this._entries.length };
  }

  async warmUp(): Promise<void> {
    if (!this._createSession) return;
    const warmCount = this._entries.filter((e) => e.available && !this._isExpired(e)).length;
    const needed = Math.max(0, this.minWarm - warmCount);
    const availableSlots = Math.max(0, this.maxTotal - this._entries.length);
    const toCreate = Math.min(needed, availableSlots);

    for (let i = 0; i < toCreate; i++) {
      try {
        const s = await this._createSession();
        this._entries.push({ session: s, createdAt: Date.now(), available: true });
      } catch (err) {
        log.warn("Failed to warm session", { err: String(err) });
      }
    }
  }

  async checkout(workingDir?: string): Promise<TSession> {
    if (!this._createSession) {
      throw new Error("Worker pool not started — call start(provider) first");
    }

    // Prefer a warm non-expired session.
    for (const entry of this._entries) {
      if (!entry.available) continue;
      if (this._isExpired(entry)) continue;
      if (workingDir && entry.workingDir && entry.workingDir !== workingDir) continue;
      entry.available = false;
      entry.workingDir = workingDir;
      return entry.session;
    }

    // Prune expired warm sessions.
    const expiredWarm = this._entries.filter((e) => e.available && this._isExpired(e));
    if (expiredWarm.length > 0) {
      this._entries = this._entries.filter((e) => !e.available || !this._isExpired(e));
      await Promise.allSettled(expiredWarm.map(async (e) => { try { e.session.close?.(); } catch {} }));
    }

    if (this._entries.length < this.maxTotal) {
      const s = await this._createSession(workingDir);
      this._entries.push({ session: s, createdAt: Date.now(), available: false, workingDir });
      return s;
    }

    // Wait for a check-in.
    return new Promise<TSession>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.indexOf(resolve);
        if (idx !== -1) this._waiters.splice(idx, 1);
        reject(new Error("Worker pool checkout timed out after 120s — all sessions are busy"));
      }, CHECKOUT_TIMEOUT_MS);

      this._waiters.push((session) => {
        clearTimeout(timer);
        resolve(session);
      });
    });
  }

  async checkin(session: TSession): Promise<void> {
    const entry = this._entries.find((e) => e.session === session);
    if (!entry) return;

    // If expired, recycle.
    if (this._isExpired(entry)) {
      this._entries = this._entries.filter((e) => e !== entry);
      try { entry.session.close?.(); } catch {}

      if (this._waiters.length > 0) {
        const resolve = this._waiters.shift()!;
        try {
          const replacement = await this._createSession?.(entry.workingDir);
          if (replacement) {
            this._entries.push({ session: replacement, createdAt: Date.now(), available: false, workingDir: entry.workingDir });
            resolve(replacement);
            return;
          }
        } catch {
        }
      }
      return;
    }

    entry.available = true;
    entry.workingDir = undefined;

    if (this._waiters.length > 0) {
      const resolve = this._waiters.shift()!;
      entry.available = false;
      resolve(entry.session);
    }
  }

  private _isExpired(entry: PoolEntry<TSession>): boolean {
    return Date.now() - entry.createdAt > this._maxSessionAge;
  }
}

export function isPoolEnabled(): boolean {
  return (process.env.HOOT_POOL_ENABLED ?? process.env.MAX_POOL_ENABLED) !== "0";
}

let _pool: WorkerPool<any> | undefined;

export function getWorkerPool(): WorkerPool<any> {
  if (!_pool) _pool = new WorkerPool();
  return _pool;
}

export function resetWorkerPool(): void {
  _pool = undefined;
}
