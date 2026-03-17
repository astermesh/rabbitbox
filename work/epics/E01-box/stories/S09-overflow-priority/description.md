# S09: Queue Overflow & Priority Queues

Implement queue overflow policies and priority queue support.

## Scope

- Max-length and max-length-bytes limits with three overflow strategies
- Priority queues with separate per-priority buckets

## Dependencies

- S03: message storage
- S04: consumer dispatch
- S07: DLX routing (overflow triggers dead-lettering with reason "maxlen")

---

[← Back](README.md)
