import { POOL_MIN_WARM, POOL_MAX_TOTAL, POOL_SESSION_AGE_MS } from "../config.js";
import { createLogger } from "../observability/logger.js";

const log = createLogger("pool");

export interface LegacyPoolConfig {
  minWarm?: number;
  maxTotal?: number;
  maxSessionAgeMs?: number;
  model?: string;
}

export interface PooledSession {
  session: any;
  status: "warm" | "checked-out";
  createdAt: number;
  workingDir?: string;
}

export interface WorkerPoolOptions {
  minWarm?: number;
  maxTotal?: number;
  createSession: () => Promise<{ id: string; close?: () => void }>;
  maxSessionAge?: number;
}

interface PoolEntry {
  session: { id: string; close?: () => void };
  createdAt: number;
  available: boolean;
}

type AnyPoolOpts = (LegacyPoolConfig & { createSession?: undefined }) | WorkerPoolOptions;

function isNewMode(opts: AnyPoolOpts | undefined): opts is WorkerPoolOptions {
  return !!(opts && typeof (opts as WorkerPoolOptions).createSession === "function");
}

export class WorkerPool {
  readonly minWarm: number;
  readonly maxTotal: number;
  private readonly _newMode: boolean;

  private readonly _legacyCfg: Required<LegacyPoolConfig>;
  private _legacySessions: PooledSession[] = [];
  private _legacyClient?: { createSession: (opts: any) => Promise<any> };
  private _replenishTimer?: ReturnType<typeof setInterval>;

  private readonly _createSession?: () => Promise<{ id: string; close?: () => void }>;
  private readonly _maxSessionAge: number;
  private _entries: PoolEntry[] = [];
  private _waiters: Array<(s: { id: string; close?: () => void }) => void> = [];

  constructor(opts?: AnyPoolOpts) {
    this._newMode = isNewMode(opts);

    if (this._newMode) {
      const o = opts as WorkerPoolOptions;
      this.minWarm = o.minWarm ?? POOL_MIN_WARM;
      this.maxTotal = o.maxTotal ?? POOL_MAX_TOTAL;
      this._createSession = o.createSession;
      this._maxSessionAge = o.maxSessionAge ?? POOL_SESSION_AGE_MS;
      this._legacyCfg = { minWarm: this.minWarm, maxTotal: this.maxTotal, maxSessionAgeMs: this._maxSessionAge, model: "default" };
    } else {
      const o = (opts ?? {}) as LegacyPoolConfig;
      this.minWarm = o.minWarm ?? POOL_MIN_WARM;
      this.maxTotal = o.maxTotal ?? POOL_MAX_TOTAL;
      this._maxSessionAge = o.maxSessionAgeMs ?? 1_800_000;
      this._legacyCfg = { minWarm: this.minWarm, maxTotal: this.maxTotal, maxSessionAgeMs: this._maxSessionAge, model: o.model ?? "default" };
    }
  }

  async start(client: { createSession: (opts: any) => Promise<any> }): Promise<void> {
    this._legacyClient = client;
    await this._legacyReplenish();
    this._replenishTimer = setInterval(() => {
      this._legacyReplenish().catch(() => {});
    }, 30_000);
    if ((this._replenishTimer as any).unref) (this._replenishTimer as any).unref();
    log.info("Worker pool started", { minWarm: this.minWarm, maxTotal: this.maxTotal });
  }

  async return(ps: PooledSession): Promise<void> {
    if (this._isExpiredLegacy(ps)) {
      await this.discard(ps);
      await this._legacyReplenish();
      return;
    }
    ps.status = "warm";
    ps.workingDir = undefined;
    // Janitor: force-return sessions checked out longer than maxSessionAge
    for (const s of this._legacySessions) {
      if (s.status === "checked-out" && this._isExpiredLegacy(s)) {
        log.warn("Janitor: force-returning expired checked-out session", { age: Date.now() - s.createdAt });
        s.status = "warm";
        s.workingDir = undefined;
      }
    }
  }

  async discard(ps: PooledSession): Promise<void> {
    this._legacySessions = this._legacySessions.filter((s) => s !== ps);
    try { await ps.session.destroy(); } catch { /* best effort */ }
  }

  async shutdown(): Promise<void> {
    if (this._replenishTimer) clearInterval(this._replenishTimer);
    if (this._newMode) {
      this._entries = [];
    } else {
      await Promise.allSettled(this._legacySessions.map((s) => s.session.destroy()));
      this._legacySessions = [];
    }
    log.info("Worker pool shut down");
  }

  async warmUp(): Promise<void> {
    const warmCount = this._entries.filter((e) => e.available).length;
    const needed = Math.max(0, this.minWarm - warmCount);
    const available = this.maxTotal - this._entries.length;
    const toCreate = Math.min(needed, available);
    for (let i = 0; i < toCreate; i++) {
      try {
        const s = await this._createSession!();
        this._entries.push({ session: s, createdAt: Date.now(), available: true });
      } catch (err) {
        log.warn("Failed to warm session", { err: String(err) });
      }
    }
  }

