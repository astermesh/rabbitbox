# S04: Channels, Consumers & Acknowledgments

**Status:** done

Implement the connection/channel lifecycle, consumer management with round-robin dispatch, acknowledgment tracking, and polling operations.

## Scope

- Connection and channel lifecycle with error propagation
- Consumer registration, cancellation, round-robin dispatch with prefetch
- Ack/nack/reject with requeue and delivery tag tracking
- basic.get (polling), basic.recover, passive declares

## Dependencies

- S01: domain types, error model
- S02: exchange routing (for passive declares)
- S03: queue storage, publish pipeline

---

[← Back](README.md)
