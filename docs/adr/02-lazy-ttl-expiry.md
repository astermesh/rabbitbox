# 02: Lazy TTL Expiry at Queue Head

## Status

Accepted

## Context

AMQP 0-9-1 supports per-queue and per-message TTL. Messages that exceed their TTL must be removed from the queue (and optionally dead-lettered). The question is when expiry happens: proactively via timers, or lazily when the queue head is inspected.

## Decision

Messages are not expired by active timers. Instead, `drainExpired(now)` removes consecutive expired messages from the queue head at dispatch time and on `basic.get`. Messages behind a non-expired head never expire independently — this is RabbitMQ's documented per-message TTL quirk.

`expiresAt` is computed once at enqueue time. No `setTimeout` is set per message.

## Alternatives Considered

- **Timer-based expiry** — set a `setTimeout` for each message's TTL. Requires per-message timer tracking, cancellation on ack/dequeue, and does not work with virtual-time Sim scenarios
- **Periodic GC scan** — sweeps all queues on interval. Wastes CPU when queues are idle, does not match RabbitMQ behavior

## Consequences

- Exact match with RabbitMQ's lazy expiry behavior
- No per-message timer state — simpler and more efficient
- Works naturally with OBI time injection (virtual time in Sim scenarios)
- Messages with per-message TTL behind a non-expired head accumulate until the head expires or is consumed — this is correct RabbitMQ behavior, not a bug

---

[← Back](README.md)
