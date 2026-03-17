# T02: Topology Operations

Implement amqplib-compatible topology operations.

## Scope

- Exchange operations:
  - `assertExchange(name, type, options?)` → `{exchange}`
  - `deleteExchange(name, options?)` → `{}`
  - `checkExchange(name)` → `{exchange}` (or channel error)
  - `bindExchange(destination, source, pattern, args?)` → `{}`
  - `unbindExchange(destination, source, pattern, args?)` → `{}`
- Queue operations:
  - `assertQueue(name, options?)` → `{queue, messageCount, consumerCount}`
  - `deleteQueue(name, options?)` → `{messageCount}`
  - `checkQueue(name)` → `{queue, messageCount, consumerCount}` (or channel error)
  - `bindQueue(queue, source, pattern, args?)` → `{}`
  - `unbindQueue(queue, source, pattern, args?)` → `{}`
  - `purgeQueue(name)` → `{messageCount}`
- All return types must match amqplib return types exactly
- Options mapped from amqplib conventions to RabbitBox conventions

## Inputs

- S13T01 channel adapter, RabbitBox API

## Outputs

- Topology methods on Channel adapter
- Unit tests: each operation, return type verification, option mapping

## Key Constraints

- Return type shapes must match amqplib exactly (e.g., assertQueue returns object with queue/messageCount/consumerCount)
- amqplib uses `durable`, `autoDelete`, `internal`, `arguments` in options — map directly

---

[← Back](../README.md)
