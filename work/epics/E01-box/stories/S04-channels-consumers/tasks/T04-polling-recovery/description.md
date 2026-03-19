# T04: Polling & Recovery

**Status:** done

Implement basic.get (polling), basic.recover, and passive declares.

## Scope

- `get(queue, options)`:
  - Dequeue one message from queue
  - Not affected by prefetch count
  - `noAck` option: if false, track in unacked map with delivery tag
  - Return message or null if queue empty
  - Return includes `messageCount` (remaining messages after this get)
- `recover(requeue)`:
  - Requeue ALL unacked messages on this channel
  - RabbitMQ ignores `requeue=false` — always requeues regardless
  - RabbitBox must match this behavior (always requeue)
  - Requeued messages get `redelivered=true`
- Passive declares (wired through channel):
  - `checkExchange(name)` — delegates to exchange registry, NOT_FOUND → channel error
  - `checkQueue(name)` — delegates to queue registry, returns {queue, messageCount, consumerCount}

## Inputs

- S04T01 channel, S04T03 ack tracking, S03 queue storage, S02 exchange registry

## Outputs

- Methods on channel: `get()`, `recover()`, `checkExchange()`, `checkQueue()`
- Unit tests: get from empty queue, get with/without ack tracking, recover always requeues, passive declare success/failure

## Key Constraints

- basic.get is NOT affected by prefetch (this differs from consume)
- recover ALWAYS requeues regardless of requeue parameter (match RabbitMQ)
- Passive declare failure must be a channel error (channel closes), not a return value

---

[← Back](../README.md)
