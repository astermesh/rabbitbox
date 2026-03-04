# Publisher Confirms

## Overview

Publisher confirms are a RabbitMQ extension to AMQP 0-9-1 that provide broker-to-publisher acknowledgments. They let publishers know when the broker has accepted responsibility for their messages.

Publisher confirms and consumer acknowledgments are **entirely orthogonal** -- they are unaware of each other. Publisher confirms cover the publisher-to-broker path; consumer acknowledgments cover the broker-to-consumer path. Both are essential for end-to-end data safety.

## Enabling Confirm Mode

Confirm mode is enabled per channel using `confirm.select`:

```javascript
// amqplib
const channel = await connection.createConfirmChannel();
// or on an existing channel:
await channel.confirmSelect();
```

Once enabled on a channel, it cannot be disabled. The broker begins tracking published messages with monotonically increasing sequence numbers (delivery tags).

## How Confirms Work

1. Publisher enables confirm mode on a channel
2. Publisher sends messages; broker assigns each a sequence number (starting at 1)
3. When the broker has handled a message, it sends `basic.ack` back to the publisher
4. If the broker cannot handle a message, it sends `basic.nack`

### Confirmation Timing

**Unroutable messages**: Confirmed as soon as the exchange verifies the message cannot be routed to any queue.

**Routable messages**: Confirmed when the message has been accepted by ALL target queues:
- For transient messages in non-durable queues: when enqueued in memory
- For persistent messages in durable queues: when written and flushed to disk
- For mirrored/replicated queues: when replicated to a quorum of nodes

### Delivery Tags and Multiple Flag

The broker's `basic.ack` includes:
- `delivery-tag`: The sequence number of the confirmed message
- `multiple`: If `true`, all messages up to and including this sequence number are confirmed

This allows the broker to batch confirmations for efficiency.

### Negative Acknowledgments (basic.nack)

The broker sends `basic.nack` when it cannot process a message. This is rare and indicates an internal broker error (e.g., an Erlang process crash for a queue).

When receiving `basic.nack`, the publisher should:
- Log the error
- Retry the publish
- Alert monitoring systems

## Confirmation Strategies

### Strategy 1: Publish and Wait (Synchronous)

Wait for each confirm individually. Simple but very slow.

```javascript
// amqplib ConfirmChannel
channel.sendToQueue("queue", msg, {}, (err) => {
  if (err) console.error("Nacked!");
  else console.log("Confirmed!");
});
await channel.waitForConfirms();
```

### Strategy 2: Batch Confirms

Publish a batch of messages, then wait for all confirms. Better throughput but all-or-nothing error handling.

```javascript
for (const msg of batch) {
  channel.sendToQueue("queue", msg);
}
await channel.waitForConfirms(); // waits until all published messages are confirmed
```

### Strategy 3: Asynchronous Confirms (Recommended)

Track outstanding confirms with a map and process them asynchronously as they arrive. Best throughput with fine-grained error handling.

```javascript
// rabbitmq-client library handles this automatically
const pub = rabbit.createPublisher({
  confirm: true,
  maxAttempts: 3,
});
await pub.send("exchange", "routing.key", payload);
```

## Latency Considerations

- Under constant load, confirm latency for persistent messages can reach a few hundred milliseconds (disk flush time)
- Applications should process confirms asynchronously or publish in batches
- Confirms are typically sent in publish order on a single channel, but ordering is not guaranteed across different delivery modes or queue types

## Data Safety Limitations

Publisher confirms alone do not guarantee message persistence across all failure scenarios:

- A broker node can lose persistent messages if it fails **before** the messages are written to disk
- For maximum safety, combine publisher confirms with:
  - Persistent messages (`delivery-mode: 2`)
  - Durable queues
  - Consumer acknowledgments
  - Quorum queues (Raft-based replication with fsync)

## Publisher Confirms vs Transactions

| Feature | Publisher Confirms | Transactions (tx) |
|---|---|---|
| Throughput | High (async possible) | Very low (synchronous) |
| Atomicity | Per-message | Per-transaction batch |
| Recommended | Yes | Rarely |
| Complexity | Moderate | Simple API but slow |

Publisher confirms are the recommended approach for reliable publishing. Transactions (`tx.select`, `tx.commit`) provide atomicity but at a severe throughput penalty.

## Interaction with Mandatory Flag

When `mandatory` is set on a published message:
- If the message is unroutable, the broker sends `basic.return` before `basic.ack`
- The publisher receives the returned message AND the confirm
- The confirm simply means the exchange processed the message (even if it was returned)

---

[← Back](README.md)
