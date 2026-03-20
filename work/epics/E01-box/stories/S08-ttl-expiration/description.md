# S08: TTL & Expiration

**Status:** done

Implement message TTL (per-queue and per-message) and queue expiry with exact RabbitMQ semantics.

## Scope

- Per-queue message TTL via x-message-ttl argument
- Per-message TTL via expiration property
- Lazy expiry on dequeue (not timer-based for initial implementation)
- Queue expiry (x-expires) — delete idle queues
- TTL of 0: messages expire immediately unless delivered directly to a consumer

## Dependencies

- S03: queue storage, message storage
- S05: OBI time and timer hooks
- S07: DLX routing (TTL expiry triggers dead-lettering with reason "expired")

---

[← Back](README.md)
