import type { MessageBus } from "../bus/index.js";

export interface ChannelAdapter {
  readonly name: string;

    initialize(bus: MessageBus, router: ChannelRouter): Promise<void>;

  shutdown(): Promise<void>;

    deliverResponse(envelopeId: string, text: string, done: boolean): void;

    deliverProactive(text: string): Promise<void>;
}

export interface ChannelRouter {
  register(adapter: ChannelAdapter): void;

  deliverResponse(envelopeId: string, text: string, done: boolean): void;
  deliverProactive(channel: string, text: string): Promise<void>;

  getAdapter(name: string): ChannelAdapter | undefined;

  trackEnvelope(envelopeId: string, channelName: string): void;
}
