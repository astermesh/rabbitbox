# Eng Options Survey: In-Memory RabbitMQ Emulator

Detailed survey of existing JS/TS libraries, AMQP server implementations, and protocol resources relevant to building the RabbitBox Eng. Supplements [boxing-analysis.md](boxing-analysis.md) with specific library evaluations and implementation details.

## Table of Contents

- [1. Existing Mock Libraries (npm)](#1-existing-mock-libraries-npm)
- [2. AMQP Server Implementations in JS/TS](#2-amqp-server-implementations-in-jsts)
- [3. AMQP Protocol Parsing Resources](#3-amqp-protocol-parsing-resources)
- [4. Topic Exchange Algorithm Detail](#4-topic-exchange-algorithm-detail)
- [5. Headers Exchange x-match Modes](#5-headers-exchange-x-match-modes)
- [6. Consumer Semantics Deep Dive](#6-consumer-semantics-deep-dive)
- [7. Dead Letter Exchange Edge Cases](#7-dead-letter-exchange-edge-cases)
- [8. Build vs Reuse Conclusion](#8-build-vs-reuse-conclusion)

---

## 1. Existing Mock Libraries (npm)

### @onify/fake-amqplib (Best Available)

- **npm**: https://www.npmjs.com/package/@onify/fake-amqplib
- **GitHub**: https://github.com/onify/fake-amqplib
- **Version**: 3.2.0 | **License**: MIT | **Size**: ~55 kB
- **Maintenance**: Active (last release < 1 year, 2 maintainers)

**API coverage**: Full amqplib channel surface -- `assertExchange`, `deleteExchange`, `checkExchange`, `bindExchange`, `unbindExchange`, `assertQueue`, `deleteQueue`, `checkQueue`, `bindQueue`, `unbindQueue`, `purgeQueue`, `publish`, `sendToQueue`, `consume`, `cancel`, `get`, `ack`, `ackAll`, `nack`, `nackAll`, `reject`, `prefetch`.

**Special features**: RabbitMQ version simulation via `setVersion(minor)` (default 3.5). Supports both CJS and ESM. Can be injected via `mock-require` or `quibble`.

**Known issues**:
- `channel.publish()` return type inconsistent with real amqplib (returns `undefined` vs `boolean`)
- `assertQueue(undefined)` behaves differently from real amqplib

**What's unclear**: Depth of exchange routing emulation (topic pattern matching correctness, headers exchange support, dead letter routing, TTL handling). Documentation focuses on API shape, not behavioral accuracy.

**Verdict for Eng**: Not suitable as-is. It's a test mock optimized for API shape fidelity, not behavioral accuracy. Would need deep audit and likely major rewrite to serve as an Eng. MIT license allows forking, but the internal architecture may not support SBI hookability.

### mock-amqplib

- **npm**: https://www.npmjs.com/package/mock-amqplib
- **GitHub**: https://github.com/mkls/mock-amqplib
- **Version**: 1.8.2 | **Downloads**: ~2,268/week | **Stars**: 18
- **Maintenance**: Inactive (no releases in 12+ months)

Author states: "I implemented whatever was necessary to use it in the app I'm currently developing, so parts are missing." Acknowledges competing libraries exist and none are complete.

**Verdict for Eng**: Too incomplete and unmaintained. Partial implementation with unknown gaps.

### amqplib-mocks

- **npm**: https://www.npmjs.com/package/amqplib-mocks
- **GitHub**: https://github.com/Bunk/amqplib-mocks

Simple mocking framework. Used with `proxyquire`. Minimal behavioral emulation.

**Verdict for Eng**: Pure mock, not an emulator.

### amqplib-mock

- **npm**: https://www.npmjs.com/package/amqplib-mock
- **Version**: 0.0.5 | Last published 7 years ago

Callback and promise API support. Stale.

**Verdict for Eng**: Abandoned.

### Libraries targeting old `node-amqp` (not amqplib)

These target the deprecated `node-amqp` library, not the current `amqplib`:

| Library | npm | Status | Notes |
|---------|-----|--------|-------|
| fake-amqp | https://www.npmjs.com/package/fake-amqp | Unknown | In-memory AMQP simulation |
| exp-fake-amqp | https://github.com/ExpressenAB/exp-fake-amqp | Unknown | AMQP stub for tests |
| amqp-mock | https://www.npmjs.com/package/amqp-mock | Abandoned (12 years) | nock-inspired |

**Verdict for Eng**: Wrong target API. `node-amqp` is unmaintained; `amqplib` is the standard.

### Ecosystem Conclusion

No existing npm package implements a behaviorally accurate in-memory RabbitMQ broker. Every library is a test mock designed to avoid needing a running broker, not to faithfully reproduce routing, consumer dispatch, TTL, dead-lettering, or prefetch semantics. The community perspective (from RabbitMQ mailing list) is that "mocked-only tests are a terrible idea" and real integration tests with Docker are preferred -- which validates the need for a better solution that's fast like mocks but correct like real brokers.

---

## 2. AMQP Server Implementations in JS/TS

### simple-amqp-server (Only JS/TS AMQP Server Found)

- **GitHub**: https://github.com/Thomas-B/simple-amqp-server
- **npm**: https://www.npmjs.com/package/simple-amqp-server
- **Version**: 0.0.7 (April 2021) | **Language**: 100% TypeScript
- **Stars**: 8 | **Forks**: 5 | **Commits**: 50

Purpose: "provide a simple way to spawn up an AMQP server for automated tests." Warning: "Do not try to use this server as a real message broker."

**Missing (from their TODO)**: tests insufficient, no server-to-queue event pushing, no publish confirmation.

**Architecture significance**: This is the only project found that implements the server side of AMQP 0-9-1 in JS/TS -- accepting TCP connections, parsing binary frames, performing the connection handshake. It proves binary protocol parsing is feasible in TypeScript, but the broker logic is minimal.

**Verdict for Eng**: Interesting reference for protocol parsing code, but: (a) too incomplete, (b) dormant, (c) TCP server approach is unnecessary for in-process boxing. Not usable as a foundation.

### LavinMQ (Crystal -- reference only)

- **GitHub**: https://github.com/cloudamqp/lavinmq
- **Language**: Crystal (compiled, Ruby-like syntax)
- **Performance**: ~600K msgs/sec on single node, 100K queues in ~100 MB RAM

Built by CloudAMQP, the largest RabbitMQ hosting provider. Implements AMQP 0-9-1 plus MQTT. Clean, modern codebase. Not usable directly (wrong language) but architecturally relevant as a reference for how a production broker implements exchange routing, queue management, and consumer dispatch.

---

## 3. AMQP Protocol Parsing Resources

No standalone AMQP 0-9-1 protocol parsing library exists for JS/TS. All parsing code is embedded in client or server implementations:

| Library | Parsing Approach | LOC | Reusability |
|---------|-----------------|-----|-------------|
| **@cloudamqp/amqp-client** | DataView-based, browser-compatible | ~1,743 total | Best: zero deps, cleanest code |
| **amqplib** | Buffer-based, Node.js specific | Large | Mature but deeply coupled to client role |
| **ts-amqp** | Node streams-based | Medium | TypeScript, heavy Node dependency |
| **simple-amqp-server** | Server-side TypeScript | Small | Only server-side parser, incomplete |

For RabbitBox, protocol parsing is only needed if we build a TCP wire protocol server (Phase 4). For the programmatic API approach (Phase 1-3), no protocol parsing is required.

---

## 4. Topic Exchange Algorithm Detail

RabbitMQ uses a **trie data structure** for topic matching. The algorithm is documented in the [RabbitMQ blog](https://www.rabbitmq.com/blog/2010/09/14/very-fast-and-scalable-topic-routing-part-1) and [Erlang Solutions analysis](https://www.erlang-solutions.com/blog/rabbits-anatomy-understanding-topic-exchanges/).

### Algorithm

1. Binding patterns are stored as paths in a trie, split by `.` delimiter
2. Each node in the trie represents a word in the pattern
3. Special nodes for `*` and `#` wildcards
4. To match a routing key (e.g., `a.d.d.d.c`), traverse from root word-by-word
5. At each node, explore three branches: exact match, `*` match, `#` match
6. For `#`, explore all tail suffixes (backtracking): `d.d.d.c`, `d.d.c`, `d.c`, `c`, `""`

### RabbitMQ evaluated two approaches:

**Trie (chosen)**: Good size complexity, cheap to add bindings, easiest to implement. Downside: backtracks for `*` and `#`.

**DFA (rejected)**: No backtracking once built, but: significantly more memory, expensive to add bindings (entire DFA must be rebuilt), more complex to implement.

### Simple implementation for emulator

For an in-memory emulator with moderate binding counts, a recursive function is simpler than a full trie:

```
function topicMatch(routingKey: string, pattern: string): boolean
  - Split both by '.'
  - Walk word by word
  - '#' at end: always matches
  - '#' in middle: try matching rest with all suffixes
  - '*': match exactly one word
  - Otherwise: exact string comparison
```

Performance is less critical in an emulator than correctness. A simple recursive matcher handles the common case well. A trie can be added later if binding counts grow large.

---

## 5. Headers Exchange x-match Modes

The headers exchange supports **four** `x-match` modes (not just two as commonly documented):

| Mode | Behavior |
|------|----------|
| `all` (default) | All specified headers must match. Headers starting with `x-` are excluded from comparison |
| `any` | At least one header must match. Headers starting with `x-` are excluded |
| `all-with-x` | All specified headers must match. Headers starting with `x-` ARE included |
| `any-with-x` | At least one header must match. Headers starting with `x-` ARE included |

The `x-` prefix exclusion matters for routing dead-lettered messages by their `x-death` header content. Using `all-with-x` or `any-with-x` allows routing based on death reason, source queue, etc.

**Implementation note**: The binding arguments (minus `x-match` itself) form the comparison set. For each binding argument key-value pair, check if the message headers contain a matching key with equal value.

---

## 6. Consumer Semantics Deep Dive

### basic.consume vs basic.get

| Aspect | basic.consume (push) | basic.get (pull) |
|--------|---------------------|-----------------|
| Model | Broker pushes messages | Client polls for one message |
| Prefetch | Respected | Not affected by prefetch |
| Performance | High throughput | Very inefficient, discouraged |
| Connection | Long-lived consumer | Per-request poll |
| Auto-ack | Configurable | Configurable |

### Prefetch semantics

- Value = max unacknowledged messages per consumer (per-consumer since RabbitMQ 3.3.0)
- `global=true` flag: per-channel instead of per-consumer
- Value of 0 = unlimited
- Prefetch has no effect on `basic.get`
- When limit reached, broker stops delivering to that consumer but may deliver to others on the same queue

### Requeue behavior

- Requeued messages go back to **original position** when possible (since RabbitMQ 2.7.0)
- If original position cannot be maintained (concurrent deliveries), placed closer to queue head
- Requeued messages may be immediately redelivered, creating requeue/redelivery loops
- All unacked messages are requeued when channel/connection closes

### Redelivery flag

- Messages redelivered after nack/reject/channel-close get `redelivered: true` (called `redeliver` in protocol)
- First delivery: `redelivered: false`
- This allows consumers to detect redeliveries and handle idempotently

### Duplicate ack/nack

- Acking the same `deliveryTag` twice causes a channel error (`PRECONDITION_FAILED`)
- Acking on a different channel than where delivery was received causes a channel error
- Unknown delivery tag causes a channel error

### No built-in ack timeout

RabbitMQ does not have a built-in timeout for acking messages. If a consumer is alive (connection intact) but stops processing, unacked messages remain unacked indefinitely.

---

## 7. Dead Letter Exchange Edge Cases

### x-death header structure

Each dead-lettered message gets an `x-death` array in its headers. Each entry contains:

| Field | Value |
|-------|-------|
| `queue` | Source queue name |
| `reason` | `rejected`, `expired`, or `maxlen` |
| `time` | Timestamp of dead-lettering |
| `exchange` | Exchange the message was published to |
| `routing-keys` | Original routing keys (array) |
| `count` | Number of times dead-lettered for this reason from this queue |
| `original-expiration` | Only if dead-lettered due to per-message TTL |

### TTL removal on dead-letter

The `expiration` property is **removed** from dead-lettered messages to prevent them from expiring again in the DLX target queue.

### Dead-letter routing loops

- If Queue A dead-letters to Queue B, and Queue B dead-letters to Queue A, a loop forms
- RabbitMQ detects these loops
- Messages can cycle between queues a maximum of **16 times**
- After 16 cycles, if no rejection event occurs within the loop, TTL is disabled on the affected messages to prevent infinite routing

### Queue expiry vs message dead-lettering

If an entire queue expires (via `x-expires`), messages in the queue are **not** dead-lettered. They are silently discarded.

### At-least-once dead lettering (RabbitMQ 3.10+)

Traditional dead-lettering is at-most-once (fire-and-forget internally). Quorum queues support at-least-once dead lettering which guarantees delivery to DLX target queues. Requires `x-overflow: reject-publish` as prerequisite.

**For emulator**: at-most-once is sufficient for Phase 1. In-memory delivery is inherently reliable, so the distinction is less meaningful.

---

## 8. Build vs Reuse Conclusion

### Why build from scratch (confirmed)

The main research document concluded "build from scratch" is the right approach. This survey confirms that conclusion with additional evidence:

1. **No existing library implements real broker behavior** -- all are API mocks, not behavioral emulators
2. **The most complete mock (@onify/fake-amqplib)** focuses on API shape, not routing correctness
3. **The only AMQP server in JS/TS (simple-amqp-server)** is dormant and far from complete
4. **The community consensus** is that mocks are inadequate for real testing -- which is exactly the gap RabbitBox fills
5. **SBI hookability requires internal access** -- wrapping an opaque mock doesn't give us the hook points we need

### What to reference during implementation

| Resource | Use For |
|----------|---------|
| @onify/fake-amqplib source | amqplib API surface details, return types, event patterns |
| @cloudamqp/amqp-client source | Clean AMQP frame structure understanding |
| LavinMQ source (Crystal) | Production broker architecture patterns |
| RabbitMQ docs | Canonical behavior specification |
| amqplib type definitions (`@types/amqplib`) | TypeScript interface definitions for the adapter layer |

---

## Sources

- [@onify/fake-amqplib (GitHub)](https://github.com/onify/fake-amqplib)
- [@onify/fake-amqplib (npm)](https://www.npmjs.com/package/@onify/fake-amqplib)
- [mock-amqplib (GitHub)](https://github.com/mkls/mock-amqplib)
- [mock-amqplib (npm)](https://www.npmjs.com/package/mock-amqplib)
- [simple-amqp-server (GitHub)](https://github.com/Thomas-B/simple-amqp-server)
- [@cloudamqp/amqp-client.js (GitHub)](https://github.com/cloudamqp/amqp-client.js)
- [ts-amqp (GitHub)](https://github.com/martianboy/ts-amqp)
- [LavinMQ (GitHub)](https://github.com/cloudamqp/lavinmq)
- [RabbitMQ topic routing blog](https://www.rabbitmq.com/blog/2010/09/14/very-fast-and-scalable-topic-routing-part-1)
- [Erlang Solutions: Understanding topic exchanges](https://www.erlang-solutions.com/blog/rabbits-anatomy-understanding-topic-exchanges/)
- [RabbitMQ Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx)
- [RabbitMQ Consumer Acknowledgements](https://www.rabbitmq.com/docs/confirms)
- [RabbitMQ Broker Semantics](https://www.rabbitmq.com/docs/semantics)
- [RabbitMQ Queues](https://www.rabbitmq.com/docs/queues)
- [RabbitMQ Consumers](https://www.rabbitmq.com/docs/consumers)
- [RabbitMQ Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues)
- [RabbitMQ HTTP API Reference](https://www.rabbitmq.com/docs/http-api-reference)
- [AMQP frame structure (Brian Storti)](https://www.brianstorti.com/speaking-rabbit-amqps-frame-structure/)
- [AMQP 0-9-1 protocol (LavinMQ blog)](https://lavinmq.com/blog/the-amqp-091-protocol)
- [amqplib Channel API reference](https://amqp-node.github.io/amqplib/channel_api.html)
- [RabbitMQ at-least-once dead lettering](https://www.rabbitmq.com/blog/2022/03/29/at-least-once-dead-lettering)
- [Headers exchange (OneUptime)](https://oneuptime.com/blog/post/2026-01-30-rabbitmq-headers-exchange/view)

---

[← Back](README.md)
