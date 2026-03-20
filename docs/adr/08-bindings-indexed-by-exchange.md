# 08: Bindings Indexed by Exchange

## Status

Accepted

## Context

Bindings connect exchanges to queues (and exchanges to exchanges). The primary access pattern is: given an exchange name during publish, find all its bindings to determine routing targets. A secondary access pattern is: given a queue name, find all its bindings (for cleanup on queue delete).

## Decision

`BindingStore` indexes bindings in a `Map<string, Binding[]>` keyed by source exchange name. The primary lookup `getBindings(exchange)` is O(1). The secondary lookup `getBindingsForQueue(queue)` iterates all exchange lists — O(total bindings).

## Alternatives Considered

- **Doubly-indexed** (by exchange and by queue) — faster queue lookup but more memory and update complexity
- **Flat array** with full scan — O(n) on publish path where n is all bindings across all exchanges
- **Indexed by (exchange, routingKey) tuple** — complicates wildcard matching for topic exchanges

## Consequences

- Publish path (hot) is O(1) map lookup + O(k) scan where k is bindings for that exchange
- Queue cleanup path (cold) is O(n) — acceptable since it runs only on queue delete
- Simple data structure, easy to reason about

---

[← Back](README.md)
