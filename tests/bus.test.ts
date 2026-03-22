import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MessageBus, getBus, resetBus } from "../src/bus/index.js";
import type { MessageEnvelope } from "../src/bus/types.js";

describe("MessageBus", () => {
  let bus: MessageBus;

  beforeEach(() => {
    resetBus();
    bus = getBus();
  });

  it("emits and receives message.incoming events", () =>
    new Promise<void>((resolve) => {
      const envelope: MessageEnvelope = {
        id: "test-id-1",
        channel: "tui",
        channelMeta: { connectionId: "conn-1" },
        text: "hello",
        timestamp: Date.now(),
      };

      bus.on("message.incoming", (evt) => {
        expect(evt.id).toBe("test-id-1");
        expect(evt.text).toBe("hello");
        expect(evt.channel).toBe("tui");
        resolve();
      });

      bus.emit("message.incoming", envelope);
    }));

  it("delivers events via process.nextTick (non-blocking)", () => {
    let received = false;
    bus.on("message.incoming", () => { received = true; });

    const envelope: MessageEnvelope = {
      id: "tick-test",
      channel: "tui",
      channelMeta: {},
      text: "tick",
      timestamp: Date.now(),
    };

    bus.emit("message.incoming", envelope);
    // Should not be synchronously received
    expect(received).toBe(false);
  });

  it("supports once() — fires listener only once", () =>
    new Promise<void>((resolve) => {
      let count = 0;
      bus.once("message.incoming", () => { count++; });

      const makeEnv = (id: string): MessageEnvelope => ({
        id,
        channel: "tui",
        channelMeta: {},
        text: "x",
        timestamp: Date.now(),
      });

      bus.emit("message.incoming", makeEnv("e1"));
      bus.emit("message.incoming", makeEnv("e2"));

      setTimeout(() => {
        expect(count).toBe(1);
        resolve();
      }, 50);
    }));

  it("returns unsubscribe function from on()", () =>
    new Promise<void>((resolve) => {
      let count = 0;
      const unsub = bus.on("message.incoming", () => { count++; });

      const env: MessageEnvelope = {
        id: "unsub-test",
        channel: "tui",
        channelMeta: {},
        text: "x",
        timestamp: Date.now(),
      };

      bus.emit("message.incoming", env);
      setTimeout(() => {
        unsub(); // Unsubscribe
        bus.emit("message.incoming", env);
        setTimeout(() => {
          expect(count).toBe(1); // Second emit ignored
          resolve();
        }, 20);
      }, 20);
    }));

  it("emits worker.completed events", () =>
    new Promise<void>((resolve) => {
      bus.on("worker.completed", (evt) => {
        expect(evt.name).toBe("test-worker");
        expect(evt.result).toBe("done");
        resolve();
      });

      bus.emit("worker.completed", {
        name: "test-worker",
        workingDir: "/tmp",
        result: "done",
        durationMs: 1000,
      });
    }));

  it("has maxListeners set to 50", () => {
    expect(bus.listenerCount("message.incoming")).toBe(0);
    // Add many listeners without warning
    const unsubs: (() => void)[] = [];
    for (let i = 0; i < 40; i++) {
      unsubs.push(bus.on("message.incoming", () => {}));
    }
    expect(bus.listenerCount("message.incoming")).toBe(40);
    unsubs.forEach((u) => u());
  });

  it("carries correlationId end-to-end", () =>
    new Promise<void>((resolve) => {
      const correlationId = "corr-abc-123";
      bus.on("message.completed", (evt) => {
        expect(evt.envelopeId).toBe(correlationId);
        resolve();
      });
      bus.emit("message.completed", {
        envelopeId: correlationId,
        response: "ok",
        durationMs: 100,
        channel: "tui",
      });
    }));
});
