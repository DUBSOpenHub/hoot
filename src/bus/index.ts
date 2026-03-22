import { EventEmitter } from "events";
import type { BusEventMap } from "./types.js";

type Listener<T> = (event: T) => void;

export class MessageBus {
  private readonly emitter: EventEmitter;
  private readonly _sync: boolean;

  constructor(opts?: { sync?: boolean }) {
    this._sync = opts?.sync ?? false;
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
  }

  emit<K extends keyof BusEventMap>(event: K, data: BusEventMap[K]): void {
    if (this._sync) {
      this.emitter.emit(event as string, data);
    } else {
      process.nextTick(() => {
        this.emitter.emit(event as string, data);
      });
    }
  }

  on<K extends keyof BusEventMap>(event: K, listener: Listener<BusEventMap[K]>): () => void {
    this.emitter.on(event as string, listener as (...args: unknown[]) => void);
    return () => this.emitter.off(event as string, listener as (...args: unknown[]) => void);
  }

  once<K extends keyof BusEventMap>(event: K, listener: Listener<BusEventMap[K]>): void {
    this.emitter.once(event as string, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof BusEventMap>(event: K, listener: Listener<BusEventMap[K]>): void {
    this.emitter.off(event as string, listener as (...args: unknown[]) => void);
  }

  listenerCount(event: keyof BusEventMap): number {
    return this.emitter.listenerCount(event as string);
  }
}

let _bus: MessageBus | undefined;

export function getBus(): MessageBus {
  if (!_bus) _bus = new MessageBus();
  return _bus;
}

export function resetBus(): void {
  _bus = undefined;
}

export function createMessageBus(): MessageBus {
  return new MessageBus({ sync: true });
}
