import { createLogger } from "./logger.js";

const log = createLogger("metrics");

type LabelSet = Record<string, string>;

interface CounterEntry {
  value: number;
  labels: LabelSet;
}

interface HistogramEntry {
  sum: number;
  count: number;
  buckets: Map<number, number>; // upper bound → cumulative count
  labels: LabelSet;
}

interface GaugeEntry {
  value: number;
  labels: LabelSet;
}

export class MetricsCollector {
  private readonly counters = new Map<string, CounterEntry[]>();
  private readonly histograms = new Map<string, HistogramEntry[]>();
  private readonly gauges = new Map<string, GaugeEntry[]>();
  private readonly startTime = Date.now();

  private readonly HISTOGRAM_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, Infinity];

  increment(name: string, labels: LabelSet = {}): void {
    const entries = this.counters.get(name) ?? [];
    const existing = entries.find((e) => labelsEqual(e.labels, labels));
    if (existing) {
      existing.value++;
    } else {
      entries.push({ value: 1, labels });
    }
    this.counters.set(name, entries);
  }

  observe(name: string, valueMs: number, labels: LabelSet = {}): void {
    const entries = this.histograms.get(name) ?? [];
    let entry = entries.find((e) => labelsEqual(e.labels, labels));
    if (!entry) {
      entry = {
        sum: 0,
        count: 0,
        buckets: new Map(this.HISTOGRAM_BUCKETS.map((b) => [b, 0])),
        labels,
      };
      entries.push(entry);
    }
    entry.sum += valueMs;
    entry.count++;
    for (const bound of this.HISTOGRAM_BUCKETS) {
      if (valueMs <= bound) entry.buckets.set(bound, (entry.buckets.get(bound) ?? 0) + 1);
    }
    this.histograms.set(name, entries);
  }

  gauge(name: string, value: number, labels: LabelSet = {}): void {
    const entries = this.gauges.get(name) ?? [];
    const existing = entries.find((e) => labelsEqual(e.labels, labels));
    if (existing) {
      existing.value = value;
    } else {
      entries.push({ value, labels });
    }
    this.gauges.set(name, entries);
  }

  render(): string {
    const lines: string[] = [];
    const uptimeSec = (Date.now() - this.startTime) / 1000;

    this.gauges.set("max_uptime_seconds", [{ value: uptimeSec, labels: {} }]);
    this.gauges.set("max_memory_rss_bytes", [{ value: process.memoryUsage().rss, labels: {} }]);

    for (const [name, entries] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const e of entries) {
        lines.push(`${name}${renderLabels(e.labels)} ${e.value}`);
      }
    }

    for (const [name, entries] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`);
      for (const e of entries) {
        const labelStr = renderLabels(e.labels);
        for (const [bound, count] of e.buckets) {
          const le = bound === Infinity ? "+Inf" : String(bound);
          lines.push(`${name}_bucket{le="${le}"${labelStr ? "," + labelStr.slice(1, -1) : ""}} ${count}`);
        }
        lines.push(`${name}_sum${labelStr} ${e.sum}`);
        lines.push(`${name}_count${labelStr} ${e.count}`);
      }
    }

    for (const [name, entries] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      for (const e of entries) {
        lines.push(`${name}${renderLabels(e.labels)} ${e.value}`);
      }
    }

    return lines.join("\n") + "\n";
  }
}

function labelsEqual(a: LabelSet, b: LabelSet): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

function renderLabels(labels: LabelSet): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return "{" + entries.map(([k, v]) => `${k}="${v}"`).join(",") + "}";
}

let _metrics: MetricsCollector | undefined;

export function getMetrics(): MetricsCollector {
  if (!_metrics) _metrics = new MetricsCollector();
  return _metrics;
}

export function resetMetrics(): void {
  _metrics = undefined;
}

export function wireMetrics(bus: import("../bus/index.js").MessageBus): void {
  const m = getMetrics();

  bus.on("message.completed", (evt) => {
    m.increment("max_messages_total", {
      tier: evt.tier ?? "unknown",
      channel: evt.channel,
    });
    m.observe("max_response_duration_seconds", evt.durationMs, {
      tier: evt.tier ?? "unknown",
    });
  });

  bus.on("message.error", (evt) => {
    m.increment("max_messages_errors_total", { channel: evt.channel });
  });

  bus.on("worker.completed", (_evt) => {
    m.increment("max_worker_tasks_total", { status: "completed" });
  });

  bus.on("worker.failed", (_evt) => {
    m.increment("max_worker_tasks_total", { status: "failed" });
  });
}
