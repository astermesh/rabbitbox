# T01: Auto-Delete Exchanges & Queues

Implement automatic deletion when last consumer/binding is removed.

## Scope

- Auto-delete queue (`autoDelete: true`):
  - Deleted when last consumer cancels or disconnects
  - NOT deleted on creation with zero consumers (only after having had at least one consumer)
  - Track "has had consumers" state
  - On delete: remove all bindings, discard messages (no DLX on auto-delete trigger)
- Auto-delete exchange (`autoDelete: true`):
  - Deleted when last binding (queue or E2E) is removed
  - NOT deleted on creation with zero bindings (only after having had at least one binding)
  - Track "has had bindings" state
- Deletion triggers cleanup (bindings, messages) same as explicit delete

## Inputs

- S04 consumer module (cancel/disconnect events), S02 binding management

## Outputs

- Auto-delete logic in consumer cancel path and binding remove path
- Unit tests: queue auto-deletes on last consumer cancel, not on creation, exchange auto-deletes on last unbind

## Key Constraints

- Auto-delete only triggers AFTER the entity has had at least one consumer/binding
- Must match RabbitMQ behavior: a freshly declared auto-delete queue with zero consumers stays alive

---

[← Back](../README.md)
