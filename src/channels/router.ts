import type { ChannelAdapter, ChannelRouter } from "./adapter.js";
import { ENVELOPE_TTL_MS } from "../config.js";

export class ChannelRouterImpl implements ChannelRouter {
  private readonly adapters = new Map<string, ChannelAdapter>();
  private readonly envelopeMap = new Map<string, string>();

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  getAdapter(name: string): ChannelAdapter | undefined {
    return this.adapters.get(name);
  }

  trackEnvelope(envelopeId: string, channelName: string): void {
    this.envelopeMap.set(envelopeId, channelName);
    setTimeout(() => this.envelopeMap.delete(envelopeId), ENVELOPE_TTL_MS).unref();
  }

  deliverResponse(envelopeId: string, text: string, done: boolean): void {
    const channelName = this.envelopeMap.get(envelopeId);
    if (!channelName) return;
    const adapter = this.adapters.get(channelName);
    if (!adapter) return;
    adapter.deliverResponse(envelopeId, text, done);
    if (done) this.envelopeMap.delete(envelopeId);
  }

  async deliverProactive(channel: string, text: string): Promise<void> {
    if (channel) {
      const adapter = this.adapters.get(channel);
      if (adapter) {
        await adapter.deliverProactive(text);
        return;
      }
    }
    for (const adapter of this.adapters.values()) {
      await adapter.deliverProactive(text).catch(() => {});
    }
  }
}

export { ChannelRouterImpl as ChannelRouter };
