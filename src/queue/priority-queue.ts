import { createLogger } from "../observability/logger.js";

const log = createLogger("priority-queue");

type Lane = 'fast' | 'standard' | 'premium';

export interface EnqueueOptions {
  id: string;
  userId: string;
  tier: Lane;
  handler: () => Promise<void>;
}

export interface LaneConfig {
  concurrency: number;
  model: string;
  maxConcurrent?: number;
}

export interface PriorityQueueOptions {
  rateLimitPerMinute?: number;
}

export class RateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private lastRefill: number;

  constructor(private readonly limitPerMinute: number = 10) {
    this.capacity = limitPerMinute;
    this.tokens = limitPerMinute;
    this.refillPerMs = limitPerMinute / 60_000;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return true;
    }
    return false;
  }

  async acquire(): Promise<void> {
    while (!this.tryConsume()) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }
}

const LANE_CONFIG: Record<Lane, LaneConfig> = {
  fast:     { concurrency: 2, model: 'gpt-4.1' },
  standard: { concurrency: 2, model: 'claude-sonnet-4.6' },
  premium:  { concurrency: 1, model: 'claude-opus-4.6' },
};

interface QueueItem extends EnqueueOptions {
  resolve: () => void;
  reject: (err: unknown) => void;
  _legacyMsg?: any; // original QueuedLaneMessage for legacy API
}

class LaneRunner {
  private active = 0;
  private readonly queue: QueueItem[] = [];
  private readonly userActive = new Set<string>();
  _legacyExecutor?: (msg: any) => Promise<string>;

  constructor(
    readonly name: Lane,
    private readonly config: LaneConfig,
    private readonly rateLimiter: RateLimiter,
  ) {}

  enqueue(item: QueueItem): void {
    this.queue.push(item);
    this.drain();
  }

  private drain(): void {
    while (this.active < this.config.concurrency && this.queue.length > 0) {
      const idx = this.findEligible();
      if (idx === -1) break;
      const [item] = this.queue.splice(idx, 1);
      this.run(item);
    }
  }

  private findEligible(): number {
    for (let i = 0; i < this.queue.length; i++) {
      if (!this.queue[i].userId || !this.userActive.has(this.queue[i].userId)) return i;
    }
    return -1;
  }

  private run(item: QueueItem): void {
    this.active++;
    if (item.userId) this.userActive.add(item.userId);

    const doWork = this._legacyExecutor
      ? () => this._legacyExecutor!(item._legacyMsg ?? item)
      : () => this.rateLimiter.acquire().then(() => item.handler());

    doWork().then(() => {
      item.resolve();
    }).catch((err) => {
      item.reject(err);
    }).finally(() => {
      this.active--;
      if (item.userId) this.userActive.delete(item.userId);
      this.drain();
    });
  }

  get activeCount(): number { return this.active; }
  get pendingCount(): number { return this.queue.length; }
}

export class PriorityQueue {
  readonly laneConfig: Record<Lane, LaneConfig>;
  readonly rateLimiter: RateLimiter;
  private readonly runners: Map<Lane, LaneRunner>;

  constructor(opts?: PriorityQueueOptions) {
    this.laneConfig = { ...LANE_CONFIG };
    this.rateLimiter = new RateLimiter(opts?.rateLimitPerMinute ?? 10);
    this.runners = new Map([
      ['fast',     new LaneRunner('fast',     LANE_CONFIG.fast,     this.rateLimiter)],
      ['standard', new LaneRunner('standard', LANE_CONFIG.standard, this.rateLimiter)],
      ['premium',  new LaneRunner('premium',  LANE_CONFIG.premium,  this.rateLimiter)],
    ]);
  }

  enqueue(optsOrMsg: EnqueueOptions | any, tier?: string): Promise<void> | void {
    if (optsOrMsg && typeof optsOrMsg.handler === 'function') {
      return new Promise<void>((resolve, reject) => {
        const lane = this.runners.get(optsOrMsg.tier) ?? this.runners.get('standard')!;
        lane.enqueue({ ...optsOrMsg, resolve, reject });
      });
    }
    const lane = this.runners.get((tier ?? 'standard') as Lane) ?? this.runners.get('standard')!;
    const legacyMsg = optsOrMsg;
    lane.enqueue({
      id: legacyMsg?.envelope?.id ?? Math.random().toString(36),
      userId: legacyMsg?.userId ?? '',
      tier: (tier ?? 'standard') as Lane,
      handler: async () => {},
      resolve: legacyMsg?.resolve ?? (() => {}),
      reject: legacyMsg?.reject ?? (() => {}),
      _legacyMsg: legacyMsg,
    });
  }

  setExecutor(fn: (msg: any) => Promise<string>): void {
    for (const runner of this.runners.values()) {
      (runner as any)._legacyExecutor = fn;
    }
  }

  dequeue(): void {}

  getStats(): Record<Lane, { active: number; pending: number }> {
    const stats = {} as Record<Lane, { active: number; pending: number }>;
    for (const [name, runner] of this.runners) {
      stats[name] = { active: runner.activeCount, pending: runner.pendingCount };
    }
    return stats;
  }
}

export class SerialQueue {
  private _processing = false;
  private readonly queue: QueueItem[] = [];

  enqueue(opts: EnqueueOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ ...opts, resolve, reject });
      this.drain();
    });
  }

  dequeue(): void {}

  private drain(): void {
    if (this._processing || this.queue.length === 0) return;
    this._processing = true;
    const item = this.queue.shift()!;
    item.handler().then(() => {
      item.resolve();
    }).catch((err) => {
      item.reject(err);
    }).finally(() => {
      this._processing = false;
      this.drain();
    });
  }
}

export const LegacyQueue = SerialQueue;

export function isQueueV2(): boolean {
  return process.env.MAX_QUEUE_V2 === '1';
}

let _priorityQueue: PriorityQueue | undefined;

export function getPriorityQueue(): PriorityQueue {
  if (!_priorityQueue) _priorityQueue = new PriorityQueue();
  return _priorityQueue;
}

export function resetPriorityQueue(): void {
  _priorityQueue = undefined;
}
