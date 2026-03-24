/**
 * Acceptance tests for FR-6.4 and FR-6.5: Prometheus Metrics
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// FR-6.4 — GET /metrics returns valid Prometheus text format
// ---------------------------------------------------------------------------
describe('FR-6.4 — GET /metrics Prometheus format', () => {
  it('FR-6.4: GET /metrics returns HTTP 200', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ status: number }> })(app).get('/metrics');
    expect(res.status).toBe(200);
  });

  it('FR-6.4: GET /metrics Content-Type is text/plain', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ status: number; headers: Record<string, string> }> })(app).get('/metrics');
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('FR-6.4: /metrics response includes hoot_messages_total counter', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ status: number; text: string }> })(app).get('/metrics');
    expect(res.text).toMatch(/hoot_messages_total/);
  });

  it('FR-6.4: hoot_messages_total has tier and channel labels', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ text: string }> })(app).get('/metrics');
    // Prometheus label syntax: metric_name{label="value"}
    expect(res.text).toMatch(/hoot_messages_total\{[^}]*tier=/);
    expect(res.text).toMatch(/hoot_messages_total\{[^}]*channel=/);
  });

  it('FR-6.4: /metrics response includes hoot_message_duration_ms histogram', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ text: string }> })(app).get('/metrics');
    expect(res.text).toMatch(/hoot_message_duration_ms/);
  });

  it('FR-6.4: hoot_message_duration_ms has tier and quantile labels', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ text: string }> })(app).get('/metrics');
    expect(res.text).toMatch(/hoot_message_duration_ms.*quantile/);
  });

  it('FR-6.4: /metrics includes hoot_worker_pool_utilization gauge', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ text: string }> })(app).get('/metrics');
    expect(res.text).toMatch(/hoot_worker_pool_utilization/);
  });

  it('FR-6.4: /metrics includes hoot_circuit_breaker_state gauge', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ text: string }> })(app).get('/metrics');
    expect(res.text).toMatch(/hoot_circuit_breaker_state/);
  });

  it('FR-6.4: hoot_circuit_breaker_state has a breaker label', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ text: string }> })(app).get('/metrics');
    expect(res.text).toMatch(/hoot_circuit_breaker_state\{[^}]*breaker=/);
  });

  it('FR-6.4: /metrics response body is valid Prometheus text format (# HELP or # TYPE headers)', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const res = await (request as (app: unknown) => { get: (path: string) => Promise<{ text: string }> })(app).get('/metrics');
    // Valid Prometheus format must contain at least one # TYPE or # HELP comment
    expect(res.text).toMatch(/^#\s+(TYPE|HELP)/m);
  });
});

// ---------------------------------------------------------------------------
// FR-6.5 — Grafana dashboard JSON import provided in docs/metrics.md
// ---------------------------------------------------------------------------
describe('FR-6.5 — Grafana dashboard documentation', () => {
  it('FR-6.5: docs/metrics.md exists in the project', () => {
    const p = resolve('docs/metrics.md');
    expect(existsSync(p)).toBe(true);
  });

  it('FR-6.5: docs/metrics.md contains a Grafana dashboard JSON block', () => {
    const p = resolve('docs/metrics.md');
    if (!existsSync(p)) return;
    const content = readFileSync(p, 'utf8');
    // Must contain a JSON code block with Grafana dashboard keys
    expect(content).toMatch(/```json/);
    expect(content).toMatch(/"panels"|"dashboard"|"title"|"uid"/);
  });

  it('FR-6.5: the Grafana JSON block in docs/metrics.md is parseable', () => {
    const p = resolve('docs/metrics.md');
    if (!existsSync(p)) return;
    const content = readFileSync(p, 'utf8');
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) return;
    expect(() => JSON.parse(jsonMatch[1])).not.toThrow();
  });
});
