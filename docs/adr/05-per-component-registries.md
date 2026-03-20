# 05: Per-Component Registries

## Status

Accepted

## Context

The broker maintains state for exchanges, queues, bindings, consumers, and messages. This state must be organized in a way that allows independent testing, clear ownership, and avoids a god object.

## Decision

Broker state is split into five separate registry classes:

- `ExchangeRegistry` — exchange lifecycle (declare, delete, check, defaults)
- `QueueRegistry` — queue lifecycle with argument parsing (TTL, limits, overflow)
- `BindingStore` — binding management indexed by exchange
- `ConsumerRegistry` — consumer registration, exclusive enforcement, unacked tracking
- `MessageStore` — per-queue FIFO storage with TTL expiry and byte tracking (one instance per queue)

Cross-registry dependencies are resolved via injected callbacks (e.g., `ExchangeRegistry` receives a `bindingCount` callback that queries `BindingStore`), not direct imports.

## Alternatives Considered

- **Single BrokerState class** — god object with all operations, hard to test in isolation
- **Single store with typed accessors** — unclear ownership boundaries
- **Redux-style single atom** — unnecessary complexity for a synchronous system

## Consequences

- Each registry is independently testable with its own test file
- Circular references between registries are avoided via callback injection
- Composition root (`rabbit-box.ts`) explicitly wires all registries together
- `MessageStore` has a different lifecycle (lazy, per-queue) than the other registries (one per broker)

---

[← Back](README.md)
