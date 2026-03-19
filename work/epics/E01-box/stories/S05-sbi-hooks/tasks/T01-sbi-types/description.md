# T01: SBI Type Definitions

**Status:** done

Define all hook types in the rabbit-sbi package.

## Scope

- `Hook<Ctx, Result>` generic type with pre/post handler phases
- `SimDecision` types: `proceed`, `delay`, `fail`, `short_circuit`, `transform`
- Pre-hook handler: `(ctx: Ctx) => SimDecision | void`
- Post-hook handler: `(ctx: Ctx, result: Result) => Result | void`
- All 21 IBI hook context/result pairs:
  - Message ops: publish, consume, get, cancel
  - Ack ops: ack, nack, reject, recover
  - Topology: exchangeDeclare, checkExchange, exchangeDelete, exchangeBind, exchangeUnbind, queueDeclare, checkQueue, queueDelete, queueBind, queueUnbind, purge
  - QoS: prefetch
  - Mode: confirmSelect
- All 6 OBI hook context/result pairs:
  - time, timers, random, delivery, return, persist
- `RabbitInboundHooks` and `RabbitOutboundHooks` interfaces
- `RabbitHooks = RabbitInboundHooks & RabbitOutboundHooks`

## Inputs

- Boxing analysis §7-9 (IBI, OBI, SBI type definitions)

## Outputs

- `packages/rabbit-sbi/src/` type modules
- Exported from package entry point

## Key Constraints

- Pure types, zero runtime code in rabbit-sbi
- Context types use `readonly` for all fields (hooks observe, don't mutate directly)
- Meta fields provide operational context for Sim decision-making

---

[← Back](../README.md)
