# Consumer Acknowledgments and Quality of Service

## Acknowledgment Modes

AMQP 0-9-1 provides two delivery acknowledgment modes:

### Automatic Acknowledgment (autoAck / noAck)

- The broker considers a message delivered as soon as it sends it out
- Messages are removed from the queue immediately upon sending
- "Fire-and-forget" semantics
- Highest throughput, lowest data safety
- If the consumer crashes before processing, the message is lost
- Should be considered unsafe for any workload where message loss is unacceptable

### Manual Acknowledgment

- The consumer explicitly signals when it has received and/or processed the message
- The broker keeps the message until acknowledgment is received
- If the consumer disconnects without acknowledging, the message is requeued
- Three protocol methods available for acknowledgment responses

## Acknowledgment Methods

### basic.ack (Positive Acknowledgment)

Signals that the message was successfully received and processed. The broker removes the message from the queue.

```javascript
channel.ack(msg);                // Acknowledge single message
channel.ack(msg, true);          // Acknowledge all messages up to and including this one
channel.ackAll();                // Acknowledge all outstanding messages on this channel
```

**Multiple flag**: When `allUpTo` is `true`, all messages with delivery tags up to and including the specified tag are acknowledged in a single operation. This reduces network traffic when processing batches.

### basic.nack (Negative Acknowledgment -- RabbitMQ Extension)

Signals that the message was NOT successfully processed. Supports rejecting multiple messages at once.

```javascript
channel.nack(msg);               // Nack single message, requeue=true (default)
channel.nack(msg, false, false); // Nack single message, do NOT requeue (discard or dead-letter)
channel.nack(msg, true, true);   // Nack all up to this tag, requeue all
channel.nackAll(true);           // Nack all outstanding, requeue
channel.nackAll(false);          // Nack all outstanding, discard/dead-letter
```

Parameters:
- `allUpTo` (boolean): If true, nack all messages up to and including this delivery tag
- `requeue` (boolean, default true): If true, message goes back to the queue; if false, message is discarded or dead-lettered

### basic.reject (Single Rejection)

Original AMQP 0-9-1 method for rejecting a single message. Functionally equivalent to `basic.nack` with `allUpTo=false`.

```javascript
channel.reject(msg, true);      // Reject and requeue
channel.reject(msg, false);     // Reject and discard/dead-letter
```

The main difference from `nack`: `reject` can only handle one message at a time, while `nack` supports the `multiple` flag.

## Requeue Behavior

When a message is requeued (via `nack` or `reject` with `requeue=true`):

- The message returns to its original position in the queue, if possible
- If there are multiple consumers, the requeued message may be delivered to a different consumer
- The `redelivered` flag on the message is set to `true`
- There is no built-in limit on redelivery count (but quorum queues support delivery-limit)

**Requeue loop danger**: If a consumer always rejects and requeues a message, it creates an infinite loop. To prevent this:
- Use `requeue=false` to dead-letter the message
- Check the `redelivered` flag before requeuing
- Use quorum queues with `x-delivery-limit`

## Automatic Requeue on Consumer Failure

When a consumer disconnects (channel closes, connection drops, TCP timeout):
- All unacknowledged messages on that consumer's channel are automatically requeued
- The `redelivered` flag is set to `true` on these messages
- Messages are available for delivery to other consumers

## Prefetch (QoS -- Quality of Service)

### What It Does

`basic.qos` limits the number of unacknowledged messages that the broker will send to a consumer. Once the limit is reached, the broker stops delivering messages to that consumer until at least one message is acknowledged.

```javascript
channel.prefetch(10);            // Max 10 unacknowledged messages per consumer
channel.prefetch(10, true);      // Max 10 unacknowledged messages per channel (global)
```

### Per-Consumer vs Per-Channel (Global)

RabbitMQ deviates from the AMQP 0-9-1 spec in how it interprets `basic.qos`:

| AMQP 0-9-1 Spec | RabbitMQ Behavior |
|---|---|
| `global=false`: Shared across all consumers on a channel | Applied separately to each new consumer on the channel |
| `global=true`: Shared across all channels on the connection | Shared across all consumers on the channel |

In practice, most applications use per-consumer prefetch (`global=false`), which is the default.

### Recommended Values

- `0` means unlimited (no prefetch limit) -- not recommended for production
- **100 to 300** is typically optimal for throughput without overwhelming consumers
- Lower values (1-10) for long-running message processing
- Higher values for very fast message processing

### Why Prefetch Matters

Without prefetch, the broker pushes messages to consumers as fast as possible, which can:
- Overwhelm slow consumers with an unbounded buffer
- Cause uneven load distribution (fast consumers starve)
- Increase memory usage on both broker and consumer sides
- Lead to message timeout issues if consumers cannot keep up

### Multiple QoS Settings

You can apply both per-consumer and per-channel limits simultaneously. When both are active, a consumer only receives new messages when NEITHER limit has been reached. This adds coordination overhead and is slower than using a single limit.

### Default Prefetch

RabbitMQ can be configured with a default prefetch via `rabbit.default_consumer_prefetch` in the advanced configuration file, applied when consumers do not specify their own limit.

## Delivery Tags

- Monotonically increasing positive integers
- Scoped per channel (not global)
- Start at 1 for each new channel
- Must be acknowledged on the same channel where delivery occurred
- Acknowledging on a different channel raises a channel error

## Consumer Cancellation

When a consumer is cancelled (queue deleted, consumer tag cancelled):
- RabbitMQ sends a `basic.cancel` notification (if the client supports it)
- Unacknowledged messages are requeued
- The consumer callback stops receiving messages

## Best Practices

1. **Always use manual acknowledgment** for important workloads
2. **Set a reasonable prefetch** (100-300 for most workloads)
3. **Acknowledge after processing**, not just after receiving
4. **Use `nack` with `requeue=false`** to dead-letter poison messages
5. **Check `redelivered` flag** to detect potential requeue loops
6. **Batch acknowledgments** with `allUpTo=true` to reduce network traffic
7. **Handle consumer cancellation** notifications gracefully

---

[← Back](README.md)
