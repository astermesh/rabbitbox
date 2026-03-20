# 03: amqplib API Surface Compatibility

## Status

Accepted

## Context

RabbitBox must provide a programmatic API for test code to interact with the emulated broker. Users need to publish messages, declare topology, and consume — the same operations they do with a real RabbitMQ via a client library.

## Decision

The public API (ApiChannel, ApiConnection) mirrors amqplib's channel API: method names, parameter positions, return types, and async signatures. This includes:

- `assertExchange(name, type, options?)`
- `assertQueue(name?, options?)`
- `bindQueue(queue, exchange, routingKey, args?)`
- `consume(queue, callback, options?)`
- `publish(exchange, routingKey, content, options?)` — synchronous, returns `boolean`
- `get(queue, options?)` — returns `DeliveredMessage | false` (not `null`)
- `ack(message, allUpTo?)`, `nack(message, allUpTo?, requeue?)`, `reject(message, requeue?)`

## Alternatives Considered

- **Clean-slate API design** — could be more ergonomic but requires users to learn a new interface and prevents drop-in replacement
- **AMQP wire-level API** — too low-level for programmatic use in tests
- **@cloudamqp/amqp-client compatibility** — less widely adopted than amqplib

## Consequences

- Users can switch from a real RabbitMQ connection to RabbitBox with minimal code changes
- API quirks from amqplib are inherited (e.g., `false` instead of `null` for empty queue)
- Future amqplib API changes may require corresponding updates

---

[← Back](README.md)
