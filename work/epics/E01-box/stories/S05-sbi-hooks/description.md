# S05: SBI Hook System

**Status:** done

Implement the SimBox Standard (SBS) hook system with all 27 hook points — 21 inbound (IBI) and 6 outbound (OBI).

## Scope

- SBI type definitions in rabbit-sbi package
- IBI hooks wired into every eng operation (pre/post phases)
- OBI hooks for external dependencies (time, timers, random, delivery, return, persist)
- Default pass-through behavior when no hooks registered

## Dependencies

- S01: domain types
- S02–S04: eng modules to hook into

---

[← Back](README.md)
