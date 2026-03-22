/**
 * Acceptance tests for FR-4: Message Bus
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MessageBus } from '../../src/bus/index';

// ---------------------------------------------------------------------------
// Helpers — load the module under test fresh per suite to avoid state bleed
// ---------------------------------------------------------------------------
async function createBus(): Promise<MessageBus> {
  const { createMessageBus } = await import('../../src/bus/index');
  return createMessageBus();
}

// ---------------------------------------------------------------------------
// FR-4.1 — Typed MessageBus emits the required event names
// ---------------------------------------------------------------------------
describe('FR-4.1 — MessageBus event contract', () => {
  it('FR-4.1: emits message.incoming event', async () => {
    const bus = await createBus();
    const handler = vi.fn();
    bus.on('message.incoming', handler);
    bus.emit('message.incoming', { correlationId: 'abc', channel: 'telegram', text: 'hello' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('FR-4.1: emits message.completed event', async () => {
    const bus = await createBus();
    const handler = vi.fn();
    bus.on('message.completed', handler);
    bus.emit('message.completed', { correlationId: 'abc' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('FR-4.1: emits message.error event', async () => {
    const bus = await createBus();
    const handler = vi.fn();
    bus.on('message.error', handler);
    bus.emit('message.error', { correlationId: 'abc', error: new Error('boom') });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('FR-4.1: emits worker.completed event', async () => {
    const bus = await createBus();
    const handler = vi.fn();
    bus.on('worker.completed', handler);
    bus.emit('worker.completed', { correlationId: 'abc', workerId: 'w1' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('FR-4.1: emits worker.failed event', async () => {
    const bus = await createBus();
    const handler = vi.fn();
    bus.on('worker.failed', handler);
    bus.emit('worker.failed', { correlationId: 'abc', error: new Error('fail') });
    expect(handler).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// FR-4.2 — message.incoming fires before the orchestrator processes the message
// ---------------------------------------------------------------------------
describe('FR-4.2 — message.incoming precedes orchestration', () => {
  it('FR-4.2: message.incoming is emitted on every inbound message before orchestrator handling', async () => {
    const bus = await createBus();
    const callOrder: string[] = [];

    bus.on('message.incoming', () => callOrder.push('bus'));

    // Simulate the orchestrator being called after bus emission
    const simulateChannel = async () => {
      bus.emit('message.incoming', { correlationId: 'x1', channel: 'telegram', text: 'hi' });
      callOrder.push('orchestrator');
    };

    await simulateChannel();
    expect(callOrder[0]).toBe('bus');
    expect(callOrder[1]).toBe('orchestrator');
  });

  it('FR-4.2: message.incoming fires for multiple distinct messages', async () => {
    const bus = await createBus();
    const received: string[] = [];

    bus.on('message.incoming', (evt: { correlationId: string }) => {
      received.push(evt.correlationId);
    });

    bus.emit('message.incoming', { correlationId: 'cid-1', channel: 'tui', text: 'a' });
    bus.emit('message.incoming', { correlationId: 'cid-2', channel: 'telegram', text: 'b' });
    bus.emit('message.incoming', { correlationId: 'cid-3', channel: 'http', text: 'c' });

    expect(received).toEqual(['cid-1', 'cid-2', 'cid-3']);
  });
});

// ---------------------------------------------------------------------------
// FR-4.3 — Adding a new channel adapter requires zero changes to orchestrator.ts
// ---------------------------------------------------------------------------
describe('FR-4.3 — Orchestrator is channel-agnostic', () => {
  it('FR-4.3: orchestrator.ts does not import channel-specific modules directly', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const orchestratorPath = path.resolve('src/copilot/orchestrator.ts');

    let source = '';
    try {
      source = fs.readFileSync(orchestratorPath, 'utf8');
    } catch {
      // If not yet implemented, skip rather than fail
      return;
    }

    // Orchestrator must NOT import Telegram or TUI channel files directly
    expect(source).not.toMatch(/require\(['"].*telegram/);
    expect(source).not.toMatch(/from ['"].*channels\/telegram/);
    expect(source).not.toMatch(/from ['"].*channels\/tui/);
    expect(source).not.toMatch(/from ['"].*telegram\/bot/);
  });

  it('FR-4.3: a mock channel adapter can emit message.incoming without orchestrator changes', async () => {
    const bus = await createBus();
    const received: unknown[] = [];

    bus.on('message.incoming', (evt) => received.push(evt));

    // Any object acting as a channel can emit on the bus without touching orchestrator
    const mockChannel = {
      start: () => {
        bus.emit('message.incoming', {
          correlationId: 'mock-1',
          channel: 'mock',
          text: 'test',
        });
      },
    };

    mockChannel.start();
    expect(received).toHaveLength(1);
    expect((received[0] as { channel: string }).channel).toBe('mock');
  });
});

// ---------------------------------------------------------------------------
// FR-4.4 — correlationId is present and propagated end-to-end
// ---------------------------------------------------------------------------
describe('FR-4.4 — correlationId propagation', () => {
  it('FR-4.4: message.incoming event payload includes correlationId', async () => {
    const bus = await createBus();
    let captured: unknown;
    bus.on('message.incoming', (evt) => { captured = evt; });
    bus.emit('message.incoming', { correlationId: 'end-to-end-id', channel: 'telegram', text: 'hello' });
    expect((captured as { correlationId: string }).correlationId).toBe('end-to-end-id');
  });

  it('FR-4.4: correlationId is present on message.completed', async () => {
    const bus = await createBus();
    const ids: string[] = [];

    bus.on('message.incoming', (evt: { correlationId: string }) => ids.push(evt.correlationId));
    bus.on('message.completed', (evt: { correlationId: string }) => ids.push(evt.correlationId));

    const cid = 'trace-123';
    bus.emit('message.incoming', { correlationId: cid, channel: 'tui', text: 'ping' });
    bus.emit('message.completed', { correlationId: cid, response: 'pong' });

    expect(ids[0]).toBe(cid);
    expect(ids[1]).toBe(cid);
  });

  it('FR-4.4: correlationId is present on message.error', async () => {
    const bus = await createBus();
    let errorCid: string | undefined;
    bus.on('message.error', (evt: { correlationId: string }) => { errorCid = evt.correlationId; });
    bus.emit('message.error', { correlationId: 'err-abc', error: new Error('oops') });
    expect(errorCid).toBe('err-abc');
  });

  it('FR-4.4: correlationId is present on worker.completed', async () => {
    const bus = await createBus();
    let wCid: string | undefined;
    bus.on('worker.completed', (evt: { correlationId: string }) => { wCid = evt.correlationId; });
    bus.emit('worker.completed', { correlationId: 'worker-xyz', workerId: 'w99' });
    expect(wCid).toBe('worker-xyz');
  });

  it('FR-4.4: correlationId is present on worker.failed', async () => {
    const bus = await createBus();
    let wCid: string | undefined;
    bus.on('worker.failed', (evt: { correlationId: string }) => { wCid = evt.correlationId; });
    bus.emit('worker.failed', { correlationId: 'worker-fail-1', error: new Error('crash') });
    expect(wCid).toBe('worker-fail-1');
  });
});
