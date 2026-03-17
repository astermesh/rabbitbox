# T02: Consumer Management & Dispatch

Implement consumer registration and round-robin message dispatch with prefetch.

## Scope

- `consume(queue, callback, options)`:
  - Generate consumerTag if not provided (via OBI random hook)
  - `exclusive` flag: fail if queue already has consumers (ACCESS_REFUSED)
  - `noAck` flag: messages auto-acknowledged on delivery
  - Register consumer on queue, start dispatching pending messages
  - Return `{consumerTag}`
- `cancel(consumerTag)` — remove consumer, requeue its unacked messages if channel closes
- Round-robin dispatch:
  - Rotate through consumers on same queue
  - Skip consumers at prefetch limit (unackedCount >= prefetchCount)
  - If all consumers at limit, hold message in queue until an ack frees capacity
- Prefetch:
  - `prefetch(count, global)`:
    - `global=false` (default): per-consumer limit (RabbitMQ behavior, differs from AMQP spec)
    - `global=true`: per-channel shared limit
  - count=0 means unlimited
  - Changing prefetch mid-stream: apply to future deliveries
- Delivery:
  - Assign delivery tag (channel-scoped, incrementing)
  - Set `redelivered=false` for first delivery
  - Track in channel's unacked message map
  - Call consumer callback with DeliveredMessage
- Priority queue interaction: priority ordering only applies to messages waiting in queue, not those already dispatched to prefetch buffer

## Inputs

- S04T01 channel model, S03 queue + message storage

## Outputs

- `packages/rabbit-box/src/consumer.ts`
- Unit tests: register/cancel, round-robin across multiple consumers, prefetch limiting, exclusive consumer, noAck auto-ack

## Key Constraints

- Round-robin must be fair (not weighted, not random)
- Prefetch applies to unacked count, not delivered count
- Consumer callback receives message asynchronously (microtask/nextTick)
- RabbitMQ interprets global=false as per-consumer (not per-channel as AMQP spec says)

---

[← Back](../README.md)
