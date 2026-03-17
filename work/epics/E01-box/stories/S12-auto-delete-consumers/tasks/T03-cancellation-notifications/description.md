# T03: Consumer Cancellation Notifications

Implement server-initiated consumer cancellation and consumer priorities.

## Scope

- Server cancels consumer (basic.cancel from server) when:
  - Queue is deleted (all consumers on that queue cancelled)
  - Exclusive consumer conflict
  - Management action (future use)
- Cancelled consumer receives cancel notification with consumerTag
- Consumer callback receives null message (or cancel event, matching amqplib pattern)
- Channel-level 'cancel' event emitted
- Consumer priorities:
  - `x-priority` argument on basic.consume (integer)
  - Higher-priority consumers receive messages first
  - Lower-priority consumers only receive messages when higher-priority consumers are at prefetch limit

## Inputs

- S04 consumer module, S03 queue deletion

## Outputs

- Server-cancel logic in queue delete path and consumer registration
- Consumer priority dispatch logic
- Unit tests: queue delete cancels consumers, cancel notification received, exclusive conflict, priority ordering

## Key Constraints

- Server-initiated cancel is different from client cancel
- Match amqplib's consumer cancellation pattern (null message or separate event)
- Consumer priorities are separate from message priorities (S09T02)

---

[← Back](../README.md)
