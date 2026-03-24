# Metrics Reference

Hoot exposes a Prometheus-compatible `/metrics` endpoint.

## Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `hoot_messages_total` | Counter | Total messages processed by channel |
| `hoot_message_duration_seconds` | Histogram | Message processing latency |
| `hoot_workers_active` | Gauge | Currently active worker sessions |
| `hoot_circuit_breaker_state` | Gauge | Circuit breaker state (0=closed, 1=open, 2=half-open) |
| `hoot_queue_depth` | Gauge | Messages waiting in each lane |
| `hoot_uptime_seconds` | Gauge | Daemon uptime |
| `hoot_memory_bytes` | Gauge | Resident memory usage |

## Grafana Dashboard

Import the following JSON into Grafana to create a pre-built dashboard:

```json
{
  "uid": "hoot-metrics",
  "title": "Hoot Metrics Dashboard",
  "panels": [
    {
      "title": "Message Rate",
      "type": "graph",
      "targets": [{ "expr": "rate(hoot_messages_total[5m])" }]
    },
    {
      "title": "Latency P95",
      "type": "graph",
      "targets": [{ "expr": "histogram_quantile(0.95, rate(hoot_message_duration_seconds_bucket[5m]))" }]
    },
    {
      "title": "Queue Depth",
      "type": "gauge",
      "targets": [{ "expr": "hoot_queue_depth" }]
    },
    {
      "title": "Circuit Breaker State",
      "type": "stat",
      "targets": [{ "expr": "hoot_circuit_breaker_state" }]
    },
    {
      "title": "Active Workers",
      "type": "stat",
      "targets": [{ "expr": "hoot_workers_active" }]
    }
  ]
}
```

### Recommended Panels

1. **Message Rate** — `rate(hoot_messages_total[5m])` by channel
2. **Latency P95** — `histogram_quantile(0.95, rate(hoot_message_duration_seconds_bucket[5m]))`
3. **Queue Depth** — `hoot_queue_depth` by lane
4. **Circuit Breaker** — `hoot_circuit_breaker_state`
5. **Worker Count** — `hoot_workers_active`
