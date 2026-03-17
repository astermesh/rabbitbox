# T01: Message TTL

Implement per-queue and per-message TTL with expiry triggering dead-lettering.

## Scope

- Per-queue TTL: `x-message-ttl` queue argument (milliseconds)
  - Applied to all messages enqueued to this queue
  - Set `expiresAt = enqueuedAt + ttl` on enqueue
  - TTL of 0: messages expire immediately unless delivered to a consumer directly
- Per-message TTL: `expiration` property (string, parsed as integer milliseconds)
  - Applied only to that specific message
  - If both queue TTL and message TTL exist, shorter wins
- Lazy expiry strategy:
  - On dequeue/get: check if head message is expired
  - Skip expired messages (dead-letter if DLX configured, otherwise discard)
  - Continue until non-expired message found or queue empty
- Dead-letter on expiry: reason = `"expired"`, store original expiration in x-death entry
- RabbitMQ quirk: per-message TTL expiry only happens at queue head (messages behind a non-expired message don't expire independently) — match this behavior
- Expired messages at head of queue are visible in messageCount but not deliverable

## Inputs

- S03 message storage, S05 OBI time hook, S07 DLX routing

## Outputs

- TTL logic in message storage / dequeue path
- Unit tests: queue TTL, message TTL, shorter-wins, lazy expiry, DLX on expiry, head-only expiry, TTL=0 behavior

## Key Constraints

- Per-message expiration is a STRING in AMQP (not number) — parse as integer, invalid = ignore
- Lazy expiry at queue head only (match RabbitMQ's per-message TTL behavior)
- Time must go through OBI time hook (for virtual time support)

---

[← Back](../README.md)
