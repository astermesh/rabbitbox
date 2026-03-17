# S01: Project Scaffold & Domain Model

Set up the monorepo package structure and define the core domain types that all subsequent stories depend on. Includes AMQP error model with exact RabbitMQ error codes and messages.

## Scope

- Package structure: `rabbit-sbi` (SBI type definitions), `rabbit-box` (eng + hooks)
- TypeScript project references, tsup build, vitest workspace, eslint config
- Core domain types: Exchange, Queue, BrokerMessage, Consumer, Binding, MessageProperties, DeliveredMessage
- AMQP error model: 18 reply codes, channel vs connection error split, typed exceptions matching real RabbitMQ

## Dependencies

None — this is the foundation story.

---

[← Back](README.md)
