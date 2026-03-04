# RabbitMQ Streams

## What Are Streams

Append-only log data structure with non-destructive consumer semantics. Multiple consumers read the same messages independently via offset tracking, similar to Apache Kafka.

## Declaration

```javascript
channel.assertQueue("my-stream", {
  durable: true,
  arguments: {
    "x-queue-type": "stream",
    "x-max-length-bytes": 5368709120,     // 5 GB max
    "x-max-age": "7D",                     // 7 day retention
    "x-stream-max-segment-size-bytes": 524288000  // 500 MB segments
  }
});
```

## Consumer Offset Control

```javascript
channel.consume("my-stream", handler, {
  arguments: { "x-stream-offset": "first" }
});
```

| Offset | Description |
|---|---|
| `"first"` | Beginning of log |
| `"last"` / `"next"` | End of log (new messages only) |
| Numeric | Specific offset |
| Timestamp | POSIX time point |
| Interval (e.g., `"1h"`) | Relative time |

## Retention

- Size-based: `x-max-length-bytes`
- Time-based: `x-max-age`
- Removal at segment level, not per-message

## Replication and Fault Tolerance

- Replicated across cluster nodes
- 3-node cluster tolerates 1 failure; 5-node tolerates 2
- Publisher confirms after quorum replication (no explicit fsync)

## Super Streams (Partitioned)

```bash
rabbitmq-streams add_super_stream my-super-stream --partitions 5
```

- Horizontal scaling via partitions
- Ordering guaranteed within partition
- Integrates with single active consumer

## Stream Protocol (Port 5552)

Dedicated binary protocol for optimized stream operations:
- Automatic offset tracking
- Sub-batching, credit-based flow control
- Higher throughput than AMQP 0-9-1 for streams
- Client libraries: Java, Go, .NET, Python, Rust, C

## Server-Side Filtering (RabbitMQ 4.2+)

- Bloom filter-based message filtering before delivery
- SQL filter expressions
- 4+ million msgs/sec filtering throughput

## Limitations

- No per-message TTL, priority, or DLX
- Cannot be exclusive or non-durable
- No `basic.get` (polling) -- must use `basic.consume`
- No global QoS

---

[← Back](README.md)
