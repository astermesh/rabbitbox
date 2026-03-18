# T01: Connection & Channel Lifecycle

**Status:** done

Implement the in-process connection and channel model.

## Scope

- `Connection`:
  - Factory: `createConnection()` → Connection
  - `createChannel()` → Channel (with unique channel ID)
  - `close()` — close all channels, clean up exclusive queues, requeue unacked messages
  - Error event: connection-level errors close all channels
  - Track owned channels and exclusive queues
- `Channel`:
  - State machine: `open` → `closing` → `closed`
  - Channel-scoped delivery tag sequence (starts at 1, increments per delivery)
  - `close()` — cancel all consumers, requeue unacked messages, remove from connection
  - Channel error: closes this channel only, other channels unaffected
  - Operations on closed channel → throw error
- Error propagation:
  - Channel error → channel closed, connection stays open
  - Connection error → connection + all channels closed
- `channel.flow` support: pause/resume content delivery on a channel

## Inputs

- S01 types, error model

## Outputs

- `packages/rabbit-box/src/connection.ts`, `packages/rabbit-box/src/channel.ts`
- Unit tests: create/close lifecycle, error propagation, closed-channel rejection

## Key Constraints

- Channel close must requeue all unacked messages (same as RabbitMQ)
- Connection close must delete exclusive queues owned by that connection
- Delivery tags are per-channel, not global

---

[← Back](../README.md)
