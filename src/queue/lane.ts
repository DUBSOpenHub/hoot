import type { MessageEnvelope } from "../bus/types.js";
import type { MessageCallback } from "../copilot/orchestrator.js";
import { createLogger } from "../observability/logger.js";

const log = createLogger("lane");

export interface LaneConfig {
  name: string;
  concurrency: number;
  model: string;
}

export interface QueuedLaneMessage {
  envelope: MessageEnvelope;
  callback: MessageCallback;
  resolve: (response: string) => void;
  reject: (err: unknown) => void;
  userId?: string;
}

type LaneExecutor = (msg: QueuedLaneMessage) => Promise<string>;

export class Lane {
  readonly config: LaneConfig;
  private active = 0;
  private readonly queue: QueuedLaneMessage[] = [];
  private executor?: LaneExecutor;
  private readonly userActive = new Set<string>();

  constructor(config: LaneConfig) {
    this.config = config;
  }

  get activeCount(): number { return this.active; }
  get pendingCount(): number { return this.queue.length; }

  setExecutor(fn: LaneExecutor): void {
    this.executor = fn;
  }

  enqueue(msg: QueuedLaneMessage): void {
    this.queue.push(msg);
    this.drain();
  }

  drain(): void {
    if (!this.executor) return;
    while (this.active < this.config.concurrency && this.queue.length > 0) {
      const idx = this.findEligible();
      if (idx === -1) break;
      const [msg] = this.queue.splice(idx, 1);
      this.dispatch(msg);
    }
  }

  private findEligible(): number {
    for (let i = 0; i < this.queue.length; i++) {
      const msg = this.queue[i];
      const uid = msg.userId;
      if (!uid || !this.userActive.has(uid)) return i;
    }
    return -1;
  }

  private dispatch(msg: QueuedLaneMessage): void {
    this.active++;
    if (msg.userId) this.userActive.add(msg.userId);

    const fn = this.executor!;
    fn(msg).then((response) => {
      msg.resolve(response);
    }).catch((err) => {
      msg.reject(err);
    }).finally(() => {
      this.active--;
      if (msg.userId) this.userActive.delete(msg.userId);
      this.drain();
    });
  }
}
