# T02: Priority Queues

Implement priority queue support.

## Scope

- `x-max-priority` queue argument (integer 1-255, recommended ≤10)
- Separate message bucket per priority level (each level creates internal sub-queue)
- Higher priority messages dequeued before lower priority
- Within same priority: FIFO ordering preserved
- Message priority from `priority` property (0-255)
- Default priority = 0 if message has no priority property
- Priority capped at queue's max-priority (higher values clamped)
- Consumer dispatch respects priority ordering
- Important: priority ordering only applies to messages WAITING in queue; messages already dispatched to consumer prefetch buffer are in FIFO order

## Inputs

- S03 message storage, S04 consumer dispatch

## Outputs

- Priority-aware message storage (replaces or wraps standard FIFO store for priority queues)
- Unit tests: priority ordering, same-priority FIFO, default priority, priority capping, dispatch order, prefetch interaction

## Key Constraints

- Only queues declared with x-max-priority support priorities (normal queues ignore message priority)
- Recommended max of 10 priorities (higher values work but waste memory)
- FIFO within same priority level must be preserved

---

[← Back](../README.md)
