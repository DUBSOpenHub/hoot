import { randomUUID } from "crypto";
import type { Response } from "express";
import type { ChannelAdapter, ChannelRouter } from "./adapter.js";
import type { MessageBus } from "../bus/index.js";
import type { MessageEnvelope } from "../bus/types.js";
import { sendToOrchestrator } from "../copilot/orchestrator.js";
import { broadcastToSSE } from "../api/server.js";

export class TuiAdapter implements ChannelAdapter {
  readonly name = "tui";

  private bus!: MessageBus;
  private router!: ChannelRouter;

  async initialize(bus: MessageBus, router: ChannelRouter): Promise<void> {
    this.bus = bus;
    this.router = router;
    bus.on("message.completed", (evt) => {
      if (evt.channel !== this.name) return;
    });
  }

  async shutdown(): Promise<void> {
  }

  deliverResponse(envelopeId: string, text: string, done: boolean): void {
  }

  async deliverProactive(text: string): Promise<void> {
    broadcastToSSE(text);
  }

    handleIncomingMessage(
    text: string,
    connectionId: string,
    callback: (text: string, done: boolean) => void
  ): void {
    const envelopeId = randomUUID();
    const envelope: MessageEnvelope = {
      id: envelopeId,
      channel: this.name,
      channelMeta: { connectionId },
      text,
      userId: connectionId,
      timestamp: Date.now(),
    };

    this.router.trackEnvelope(envelopeId, this.name);

    this.bus.emit("message.incoming", envelope);

    sendToOrchestrator(
      text,
      { type: "tui", connectionId },
      callback
    );
  }
}

let _tuiAdapter: TuiAdapter | undefined;

export function getTuiAdapter(): TuiAdapter {
  if (!_tuiAdapter) _tuiAdapter = new TuiAdapter();
  return _tuiAdapter;
}

export class TuiChannelAdapter {
  readonly name = 'tui';
  readonly channelName = 'tui';
  private bus: any;

  constructor(opts: { bus: any }) {
    this.bus = opts.bus;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  _handleMessage(msg: { userId?: string; text?: string }): void {
    const correlationId = Math.random().toString(36).slice(2);
    this.bus.emit('message.incoming', {
      correlationId,
      channel: 'tui',
      text: msg.text ?? '',
      userId: msg.userId ?? 'tui-user',
      id: correlationId,
      channelMeta: {},
      timestamp: Date.now(),
    });
  }
}
