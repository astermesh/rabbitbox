# T01: Connection & Channel Adapter

**Status:** done

Implement the amqplib-compatible connection and channel wrapper.

## Scope

- `amqp.connect(url)` → Connection
  - URL parsed but host/port ignored (in-process)
  - Vhost extracted from URL path (optional)
  - Returns amqplib-compatible Connection object
- `Connection`:
  - `createChannel()` → Promise<Channel>
  - `createConfirmChannel()` → Promise<ConfirmChannel> (delegates to S13T04)
  - `close()` → Promise<void>
  - Events: `error`, `close`, `blocked`, `unblocked`
- `Channel`:
  - Wraps RabbitBox Channel with amqplib-compatible method signatures
  - Events: `error`, `close`, `return`, `drain`
  - `close()` → Promise<void>
- Package: `packages/rabbit-amqplib/` (separate package)
- TypeScript types match `@types/amqplib` interfaces

## Inputs

- S06 RabbitBox public API, amqplib type definitions

## Outputs

- `packages/rabbit-amqplib/src/connection.ts`, `channel.ts`
- Package entry point: `import amqp from 'rabbit-amqplib'`
- Unit tests: connect, create channel, close, events

## Key Constraints

- API signatures must match amqplib exactly (method names, parameter order, return types)
- `blocked`/`unblocked` events: emit but RabbitBox has no real flow control (always unblocked)
- URL parsing should handle common formats: amqp://user:pass@host:port/vhost

---

[← Back](../README.md)
