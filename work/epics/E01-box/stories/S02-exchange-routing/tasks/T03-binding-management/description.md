# T03: Binding Management

**Status:** done

Implement the queue-to-exchange binding store.

## Scope

- Binding store (per-exchange binding list)
- `addBinding(exchange, queue, routingKey, arguments)` — idempotent (duplicate binding is no-op). Validate exchange and queue exist (NOT_FOUND if missing)
- `removeBinding(exchange, queue, routingKey, arguments)` — no error if binding doesn't exist (idempotent)
- `getBindings(exchange)` — return all bindings for an exchange
- `getBindingsForQueue(queue)` — return all bindings for a queue (needed for queue deletion cleanup)
- Binding identity: (exchange, queue, routingKey, arguments) tuple — arguments compared by deep equality
- Default exchange: every queue is implicitly bound with routingKey = queue name (cannot be unbound)
- Cleanup: when queue deleted, remove all its bindings; when exchange deleted, remove all its bindings

## Inputs

- S02T01 exchange registry, S01 types

## Outputs

- `packages/rabbit-box/src/binding-store.ts`
- Unit tests: add/remove, idempotent add, default exchange implicit bindings, cleanup on delete

## Key Constraints

- Arguments deep comparison for binding identity (not reference equality)
- Implicit bindings on default exchange are not stored as explicit bindings — they are virtual

---

[← Back](../README.md)
