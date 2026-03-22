import type { Tier } from "../copilot/router.js";

export interface MessageEnvelope {
  id: string;
  channel: string;
  channelMeta: Record<string, unknown>;
  text: string;
  userId?: string;
  timestamp: number;
  tier?: Tier;
  model?: string;
}

export interface RoutedEnvelope extends MessageEnvelope {
  tier: Tier;
  model: string;
}

export interface DeltaEvent {
  envelopeId: string;
  accumulated: string;
}

export interface CompletedEvent {
  envelopeId: string;
  response: string;
  durationMs: number;
  tier?: Tier;
  model?: string;
  channel: string;
}

export interface ErrorEvent {
  envelopeId: string;
  error: string;
  channel: string;
}

export interface WorkerEvent {
  name: string;
  workingDir: string;
  channel?: string;
  correlationId?: string;
}

export interface WorkerResultEvent extends WorkerEvent {
  result: string;
  durationMs: number;
}

export interface WorkerErrorEvent extends WorkerEvent {
  error: string;
  durationMs: number;
}

export type CircuitBreakerState = "closed" | "open" | "half-open";

export interface MetricsSnapshot {
  queueDepth: Record<string, number>;
  activeWorkers: number;
  poolUtilization?: number;
  circuitBreakerState: Record<string, CircuitBreakerState>;
  uptimeMs: number;
}

export interface BusEventMap {
  "message.incoming":  MessageEnvelope;
  "message.routed":    RoutedEnvelope;
  "message.delta":     DeltaEvent;
  "message.completed": CompletedEvent;
  "message.error":     ErrorEvent;
  "worker.created":    WorkerEvent;
  "worker.completed":  WorkerResultEvent;
  "worker.failed":     WorkerErrorEvent;
  "metrics.tick":      MetricsSnapshot;
}
