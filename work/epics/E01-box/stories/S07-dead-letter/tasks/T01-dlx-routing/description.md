# T01: DLX Routing & x-death Headers

**Status:** done

Implement dead letter exchange routing with proper header construction.

## Scope

- When nack/reject with `requeue=false` and queue has `x-dead-letter-exchange`:
  1. Build x-death entry: `{queue, reason: "rejected", time, exchange, routing-keys: [originalRoutingKey], count: 1}`
  2. If same queue+reason entry already in x-death array, increment `count` instead of adding new entry
  3. Use `x-dead-letter-routing-key` from queue config if set, otherwise original routing key
  4. Remove `expiration` property from message (prevent re-expiry in DLX target)
  5. If per-message TTL caused death: store original expiration in x-death entry as `original-expiration`
  6. Set quick-access headers: `x-first-death-queue`, `x-first-death-reason` (only on first death), `x-last-death-queue`, `x-last-death-reason` (updated each time)
  7. Re-publish message to DLX exchange through normal routing pipeline
- If DLX exchange doesn't exist: message is silently dropped (no error)
- x-death array stored in message headers property
- Death reasons: `rejected` (nack/reject), `expired` (TTL, implemented in S08), `maxlen` (overflow, implemented in S09)

## Inputs

- S04 ack module (nack/reject triggers), S03 queue config + publish pipeline

## Outputs

- `packages/rabbit-box/src/dead-letter.ts`
- Unit tests: nack triggers DLX, x-death header structure, count increment, routing key override, expiration removal, missing DLX exchange, quick-access headers

## Key Constraints

- x-death header structure must match real RabbitMQ exactly
- Count must be incremented on repeated dead-lettering from same queue+reason (not new entries)
- Expiration MUST be removed from dead-lettered messages

---

[← Back](../README.md)
