# T03: Message Operations

**Status:** done

Implement amqplib-compatible publish, consume, and acknowledgment operations.

## Scope

- Publishing:
  - `publish(exchange, routingKey, content, options?)` → boolean (backpressure signal)
  - `sendToQueue(queue, content, options?)` → boolean (shorthand for publish to default exchange)
  - Content is Buffer (Node.js) — adapter converts to/from Uint8Array internally
  - Options: all MessageProperties fields, plus `mandatory`, `immediate`, `CC`, `BCC`
- Consuming:
  - `consume(queue, callback, options?)` → `{consumerTag}`
  - Callback shape: `(msg: ConsumeMessage | null) => void`
  - `msg.content`: Buffer, `msg.fields`: {deliveryTag, redelivered, exchange, routingKey, consumerTag}, `msg.properties`: all 14 properties
  - `cancel(consumerTag)` → `{consumerTag}`
- Polling:
  - `get(queue, options?)` → `GetMessage | false`
  - Returns false (not null) when queue empty — matches amqplib convention
- Acknowledgments:
  - `ack(message, allUpTo?)` — message object has deliveryTag in fields
  - `ackAll()` — ack all outstanding
  - `nack(message, allUpTo?, requeue?)` — default requeue=true
  - `nackAll(requeue?)` — nack all outstanding
  - `reject(message, requeue?)` — single message
- QoS:
  - `prefetch(count, global?)` — set prefetch
  - `recover()` — requeue unacked

## Inputs

- S13T01 channel adapter, RabbitBox API

## Outputs

- Message methods on Channel adapter
- Unit tests: publish/consume round trip, content Buffer↔Uint8Array, get returns false on empty, ack/nack/reject, prefetch

## Key Constraints

- amqplib uses Buffer for content; adapter must convert to Uint8Array for RabbitBox and back to Buffer for consumers
- `publish` returns boolean (true = ok, false = backpressure) — RabbitBox has no backpressure, always true
- `get` returns `false` (not null) on empty queue — this is amqplib's convention
- nack default requeue is `true` in amqplib (verify)

---

[← Back](../README.md)
