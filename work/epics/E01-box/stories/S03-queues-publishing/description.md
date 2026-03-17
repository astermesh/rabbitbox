# S03: Queues & Publishing Pipeline

Implement queue storage, message lifecycle, and the full publish-to-consume routing pipeline.

## Scope

- Queue registry: declare (with auto-generated names), delete, check, purge
- Per-queue FIFO message storage with enqueue/dequeue
- Full publish pipeline: exchange lookup → routing → queue enqueue → consumer dispatch trigger
- Mandatory message handling: basic.return if unroutable
- CC/BCC header support: sender-selected distribution to additional routing keys

## Dependencies

- S01: domain types, error model
- S02: exchange routing, bindings

---

[← Back](README.md)
