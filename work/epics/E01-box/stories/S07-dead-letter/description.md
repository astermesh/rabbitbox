# S07: Dead Letter Exchanges

**Status:** done

Implement dead letter exchange routing with x-death headers and cycle detection, matching exact RabbitMQ DLX semantics.

## Scope

- Dead-letter routing on nack/reject with requeue=false
- x-death header construction (queue, reason, time, exchange, routing-keys, count, original-expiration)
- x-first-death-queue, x-first-death-reason, x-last-death-queue, x-last-death-reason quick-access headers
- DLX cycle detection based on x-death history
- Expiration property removal from dead-lettered messages

## Dependencies

- S03: queue storage, publish pipeline
- S04: acknowledgment module (nack/reject triggers)

---

[← Back](README.md)
