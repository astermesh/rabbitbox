# RabbitBox: Boxing RabbitMQ

Comprehensive research on boxing RabbitMQ into a SimBox-compatible Box. Covers AMQP 0-9-1 protocol internals, all input/output interfaces, Eng selection, cross-platform runtime analysis, and the boxing process applied step by step.

## Table of Contents

1. [Goal](#1-goal)
2. [AMQP 0-9-1 Protocol Overview](#2-amqp-0-9-1-protocol-overview)
3. [RabbitMQ Core Concepts](#3-rabbitmq-core-concepts)
4. [AMQP Error Model](#4-amqp-error-model)
5. [Boxing Process Applied](#5-boxing-process-applied)
6. [Eng Selection: In-Memory AMQP Broker](#6-eng-selection-in-memory-amqp-broker)
7. [IBI: Inbound Box Interface](#7-ibi-inbound-box-interface)
8. [OBI: Outbound Box Interface](#8-obi-outbound-box-interface)
9. [SBI: RabbitBox Hook Types](#9-sbi-rabbitbox-hook-types)
10. [Cross-Platform Analysis](#10-cross-platform-analysis)
11. [Client Libraries Landscape](#11-client-libraries-landscape)
12. [Management API Interface](#12-management-api-interface)
13. [RabbitSim Capabilities](#13-rabbitsim-capabilities)
14. [Implementation Strategy](#14-implementation-strategy)
15. [Open Questions](#15-open-questions)

---

## 1. Goal

Create **RabbitBox** — an in-memory RabbitMQ emulator wrapped with SBS hooks on all boundaries. The result:

- **Without Sim**: a working in-memory AMQP broker for fast tests (no Docker, no external process)
- **With Sim (RabbitSim)**: realistic message broker behavior — delivery delays, queue backpressure, consumer failures, dead-letter routing, memory limits, network partitions

RabbitMQ is a fundamentally different service type from what simbox has boxed before (PGBox = database, KVBox = key-value store). It is a **message broker** — a mediator between producers and consumers. This means:

- **Stateful topology**: exchanges, queues, bindings are declared at runtime
- **Asynchronous message flow**: publish → route → queue → deliver (not request-response)
- **Multiple delivery semantics**: at-most-once, at-least-once, competing consumers
- **Server-push model**: broker pushes messages to consumers (unlike DB where client pulls)

---

## 2. AMQP 0-9-1 Protocol Overview

### 2.1 Protocol Architecture

AMQP 0-9-1 is a binary, application-layer protocol. The wire format uses **frames** over a TCP connection:

```
┌────────────────────────────────────────────┐
│  TCP Connection                            │
│  ┌──────────────────────────────────────┐  │
│  │  Channel 1                           │  │
│  │  ┌─────────┐ ┌─────────┐ ┌────────┐ │  │
│  │  │ Method  │ │ Header  │ │  Body  │ │  │
│  │  │ Frame   │ │ Frame   │ │ Frame  │ │  │
│  │  └─────────┘ └─────────┘ └────────┘ │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │  Channel 2                           │  │
│  └──────────────────────────────────────┘  │
│  ...                                       │
└────────────────────────────────────────────┘
```

**Connection** = single TCP socket to the broker. Negotiated with protocol header + `connection.start` / `connection.tune` / `connection.open`.

**Channel** = lightweight logical connection multiplexed over one TCP connection. All operations (declare, publish, consume) happen on a channel. Channels are cheap; connections are expensive.

### 2.2 Method Classes

AMQP 0-9-1 defines these method classes:

| Class | Methods | Purpose |
|-------|---------|---------|
| **connection** | start, start-ok, tune, tune-ok, open, open-ok, close, close-ok | Connection lifecycle, negotiation |
| **channel** | open, open-ok, close, close-ok, flow, flow-ok | Channel lifecycle |
| **exchange** | declare, declare-ok, delete, delete-ok, bind, unbind | Exchange CRUD |
| **queue** | declare, declare-ok, bind, bind-ok, unbind, unbind-ok, purge, purge-ok, delete, delete-ok | Queue CRUD + binding management |
| **basic** | qos, qos-ok, consume, consume-ok, cancel, cancel-ok, publish, return, deliver, get, get-ok, get-empty, ack, reject, nack, recover, recover-ok | Message operations (the core) |
| **tx** | select, select-ok, commit, commit-ok, rollback, rollback-ok | Transactions |
| **confirm** | select, select-ok | Publisher confirms (RabbitMQ extension) |

### 2.3 Message Lifecycle

```
Publisher                    Broker                         Consumer
   │                          │                               │
   │─── basic.publish ───────▶│                               │
   │    (exchange, routingKey, │                               │
   │     properties, body)     │                               │
   │                          │── route via exchange ──┐      │
   │                          │                        │      │
   │                          │◀─ enqueue to matching  │      │
   │                          │   queues               │      │
   │                          │                               │
   │                          │─── basic.deliver ────────────▶│
   │                          │    (consumerTag, deliveryTag,  │
   │                          │     exchange, routingKey,      │
   │                          │     properties, body)          │
   │                          │                               │
   │                          │◀────── basic.ack ─────────────│
   │                          │        (deliveryTag)           │
```

### 2.4 Message Properties

Every AMQP message has a body (opaque bytes) and a set of standard properties:

| Property | Type | Purpose |
|----------|------|---------|
| `content-type` | shortstr | MIME type (e.g., `application/json`) |
| `content-encoding` | shortstr | Encoding (e.g., `gzip`) |
| `headers` | table | Custom headers (used by headers exchange) |
| `delivery-mode` | octet | 1 = transient, 2 = persistent |
| `priority` | octet | 0-255 (typically 0-9) |
| `correlation-id` | shortstr | RPC correlation |
| `reply-to` | shortstr | RPC reply queue |
| `expiration` | shortstr | Per-message TTL (milliseconds as string) |
| `message-id` | shortstr | Application message ID |
| `timestamp` | timestamp | Message creation time |
| `type` | shortstr | Message type name |
| `user-id` | shortstr | Publishing user (validated by broker) |
| `app-id` | shortstr | Application identifier |

---

## 3. RabbitMQ Core Concepts

### 3.1 Exchange Types

| Type | Routing Logic | Use Case |
|------|--------------|----------|
| **direct** | Exact match: message routing key = binding key | Point-to-point, task queues |
| **fanout** | Broadcast to ALL bound queues, routing key ignored | Pub/sub, event broadcasting |
| **topic** | Pattern match with `*` (one word) and `#` (zero or more words). Key is dot-separated: `order.created.us` matches `order.*.us` and `order.#` | Selective pub/sub |
| **headers** | Match on message headers via `x-match` argument (`all` or `any`) | Content-based routing |
| **default** | Pre-declared direct exchange with empty name. Every queue auto-bound with queue name as routing key | Simple queue access |

### 3.2 Queues

Queue properties and arguments:

| Property | Description |
|----------|-------------|
| `name` | Queue name (empty = server-generated) |
| `durable` | Survives broker restart |
| `exclusive` | Only accessible by declaring connection, deleted on close |
| `auto-delete` | Deleted when last consumer unsubscribes |
| `x-message-ttl` | Per-queue message TTL (ms) |
| `x-expires` | Queue auto-delete timeout (ms) |
| `x-max-length` | Max messages in queue |
| `x-max-length-bytes` | Max total body size |
| `x-overflow` | What to do when max-length hit: `drop-head`, `reject-publish`, `reject-publish-dlx` |
| `x-dead-letter-exchange` | DLX name |
| `x-dead-letter-routing-key` | Override routing key for DLX |
| `x-max-priority` | Enable priority queue (0-255) |
| `x-queue-type` | `classic`, `quorum`, `stream` |
| `x-single-active-consumer` | Only one consumer at a time |

### 3.3 Queue Types

| Feature | Classic | Quorum | Stream |
|---------|---------|--------|--------|
| Replication | No (mirrored deprecated) | Raft-based | Log replication |
| Ordering | FIFO per channel | FIFO | Append-only log |
| Priority | Yes | Limited (not recommended) | No |
| TTL (message) | Yes | Yes | Yes (via retention) |
| TTL (queue) | Yes | No | No |
| Dead-lettering | Yes | Yes | No |
| Poison message handling | No | Yes (`x-delivery-limit`) | N/A |
| Consumer offset tracking | No | No | Yes |
| Message replay | No | No | Yes |

**For RabbitBox**: classic queues are the primary target. Quorum queue semantics (delivery limits) are useful for simulation. Streams can be deferred.

### 3.4 Bindings

A binding connects an exchange to a queue (or another exchange) with a routing key and optional arguments:

```
Exchange ──[binding: routing_key + args]──▶ Queue
Exchange ──[binding: routing_key + args]──▶ Exchange (e2e)
```

Multiple bindings between the same exchange and queue are allowed (different routing keys). A message matches a binding based on exchange type routing logic.

### 3.5 Consumer Acknowledgments

| Mode | Method | Semantics |
|------|--------|-----------|
| Auto-ack | `basic.consume` with `no-ack=true` | Fire-and-forget, message removed from queue immediately |
| Manual ack | `basic.ack(deliveryTag, multiple)` | Explicit confirmation, message removed |
| Reject | `basic.reject(deliveryTag, requeue)` | Reject single message, optionally requeue |
| Nack | `basic.nack(deliveryTag, multiple, requeue)` | Reject one or more, optionally requeue (RabbitMQ extension) |

### 3.6 Prefetch (QoS)

`basic.qos(prefetchCount, prefetchSize, global)`:
- `prefetchCount` — max unacked messages per consumer (or per channel if `global=true`)
- Controls backpressure: broker stops delivering when consumer hits the limit
- Critical for load balancing across competing consumers

### 3.7 Publisher Confirms

RabbitMQ extension. When enabled on a channel (`confirm.select`):
- Broker acks each published message with a `basic.ack` (or `basic.nack` on failure)
- `deliveryTag` is a channel-scoped sequence number
- Enables reliable publishing without transactions

### 3.8 Dead Letter Exchanges (DLX)

Messages are dead-lettered when:
1. Consumer rejects/nacks with `requeue=false`
2. Message TTL expires
3. Queue max-length exceeded (overflow policy)
4. Delivery limit exceeded (quorum queues)

Dead-lettered messages are republished to the configured DLX with:
- Original exchange/routing key in `x-death` headers
- Optional routing key override via `x-dead-letter-routing-key`
- `x-death` header array tracks death history (queue, reason, count, time)
- Per-message `expiration` property is **removed** from dead-lettered messages to prevent re-expiry in the DLX target queue

**x-death header fields** (per entry in the array, ordered by recency):

| Field | Type | Description |
|-------|------|-------------|
| `queue` | longstr | Source queue name where dead-lettering occurred |
| `reason` | longstr | `rejected`, `expired`, `maxlen`, or `delivery_limit` |
| `count` | long | Number of times dead-lettered for this reason from this queue |
| `exchange` | longstr | Exchange the message was published to |
| `routing-keys` | array of longstr | Original routing keys |
| `time` | timestamp | Time of dead-lettering |
| `original-expiration` | longstr | Original TTL (only if dead-lettered due to per-message TTL) |

Additional first-death annotations: `x-first-death-queue`, `x-first-death-reason`, `x-first-death-exchange` — set on first dead-lettering, never modified.

**Dead letter cycle detection** (verified against RabbitMQ source `rabbit_dead_letter.erl` + `mc.erl`):

RabbitMQ detects cycles by checking if the message has already been dead-lettered from the target queue. The algorithm:
1. For each target queue in the DLX routing result, check `x-death` records
2. If the message was previously dead-lettered from this target queue, AND all death reasons in the cycle path are **not** `rejected` — this is a cycle, message is dropped
3. If any death reason in the cycle is `rejected` — the cycle is allowed (because a client explicitly rejected, meaning the cycle is intentional)
4. `rejected` reason completely bypasses cycle detection (shortcut in the code)

There is **no numeric limit** on cycle iterations — the detection is based on queue name presence in death history, not a counter. A message is dropped immediately upon detecting the first fully-automatic cycle.

**Queue expiry vs dead-lettering**: if an entire queue expires via `x-expires`, messages in the queue are **not** dead-lettered — they are silently discarded.

**At-most-once vs at-least-once**: default dead-lettering is at-most-once (fire-and-forget republish). Quorum queues support at-least-once dead-lettering with internal publisher confirms. For RabbitBox in-memory Eng, at-most-once is sufficient — in-memory delivery is inherently reliable.

### 3.9 Heartbeats

- Negotiated at connection time (`connection.tune`)
- Both sides send heartbeat frames at `interval/2` seconds
- Connection closed if no data received for `interval` seconds
- Detects dead TCP connections (half-open sockets)

### 3.10 Virtual Hosts

- Logical isolation: separate namespace for exchanges, queues, bindings, users
- Default vhost: `/`
- Users get permissions per vhost (configure, write, read — regex patterns)

### 3.11 Exchange-to-Exchange Bindings

RabbitMQ extension. Exchanges can bind to other exchanges, not just queues. The `exchange.bind` method creates a unidirectional binding from a source exchange to a destination exchange.

- Routing semantics are identical to exchange-to-queue bindings (same binding keys, same exchange type rules)
- Messages flow: source exchange → destination exchange → further routing
- RabbitMQ detects and eliminates cycles during message delivery — each queue receives exactly one copy of a message regardless of routing topology complexity
- Auto-delete exchanges are removed when all bindings where the exchange is the **source** are deleted (not when it's only a destination)

**For RabbitBox**: low usage in practice, but needed for behavioral parity. Implement in Phase 2.

### 3.12 Alternate Exchanges

When a message published to an exchange cannot be routed to any queue, it can be republished to an alternate exchange (AE) instead of being silently dropped.

- Configured via `alternate-exchange` argument in `exchange.declare` or via policy (arguments take precedence)
- Cascades: if the AE also can't route, it checks its own AE, and so on — until routing succeeds, chain ends, or a previously-attempted AE is encountered
- **Interaction with mandatory flag**: if a message routes via an AE, it counts as routed — no `basic.return` is sent
- Requires `configure` permission on the declared exchange, `read` on declared exchange, `write` on the AE

### 3.13 Mandatory Messages and basic.return

When `mandatory=true` is set on `basic.publish` and the message cannot be routed to any queue:
- Broker sends `basic.return` back to the publishing channel
- `basic.return` contains: `reply-code` (312 NO_ROUTE), `reply-text`, `exchange`, `routing-key`, plus the original message content

When `mandatory=false` (default): unroutable messages are silently discarded (unless alternate exchange is configured).

**Interaction with publisher confirms**: `basic.return` is sent **before** `basic.ack`. The ordering guarantee is: return first, then confirm.

**`immediate` flag**: defined in AMQP 0-9-1 spec but **not supported** by RabbitMQ (removed in 3.0). Publishing with `immediate=true` causes a channel error.

### 3.14 Publisher Confirms (Detail)

When `confirm.select` is sent on a channel:
- Channel enters confirm mode (irreversible for that channel)
- A transactional channel cannot enter confirm mode (and vice versa)
- Both broker and client count messages starting at 1
- Broker sends `basic.ack(deliveryTag, multiple)` on successful handling
- Broker sends `basic.nack(deliveryTag, multiple)` on internal error only (rare — only when Erlang queue process crashes)
- `multiple=true` means: all messages up to and including this `deliveryTag` are confirmed
- For unroutable messages: confirm is sent once the exchange verifies no matching queues
- For routable messages: confirm is sent when all matching queues have accepted the message (for persistent messages in durable queues, this means persisting to disk)
- Ordering: confirms are generally in publish order on a single channel, but applications should not depend on this

### 3.15 basic.recover

Redelivers all unacknowledged messages on the channel.

- `basic.recover(requeue)`: if `requeue=true`, unacked messages are requeued and may be delivered to different consumers
- In RabbitMQ, `requeue=false` (redeliver to same consumer) is **not supported** — always requeues
- Server responds with `basic.recover-ok`
- Redelivered messages have `redelivered=true` flag set

### 3.16 Passive Declarations (checkExchange / checkQueue)

The `passive` flag on `exchange.declare` and `queue.declare`:
- If `passive=true`: server checks if the entity exists and replies with `declare-ok` if it does, or raises `404 NOT_FOUND` channel error if it doesn't
- Does **not** create the entity — read-only check
- In amqplib: exposed as `checkExchange(name)` and `checkQueue(name)`
- `checkQueue` returns `{ queue, messageCount, consumerCount }` — useful for inspection

### 3.17 Consumer Cancellation Notifications

RabbitMQ extension. Broker can asynchronously cancel a consumer by sending `basic.cancel` to the client:

- Triggered by: queue deletion, queue leader node failure, queue becoming unavailable
- Client must declare `consumer_cancel_notify` capability during connection
- Different from client-initiated `basic.cancel` — this is server-initiated
- Consumer receives `null` message in amqplib when cancelled by server

### 3.18 Single Active Consumer

When `x-single-active-consumer=true` is set on a queue:
- Only one consumer at a time receives messages from the queue
- Other registered consumers are on standby
- When the active consumer is cancelled or its connection drops, the next registered consumer becomes active
- On quorum queues, a new consumer with higher priority can preempt the current active consumer (messages are drained first)
- Ensures strict message ordering guarantees

---

## 4. AMQP Error Model

### 4.1 Reply Codes

Verified against the AMQP 0-9-1 XML specification (`amqp0-9-1.extended.xml`):

| Code | Name | Level | Description |
|------|------|-------|-------------|
| 200 | reply-success | — | Method completed successfully |
| 311 | content-too-large | channel (soft) | Content body too large |
| 312 | no-route | channel (soft) | Mandatory message cannot be routed (sent with `basic.return`) |
| 313 | no-consumers | channel (soft) | Immediate message has no consumers (not supported by RabbitMQ) |
| 320 | connection-forced | connection (hard) | Operator intervention to close connection |
| 402 | invalid-path | connection (hard) | Client tried to access unknown virtual host |
| 403 | access-refused | channel (soft) | No access due to security settings |
| 404 | not-found | channel (soft) | Entity does not exist (queue, exchange) |
| 405 | resource-locked | channel (soft) | Exclusive queue accessed by another connection |
| 406 | precondition-failed | channel (soft) | Precondition failed (e.g., redeclare with different properties) |
| 501 | frame-error | connection (hard) | Malformed frame |
| 502 | syntax-error | connection (hard) | Illegal field values |
| 503 | command-invalid | connection (hard) | Invalid sequence of frames |
| 504 | channel-error | connection (hard) | Channel not correctly opened |
| 505 | unexpected-frame | connection (hard) | Unexpected frame type |
| 506 | resource-error | connection (hard) | Insufficient resources |
| 530 | not-allowed | connection (hard) | Prohibited action |
| 540 | not-implemented | connection (hard) | Functionality not implemented |
| 541 | internal-error | connection (hard) | Internal error requiring operator intervention |

### 4.2 Channel-Level vs Connection-Level Errors

**Channel errors (soft)** close only the affected channel. The connection and other channels remain open. Common triggers:

| Error | Code | Typical Trigger |
|-------|------|-----------------|
| NOT_FOUND | 404 | `queue.bind` to non-existing queue/exchange, `basic.consume` on missing queue, `basic.publish` to non-existing exchange, passive declare of non-existing entity |
| PRECONDITION_FAILED | 406 | Redeclare queue/exchange with different properties, duplicate `basic.ack` for same delivery tag, `basic.ack` on wrong channel |
| ACCESS_REFUSED | 403 | Insufficient permissions for the operation |
| RESOURCE_LOCKED | 405 | Accessing exclusive queue from a different connection |

**Connection errors (hard)** close the entire connection including all channels. These indicate protocol-level violations:

| Error | Code | Typical Trigger |
|-------|------|-----------------|
| connection-forced | 320 | Operator closed connection, resource alarm |
| invalid-path | 402 | Unknown virtual host |
| frame-error | 501 | Malformed frame structure |
| command-invalid | 503 | Operations on a closed channel, invalid method sequence |
| channel-error | 504 | Operations on an unopened channel |
| not-allowed | 530 | Exceeded negotiated `channel_max` |

### 4.3 Error Model for RabbitBox

For in-process boxing without wire protocol, errors map to:
- **Channel errors** → throw a typed `ChannelError` with code and message, mark channel as closed
- **Connection errors** → throw a typed `ConnectionError`, mark connection and all its channels as closed
- Error codes and messages must match RabbitMQ exactly for behavioral parity

---

## 5. Boxing Process Applied

Following the standard boxing process from R04:

### Step 1: Select Eng

**Eng = in-memory AMQP broker implementation in TypeScript**

No existing production-ready in-memory AMQP broker in JS/TS exists. Options:

| Option | Viability | Notes |
|--------|-----------|-------|
| **Build from scratch** | ✅ Best | Implement exchange routing, queue storage, consumer dispatch. No wire protocol needed for in-process boxing |
| **Port LavinMQ concepts** | Partial | LavinMQ (Crystal) is clean but different language. Useful as reference for routing logic |
| **Wrap `@onify/fake-amqplib`** | ❌ | API mock only, no real broker behavior |
| **Embed real RabbitMQ (Docker)** | Partial boxing | Loses in-process OBI hookability |

**Decision**: Build a custom in-memory Eng. The core logic is not complex:
- Exchange routing (4 algorithms)
- Queue storage (ordered array or linked list)
- Consumer round-robin dispatch
- Ack/nack tracking with delivery tags

This is comparable to KVBox's `Map<string, StoreEntry>` — the Eng is the data structure + dispatch logic.

### Step 2: Identify BI

**BI = AMQP 0-9-1 channel methods (programmatic API)**

For in-process boxing, we don't need the binary wire protocol. The BI is the programmatic equivalent of AMQP channel operations:

| BI Method | AMQP Equivalent | Direction |
|-----------|-----------------|-----------|
| `exchangeDeclare(name, type, opts)` | `exchange.declare` | Topology |
| `checkExchange(name)` | `exchange.declare` (passive) | Topology |
| `exchangeDelete(name, opts)` | `exchange.delete` | Topology |
| `exchangeBind(dest, source, routingKey, args)` | `exchange.bind` | Topology |
| `exchangeUnbind(dest, source, routingKey, args)` | `exchange.unbind` | Topology |
| `queueDeclare(name, opts)` | `queue.declare` | Topology |
| `checkQueue(name)` | `queue.declare` (passive) | Topology |
| `queueDelete(name, opts)` | `queue.delete` | Topology |
| `queueBind(queue, exchange, routingKey, args)` | `queue.bind` | Topology |
| `queueUnbind(queue, exchange, routingKey, args)` | `queue.unbind` | Topology |
| `publish(exchange, routingKey, body, props)` | `basic.publish` | Inbound |
| `consume(queue, callback, opts)` | `basic.consume` | Inbound |
| `cancel(consumerTag)` | `basic.cancel` | Inbound |
| `ack(deliveryTag, multiple)` | `basic.ack` | Inbound |
| `nack(deliveryTag, multiple, requeue)` | `basic.nack` | Inbound |
| `reject(deliveryTag, requeue)` | `basic.reject` | Inbound |
| `get(queue, opts)` | `basic.get` | Inbound |
| `prefetch(count, global)` | `basic.qos` | Inbound |
| `recover(requeue)` | `basic.recover` | Inbound |
| `purgeQueue(queue)` | `queue.purge` | Inbound |
| `confirmSelect()` | `confirm.select` | Inbound |

### Step 3: Map IBI Points

IBI = where external calls enter the Box. These are operations that Src/Exp invoke:

```
                    IBI
Src / Exp ─────▶ ●─ publish ──────▶ ┌────────────────────────┐
                 ●─ consume ──────▶ │                        │
                 ●─ ack/nack ─────▶ │       Eng              │
                 ●─ get ──────────▶ │  (in-memory broker)    │
                 ●─ recover ──────▶ │                        │
                 ●─ declareExch ──▶ │  exchanges             │
                 ●─ checkExch ────▶ │  queues                │
                 ●─ declareQueue ─▶ │  bindings              │
                 ●─ checkQueue ───▶ │  consumers             │
                 ●─ bind ─────────▶ │  unacked messages      │
                 ●─ unbind ───────▶ │                        │
                 ●─ exchBind ─────▶ │                        │
                 ●─ deleteExch ───▶ │                        │
                 ●─ deleteQueue ──▶ │                        │
                 ●─ prefetch ─────▶ │                        │
                 ●─ purge ────────▶ │                        │
                 ●─ cancel ───────▶ │                        │
                 ●─ confirmSelect ▶ └────────────────────────┘
```

**Grouped by concern:**

| Group | IBI Hook Points | Sim Interest |
|-------|----------------|--------------|
| **Publishing** | `publish` | Latency, rate limiting, reject, confirm delay |
| **Consuming** | `consume`, `get`, `cancel` | Delivery delay, consumer failure, rebalance |
| **Acknowledgment** | `ack`, `nack`, `reject`, `recover` | Ack delay, nack simulation, requeue behavior, mass redeliver |
| **Topology** | `exchangeDeclare`, `checkExchange`, `exchangeDelete`, `exchangeBind`, `exchangeUnbind`, `queueDeclare`, `checkQueue`, `queueDelete`, `queueBind`, `queueUnbind`, `purge` | Topology validation, limit enforcement |
| **QoS** | `prefetch` | Prefetch simulation |
| **Channel mode** | `confirmSelect` | Confirm mode activation |

### Step 4: Map OBI Points

OBI = where Eng calls outward to OS/dependencies.

For an in-memory broker, outbound dependencies are minimal but critical:

| OBI Point | What Eng Calls | Sim Use |
|-----------|---------------|---------|
| **time** | `Date.now()` for message timestamps, TTL expiry checks, queue expiry, heartbeat tracking | Virtual time for TTL simulation, time-based expiry |
| **timers** | `setTimeout` / `setInterval` for delayed delivery, queue expiry checks, consumer timeout | Virtual timer management |
| **random** | Consumer tag generation, message ID generation | Deterministic IDs |
| **delivery** | Internal: message dispatch from queue to consumer callback | Delivery delay, consumer failure injection |
| **return** | Internal: `basic.return` sent to publisher when mandatory message is unroutable | Return delay, suppress returns, transform return reason |
| **persist** | If persistence is added: writing messages/topology to storage | Disk I/O simulation |

**Key insight**: The `delivery` OBI point is unique to message brokers. When a message is routed to a queue and a consumer is ready, the broker internally dispatches the message to the consumer's callback. This is an outbound boundary — the broker "calls out" to deliver. Sim can intercept to:
- Add delivery delay
- Simulate consumer crash
- Simulate network partition between broker and consumer
- Simulate slow consumer

**`return` OBI point**: when a mandatory message cannot be routed, the broker calls back to the publisher with `basic.return`. This is an outbound boundary — the Eng "calls out" to notify the publisher. Sim can intercept to delay returns, suppress them, or inject returns for non-mandatory messages.

### Step 5: Apply SBS

Wrap every boundary (IBI + OBI) with Hook lifecycle:

```
pre → optional next() → post → final resolution
```

Each hook gets domain-specific context types (defined in SBI). Same `Tap<Ctx, T>` shape as all other boxes.

### Step 6: Result = RabbitBox

```
              IBI                                    OBI
Src / Exp ──▶ ●─publish────▶ ┌──────────────────┐ ──time──── ● ──▶ OS
              ●─consume────▶ │                  │ ──timers── ●
              ●─ack/nack───▶ │   Eng            │ ──random── ●
              ●─get────────▶ │   (AMQP broker)  │ ──deliver─ ● ──▶ Consumer cb
              ●─recover─────▶ │                  │ ──return── ● ──▶ Publisher cb
              ●─topology───▶ │  exchanges       │ ──persist─ ●
              ●─prefetch───▶ │  queues/bindings │
              ●─purge──────▶ │  consumers       │
              ●─cancel─────▶ │                  │
              ●─confirmSel─▶ └──────────────────┘
              ● = SBI hook point (SBS applied)
```

---

## 6. Eng Selection: In-Memory AMQP Broker

### 6.1 What Eng Must Implement

The core broker logic that lives inside RabbitBox:

#### Exchange Routing Engine

```typescript
interface Exchange {
  name: string
  type: 'direct' | 'fanout' | 'topic' | 'headers'
  durable: boolean
  autoDelete: boolean
  internal: boolean
  arguments: Record<string, unknown>
  alternateExchange?: string  // x-alternate-exchange
}
```

Routing algorithms per exchange type:

**Direct**: exact string match `routingKey === bindingKey`

**Fanout**: all bound queues, ignore routing key

**Topic**: dot-separated word matching with wildcards
```
"order.created.us" matches:
  "order.created.us"   → exact
  "order.*.us"         → * matches one word
  "order.#"            → # matches zero or more words
  "#"                  → matches everything
  "*.created.*"        → * in multiple positions
```

Topic matching algorithm: split routing key and binding key by `.`, compare word by word. `*` matches exactly one word, `#` matches zero or more words. Can be implemented as a trie for efficiency or simple linear scan for correctness-first.

**Headers**: compare message headers with binding arguments, respecting `x-match` (`all` / `any`).

#### Queue Storage

```typescript
interface Queue {
  name: string
  durable: boolean
  exclusive: boolean
  autoDelete: boolean
  arguments: Record<string, unknown>

  // Derived from arguments
  messageTtl?: number          // x-message-ttl
  expires?: number             // x-expires
  maxLength?: number           // x-max-length
  maxLengthBytes?: number      // x-max-length-bytes
  overflowBehavior?: 'drop-head' | 'reject-publish' | 'reject-publish-dlx'
  deadLetterExchange?: string  // x-dead-letter-exchange
  deadLetterRoutingKey?: string // x-dead-letter-routing-key
  maxPriority?: number         // x-max-priority
  singleActiveConsumer?: boolean // x-single-active-consumer
}
```

Internal storage: ordered message list (FIFO). For priority queues: separate list per priority level or a priority-aware insertion.

#### Consumer Management

```typescript
interface Consumer {
  consumerTag: string
  queueName: string
  callback: (msg: DeliveredMessage) => void
  noAck: boolean
  exclusive: boolean
  prefetchCount: number
  unackedCount: number
  unackedMessages: Map<number, UnackedMessage>  // deliveryTag → message
}
```

Dispatch: round-robin across consumers on the same queue. Respect prefetch limits. Track unacked messages per consumer with delivery tags.

#### Message Structure

```typescript
interface BrokerMessage {
  body: Uint8Array
  properties: MessageProperties
  exchange: string
  routingKey: string
  mandatory: boolean
  immediate: boolean  // deprecated but in spec

  // Internal tracking
  deliveryCount: number
  enqueuedAt: number  // timestamp
  expiresAt?: number  // computed from TTL
  priority: number
  xDeath?: XDeathEntry[]  // dead-letter history
}

interface MessageProperties {
  contentType?: string
  contentEncoding?: string
  headers?: Record<string, unknown>
  deliveryMode?: 1 | 2
  priority?: number
  correlationId?: string
  replyTo?: string
  expiration?: string
  messageId?: string
  timestamp?: number
  type?: string
  userId?: string
  appId?: string
}
```

### 6.2 Complexity Assessment

| Component | Complexity | Lines (est.) | Notes |
|-----------|-----------|-------------|-------|
| Exchange routing (all 4 types) | Medium | ~200 | Topic matching is the hardest part |
| Queue storage + FIFO | Low | ~150 | Array with head pointer |
| Consumer dispatch + round-robin | Medium | ~200 | Prefetch tracking adds complexity |
| Ack/nack/reject handling | Medium | ~150 | Requeue, dead-letter routing |
| Binding management | Low | ~100 | Map-based lookup |
| TTL expiry | Low-Medium | ~100 | Timer-based or lazy expiry |
| Dead letter routing | Medium | ~100 | Re-publish to DLX with x-death |
| Priority queues | Low-Medium | ~80 | Multiple buckets |
| Connection/channel model | Low | ~100 | Lightweight for in-process |
| **Total** | | **~1200** | Core broker without SBS hooks |

This is manageable. Compare: PGlite is thousands of lines but we use it as a dependency. Here the Eng is custom-built but the domain is much simpler than a SQL database.

### 6.3 Existing Mocks Analysis

| Package | Downloads/wk | Last Updated | What It Does | Usable as Eng? |
|---------|-------------|-------------|--------------|----------------|
| `@onify/fake-amqplib` | ~2,000 | 2025 | API-compatible amqplib replacement for tests | ❌ Mocks API shape, no routing logic |
| `mock-amqplib` | ~500 | 2023 | Stubs for integration tests | ❌ No broker behavior |
| `amqplib-mock` | ~200 | old | Callback/promise mock | ❌ No broker behavior |
| `amqp-mock` | ~50 | 2013 | Inspired by nock | ❌ Abandoned, incompatible |

**Verdict**: None are usable as Eng. They mock the client API shape, not broker behavior. We need a real broker implementation that actually routes messages.

---

## 7. IBI: Inbound Box Interface

Full specification of every inbound hook point with context types:

### 7.1 publish

```typescript
interface PublishCtx {
  readonly exchange: string
  readonly routingKey: string
  readonly body: Uint8Array
  readonly properties: MessageProperties
  readonly mandatory: boolean
  readonly meta: PublishMeta
}

interface PublishMeta {
  readonly exchangeExists: boolean
  readonly exchangeType: string | null
  readonly matchedQueues?: number  // after routing (post-phase)
  realDurationMs?: number
}

type PublishResult = {
  routed: boolean         // true if at least one queue matched
  deliveryTag?: number    // if confirms enabled
}
```

**Sim decisions**:
- Pre: delay (simulate slow publish), fail (simulate channel error), short_circuit (silently drop)
- Post: transform (modify routed status), delay (confirm delay)

### 7.2 consume

```typescript
interface ConsumeCtx {
  readonly queue: string
  readonly consumerTag: string
  readonly noAck: boolean
  readonly exclusive: boolean
  readonly meta: ConsumeMeta
}

interface ConsumeMeta {
  readonly queueExists: boolean
  readonly queueMessageCount: number
  readonly existingConsumerCount: number
  realDurationMs?: number
}

type ConsumeResult = { consumerTag: string }
```

### 7.3 ack / nack / reject

```typescript
interface AckCtx {
  readonly deliveryTag: number
  readonly multiple: boolean
  readonly meta: AckMeta
}

interface AckMeta {
  readonly messageExists: boolean
  readonly consumerTag: string
  readonly queue: string
  realDurationMs?: number
}

type AckResult = void

interface NackCtx {
  readonly deliveryTag: number
  readonly multiple: boolean
  readonly requeue: boolean
  readonly meta: NackMeta
}

interface NackMeta {
  readonly messageExists: boolean
  readonly willDeadLetter: boolean  // true if requeue=false and DLX configured
  readonly consumerTag: string
  readonly queue: string
  realDurationMs?: number
}

type NackResult = void

// reject is same shape as nack but single message only (no multiple flag)
```

### 7.4 get (polling)

```typescript
interface GetCtx {
  readonly queue: string
  readonly noAck: boolean
  readonly meta: GetMeta
}

interface GetMeta {
  readonly queueExists: boolean
  readonly messageCount: number
  readonly consumerCount: number
  realDurationMs?: number
}

type GetResult = DeliveredMessage | null
```

### 7.5 Topology Operations

```typescript
interface ExchangeDeclareCtx {
  readonly name: string
  readonly type: 'direct' | 'fanout' | 'topic' | 'headers'
  readonly durable: boolean
  readonly autoDelete: boolean
  readonly internal: boolean
  readonly arguments: Record<string, unknown>
  readonly meta: { readonly alreadyExists: boolean }
}

interface QueueDeclareCtx {
  readonly name: string
  readonly durable: boolean
  readonly exclusive: boolean
  readonly autoDelete: boolean
  readonly arguments: Record<string, unknown>
  readonly meta: {
    readonly alreadyExists: boolean
    readonly messageCount: number
    readonly consumerCount: number
  }
}

interface QueueBindCtx {
  readonly queue: string
  readonly exchange: string
  readonly routingKey: string
  readonly arguments: Record<string, unknown>
  readonly meta: {
    readonly queueExists: boolean
    readonly exchangeExists: boolean
  }
}

// Similar patterns for exchangeDelete, queueDelete, queueUnbind, purge
```

### 7.6 prefetch

```typescript
interface PrefetchCtx {
  readonly count: number
  readonly global: boolean
  readonly meta: {
    readonly previousCount: number
    readonly channelConsumerCount: number
  }
}

type PrefetchResult = void
```

### 7.7 recover

```typescript
interface RecoverCtx {
  readonly requeue: boolean  // RabbitMQ always requeues regardless of this flag
  readonly meta: {
    readonly unackedCount: number  // messages that will be requeued
  }
}

type RecoverResult = void
```

**Note**: RabbitMQ ignores `requeue=false` and always requeues. RabbitBox must match this behavior.

### 7.8 checkExchange / checkQueue (passive declare)

```typescript
interface CheckExchangeCtx {
  readonly name: string
  readonly meta: {
    readonly exists: boolean
  }
}

type CheckExchangeResult = void  // success or 404 NOT_FOUND channel error

interface CheckQueueCtx {
  readonly name: string
  readonly meta: {
    readonly exists: boolean
    readonly messageCount: number
    readonly consumerCount: number
  }
}

type CheckQueueResult = {
  queue: string
  messageCount: number
  consumerCount: number
}
```

### 7.9 confirmSelect

```typescript
interface ConfirmSelectCtx {
  readonly meta: {
    readonly alreadyInConfirmMode: boolean
    readonly channelIsTransactional: boolean  // if true, operation must fail
  }
}

type ConfirmSelectResult = void
```

### 7.10 exchangeBind / exchangeUnbind

```typescript
interface ExchangeBindCtx {
  readonly destination: string
  readonly source: string
  readonly routingKey: string
  readonly arguments: Record<string, unknown>
  readonly meta: {
    readonly destinationExists: boolean
    readonly sourceExists: boolean
  }
}

type ExchangeBindResult = void

// exchangeUnbind has identical context shape
```

---

## 8. OBI: Outbound Box Interface

### 8.1 time

```typescript
interface TimeCtx {
  readonly source: 'message-timestamp' | 'ttl-check' | 'queue-expiry' | 'heartbeat' | 'now'
  readonly meta: Record<string, never>
}

type TimeResult = number  // ms timestamp
```

Used for: message `timestamp` property, TTL expiry calculations, queue auto-expiry, heartbeat intervals.

**Sim pattern**: short_circuit → return virtual time. Same as KVBox.

### 8.2 timers

```typescript
interface TimerSetCtx {
  readonly source: 'ttl-expiry' | 'queue-expiry' | 'delayed-delivery' | 'heartbeat'
  readonly delayMs: number
  readonly meta: Record<string, never>
}

type TimerSetResult = TimerHandle

interface TimerFireCtx {
  readonly handle: TimerHandle
  readonly source: string
  readonly meta: { readonly scheduledAt: number; readonly firedAt: number }
}

type TimerFireResult = void
```

**Sim pattern**: intercept timer creation, manage in virtual timer queue. Enables time-jump for TTL testing.

### 8.3 random

```typescript
interface RandomCtx {
  readonly source: 'consumer-tag' | 'message-id' | 'queue-name'
  readonly meta: Record<string, never>
}

type RandomResult = string  // generated identifier
```

**Sim pattern**: short_circuit → return deterministic value from seed.

### 8.4 delivery

```typescript
interface DeliveryCtx {
  readonly queue: string
  readonly consumerTag: string
  readonly deliveryTag: number
  readonly message: DeliveredMessage
  readonly meta: DeliveryMeta
}

interface DeliveryMeta {
  readonly queueDepth: number       // messages remaining in queue
  readonly consumerUnacked: number  // consumer's current unacked count
  readonly redelivered: boolean
  realDurationMs?: number
}

type DeliveryResult = void
```

This is the **most important OBI point** for RabbitSim. The broker dispatches messages to consumers through this boundary. Sim can:

- **delay**: simulate network latency between broker and consumer
- **fail**: simulate consumer crash / connection drop
- **short_circuit**: prevent delivery (simulate consumer being paused)
- **transform**: modify message before delivery (corrupt data simulation)

### 8.5 return (mandatory messages)

```typescript
interface ReturnCtx {
  readonly exchange: string
  readonly routingKey: string
  readonly replyCode: number       // 312 (NO_ROUTE)
  readonly replyText: string
  readonly message: BrokerMessage
  readonly meta: {
    readonly mandatory: boolean
    readonly publisherChannelId: string
  }
}

type ReturnResult = void
```

Sent when a mandatory message cannot be routed to any queue. The return is sent **before** the publisher confirm (`basic.ack`).

**Sim decisions**:
- Pre: delay (simulate slow return notification), fail (swallow the return)
- Post: transform (modify reply code/text)

### 8.6 persist (optional)

```typescript
interface PersistCtx {
  readonly operation: 'write-message' | 'write-topology' | 'fsync'
  readonly meta: {
    readonly messageCount?: number
    readonly sizeBytes?: number
  }
}

type PersistResult = void
```

Only relevant if we simulate durable messages/queues. For in-memory Eng, persist is a no-op by default. Sim can hook to simulate disk I/O delays.

---

## 9. SBI: RabbitBox Hook Types

Combined SBI definition:

```typescript
// === RabbitBox SBI ===

interface RabbitInboundHooks {
  // Message operations
  publish: Hook<PublishCtx, PublishResult>
  consume: Hook<ConsumeCtx, ConsumeResult>
  get: Hook<GetCtx, GetResult>
  cancel: Hook<CancelCtx, CancelResult>

  // Acknowledgment
  ack: Hook<AckCtx, AckResult>
  nack: Hook<NackCtx, NackResult>
  reject: Hook<RejectCtx, RejectResult>
  recover: Hook<RecoverCtx, RecoverResult>

  // Topology
  exchangeDeclare: Hook<ExchangeDeclareCtx, ExchangeDeclareResult>
  checkExchange: Hook<CheckExchangeCtx, CheckExchangeResult>
  exchangeDelete: Hook<ExchangeDeleteCtx, ExchangeDeleteResult>
  exchangeBind: Hook<ExchangeBindCtx, ExchangeBindResult>
  exchangeUnbind: Hook<ExchangeUnbindCtx, ExchangeUnbindResult>
  queueDeclare: Hook<QueueDeclareCtx, QueueDeclareResult>
  checkQueue: Hook<CheckQueueCtx, CheckQueueResult>
  queueDelete: Hook<QueueDeleteCtx, QueueDeleteResult>
  queueBind: Hook<QueueBindCtx, QueueBindResult>
  queueUnbind: Hook<QueueUnbindCtx, QueueUnbindResult>
  purge: Hook<PurgeCtx, PurgeResult>

  // QoS
  prefetch: Hook<PrefetchCtx, PrefetchResult>

  // Channel mode
  confirmSelect: Hook<ConfirmSelectCtx, ConfirmSelectResult>
}

interface RabbitOutboundHooks {
  time: Hook<TimeCtx, TimeResult>
  timers: Hook<TimerSetCtx, TimerSetResult>
  random: Hook<RandomCtx, RandomResult>
  delivery: Hook<DeliveryCtx, DeliveryResult>
  return: Hook<ReturnCtx, ReturnResult>
  persist: Hook<PersistCtx, PersistResult>
}

type RabbitHooks = RabbitInboundHooks & RabbitOutboundHooks
```

**Hook count**: 21 IBI + 6 OBI = **27 hook points**

Compare: KVBox has 3 IBI + 2 OBI = 5 hooks. RabbitBox has ~5x the hook surface, reflecting the broker's richer interface.

---

## 10. Cross-Platform Analysis

### 10.1 Runtime Compatibility Matrix

RabbitBox's Eng is pure TypeScript with no native dependencies. The question is how Src connects to RabbitBox — what client library does Src use?

| Runtime | In-Process RabbitBox | Src Connection to RabbitBox |
|---------|---------------------|---------------------------|
| **Node.js** | ✅ Native | Direct API or amqplib-compatible adapter |
| **Deno** | ✅ Via npm compat | Direct API or deno-amqp adapter |
| **Bun** | ✅ Via npm compat | Direct API or amqplib-compatible adapter |
| **Browser** | ✅ Pure TS | Direct API or STOMP-over-WS adapter |

### 10.2 Connection Mode Options

There are two fundamentally different approaches for how Src connects to RabbitBox:

#### Option A: Programmatic API (In-Process)

Src imports RabbitBox directly and calls methods. No wire protocol needed.

```typescript
// Src code
import { rabbitBox } from './lab-setup'

const ch = rabbitBox.createChannel()
await ch.assertQueue('tasks')
await ch.publish('', 'tasks', Buffer.from('hello'))
await ch.consume('tasks', (msg) => {
  console.log(msg.content.toString())
  ch.ack(msg)
})
```

**Pros**: zero overhead, full OBI hookability, works everywhere
**Cons**: Src code differs from production (uses RabbitBox API, not amqplib)

#### Option B: amqplib-Compatible Adapter

Provide a drop-in replacement for `amqplib` that routes to in-memory RabbitBox instead of TCP:

```typescript
// Adapter: amqplib API shape → RabbitBox calls
import amqp from 'rabbit-amqplib-adapter'

const conn = await amqp.connect('amqp://rabbitbox')  // no real TCP
const ch = await conn.createChannel()
await ch.assertQueue('tasks')
ch.sendToQueue('tasks', Buffer.from('hello'))
ch.consume('tasks', (msg) => {
  console.log(msg.content.toString())
  ch.ack(msg)
})
```

**Pros**: Src code identical to production, zero-knowledge invariant preserved
**Cons**: must implement full amqplib API surface, adapter maintenance burden

#### Option C: Wire Protocol Server (TCP/WebSocket)

RabbitBox listens on a port, speaks real AMQP 0-9-1 binary protocol. Any client connects normally.

**Pros**: any AMQP client works unmodified
**Cons**: must implement binary protocol parser/serializer (~10x complexity), TCP needed (no browser), slower

#### Recommendation

**Start with Option A (programmatic API)**, then build **Option B (amqplib adapter)** as a thin translation layer. Option C is only needed for Docker-based partial boxing.

### 10.3 Per-Runtime Details

#### Node.js

Full support. Both programmatic and amqplib-adapter approaches work. Node.js is the primary target — most production RabbitMQ consumers run on Node.

If TCP server needed: `node:net` module available.

#### Deno

Full support for programmatic API (pure TS).

For amqplib adapter: Deno's npm compatibility supports amqplib, but there's also `deno.land/x/amqp` — a native Deno AMQP client by [lenkan/deno-amqp](https://github.com/lenkan/deno-amqp) (latest v0.24.0). A Deno-native adapter could target this API instead.

For TCP server: `Deno.listen()` available but not on Deno Deploy (raw TCP not supported).

#### Bun

Full support for programmatic API (pure TS).

For amqplib adapter: Bun has known issues with amqplib due to `net` module incompatibilities ([bun#4791](https://github.com/oven-sh/bun/issues/4791)). A fork `amqplib-bun` exists but is low adoption. RabbitBox's in-process adapter bypasses this entirely — no TCP sockets involved.

For TCP server: `Bun.listen()` available.

#### Browser

Full support for programmatic API (pure TS). The Eng is pure computation — no Node-specific APIs.

For wire protocol: browsers cannot open raw TCP sockets. Options:
- **STOMP over WebSocket**: RabbitMQ supports this via `rabbitmq_web_stomp` plugin. `@stomp/stompjs` (338k weekly downloads) is the standard browser client. A WebSocket STOMP adapter for RabbitBox could be built.
- **MQTT over WebSocket**: via `rabbitmq_web_mqtt` plugin. Less common for RabbitMQ.
- **HTTP API only**: expose management-style REST endpoints. Limited to admin operations + basic publish/get (no consumer push).

**Browser conclusion**: programmatic API works out of the box. STOMP-over-WS adapter is the path for protocol-level browser access.

### 10.4 Cross-Platform Summary

| Feature | Node.js | Deno | Bun | Browser |
|---------|---------|------|-----|---------|
| In-process Eng | ✅ | ✅ | ✅ | ✅ |
| Programmatic API | ✅ | ✅ | ✅ | ✅ |
| amqplib adapter | ✅ | ⚠️ npm compat | ⚠️ net issues | ❌ |
| deno-amqp adapter | ❌ | ✅ | ❌ | ❌ |
| STOMP/WS adapter | ✅ | ✅ | ✅ | ✅ |
| TCP wire protocol | ✅ | ✅ (not Deploy) | ✅ | ❌ |
| Full OBI hookability | ✅ | ✅ | ✅ | ✅ |

---

## 11. Client Libraries Landscape

### 11.1 Major Libraries

| Library | Protocol | Runtime | Weekly DL | Notes |
|---------|----------|---------|-----------|-------|
| **amqplib** | AMQP 0-9-1 over TCP | Node.js | ~937k | De facto standard. Raw TCP sockets. |
| **rabbitmq-client** | AMQP 0-9-1 over TCP | Node.js | Growing | Zero deps, TS-native, auto-reconnect. By cody-greene. |
| **@cloudamqp/amqp-client** | AMQP 0-9-1 over TCP + WS | Node.js + Browser | ~5k | TCP (Node) or WebSocket (browser). By CloudAMQP. |
| **@stomp/stompjs** | STOMP over WS | Node.js + Browser | ~338k | Browser-first. Needs `rabbitmq_web_stomp` plugin. |
| **deno-amqp** | AMQP 0-9-1 over TCP | Deno | N/A | Deno-native. Latest v0.24.0. |
| **amqplib-bun** | AMQP 0-9-1 over TCP | Bun | ~138 | Fork of amqplib for Bun compatibility. |

### 11.2 amqplib API Surface

Since amqplib is the most popular, the amqplib-compatible adapter must implement its API:

```typescript
// amqplib connection
interface Connection {
  createChannel(): Promise<Channel>
  createConfirmChannel(): Promise<ConfirmChannel>
  close(): Promise<void>
  on(event: 'error' | 'close' | 'blocked' | 'unblocked', listener: Function): this
}

// amqplib channel
interface Channel {
  // Topology
  assertExchange(exchange: string, type: string, options?: Options.AssertExchange): Promise<Replies.AssertExchange>
  checkExchange(exchange: string): Promise<Replies.Empty>
  deleteExchange(exchange: string, options?: Options.DeleteExchange): Promise<Replies.Empty>
  assertQueue(queue: string, options?: Options.AssertQueue): Promise<Replies.AssertQueue>
  checkQueue(queue: string): Promise<Replies.AssertQueue>
  deleteQueue(queue: string, options?: Options.DeleteQueue): Promise<Replies.DeleteQueue>
  bindQueue(queue: string, source: string, pattern: string, args?: object): Promise<Replies.Empty>
  unbindQueue(queue: string, source: string, pattern: string, args?: object): Promise<Replies.Empty>
  bindExchange(destination: string, source: string, pattern: string, args?: object): Promise<Replies.Empty>
  unbindExchange(destination: string, source: string, pattern: string, args?: object): Promise<Replies.Empty>
  purgeQueue(queue: string): Promise<Replies.PurgeQueue>

  // Publishing
  publish(exchange: string, routingKey: string, content: Buffer, options?: Options.Publish): boolean
  sendToQueue(queue: string, content: Buffer, options?: Options.Publish): boolean

  // Consuming
  consume(queue: string, onMessage: (msg: ConsumeMessage | null) => void, options?: Options.Consume): Promise<Replies.Consume>
  cancel(consumerTag: string): Promise<Replies.Empty>
  get(queue: string, options?: Options.Get): Promise<GetMessage | false>
  prefetch(count: number, global?: boolean): Promise<Replies.Empty>

  // Acknowledgment
  ack(message: Message, allUpTo?: boolean): void
  nack(message: Message, allUpTo?: boolean, requeue?: boolean): void
  reject(message: Message, requeue?: boolean): void

  // Flow
  recover(): Promise<Replies.Empty>

  // Lifecycle
  close(): Promise<void>
  on(event: 'error' | 'close' | 'return' | 'drain', listener: Function): this
}
```

### 11.3 @cloudamqp/amqp-client API

Alternative API (simpler, modern):

```typescript
const amqp = new AMQPClient("amqp://localhost")
const conn = await amqp.connect()
const ch = await conn.channel()

await ch.exchangeDeclare("logs", "fanout")
const q = await ch.queueDeclare("")  // server-generated name
await ch.queueBind(q.name, "logs", "")

// Publish
await ch.basicPublish("logs", "", JSON.stringify({msg: "hello"}))

// Consume (AsyncGenerator)
const consumer = await ch.basicConsume(q.name)
for await (const msg of consumer) {
  console.log(msg.bodyString())
  await msg.ack()
}
```

---

## 12. Management API Interface

RabbitMQ provides an HTTP management API (via `rabbitmq_management` plugin). RabbitBox should expose a compatible subset for admin/monitoring:

### 12.1 Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/overview` | GET | Cluster overview, message rates |
| `/api/exchanges` | GET | List all exchanges |
| `/api/exchanges/{vhost}` | GET | List exchanges in vhost |
| `/api/exchanges/{vhost}/{name}` | GET/PUT/DELETE | CRUD exchange |
| `/api/exchanges/{vhost}/{name}/publish` | POST | Publish message via HTTP |
| `/api/queues` | GET | List all queues |
| `/api/queues/{vhost}` | GET | List queues in vhost |
| `/api/queues/{vhost}/{name}` | GET/PUT/DELETE | CRUD queue |
| `/api/queues/{vhost}/{name}/get` | POST | Get messages from queue |
| `/api/bindings` | GET | List all bindings |
| `/api/bindings/{vhost}` | GET | List bindings in vhost |
| `/api/bindings/{vhost}/e/{exchange}/q/{queue}` | GET/POST | Bindings between exchange and queue |
| `/api/connections` | GET | List connections |
| `/api/channels` | GET | List channels |
| `/api/consumers` | GET | List consumers |
| `/api/definitions` | GET/POST | Export/import definitions |

### 12.2 For RabbitBox

The management API is **not** part of the core BI (AMQP operations). It's an auxiliary interface for:

- **Exp** (test code) to inspect broker state without AMQP operations
- **Monitoring** tools compatibility
- **Topology import/export** (definitions endpoint)

Implementation priority: LOW. Programmatic inspection methods on the RabbitBox instance serve the same purpose for testing. HTTP management API is a nice-to-have for compatibility.

---

## 13. RabbitSim Capabilities

What RabbitSim can simulate via SBS hooks:

### 13.1 Virtual Domain State

```typescript
interface RabbitSimState {
  // Queue sizes (virtual — independent of real message count)
  virtualQueueDepths: Map<string, number>

  // Latency injection
  publishLatencyMs: number
  deliveryLatencyMs: number
  ackLatencyMs: number

  // Consumer simulation
  consumerFailureRate: number         // 0-1, probability of delivery failure
  consumerSlowdownFactor: number      // multiplier for delivery time

  // Broker limits
  maxQueues: number
  maxConnections: number
  maxMessageSize: number
  memoryLimit: number                 // virtual memory usage
  diskLimit: number                   // virtual disk usage

  // Rate limiting
  publishRateLimit: number            // msgs/sec
  deliveryRateLimit: number           // msgs/sec

  // Failure injection
  queueDownSet: Set<string>           // queues that reject operations
  exchangeDownSet: Set<string>        // exchanges that reject publishes
  networkPartitioned: boolean         // all operations fail

  // Time
  virtualTime: number
  timeCoefficient: number
}
```

### 13.2 Simulation Scenarios

| Scenario | Hook Point | Sim Action |
|----------|-----------|------------|
| Slow publish | IBI: `publish` | Pre: delay |
| Publish rejected (queue full) | IBI: `publish` | Pre: fail with channel error |
| Slow delivery | OBI: `delivery` | Pre: delay |
| Consumer crash | OBI: `delivery` | Pre: fail (simulate connection drop) |
| Message TTL with virtual time | OBI: `time` | Short_circuit: return virtual time |
| Queue overflow (virtual 1M msgs) | IBI: `publish` | Pre: fail or apply overflow policy based on virtual queue depth |
| Dead letter routing | IBI: `nack` | Post: verify DLX routing |
| Network partition | All IBI | Pre: fail with connection error |
| Broker memory alarm | IBI: `publish` | Pre: fail with "memory alarm" error |
| Slow disk | OBI: `persist` | Pre: delay |
| Redelivery storm | OBI: `delivery` | Post: transform (set redelivered=true) |
| Priority starvation | OBI: `delivery` | Pre: delay low-priority, continue high-priority |
| Confirm delay | IBI: `publish` | Post: delay (simulate slow persistence) |

### 13.3 Interaction with Laws

RabbitSim emits signals for Laws:

```typescript
// Signals emitted by RabbitSim
interface RabbitSimSignals {
  messagePublished: Signal<{ exchange: string; queue: string; size: number }>
  messageDelivered: Signal<{ queue: string; consumerTag: string }>
  messageAcked: Signal<{ queue: string; deliveryTag: number }>
  messageNacked: Signal<{ queue: string; requeue: boolean }>
  queueDepthChanged: Signal<{ queue: string; depth: number }>
  consumerAdded: Signal<{ queue: string; consumerTag: string }>
  consumerRemoved: Signal<{ queue: string; consumerTag: string }>
}
```

Example Laws:

- **CpuContentionLaw**: PGSim + RabbitSim → high DB load slows message processing
- **BackpressureLaw**: RabbitSim → queue depth > threshold triggers producer slowdown signal to NodeSim
- **CascadingFailureLaw**: RabbitSim queue down → upstream producers backlog → NodeSim memory pressure

---

## 14. Implementation Strategy

### 14.1 Phased Approach

**Phase 1: Core Eng + Programmatic API**
- Exchange routing (direct, fanout, topic, headers)
- Queue storage (FIFO, basic properties)
- Consumer dispatch (round-robin, prefetch)
- Ack/nack/reject with requeue
- basic.recover (requeue all unacked)
- basic.get (polling)
- Passive declares (checkExchange, checkQueue)
- Mandatory messages + basic.return
- Basic message properties
- AMQP error model (typed errors with correct codes)
- Channel/connection lifecycle
- SBS hooks on all boundaries (27 hook points)

**Phase 2: Advanced Broker Features**
- Dead letter exchanges (with x-death headers, cycle detection)
- Message TTL + queue TTL + queue expiry (x-expires)
- Queue overflow policies (drop-head, reject-publish, reject-publish-dlx)
- Priority queues
- Publisher confirms (confirm.select, delivery tags)
- Alternate exchanges
- Exchange-to-exchange bindings
- Single active consumer
- Consumer cancellation notifications
- Auto-delete exchanges and queues

**Phase 3: Adapters**
- amqplib-compatible adapter (Option B)
- STOMP-over-WS adapter (for browser)

**Phase 4: Wire Protocol (if needed)**
- AMQP 0-9-1 binary protocol parser
- TCP server listener

### 14.2 Package Structure

```
rabbit-sbi      — SBI type definitions (contexts, hooks)
rabbit-box       — RabbitBox (Eng + SBI hooks)
rabbit-sim       — RabbitSim (behavior simulation)
rabbit-amqplib   — amqplib-compatible adapter
rabbit-stomp     — STOMP-over-WS adapter (optional)
```

### 14.3 Testing Strategy

1. **Unit tests for Eng**: exchange routing correctness, consumer dispatch, ack tracking
2. **SBS integration tests**: hook interception, pre/post decisions (mirror KVBox test patterns)
3. **Compatibility tests**: run against amqplib test expectations
4. **Sim scenario tests**: validate each simulation scenario from section 12.2

---

## 15. Open Questions

### Resolved by This Research

1. **Can we build an in-memory broker?** → Yes, ~1200 lines of core logic. Domain is simpler than SQL.
2. **Cross-platform?** → Yes, pure TS Eng works everywhere. Adapters per runtime.
3. **Browser support?** → Yes via programmatic API. STOMP adapter for protocol access.
4. **What to hook?** → 21 IBI + 6 OBI = 27 hook points defined.
5. **Wire protocol needed?** → No for in-process boxing. Programmatic API + adapters sufficient.
6. **Exchange-to-exchange bindings** → Supported by RabbitMQ, cycle-safe. Low priority but needed for parity. Phase 2.
7. **Error model** → Fully documented. 18 reply codes, clear channel vs connection error split. Channel errors = typed exceptions + channel close. Connection errors = connection + all channels close.
8. **basic.recover** → Always requeues (RabbitMQ ignores `requeue=false`). Added to IBI hooks.
9. **basic.return** → Sent for unroutable mandatory messages, before publisher confirm. Added as OBI hook.
10. **Passive declares** → Read-only existence checks. 404 on missing. Added to IBI hooks.
11. **Publisher confirms lifecycle** → confirm.select is irreversible, mutually exclusive with transactions. Delivery tags start at 1. nack only on internal Erlang process crash.
12. **DLX cycle detection** → No numeric limit. Cycle = message already visited target queue with all-automatic reasons. `rejected` breaks cycles intentionally. Verified against source code.

### Open for Future Decision

1. **Virtual host support** — needed for multi-tenant simulation? (Likely not in Phase 1)
2. **Quorum queue semantics** — delivery limits are useful for Sim. How deep to emulate?
3. **Streams** — append-only log semantics, consumer offsets. Fundamentally different from queues. Defer?
4. **Transaction support** (tx.select/commit/rollback) — rarely used in practice, mutually exclusive with confirms. Defer?
5. **amqplib adapter completeness** — full API parity or just the commonly used subset?
6. **Message ordering guarantees** — AMQP guarantees ordering per channel per queue. How strict in Eng?
7. **Consumer priorities** — RabbitMQ extension allowing higher-priority consumers to receive messages first. Implement in Phase 2?
8. **Direct reply-to** — RabbitMQ extension for RPC without declaring reply queues. Evaluate need.

---

[← Back](../README.md)
