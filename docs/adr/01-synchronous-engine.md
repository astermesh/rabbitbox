# 01: Synchronous Engine with Async API Wrapper

## Status

Accepted

## Context

RabbitBox is an in-memory AMQP broker emulator. All operations (routing, queue storage, acknowledgment) happen in-memory with no I/O. The public API must be compatible with amqplib, which returns Promises from most channel methods.

## Decision

The internal engine (Channel, registries, publish pipeline, dispatcher) is fully synchronous. The public API layer (ApiChannel, ApiConnection) wraps operations in async methods that immediately delegate to the synchronous engine without awaiting anything.

The one exception is consumer delivery scheduling, which uses `queueMicrotask` to defer callback invocation until after the current call stack completes.

## Alternatives Considered

- **Fully async engine** — adds overhead, complexity, and requires await chains through all routing/storage for no benefit (no I/O)
- **Fully synchronous public API** — breaks amqplib compatibility where methods return Promises
- **Generator-based cooperative scheduling** — unnecessary complexity for in-memory operations

## Consequences

- Engine logic is simple, deterministic, and easy to test
- No async overhead on the hot path (publish → route → enqueue → dispatch)
- The `delay` SimDecision from SBI is a no-op in synchronous mode — actual delay simulation would require an async engine variant
- Sim scenarios requiring real async behavior (network latency simulation) are not possible without restructuring

---

[← Back](README.md)
