# 09: Implicit Default Exchange Routing

## Status

Accepted

## Context

AMQP 0-9-1 defines the default exchange (`""`) with a protocol-level guarantee: every queue is implicitly bound with its own name as the routing key. These bindings cannot be removed or modified. The question is whether to store them as real `Binding` records or handle them as a special case.

## Decision

The default exchange routing is a special case in the publish pipeline. When `exchangeName === ''`, the routing key is used as a direct queue name lookup in `QueueRegistry` — `BindingStore` is not consulted. Implicit bindings are never stored.

## Alternatives Considered

- **Store implicit bindings** — auto-add a binding for every declared queue, auto-remove on queue delete. Works but pollutes `BindingStore` with bindings that are not part of the user-configurable data model and cannot be unbound
- **Treat default exchange like any other exchange** — adds complexity for a well-defined invariant

## Consequences

- Correctly reflects the AMQP protocol: implicit bindings are not visible via `listBindings` and cannot be unbound
- No stale binding cleanup needed when queues are created/deleted
- `BindingStore` only contains user-managed bindings
- The special case is isolated to one code path in `publish.ts`

---

[← Back](README.md)
