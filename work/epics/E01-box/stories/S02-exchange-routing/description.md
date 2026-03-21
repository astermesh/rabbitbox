# S02: Exchange Routing Engine

**Status:** done

Implement all four AMQP exchange types with exact RabbitMQ routing semantics, the exchange registry, and binding management.

## Scope

- Exchange registry: declare (idempotent), delete, check (passive declare)
- Pre-declared default exchanges: `""` (direct), `amq.direct`, `amq.fanout`, `amq.topic`, `amq.headers`, `amq.match`
- Direct routing: exact string match
- Fanout routing: all bound queues
- Topic routing: dot-separated wildcards (`*` = one word, `#` = zero or more)
- Headers routing: all four x-match modes (`all`, `any`, `all-with-x`, `any-with-x`), void key-presence check
- Binding management: add, remove, lookup; binding identity by (exchange, queue, routingKey, arguments) tuple

## Dependencies

- S01: domain types, error model

---

[← Back](README.md)
