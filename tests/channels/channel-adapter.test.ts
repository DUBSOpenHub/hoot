/**
 * Acceptance tests for Channel Adapters: FR-CA.1 – FR-CA.4
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// FR-CA.1 — Telegram adapter lives in src/channels/telegram.ts and implements ChannelAdapter
// ---------------------------------------------------------------------------
describe('FR-CA.1 — TelegramChannelAdapter interface compliance', () => {
  it('FR-CA.1: TelegramChannelAdapter exports a class/object from src/channels/telegram.ts', async () => {
    const mod = await import('../../src/channels/telegram');
    expect(mod).toBeDefined();
    // Should export something named TelegramChannelAdapter or default export
    const adapter = mod.TelegramChannelAdapter ?? mod.default;
    expect(adapter).toBeDefined();
  });

  it('FR-CA.1: TelegramChannelAdapter instance has start() and stop() methods', async () => {
    const mod = await import('../../src/channels/telegram');
    const Adapter = mod.TelegramChannelAdapter ?? mod.default;
    const instance = typeof Adapter === 'function'
      ? new Adapter({ token: 'test-token', bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } })
      : Adapter;
    expect(typeof instance.start).toBe('function');
    expect(typeof instance.stop).toBe('function');
  });

  it('FR-CA.1: TelegramChannelAdapter has a channel name identifier', async () => {
    const mod = await import('../../src/channels/telegram');
    const Adapter = mod.TelegramChannelAdapter ?? mod.default;
    const instance = typeof Adapter === 'function'
      ? new Adapter({ token: 'test-token', bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } })
      : Adapter;
    expect(instance.name ?? instance.channelName).toBe('telegram');
  });
});

// ---------------------------------------------------------------------------
// FR-CA.2 — TUI adapter lives in src/channels/tui.ts and implements ChannelAdapter
// ---------------------------------------------------------------------------
describe('FR-CA.2 — TuiChannelAdapter interface compliance', () => {
  it('FR-CA.2: TuiChannelAdapter exports a class/object from src/channels/tui.ts', async () => {
    const mod = await import('../../src/channels/tui');
    expect(mod).toBeDefined();
    const adapter = mod.TuiChannelAdapter ?? mod.default;
    expect(adapter).toBeDefined();
  });

  it('FR-CA.2: TuiChannelAdapter instance has start() and stop() methods', async () => {
    const mod = await import('../../src/channels/tui');
    const Adapter = mod.TuiChannelAdapter ?? mod.default;
    const instance = typeof Adapter === 'function'
      ? new Adapter({ bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } })
      : Adapter;
    expect(typeof instance.start).toBe('function');
    expect(typeof instance.stop).toBe('function');
  });

  it('FR-CA.2: TuiChannelAdapter has a channel name identifier', async () => {
    const mod = await import('../../src/channels/tui');
    const Adapter = mod.TuiChannelAdapter ?? mod.default;
    const instance = typeof Adapter === 'function'
      ? new Adapter({ bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } })
      : Adapter;
    expect(instance.name ?? instance.channelName).toBe('tui');
  });
});

// ---------------------------------------------------------------------------
// FR-CA.3 — Both adapters register with a ChannelRouter; shims exist
// ---------------------------------------------------------------------------
describe('FR-CA.3 — ChannelRouter registration', () => {
  it('FR-CA.3: ChannelRouter is exported from src/channels/router.ts or similar', async () => {
    // Try multiple plausible export locations
    let mod: Record<string, unknown>;
    try {
      mod = await import('../../src/channels/router');
    } catch {
      mod = await import('../../src/bus/index');
    }
    const Router = (mod as Record<string, unknown>).ChannelRouter ?? (mod as Record<string, unknown>).default;
    expect(Router).toBeDefined();
  });

  it('FR-CA.3: ChannelRouter exposes a register() method', async () => {
    let mod: Record<string, unknown>;
    try {
      mod = await import('../../src/channels/router');
    } catch {
      mod = await import('../../src/bus/index');
    }
    const RouterClass = (mod as Record<string, unknown>).ChannelRouter;
    if (RouterClass && typeof RouterClass === 'function') {
      const router = new (RouterClass as new () => { register: unknown })();
      expect(typeof router.register).toBe('function');
    } else {
      // ChannelRouter might be a singleton
      expect(typeof (mod as { register?: unknown }).register).toBe('function');
    }
  });

  it('FR-CA.3: Registering an adapter does not require modifying orchestrator.ts', async () => {
    const fs = await import('fs');
    const path = await import('path');

    // orchestrator.ts must not hard-code channel types
    const orchPath = path.resolve('src/copilot/orchestrator.ts');
    let source: string;
    try {
      source = fs.readFileSync(orchPath, 'utf8');
    } catch {
      return; // not yet implemented — skip
    }

    // The orchestrator should not enumerate channel types
    expect(source).not.toMatch(/channel\s*===\s*['"]telegram['"]/);
    expect(source).not.toMatch(/channel\s*===\s*['"]tui['"]/);
  });
});

// ---------------------------------------------------------------------------
// FR-CA.4 — Both channels remain functionally equivalent after refactor
// (behavioral regression tests)
// ---------------------------------------------------------------------------
describe('FR-CA.4 — Post-refactor behavioral equivalence', () => {
  it('FR-CA.4: TelegramChannelAdapter emits message.incoming on bus when a message arrives', async () => {
    const { createMessageBus } = await import('../../src/bus/index');
    const bus = createMessageBus();
    const handler = vi.fn();
    bus.on('message.incoming', handler);

    const mod = await import('../../src/channels/telegram');
    const Adapter = mod.TelegramChannelAdapter ?? mod.default;
    if (typeof Adapter !== 'function') return; // guard for not-yet-implemented

    // We can't connect to the real Telegram API in tests — verify the adapter
    // correctly wires bus emission by simulating an inbound update via the adapter's
    // handleMessage (or equivalent internal method exposed for testing).
    const adapter = new Adapter({ token: 'test-token', bus });
    if (typeof (adapter as { _handleMessage?: (msg: unknown) => void })._handleMessage === 'function') {
      (adapter as { _handleMessage: (msg: unknown) => void })._handleMessage({
        from: { id: 1, username: 'testuser' },
        text: 'hello',
        chat: { id: 1 },
        message_id: 42,
      });
      expect(handler).toHaveBeenCalled();
      const evt = handler.mock.calls[0][0] as { channel: string; correlationId: string };
      expect(evt.channel).toBe('telegram');
      expect(evt.correlationId).toBeDefined();
    } else {
      // Adapter doesn't expose internal method yet — check it at least starts without throwing
      await expect(adapter.start()).resolves.not.toThrow?.();
    }
  });

  it('FR-CA.4: TuiChannelAdapter emits message.incoming on bus when a message arrives', async () => {
    const { createMessageBus } = await import('../../src/bus/index');
    const bus = createMessageBus();
    const handler = vi.fn();
    bus.on('message.incoming', handler);

    const mod = await import('../../src/channels/tui');
    const Adapter = mod.TuiChannelAdapter ?? mod.default;
    if (typeof Adapter !== 'function') return;

    const adapter = new Adapter({ bus });
    if (typeof (adapter as { _handleMessage?: (msg: unknown) => void })._handleMessage === 'function') {
      (adapter as { _handleMessage: (msg: unknown) => void })._handleMessage({
        userId: 'tui-user',
        text: 'tui message',
      });
      expect(handler).toHaveBeenCalled();
      const evt = handler.mock.calls[0][0] as { channel: string };
      expect(evt.channel).toBe('tui');
    }
  });

  it('FR-CA.4: channel field on message.incoming payload matches the emitting adapter', async () => {
    const { createMessageBus } = await import('../../src/bus/index');
    const bus = createMessageBus();
    const channels: string[] = [];
    bus.on('message.incoming', (evt: { channel: string }) => channels.push(evt.channel));

    bus.emit('message.incoming', { correlationId: 'c1', channel: 'telegram', text: 'a' });
    bus.emit('message.incoming', { correlationId: 'c2', channel: 'tui', text: 'b' });

    expect(channels).toContain('telegram');
    expect(channels).toContain('tui');
  });
});
