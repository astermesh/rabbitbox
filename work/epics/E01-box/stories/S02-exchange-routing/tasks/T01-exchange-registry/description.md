# T01: Exchange Registry

Implement the exchange store with CRUD operations and default exchanges.

## Scope

- Exchange store (Map-based)
- `declareExchange(name, type, options)` — idempotent if same type+options; PRECONDITION_FAILED if type mismatch on re-declare; reserved `amq.` prefix check (ACCESS_REFUSED if client tries to declare amq.* with wrong type)
- `deleteExchange(name, ifUnused)` — NOT_FOUND if missing; PRECONDITION_FAILED if ifUnused and has bindings
- `checkExchange(name)` — passive declare, NOT_FOUND channel error if missing
- Pre-declared on init: `""` (default direct), `amq.direct`, `amq.fanout`, `amq.topic`, `amq.headers`, `amq.match` (alias for amq.headers)
- Default exchange `""` cannot be deleted or re-declared with different type
- `internal` flag: internal exchanges cannot be published to directly by clients

## Inputs

- S01 Exchange type, error model

## Outputs

- `packages/rabbit-box/src/exchange-registry.ts`
- Unit tests covering: declare, idempotent re-declare, type conflict, delete, check, default exchanges, reserved prefix

## Key Constraints

- Error codes and messages must match real RabbitMQ
- Default exchanges are immutable (cannot be deleted or modified)

---

[← Back](../README.md)
