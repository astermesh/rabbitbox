# T01: Confirm Mode

**Status:** done

Implement publisher confirm mode on channels.

## Scope

- `confirmSelect()` — enable confirm mode on channel
  - Irreversible (cannot disable once enabled)
  - Mutually exclusive with transaction mode (PRECONDITION_FAILED if tx mode active)
  - Idempotent (calling again on already-confirmed channel is fine)
- Delivery tag counter: starts at 1, increments per publish on this channel
- Confirmation timing:
  - Unroutable messages: confirmed immediately after exchange verifies no route
  - Routable messages: confirmed after message accepted by all target queues (enqueued)
- After each publish:
  - basic.ack with deliveryTag (success)
  - basic.nack with deliveryTag (internal error only — rare)
  - Multiple flag: broker may batch-ack multiple tags for efficiency
- For mandatory unroutable messages: `basic.return` sent BEFORE `basic.ack`
- `waitForConfirms()` → Promise that resolves when all outstanding publishes are confirmed
- Confirm events emitted on channel

## Inputs

- S04 channel model, S03 publish pipeline

## Outputs

- Confirm mode logic in channel module
- Unit tests: enable confirm mode, delivery tag sequence, ack after publish, nack on error, return before ack for mandatory, waitForConfirms, mutual exclusion with tx, idempotent re-enable

## Key Constraints

- confirm.select is irreversible
- Publisher delivery tags are a SEPARATE sequence from consumer delivery tags
- basic.return MUST be sent before basic.ack for mandatory unroutable messages
- basic.nack only on internal errors (not on "no route" — that still gets basic.ack)

---

[← Back](../README.md)
