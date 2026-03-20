# T02: Single Active Consumer

**Status:** done

Implement the single active consumer queue option.

## Scope

- `x-single-active-consumer: true` queue argument
- Only one consumer receives messages at a time (the "active" consumer)
- Other consumers are registered but inactive (waiting)
- When active consumer cancels or disconnects:
  - Next registered consumer becomes active (FIFO order of registration)
  - Consumer activation notification event
- Active consumer respects prefetch normally
- If no consumers registered, messages accumulate in queue

## Inputs

- S04 consumer module

## Outputs

- SAC logic in consumer dispatch
- Unit tests: single consumer active, failover to next, registration order preserved, prefetch respected

## Key Constraints

- Consumer activation order must be deterministic (registration order)
- Inactive consumers must NOT receive any messages
- Failover must be immediate (no delay between active cancel and next activation)

---

[← Back](../README.md)
