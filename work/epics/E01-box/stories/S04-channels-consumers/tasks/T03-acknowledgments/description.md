# T03: Acknowledgments & Delivery Tracking

**Status:** done

Implement ack, nack, and reject with delivery tag tracking and requeue behavior.

## Scope

- Per-channel unacked message map: `deliveryTag → {message, queue, consumerTag}`
- `ack(deliveryTag, multiple)`:
  - `multiple=false`: ack single delivery tag
  - `multiple=true`: ack all tags ≤ given tag on this channel
  - Unknown tag → PRECONDITION_FAILED channel error
  - Already-acked tag → PRECONDITION_FAILED channel error
  - Remove from unacked map, free prefetch capacity, trigger re-dispatch
- `nack(deliveryTag, multiple, requeue)`:
  - Same multiple semantics as ack
  - `requeue=true` (default): return message to queue at original position (head)
  - `requeue=false`: discard (or dead-letter in Phase 2)
  - Set `redelivered=true` on requeued messages
- `reject(deliveryTag, requeue)`:
  - Same as nack but single message only (no multiple flag)
- Requeue behavior:
  - Requeued messages placed at head of queue (close to original position)
  - Requeued messages get `redelivered=true` flag
  - Requeued messages may be immediately re-dispatched to a different consumer
- Channel/connection close: all unacked messages requeued automatically
- `ackAll()` / `nackAll(requeue?)`: convenience for all outstanding on this channel

## Inputs

- S04T01 channel model, S04T02 consumer dispatch

## Outputs

- `packages/rabbit-box/src/acknowledgment.ts`
- Unit tests: single ack, multiple ack, nack with requeue, nack without requeue, reject, duplicate ack error, unknown tag error, cross-channel ack error, close-requeues-all

## Key Constraints

- Duplicate ack/nack on same tag must produce PRECONDITION_FAILED (not silently ignored)
- Cross-channel ack (ack on different channel than delivery) must produce channel error
- Requeue must set redelivered flag to true
- Multiple=true must ack/nack ALL tags ≤ given tag (not just the one)
- nack default requeue is true

---

[← Back](../README.md)
