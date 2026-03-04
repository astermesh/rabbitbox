# AMQP 0-9-1 Protocol Overview

## What is AMQP 0-9-1

AMQP 0-9-1 (Advanced Message Queuing Protocol) is a binary wire-level messaging protocol that enables conforming client applications to communicate with conforming messaging middleware brokers. The protocol was published by the AMQP Working Group in 2008 and is the foundation that RabbitMQ implements.

AMQP 0-9-1 is distinct from AMQP 1.0, which is a completely different protocol. RabbitMQ's primary protocol is AMQP 0-9-1, though it also supports AMQP 1.0 via a plugin.

## Core Architecture

### Message Flow Model

The protocol operates through a three-tier routing system:

```
Publisher --> Exchange --> Binding Rules --> Queue --> Consumer
```

1. **Publishers** (producers) create and send messages to **exchanges**
2. **Exchanges** route message copies to **queues** using rules called **bindings**
3. **Brokers** deliver messages from queues to **consumers**, or consumers pull messages on demand

Since AMQP is a network protocol, publishers, brokers, and consumers can reside on entirely different machines.

### Programmable Protocol

A key distinguishing feature of AMQP 0-9-1 is that it is a "programmable protocol" -- the entities and routing schemes are defined by applications themselves, not the broker administrator. Applications declare the exchanges, queues, and bindings they need at runtime.

## Protocol Layers

AMQP 0-9-1 is organized into two layers:

### Functional Layer

Defines protocol commands (called "methods") grouped into logical classes. These enable operations like queue management, message publishing, consuming, and transactions.

### Transport Layer

Handles binary framing, channel multiplexing, encoding, heartbeats, and error handling. Information is organized into **frames** with a standard format: frame header, payload, and frame end.

## Protocol Method Classes

Methods in AMQP are operations (analogous to HTTP methods). They are grouped into classes:

### Connection Class

Manages TCP socket connections between client and broker.

| Method | Direction | Description |
|---|---|---|
| `connection.start` | S -> C | Server proposes protocol version and auth mechanisms |
| `connection.start-ok` | C -> S | Client selects auth mechanism and sends credentials |
| `connection.secure` | S -> C | Security challenge (SASL) |
| `connection.secure-ok` | C -> S | Security response |
| `connection.tune` | S -> C | Server proposes connection parameters (channel_max, frame_max, heartbeat) |
| `connection.tune-ok` | C -> S | Client accepts/negotiates parameters |
| `connection.open` | C -> S | Client selects virtual host |
| `connection.open-ok` | S -> C | Virtual host access granted |
| `connection.close` | Both | Initiate graceful shutdown |
| `connection.close-ok` | Both | Confirm shutdown |

### Channel Class

Manages lightweight connections multiplexed over a single TCP connection.

| Method | Description |
|---|---|
| `channel.open` / `channel.open-ok` | Open a new channel |
| `channel.close` / `channel.close-ok` | Close a channel (with error code if applicable) |
| `channel.flow` / `channel.flow-ok` | Pause or resume content delivery (flow control) |

### Exchange Class

Declares, inspects, and deletes exchanges.

| Method | Description |
|---|---|
| `exchange.declare` / `exchange.declare-ok` | Create an exchange (idempotent if attributes match) |
| `exchange.delete` / `exchange.delete-ok` | Remove an exchange |
| `exchange.bind` / `exchange.unbind` | Exchange-to-exchange binding (RabbitMQ extension) |

### Queue Class

Declares, inspects, binds, purges, and deletes queues.

| Method | Description |
|---|---|
| `queue.declare` / `queue.declare-ok` | Create a queue (returns name, message count, consumer count) |
| `queue.bind` / `queue.bind-ok` | Bind queue to an exchange with a routing pattern |
| `queue.unbind` / `queue.unbind-ok` | Remove a binding |
| `queue.purge` / `queue.purge-ok` | Remove all messages from a queue |
| `queue.delete` / `queue.delete-ok` | Delete a queue |

### Basic Class

Core messaging operations -- publish, consume, acknowledge.

| Method | Description |
|---|---|
| `basic.qos` | Set prefetch count (Quality of Service) |
| `basic.consume` / `basic.consume-ok` | Subscribe to a queue (push-based delivery) |
| `basic.cancel` / `basic.cancel-ok` | Unsubscribe from a queue |
| `basic.publish` | Publish a message to an exchange (no response) |
| `basic.return` | Server returns undeliverable mandatory message |
| `basic.deliver` | Server pushes message to consumer |
| `basic.get` / `basic.get-ok` / `basic.get-empty` | Pull a single message (synchronous) |
| `basic.ack` | Acknowledge message(s) |
| `basic.reject` | Reject a single message |
| `basic.nack` | Reject one or more messages (RabbitMQ extension) |
| `basic.recover` | Redeliver unacknowledged messages |

### Tx (Transaction) Class

Atomic publish-and-ack operations.

| Method | Description |
|---|---|
| `tx.select` / `tx.select-ok` | Enable transactions on the channel |
| `tx.commit` / `tx.commit-ok` | Commit current transaction |
| `tx.rollback` / `tx.rollback-ok` | Roll back current transaction |

Transactions cover publishes and acknowledgments, not deliveries. A rollback does not requeue or redeliver messages. Transactions are rarely used in practice -- publisher confirms are the preferred mechanism.

### Confirm Class (RabbitMQ Extension)

| Method | Description |
|---|---|
| `confirm.select` / `confirm.select-ok` | Enable publisher confirm mode on the channel |

## Method Semantics

Most AMQP methods operate as request-response pairs (e.g., `queue.declare` / `queue.declare-ok`). Some methods like `basic.publish` have no response. Some like `basic.get` have multiple possible responses (`basic.get-ok` or `basic.get-empty`).

Many synchronous methods support a `nowait` flag that makes them asynchronous -- the server does not send a response. This improves throughput but removes error feedback.

## Wire Format

AMQP is a binary protocol. Frames include:

- **Method frames**: Carry protocol method calls
- **Content header frames**: Carry message properties (content-type, delivery-mode, etc.)
- **Content body frames**: Carry message payload data
- **Heartbeat frames**: Connection keepalive signals

Maximum frame size is negotiated during connection setup (default typically 131072 bytes). Large messages are split across multiple body frames.

## Connection Negotiation Sequence

```
Client                              Server
  |  --> Protocol Header (AMQP 0 9 1) -->  |
  |  <-- connection.start              <--  |
  |  --> connection.start-ok            -->  |
  |  <-- connection.tune               <--  |
  |  --> connection.tune-ok             -->  |
  |  --> connection.open                -->  |
  |  <-- connection.open-ok             <--  |
  |         (connection ready)              |
```

## RabbitMQ Extensions to AMQP 0-9-1

RabbitMQ extends the base specification with several features:

- **Publisher confirms** (`confirm.select`) -- broker acknowledgment of published messages
- **Negative acknowledgments** (`basic.nack`) -- reject multiple messages at once
- **Exchange-to-exchange bindings** -- route between exchanges, not just exchange-to-queue
- **Per-consumer prefetch** -- QoS applied per consumer rather than per channel
- **Consumer cancellation notifications** -- notify consumers when their queue is deleted
- **Consumer priorities** -- higher-priority consumers receive messages first
- **Direct reply-to** -- optimized RPC without declaring a reply queue
- **Sender-selected distribution** -- CC and BCC headers for multi-queue routing
- **Blocked connection notifications** -- inform clients when the broker is resource-limited

---

[← Back](README.md)
