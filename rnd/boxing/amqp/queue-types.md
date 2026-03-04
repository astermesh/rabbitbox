# Queue Types Comparison

## Classic Queues

- Single-node, non-replicated (mirroring removed in RabbitMQ 4.0)
- CQv2 only since 4.0 -- better performance and lower memory
- Full priority range (0-255), TTL, DLX, queue expiry, exclusive queues
- Best for: transient workloads, RPC reply queues, low-latency single-node

## Quorum Queues

- Raft-replicated across multiple nodes, fsync to disk
- Publisher confirms only after quorum write
- Two priority levels, at-least-once DLX, poison message handling (`x-delivery-limit`)
- Cannot be exclusive or auto-delete
- Best for: mission-critical messaging, fault tolerance

## Streams

- Append-only log, non-destructive reads, consumer offset tracking
- Multiple consumers read same data without extra queues
- Retention-based (size or age), no per-message TTL or DLX
- Best for: fan-out, replay, high-throughput ingestion, event sourcing

## Feature Matrix

| Feature | Classic | Quorum | Stream |
|---|---|---|---|
| Replication | None | Raft | Replicated |
| Data safety | Low | Very high | High |
| Replay | No | No | Yes |
| Priority | Full range | 2 levels | None |
| DLX | Yes | Yes (at-least-once) | No |
| TTL | Yes | Yes | No (retention) |
| Exclusive | Yes | No | No |

---

[← Back](README.md)
