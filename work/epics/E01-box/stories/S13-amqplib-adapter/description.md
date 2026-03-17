# S13: amqplib-Compatible Adapter

Build a drop-in replacement for amqplib that routes to in-memory RabbitBox instead of TCP. Enables existing codebases to use RabbitBox with zero code changes.

## Scope

- Connection and channel adapter matching amqplib API surface
- Topology operations (assert/delete/bind/unbind for exchanges and queues)
- Message operations (publish, consume, get, ack/nack/reject)
- ConfirmChannel support
- Event compatibility (error, close, return, drain)

## Dependencies

- S06: RabbitBox programmatic API (all Phase 1 features)
- S10: publisher confirms (for ConfirmChannel)

---

[← Back](README.md)
