# T02: Core Domain Types

**Status:** done

Define all core domain type interfaces used throughout the eng.

## Scope

- `Exchange` — name, type (direct/fanout/topic/headers), durable, autoDelete, internal, arguments
- `Queue` — name, durable, exclusive, autoDelete, arguments, plus derived fields (messageTtl, expires, maxLength, maxLengthBytes, overflowBehavior, deadLetterExchange, deadLetterRoutingKey, maxPriority, singleActiveConsumer)
- `BrokerMessage` — body (Uint8Array), properties, exchange, routingKey, mandatory, internal tracking (deliveryCount, enqueuedAt, expiresAt, priority, xDeath)
- `MessageProperties` — all 14 AMQP basic properties (contentType, contentEncoding, headers, deliveryMode, priority, correlationId, replyTo, expiration, messageId, timestamp, type, userId, appId)
- `DeliveredMessage` — message as seen by consumer: fields (deliveryTag, redelivered, exchange, routingKey, consumerTag) + content + properties
- `Consumer` — consumerTag, queueName, callback, noAck, exclusive, prefetchCount, unacked tracking
- `Binding` — exchange, queue, routingKey, arguments
- `XDeathEntry` — queue, reason, time, exchange, routing-keys, count, original-expiration

## Inputs

- Boxing analysis §6 type definitions

## Outputs

- Type modules in `packages/rabbit-box/src/types/`
- Re-exported from package entry point

## Key Constraints

- Use `Uint8Array` for message body (not Buffer) — cross-platform
- All types are interfaces, not classes — eng modules provide the behavior
- Match RabbitMQ field names exactly where they appear in protocol/API

---

[← Back](../README.md)
