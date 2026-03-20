# 06: Flat Functions for Engine Operations

## Status

Accepted

## Context

Core engine operations (publish, ack, nack, reject, dead-letter, route) need access to multiple registries and callbacks. These operations could be organized as methods on a broker class or as standalone functions.

## Decision

Core operations are implemented as standalone exported functions that receive all dependencies via typed parameter objects:

- `publish(opts: PublishOptions)` — full publish pipeline
- `ack(channel, deliveryTag, multiple, deps, hook?)` — acknowledgment
- `nack(...)`, `reject(...)` — negative acknowledgment
- `deadLetter(...)` — dead-letter routing
- `route(...)` — exchange type matching (direct, fanout, topic, headers)

Each function declares its dependencies explicitly in its parameter type.

## Alternatives Considered

- **Broker class with methods** — creates a god class, harder to test individual operations, accidental coupling between methods via shared `this`
- **Module-level singletons** — incompatible with multiple concurrent `RabbitBox.create()` instances
- **Method injection via prototype** — not type-safe, hard to follow

## Consequences

- Each function is trivially testable — call with stubs, no class instantiation needed
- Functions are tree-shakeable
- Recursive calls are natural (e.g., `deadLetterPublish` calls `publish()` again for DLX routing)
- Dependencies are explicit in the type signature — no hidden state

---

[← Back](README.md)
