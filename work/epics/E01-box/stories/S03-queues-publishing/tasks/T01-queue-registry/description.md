# T01: Queue Registry

**Status:** done

Implement the queue store with CRUD operations.

## Scope

- Queue store (Map-based)
- `declareQueue(name, options)`:
  - Empty name `""` → server generates unique name (amq.gen-{random})
  - Idempotent if same options; PRECONDITION_FAILED if option mismatch on re-declare
  - Exclusive queues scoped to owning connection — other connections get RESOURCE_LOCKED
  - Returns `{queue, messageCount, consumerCount}`
  - Reserved `amq.` prefix: clients cannot declare custom queues starting with `amq.` (ACCESS_REFUSED)
- `deleteQueue(name, options)`:
  - `ifUnused` flag: PRECONDITION_FAILED if queue has consumers
  - `ifEmpty` flag: PRECONDITION_FAILED if queue has messages
  - Returns `{messageCount}` (count of messages deleted)
  - NOT_FOUND if missing
- `checkQueue(name)` — passive declare, NOT_FOUND if missing, returns {queue, messageCount, consumerCount}
- `purgeQueue(name)` — remove all messages, return {messageCount}

## Inputs

- S01 Queue type, error model

## Outputs

- `packages/rabbit-box/src/queue-registry.ts`
- Unit tests

## Key Constraints

- Server-generated names must use `amq.gen-` prefix (RabbitMQ convention)
- Exclusive queue access checks require connection identity

---

[← Back](../README.md)
