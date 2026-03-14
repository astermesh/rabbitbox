# RabbitBox: Boxing RabbitMQ

Comprehensive research on boxing RabbitMQ into a SimBox-compatible Box. Covers AMQP 0-9-1 protocol internals, all input/output interfaces, Eng selection, cross-platform runtime analysis, and the boxing process applied step by step.

## Table of Contents

1. [Goal](#1-goal)
2. [AMQP 0-9-1 Protocol Overview](#2-amqp-0-9-1-protocol-overview)
3. [RabbitMQ Core Concepts](#3-rabbitmq-core-concepts)
4. [Boxing Process Applied](#4-boxing-process-applied)
5. [Eng Selection: In-Memory AMQP Broker](#5-eng-selection-in-memory-amqp-broker)
6. [IBI: Inbound Box Interface](#6-ibi-inbound-box-interface)
7. [OBI: Outbound Box Interface](#7-obi-outbound-box-interface)
8. [SBI: RabbitBox Hook Types](#8-sbi-rabbitbox-hook-types)
9. [Cross-Platform Analysis](#9-cross-platform-analysis)
10. [Client Libraries Landscape](#10-client-libraries-landscape)
11. [Management API Interface](#11-management-api-interface)
12. [RabbitSim Capabilities](#12-rabbitsim-capabilities)
13. [Implementation Strategy](#13-implementation-strategy)
14. [Open Questions](#14-open-questions)

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

### 3.9 Heartbeats

- Negotiated at connection time (`connection.tune`)
- Both sides send heartbeat frames at `interval/2` seconds
- Connection closed if no data received for `interval` seconds
- Detects dead TCP connections (half-open sockets)

### 3.10 Virtual Hosts

- Logical isolation: separate namespace for exchanges, queues, bindings, users
- Default vhost: `/`
- Users get permissions per vhost (configure, write, read — regex patterns)

---

## 4. Boxing Process Applied

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
| `exchangeDelete(name, opts)` | `exchange.delete` | Topology |
| `queueDeclare(name, opts)` | `queue.declare` | Topology |
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
| `purgeQueue(queue)` | `queue.purge` | Inbound |

### Step 3: Map IBI Points

IBI = where external calls enter the Box. These are operations that Src/Exp invoke:

```
                    IBI
Src / Exp ─────▶ ●─ publish ──────▶ ┌────────────────────────┐
                 ●─ consume ──────▶ │                        │
                 ●─ ack/nack ─────▶ │       Eng              │
                 ●─ get ──────────▶ │  (in-memory broker)    │
                 ●─ declareExch ──▶ │                        │
                 ●─ declareQueue ─▶ │  exchanges             │
                 ●─ bind ─────────▶ │  queues                │
                 ●─ unbind ───────▶ │  bindings              │
                 ●─ deleteExch ───▶ │  consumers             │
                 ●─ deleteQueue ──▶ │  unacked messages      │
                 ●─ prefetch ─────▶ │                        │
                 ●─ purge ────────▶ │                        │
                 ●─ cancel ───────▶ └────────────────────────┘
```

**Grouped by concern:**

| Group | IBI Hook Points | Sim Interest |
|-------|----------------|--------------|
| **Publishing** | `publish` | Latency, rate limiting, reject, confirm delay |
| **Consuming** | `consume`, `get`, `cancel` | Delivery delay, consumer failure, rebalance |
| **Acknowledgment** | `ack`, `nack`, `reject` | Ack delay, nack simulation, requeue behavior |
| **Topology** | `exchangeDeclare`, `exchangeDelete`, `queueDeclare`, `queueDelete`, `queueBind`, `queueUnbind`, `purge` | Topology validation, limit enforcement |
| **QoS** | `prefetch` | Prefetch simulation |

### Step 4: Map OBI Points

OBI = where Eng calls outward to OS/dependencies.

For an in-memory broker, outbound dependencies are minimal but critical:

| OBI Point | What Eng Calls | Sim Use |
|-----------|---------------|---------|
| **time** | `Date.now()` for message timestamps, TTL expiry checks, queue expiry, heartbeat tracking | Virtual time for TTL simulation, time-based expiry |
| **timers** | `setTimeout` / `setInterval` for delayed delivery, queue expiry checks, consumer timeout | Virtual timer management |
| **random** | Consumer tag generation, message ID generation | Deterministic IDs |
| **delivery** | Internal: message dispatch from queue to consumer callback | Delivery delay, consumer failure injection |
| **persist** | If persistence is added: writing messages/topology to storage | Disk I/O simulation |

**Key insight**: The `delivery` OBI point is unique to message brokers. When a message is routed to a queue and a consumer is ready, the broker internally dispatches the message to the consumer's callback. This is an outbound boundary — the broker "calls out" to deliver. Sim can intercept to:
- Add delivery delay
- Simulate consumer crash
- Simulate network partition between broker and consumer
- Simulate slow consumer

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
              ●─topology───▶ │                  │ ──persist─ ●
              ●─prefetch───▶ │  exchanges       │
              ●─purge──────▶ │  queues/bindings │
              ●─cancel─────▶ │  consumers       │
                              └──────────────────┘
              ● = SBI hook point (SBS applied)
```

---

## 5. Eng Selection: In-Memory AMQP Broker

### 5.1 What Eng Must Implement

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

### 5.2 Complexity Assessment

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

### 5.3 Existing Mocks Analysis

| Package | Downloads/wk | Last Updated | What It Does | Usable as Eng? |
|---------|-------------|-------------|--------------|----------------|
| `@onify/fake-amqplib` | ~2,000 | 2025 | API-compatible amqplib replacement for tests | ❌ Mocks API shape, no routing logic |
| `mock-amqplib` | ~500 | 2023 | Stubs for integration tests | ❌ No broker behavior |
| `amqplib-mock` | ~200 | old | Callback/promise mock | ❌ No broker behavior |
| `amqp-mock` | ~50 | 2013 | Inspired by nock | ❌ Abandoned, incompatible |

**Verdict**: None are usable as Eng. They mock the client API shape, not broker behavior. We need a real broker implementation that actually routes messages.

---

## 6. IBI: Inbound Box Interface

Full specification of every inbound hook point with context types:

### 6.1 publish

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

### 6.2 consume

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

### 6.3 ack / nack / reject

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

### 6.4 get (polling)

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

### 6.5 Topology Operations

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

### 6.6 prefetch

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

---

## 7. OBI: Outbound Box Interface

### 7.1 time

```typescript
interface TimeCtx {
  readonly source: 'message-timestamp' | 'ttl-check' | 'queue-expiry' | 'heartbeat' | 'now'
  readonly meta: Record<string, never>
}

type TimeResult = number  // ms timestamp
```

Used for: message `timestamp` property, TTL expiry calculations, queue auto-expiry, heartbeat intervals.

**Sim pattern**: short_circuit → return virtual time. Same as KVBox.

### 7.2 timers

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

### 7.3 random

```typescript
interface RandomCtx {
  readonly source: 'consumer-tag' | 'message-id' | 'queue-name'
  readonly meta: Record<string, never>
}

type RandomResult = string  // generated identifier
```

**Sim pattern**: short_circuit → return deterministic value from seed.

### 7.4 delivery

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

### 7.5 persist (optional)

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

## 8. SBI: RabbitBox Hook Types

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

  // Topology
  exchangeDeclare: Hook<ExchangeDeclareCtx, ExchangeDeclareResult>
  exchangeDelete: Hook<ExchangeDeleteCtx, ExchangeDeleteResult>
  queueDeclare: Hook<QueueDeclareCtx, QueueDeclareResult>
  queueDelete: Hook<QueueDeleteCtx, QueueDeleteResult>
  queueBind: Hook<QueueBindCtx, QueueBindResult>
  queueUnbind: Hook<QueueUnbindCtx, QueueUnbindResult>
  purge: Hook<PurgeCtx, PurgeResult>

  // QoS
  prefetch: Hook<PrefetchCtx, PrefetchResult>
}

interface RabbitOutboundHooks {
  time: Hook<TimeCtx, TimeResult>
  timers: Hook<TimerSetCtx, TimerSetResult>
  random: Hook<RandomCtx, RandomResult>
  delivery: Hook<DeliveryCtx, DeliveryResult>
  persist: Hook<PersistCtx, PersistResult>
}

type RabbitHooks = RabbitInboundHooks & RabbitOutboundHooks
```

**Hook count**: 14 IBI + 5 OBI = **19 hook points**

Compare: KVBox has 3 IBI + 2 OBI = 5 hooks. RabbitBox has ~4x the hook surface, reflecting the broker's richer interface.

---

## 9. Cross-Platform Analysis

### 9.1 Runtime Compatibility Matrix

RabbitBox's Eng is pure TypeScript with no native dependencies. The question is how Src connects to RabbitBox — what client library does Src use?

| Runtime | In-Process RabbitBox | Src Connection to RabbitBox |
|---------|---------------------|---------------------------|
| **Node.js** | ✅ Native | Direct API or amqplib-compatible adapter |
| **Deno** | ✅ Via npm compat | Direct API or deno-amqp adapter |
| **Bun** | ✅ Via npm compat | Direct API or amqplib-compatible adapter |
| **Browser** | ✅ Pure TS | Direct API or STOMP-over-WS adapter |

### 9.2 Connection Mode Options

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

### 9.3 Per-Runtime Details

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

### 9.4 Cross-Platform Summary

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

## 10. Client Libraries Landscape

### 10.1 Major Libraries

| Library | Protocol | Runtime | Weekly DL | Notes |
|---------|----------|---------|-----------|-------|
| **amqplib** | AMQP 0-9-1 over TCP | Node.js | ~937k | De facto standard. Raw TCP sockets. |
| **rabbitmq-client** | AMQP 0-9-1 over TCP | Node.js | Growing | Zero deps, TS-native, auto-reconnect. By cody-greene. |
| **@cloudamqp/amqp-client** | AMQP 0-9-1 over TCP + WS | Node.js + Browser | ~5k | TCP (Node) or WebSocket (browser). By CloudAMQP. |
| **@stomp/stompjs** | STOMP over WS | Node.js + Browser | ~338k | Browser-first. Needs `rabbitmq_web_stomp` plugin. |
| **deno-amqp** | AMQP 0-9-1 over TCP | Deno | N/A | Deno-native. Latest v0.24.0. |
| **amqplib-bun** | AMQP 0-9-1 over TCP | Bun | ~138 | Fork of amqplib for Bun compatibility. |

### 10.2 amqplib API Surface

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

### 10.3 @cloudamqp/amqp-client API

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

## 11. Management API Interface

RabbitMQ provides an HTTP management API (via `rabbitmq_management` plugin). RabbitBox should expose a compatible subset for admin/monitoring:

### 11.1 Core Endpoints

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

### 11.2 For RabbitBox

The management API is **not** part of the core BI (AMQP operations). It's an auxiliary interface for:

- **Exp** (test code) to inspect broker state without AMQP operations
- **Monitoring** tools compatibility
- **Topology import/export** (definitions endpoint)

Implementation priority: LOW. Programmatic inspection methods on the RabbitBox instance serve the same purpose for testing. HTTP management API is a nice-to-have for compatibility.

---

## 12. RabbitSim Capabilities

What RabbitSim can simulate via SBS hooks:

### 12.1 Virtual Domain State

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

### 12.2 Simulation Scenarios

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

### 12.3 Interaction with Laws

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

## 13. Implementation Strategy

### 13.1 Phased Approach

**Phase 1: Core Eng + Programmatic API**
- Exchange routing (direct, fanout, topic, headers)
- Queue storage (FIFO, basic properties)
- Consumer dispatch (round-robin, prefetch)
- Ack/nack/reject with requeue
- Basic message properties
- SBS hooks on all boundaries

**Phase 2: Advanced Broker Features**
- Dead letter exchanges
- Message TTL + queue TTL
- Queue overflow policies
- Priority queues
- Publisher confirms
- Alternate exchanges

**Phase 3: Adapters**
- amqplib-compatible adapter (Option B)
- STOMP-over-WS adapter (for browser)

**Phase 4: Wire Protocol (if needed)**
- AMQP 0-9-1 binary protocol parser
- TCP server listener

### 13.2 Package Structure

```
rabbit-sbi      — SBI type definitions (contexts, hooks)
rabbit-box       — RabbitBox (Eng + SBI hooks)
rabbit-sim       — RabbitSim (behavior simulation)
rabbit-amqplib   — amqplib-compatible adapter
rabbit-stomp     — STOMP-over-WS adapter (optional)
```

### 13.3 Testing Strategy

1. **Unit tests for Eng**: exchange routing correctness, consumer dispatch, ack tracking
2. **SBS integration tests**: hook interception, pre/post decisions (mirror KVBox test patterns)
3. **Compatibility tests**: run against amqplib test expectations
4. **Sim scenario tests**: validate each simulation scenario from section 12.2

---

## 14. Open Questions

### Resolved by This Research

1. **Can we build an in-memory broker?** → Yes, ~1200 lines of core logic. Domain is simpler than SQL.
2. **Cross-platform?** → Yes, pure TS Eng works everywhere. Adapters per runtime.
3. **Browser support?** → Yes via programmatic API. STOMP adapter for protocol access.
4. **What to hook?** → 14 IBI + 5 OBI = 19 hook points defined.
5. **Wire protocol needed?** → No for in-process boxing. Programmatic API + adapters sufficient.

### Open for Future Decision

1. **Exchange-to-exchange bindings** — implement in Phase 1 or defer? (Low usage in practice)
2. **Virtual host support** — needed for multi-tenant simulation? (Likely not in Phase 1)
3. **Quorum queue semantics** — delivery limits are useful for Sim. How deep to emulate?
4. **Streams** — append-only log semantics, consumer offsets. Fundamentally different from queues. Defer?
5. **Transaction support** (tx.select/commit/rollback) — rarely used in practice. Defer?
6. **Connection/channel lifecycle simulation** — simulate channel errors, connection drops at protocol level? Or handle at Sim level via hook failures?
7. **amqplib adapter completeness** — full API parity or just the commonly used subset?
8. **Message ordering guarantees** — AMQP guarantees ordering per channel per queue. How strict in Eng?

---

[← Back](../README.md)
