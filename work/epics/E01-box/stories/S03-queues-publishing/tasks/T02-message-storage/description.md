# T02: Message Storage

**Status:** done

Implement per-queue FIFO message storage.

## Scope

- `MessageStore` per queue — ordered message list
- `enqueue(message)` — add to tail, set enqueuedAt timestamp, compute expiresAt from TTL if present
- `dequeue()` — remove from head, return message or null if empty
- `peek()` — read head without removing
- `count()` — message count
- `byteSize()` — total byte size of all message bodies (for x-max-length-bytes)
- `purge()` — remove all messages, return count
- `requeue(message, position?)` — insert at head (for nack/reject requeue) or near original position
- Message properties preserved exactly as published (body is Uint8Array, properties immutable)

## Inputs

- S01 BrokerMessage type

## Outputs

- `packages/rabbit-box/src/message-store.ts`
- Unit tests

## Key Constraints

- FIFO ordering must be strict (messages dequeued in enqueue order)
- Byte size tracking must be accurate (used by overflow policies in Phase 2)
- Requeued messages go to head position (or as close to original position as possible)

---

[← Back](../README.md)
