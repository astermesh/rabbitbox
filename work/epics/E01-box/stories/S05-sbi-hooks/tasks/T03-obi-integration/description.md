# T03: OBI Hook Integration

Wire 6 outbound hooks and provide default implementations.

## Scope

- `time` hook: all timestamp sources (message timestamp, TTL check, queue expiry, now)
  - Default: `Date.now()`
- `timers` hook: TTL expiry, queue expiry, delayed delivery, heartbeat scheduling
  - Default: `setTimeout` / `clearTimeout`
- `random` hook: consumer tag generation, server-generated queue names, message IDs
  - Default: `crypto.randomUUID()` (with fallback for environments without crypto)
- `delivery` hook: consumer message dispatch (the most important OBI point)
  - Default: call consumer callback directly (microtask scheduling)
- `return` hook: mandatory message return notification
  - Default: emit return event on channel
- `persist` hook: no-op for in-memory eng
  - Default: no-op
- Each OBI hook wraps external dependency access with hookable boundary
- Sim can short_circuit any OBI to inject virtual behavior (virtual time, deterministic random, etc.)

## Inputs

- S05T01 hook types, eng modules

## Outputs

- `packages/rabbit-box/src/obi/` modules (one per hook or grouped)
- Default implementations
- Tests: default behavior, hook override, short_circuit virtual time/random

## Key Constraints

- All external dependencies must go through OBI hooks (no direct Date.now() or Math.random() in eng)
- Default implementations must work cross-platform (Node, Deno, Bun, browser)
- delivery hook is on the critical path — must be efficient

---

[← Back](../README.md)
