# T02: IBI Hook Integration

**Status:** done

Wire all 21 inbound hooks into eng operations.

## Scope

- Hook runner: `runHooked(hookName, ctx, engFn)` — calls pre-hook, executes eng, calls post-hook
- Pre-hook decisions:
  - `proceed` (default): execute eng normally
  - `delay`: wait N ms, then execute
  - `fail`: throw specified error (simulate failure)
  - `short_circuit`: skip eng, return specified value
- Post-hook decisions:
  - `transform`: modify the result before returning
  - Default: return result unchanged
- Wire hooks into: publish, consume, get, cancel, ack, nack, reject, recover, exchangeDeclare, checkExchange, exchangeDelete, exchangeBind, exchangeUnbind, queueDeclare, checkQueue, queueDelete, queueBind, queueUnbind, purge, prefetch, confirmSelect
- Context population: fill meta fields from current eng state before passing to hook
- No-hook fast path: if no hook registered for an operation, skip hook machinery entirely

## Inputs

- S05T01 hook types, S02-S04 eng modules

## Outputs

- Hook runner in `packages/rabbit-box/src/hook-runner.ts`
- Integration into each eng operation
- Tests: pre-hook fail/short_circuit/delay, post-hook transform, no-hook pass-through

## Key Constraints

- Hook errors must not corrupt eng state (catch and propagate cleanly)
- Meta fields must be populated accurately (e.g., messageCount, consumerCount reflect current state)
- Performance: no-hook path must have near-zero overhead

---

[← Back](../README.md)