  async checkin(session: { id: string; close?: () => void }): Promise<void> {
    const entry = this._entries.find((e) => e.session === session);
    if (!entry) return;

    // Janitor: force-return any sessions checked out longer than maxSessionAge
    for (const e of this._entries) {
      if (!e.available && e !== entry && this._isExpiredNew(e)) {
        log.warn("Janitor: force-returning expired checked-out session", { id: e.session.id, age: Date.now() - e.createdAt });
        e.available = true;
      }
    }

    if (this._isExpiredNew(entry)) {
      this._entries = this._entries.filter((e) => e !== entry);
      try { entry.session.close?.(); } catch {}
      if (this._waiters.length > 0) {
        const resolve = this._waiters.shift()!;
        try {
          const ns = await this._createSession!();
          this._entries.push({ session: ns, createdAt: Date.now(), available: false });
          resolve(ns);
        } catch {}
      }
    } else {
      entry.available = true;
      if (this._waiters.length > 0) {
        const resolve = this._waiters.shift()!;
        entry.available = false;
        resolve(entry.session);
      }
    }
  }

    async checkout(workingDir?: string): Promise<any> {
    if (this._newMode) {
      return this._newCheckout();
    }
    return this._legacyCheckout(workingDir ?? "");
  }

  getStats(): { warm: number; checkedOut: number; total: number } {
    if (this._newMode) {
      const warm = this._entries.filter((e) => e.available).length;
      const co = this._entries.filter((e) => !e.available).length;
      return { warm, checkedOut: co, total: this._entries.length };
    }
    const warm = this._legacySessions.filter((s) => s.status === "warm").length;
    const co = this._legacySessions.filter((s) => s.status === "checked-out").length;
    return { warm, checkedOut: co, total: this._legacySessions.length };
  }

  private static readonly CHECKOUT_TIMEOUT_MS = 30_000;

  private async _newCheckout(): Promise<{ id: string; close?: () => void }> {
    for (const e of this._entries) {
      if (e.available && !this._isExpiredNew(e)) {
        e.available = false;
        return e.session;
      }
    }
    this._entries = this._entries.filter((e) => !e.available || !this._isExpiredNew(e));

    if (this._entries.length < this.maxTotal) {
      const s = await this._createSession!();
      this._entries.push({ session: s, createdAt: Date.now(), available: false });
      return s;
    }

    return new Promise<{ id: string; close?: () => void }>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.indexOf(resolve);
        if (idx !== -1) this._waiters.splice(idx, 1);
        reject(new Error("Worker pool checkout timed out after 30s — all sessions are busy"));
      }, WorkerPool.CHECKOUT_TIMEOUT_MS);
      this._waiters.push((session) => {
        clearTimeout(timer);
        resolve(session);
      });
    });
  }

  private async _legacyCheckout(workingDir: string): Promise<PooledSession> {
    const warm = this._legacySessions.find(
      (s) => s.status === "warm" && !this._isExpiredLegacy(s)
    );
    if (warm) {
      warm.status = "checked-out";
      warm.workingDir = workingDir;
      return warm;
    }
    if (this._legacySessions.length < this.maxTotal) {
      const ps = await this._legacyCreate();
      ps.status = "checked-out";
      ps.workingDir = workingDir;
      this._legacySessions.push(ps);
      return ps;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(poll);
        reject(new Error("Worker pool checkout timed out after 30s — all sessions are busy"));
      }, WorkerPool.CHECKOUT_TIMEOUT_MS);
      const poll = setInterval(() => {
        const w = this._legacySessions.find(
          (s) => s.status === "warm" && !this._isExpiredLegacy(s)
        );
        if (w) {
          clearInterval(poll);
          clearTimeout(timer);
          w.status = "checked-out";
          w.workingDir = workingDir;
          resolve(w);
        }
      }, 100);
    });
  }

  private async _legacyCreate(): Promise<PooledSession> {
    if (!this._legacyClient) throw new Error("Pool not started — call start() first");
    const session = await this._legacyClient.createSession({ model: this._legacyCfg.model });
    return { session, status: "warm", createdAt: Date.now() };
  }

  private async _legacyReplenish(): Promise<void> {
    const expired = this._legacySessions.filter(
      (s) => s.status === "warm" && this._isExpiredLegacy(s)
    );
    for (const s of expired) await this.discard(s);

    const warmCount = this._legacySessions.filter((s) => s.status === "warm").length;
    const needed = Math.max(0, this.minWarm - warmCount);
    const avail = this.maxTotal - this._legacySessions.length;
    const toCreate = Math.min(needed, avail);
    for (let i = 0; i < toCreate; i++) {
      try {
        this._legacySessions.push(await this._legacyCreate());
      } catch { break; }
    }
  }

  private _isExpiredLegacy(ps: PooledSession): boolean {
    return Date.now() - ps.createdAt > this._maxSessionAge;
  }

  private _isExpiredNew(entry: PoolEntry): boolean {
    return Date.now() - entry.createdAt > this._maxSessionAge;
  }
}

export function isPoolEnabled(): boolean {
  return process.env.MAX_POOL_ENABLED !== "0";
}

let _pool: WorkerPool | undefined;

export function getWorkerPool(): WorkerPool {
  if (!_pool) _pool = new WorkerPool();
  return _pool;
}

export function resetWorkerPool(): void {
  _pool = undefined;
}
