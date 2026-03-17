# S10: Publisher Confirms

Implement publisher confirm mode with delivery tag tracking, matching RabbitMQ's confirm semantics.

## Scope

- confirm.select channel mode
- Per-publish delivery tag sequence
- Ack/nack after publish completes
- Interaction with mandatory flag and basic.return

## Dependencies

- S04: channel model
- S03: publish pipeline

---

[← Back](README.md)
