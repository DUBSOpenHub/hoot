import { randomUUID } from "crypto";
import type { ChannelAdapter, ChannelRouter } from "./adapter.js";
import type { MessageBus } from "../bus/index.js";
import type { MessageEnvelope } from "../bus/types.js";
import { sendToOrchestrator } from "../copilot/orchestrator.js";
import { logAudit } from "../store/db.js";
import { config } from "../config.js";

export class TelegramAdapter implements ChannelAdapter {
  readonly name = "telegram";

  private bus!: MessageBus;
  private router!: ChannelRouter;
  private readonly pendingMessages = new Map<string, {
    chatId: number;
    sendReply: (text: string, done: boolean) => void;
  }>();

  async initialize(bus: MessageBus, router: ChannelRouter): Promise<void> {
    this.bus = bus;
    this.router = router;
    bus.on("message.completed", (evt) => {
      if (evt.channel !== this.name) return;
      const pending = this.pendingMessages.get(evt.envelopeId);
      if (pending) pending.sendReply(evt.response, true);
    });
    bus.on("message.delta", (evt) => {
    });
  }

  async shutdown(): Promise<void> {
    this.pendingMessages.clear();
  }

  deliverResponse(envelopeId: string, text: string, done: boolean): void {
    const pending = this.pendingMessages.get(envelopeId);
    if (pending) {
      pending.sendReply(text, done);
      if (done) this.pendingMessages.delete(envelopeId);
    }
  }

  async deliverProactive(text: string): Promise<void> {
    const { sendProactiveMessage } = await import("../telegram/bot.js");
    await sendProactiveMessage(text);
  }

    handleIncomingMessage(
    text: string,
    chatId: number,
    messageId: number,
    userId: number,
    sendReply: (text: string, done: boolean) => void
  ): void {
    const envelopeId = randomUUID();
    const envelope: MessageEnvelope = {
      id: envelopeId,
      channel: this.name,
      channelMeta: { chatId, messageId },
      text,
      userId: String(userId),
      timestamp: Date.now(),
    };

    this.pendingMessages.set(envelopeId, { chatId, sendReply });
    this.router.trackEnvelope(envelopeId, this.name);

    this.bus.emit("message.incoming", envelope);

    sendToOrchestrator(
      text,
      { type: "telegram", chatId, messageId },
      sendReply
    );
  }
}

let _telegramAdapter: TelegramAdapter | undefined;

export function getTelegramAdapter(): TelegramAdapter {
  if (!_telegramAdapter) _telegramAdapter = new TelegramAdapter();
  return _telegramAdapter;
}

export class TelegramChannelAdapter {
  readonly name = 'telegram';
  readonly channelName = 'telegram';
  private bus: any;
  private token: string;

  constructor(opts: { token: string; bus: any }) {
    this.token = opts.token;
    this.bus = opts.bus;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  _handleMessage(msg: { from: { id: number; username?: string }; text?: string; chat: { id: number }; message_id: number }): void {
    const correlationId = Math.random().toString(36).slice(2);
    this.bus.emit('message.incoming', {
      correlationId,
      channel: 'telegram',
      text: msg.text ?? '',
      userId: String(msg.from.id),
      id: correlationId,
      channelMeta: { chatId: msg.chat.id, messageId: msg.message_id },
      timestamp: Date.now(),
    });
  }
}
