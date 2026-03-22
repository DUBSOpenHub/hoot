import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { MetricsCollector, getMetrics, resetMetrics } from "../src/observability/metrics.js";

describe("MetricsCollector", () => {
  let m: MetricsCollector;

  beforeEach(() => {
    resetMetrics();
    m = new MetricsCollector();
  });

  it("increments counters", () => {
    m.increment("my_counter");
    m.increment("my_counter");
    const output = m.render();
    expect(output).toContain("my_counter 2");
  });

  it("increments counters with labels", () => {
    m.increment("max_messages_total", { tier: "fast", channel: "tui" });
    m.increment("max_messages_total", { tier: "fast", channel: "tui" });
    m.increment("max_messages_total", { tier: "premium", channel: "telegram" });
    const output = m.render();
    expect(output).toContain('max_messages_total{tier="fast",channel="tui"} 2');
    expect(output).toContain('max_messages_total{tier="premium",channel="telegram"} 1');
  });

  it("records histogram observations", () => {
    m.observe("max_response_duration_seconds", 250);
    m.observe("max_response_duration_seconds", 500);
    const output = m.render();
    expect(output).toContain("max_response_duration_seconds_count 2");
    expect(output).toContain("max_response_duration_seconds_sum 750");
  });

  it("sets gauge values", () => {
    m.gauge("max_workers_active", 3);
    const output = m.render();
    expect(output).toContain("max_workers_active 3");
  });

  it("updates gauge to latest value", () => {
    m.gauge("my_gauge", 10);
    m.gauge("my_gauge", 20);
    const output = m.render();
    expect(output).toContain("my_gauge 20");
    expect(output).not.toContain("my_gauge 10");
  });

  it("renders valid Prometheus text format", () => {
    m.increment("max_messages_total", { tier: "standard" });
    m.observe("max_response_duration_seconds", 100);
    m.gauge("max_workers_active", 2);
    const output = m.render();
    // Must have TYPE declarations
    expect(output).toContain("# TYPE max_messages_total counter");
    expect(output).toContain("# TYPE max_response_duration_seconds histogram");
    expect(output).toContain("# TYPE max_workers_active gauge");
  });

  it("includes built-in uptime and memory gauges", () => {
    const output = m.render();
    expect(output).toContain("max_uptime_seconds");
    expect(output).toContain("max_memory_rss_bytes");
  });

  it("histogram has _bucket, _sum, _count entries", () => {
    m.observe("latency_ms", 150);
    const output = m.render();
    expect(output).toContain('latency_ms_bucket{le="+Inf"} 1');
    expect(output).toContain("latency_ms_sum 150");
    expect(output).toContain("latency_ms_count 1");
  });

  it("getMetrics() returns singleton", () => {
    const a = getMetrics();
    const b = getMetrics();
    expect(a).toBe(b);
  });

  it("resetMetrics() creates new singleton", () => {
    const a = getMetrics();
    resetMetrics();
    const b = getMetrics();
    expect(a).not.toBe(b);
  });
});
