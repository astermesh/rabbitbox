# T01: Public API Surface

Design and implement the public-facing API for RabbitBox.

## Scope

- `RabbitBox.create(options?)` → Connection
  - Options: hooks (RabbitHooks), vhost (optional future use)
- `Connection`:
  - `createChannel()` → Channel
  - `close()` → Promise<void>
  - Events: `error`, `close`
- `Channel`:
  - Topology: `assertExchange`, `deleteExchange`, `checkExchange`, `assertQueue`, `deleteQueue`, `checkQueue`, `bindQueue`, `unbindQueue`, `purgeQueue`
  - Publishing: `publish(exchange, routingKey, content, options?)`, `sendToQueue(queue, content, options?)`
  - Consuming: `consume(queue, callback, options?)`, `cancel(consumerTag)`
  - Ack: `ack(message, allUpTo?)`, `nack(message, allUpTo?, requeue?)`, `reject(message, requeue?)`
  - Polling: `get(queue, options?)`
  - QoS: `prefetch(count, global?)`
  - Recovery: `recover()`
  - Flow: `flow(active)` — pause/resume content delivery
  - `close()` → Promise<void>
  - Events: `error`, `close`, `return`, `drain`
- Clean re-exports from `packages/rabbit-box/src/index.ts`
- Method signatures should feel familiar to amqplib users

## Inputs

- All eng modules (S01-S05)

## Outputs

- `packages/rabbit-box/src/api/` — public API wrappers
- Package entry point re-exports

## Key Constraints

- API must be clean and ergonomic for direct use (not just an adapter target)
- Content parameter accepts Uint8Array (cross-platform) — convenience string→Uint8Array conversion optional
- All operations return Promises (even if internally sync) for consistency
- Event emitter pattern for async notifications (error, close, return, delivery)

---

[← Back](../README.md)
