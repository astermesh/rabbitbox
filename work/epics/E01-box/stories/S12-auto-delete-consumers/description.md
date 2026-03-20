# S12: Auto-Delete & Consumer Features

**Status:** done

Implement auto-delete behavior for exchanges and queues, single active consumer, and consumer cancellation notifications.

## Scope

- Auto-delete queues (on last consumer cancel) and exchanges (on last binding removal)
- Single active consumer queue option
- Consumer cancellation notifications
- Consumer priorities (x-priority on basic.consume)

## Dependencies

- S04: consumer management, channel model
- S02: binding management, exchange registry
- S03: queue registry

---

[← Back](README.md)
