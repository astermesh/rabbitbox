# Messages and Properties

## Message Structure

An AMQP message consists of two parts:

1. **Properties** (metadata) -- structured fields defined by the protocol
2. **Payload** (body) -- opaque byte array; the broker does not inspect or modify it

The broker treats the payload as an opaque binary blob. Content interpretation is entirely up to the publisher and consumer applications.

## Standard AMQP 0-9-1 Message Properties

These are defined in the `basic` class content header:

| Property | Type | Description |
|---|---|---|
| `content-type` | shortstr | MIME type of the payload (e.g., `application/json`, `text/plain`) |
| `content-encoding` | shortstr | Encoding of the payload (e.g., `gzip`, `utf-8`) |
| `headers` | table | Arbitrary key-value pairs for custom metadata |
| `delivery-mode` | octet | `1` = non-persistent (transient), `2` = persistent |
| `priority` | octet | Message priority, 0-9 (0 = lowest) |
| `correlation-id` | shortstr | Application correlation identifier, typically for RPC reply matching |
| `reply-to` | shortstr | Queue name for RPC responses |
| `expiration` | shortstr | Per-message TTL in milliseconds (as a string) |
| `message-id` | shortstr | Application-defined message identifier |
| `timestamp` | timestamp | POSIX epoch time when the message was created |
| `type` | shortstr | Application-defined message type name |
| `user-id` | shortstr | Creating user; RabbitMQ validates this against the connection user |
| `app-id` | shortstr | Application identifier |
| `cluster-id` | shortstr | Deprecated; do not use |

## Property Details

### delivery-mode (Persistence)

- `1` (transient): Message stored in memory only; lost on broker restart
- `2` (persistent): Message written to disk; survives broker restart if the queue is also durable

**Critical distinction**: Publishing a message to a durable exchange or routing it to a durable queue does NOT make the message persistent. The `delivery-mode` property of the message itself determines persistence.

Persistent messages have a performance cost -- disk I/O is required. For maximum durability, combine:
- Persistent messages (`delivery-mode: 2`)
- Durable queues
- Publisher confirms (to know when the message is written to disk)

### content-type

Follows MIME type conventions. Common values:
- `application/json` -- JSON payload
- `application/octet-stream` -- binary data
- `text/plain` -- plain text
- `application/protobuf` -- Protocol Buffers

The broker does not enforce or validate the content-type. It is purely informational for consumers.

### headers

A table (map) of arbitrary key-value pairs. Header values can be:
- Strings
- Integers (various sizes)
- Floats/doubles
- Booleans
- Timestamps
- Byte arrays
- Nested tables
- Arrays of the above types

Headers are used by:
- **Headers exchanges** for content-based routing
- **Applications** for custom metadata
- **RabbitMQ** for internal metadata (e.g., `x-death` for dead-lettered messages)

### correlation-id and reply-to (RPC Pattern)

Used together to implement request-reply messaging:

```
Client                                  Server
  |  publish to "rpc_queue"               |
  |  reply-to: "amq.rabbitmq.reply-to"   |
  |  correlation-id: "abc123"             |
  |  ---------------------------------->  |
  |                                       |  (processes request)
  |  <----------------------------------  |
  |  publish to reply-to queue            |
  |  correlation-id: "abc123"             |
```

RabbitMQ provides a **direct reply-to** pseudo-queue (`amq.rabbitmq.reply-to`) that eliminates the need to declare a temporary reply queue.

### user-id

If set, RabbitMQ validates that the value matches the authenticated connection username. If they do not match, the broker raises a channel error. This provides a form of message authenticity.

The only exception: connections authenticated as the default user can set any `user-id`.

### expiration (Per-Message TTL)

Specified as a string of milliseconds (e.g., `"60000"` for 60 seconds). When both per-message and per-queue TTL are set, the lower value applies.

Expired messages are only removed when they reach the head of the queue. Messages behind non-expired messages remain in the queue consuming resources until they reach the front.

### priority

Integer from 0 to 255, though RabbitMQ recommends using single-digit values (0-9). The queue must be declared with `x-max-priority` to enable priority support. Messages without a priority property are treated as priority 0.

## Delivery Metadata (Fields)

When a message is delivered to a consumer, it includes additional metadata not set by the publisher:

| Field | Description |
|---|---|
| `delivery-tag` | Monotonically increasing integer identifying this delivery on the channel |
| `redelivered` | `true` if this message was previously delivered and not acknowledged |
| `exchange` | The exchange the message was published to |
| `routing-key` | The routing key the message was published with |
| `consumer-tag` | Identifier for the consumer subscription |

The `delivery-tag` is scoped to the channel and is used for acknowledgment operations (`ack`, `nack`, `reject`).

## Message Size

RabbitMQ supports large messages but they are split across multiple body frames according to the negotiated `frame_max` size. In practice:

- Default maximum frame size: 131072 bytes (128 KB)
- No hard limit on message size, but very large messages impact performance
- For messages larger than a few MB, consider external storage (S3, etc.) with message references

## CC and BCC Headers (RabbitMQ Extension)

- `CC`: Array of additional routing keys. The message is also routed using each CC value. CC headers are preserved in the delivered message.
- `BCC`: Same as CC but the header is stripped before delivery, making extra routing invisible to consumers.

---

[← Back](README.md)
