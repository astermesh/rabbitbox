# 04: AMQP Error Hierarchy with Factory Functions

## Status

Accepted

## Context

AMQP 0-9-1 defines two error severities: channel-level (soft error, closes only the channel) and connection-level (hard error, closes the entire connection). Each error carries a reply code, reply text, and the class/method ID that triggered it. RabbitMQ formats reply text as `"ERROR_NAME - detail message"`.

## Decision

Errors use a three-class hierarchy: `AmqpError` (base) → `ChannelError` / `ConnectionError`. Each error carries `replyCode`, `replyText`, `classId`, and `methodId`. Named factory functions (`channelError.notFound(...)`, `connectionError.notAllowed(...)`) construct errors with correct reply codes. Reply text format matches RabbitMQ exactly.

All AMQP reply codes are defined as named constants (e.g., `NOT_FOUND = 404`, `PRECONDITION_FAILED = 406`).

## Alternatives Considered

- **Single Error subclass with code property** — loses the channel/connection severity distinction at the type level
- **Error class per error code** — 20+ classes, no meaningful grouping
- **Numeric error codes only** — loses human-readable context, harder to debug
- **Error codes as enums** — less ergonomic than named constants for AMQP's flat code space

## Consequences

- Type system enforces the channel/connection error distinction — catch handlers can discriminate
- Factory functions ensure correct reply code and format at every throw site
- Every error response matches RabbitMQ's wire format exactly (reply code, text, class/method IDs)

---

[← Back](README.md)
