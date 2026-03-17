# T02: Exchange-to-Exchange Bindings

Implement exchange-to-exchange bindings with recursive routing.

## Scope

- `exchangeBind(destination, source, routingKey, arguments)`:
  - Bind destination exchange to source exchange
  - When messages route through source, also route to destination using binding's routingKey/arguments
  - Destination exchange then routes to its own bound queues/exchanges
- `exchangeUnbind(destination, source, routingKey, arguments)` — remove E2E binding
- Recursive routing:
  - Source routes → matches E2E binding → destination routes → may match more E2E bindings
  - Cycle protection: track visited exchanges per publish (Set<exchangeName>)
  - If cycle detected: skip already-visited exchange (don't error, just stop recursion)
- E2E bindings use same routing logic as queue bindings (same match by exchange type)
- E2E bindings stored alongside queue bindings in binding store

## Inputs

- S02 exchange routing + binding management, S03 publish pipeline

## Outputs

- E2E binding support in binding store and routing pipeline
- Unit tests: basic E2E routing, chain routing, cycle detection, mixed queue + E2E bindings

## Key Constraints

- Cycle protection per-publish (not global) — same exchange can be visited in different publishes
- E2E bindings respect the SOURCE exchange's type for matching (not destination)
- Must not break existing queue binding behavior

---

[← Back](../README.md)
