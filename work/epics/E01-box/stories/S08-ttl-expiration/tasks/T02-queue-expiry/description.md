# T02: Queue Expiry

**Status:** done

Implement queue auto-deletion after idle timeout.

## Scope

- `x-expires` queue argument (milliseconds, must be positive integer)
- Queue deleted after N ms with no consumers AND no basic.get calls AND no re-declarations
- Timer reset on: consume, cancel (if consumers remain), get, queue declare (re-declare)
- On queue expiry:
  - Messages are NOT dead-lettered — silently discarded
  - Queue is deleted as if queue.delete was called
  - All bindings removed
- Timer managed through OBI timers hook (for virtual time support)
- Not supported for streams (out of scope, but note for future)

## Inputs

- S03 queue registry, S05 OBI timers hook

## Outputs

- Queue expiry logic in queue registry or separate module
- Unit tests: queue expires after timeout, timer reset on activity, messages not dead-lettered, positive-integer validation

## Key Constraints

- Messages in expired queues are NOT dead-lettered (this differs from message TTL expiry)
- Timer must reset on any qualifying activity
- Must use OBI timers hook (not direct setTimeout)

---

[← Back](../README.md)
