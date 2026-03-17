# T03: AMQP Error Model

**Status:** done

Implement the AMQP 0-9-1 error model with exact RabbitMQ error codes, messages, and channel/connection error classification.

## Scope

- `AmqpError` base class with replyCode, replyText, classId, methodId
- `ChannelError` subclass — closes only the affected channel
- `ConnectionError` subclass — closes the connection and all channels
- All 18 AMQP reply codes as constants:
  - Channel errors: CONTENT_TOO_LARGE (311), NO_ROUTE (312), NO_CONSUMERS (313), ACCESS_REFUSED (403), NOT_FOUND (404), RESOURCE_LOCKED (405), PRECONDITION_FAILED (406)
  - Connection errors: CONNECTION_FORCED (320), INVALID_PATH (402), FRAME_ERROR (501), SYNTAX_ERROR (502), COMMAND_INVALID (503), CHANNEL_ERROR (504), UNEXPECTED_FRAME (505), RESOURCE_ERROR (506), NOT_ALLOWED (530), NOT_IMPLEMENTED (540), INTERNAL_ERROR (541)
- Typed factory functions: `channelError.notFound(what)`, `channelError.preconditionFailed(reason)`, etc.
- Error messages must match real RabbitMQ error text format

## Inputs

- Boxing analysis §4 (AMQP error model)
- Real RabbitMQ error messages (verify against RabbitMQ source or docs)

## Outputs

- `packages/rabbit-box/src/errors/` module
- Unit tests for error construction and classification

## Key Constraints

- Every error code, error text, and channel-vs-connection classification must match real RabbitMQ
- Factory functions should produce errors that include classId/methodId for the operation that caused them (e.g., queue.declare = classId 50, methodId 10)

---

[← Back](../README.md)
