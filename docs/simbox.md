# Simbox

Overview of the Simbox domain model — Box perspective.

## Core Entities

| Entity | What it is |
|--------|-----------|
| **Box** | Hookable emulator of a real service (PGBox, NodeBox) |
| **Sim** | Per-Box behavior simulation — makes Box realistic |

Sim is always paired with a Box.

**Lab** — simulation environment. Holds Boxes and Sims. Pure container, no behavior.

## Interfaces

| Abbr | Full Name | Between | Purpose |
|------|-----------|---------|---------|
| **BI** | Box Interface | Consumer → Box | Public API of the Box |
| **IBI** | Inbound Box Interface | External calls → Box | Entry points (query, request) |
| **OBI** | Outbound Box Interface | Box → Dependencies | Exit points (time, fs, network) |
| **CBI** | Control Box Interface | Sim → Box engine | Direct engine access |
| **SBI** | Sim-Box Interface | Sim → Box | = H(IBI) + H(OBI) + CBI |

## Specification

**SBS** (Sim-Box Specification) — how Sim controls Box through hook boundaries. One primitive: Hook.

## Boxing Process

How Eng (execution core) becomes a Box:

```
1. Select Eng          → what executes operations (PGlite, Node.js runtime)
2. Map IBI points      → where external calls enter
3. Map OBI points      → where Eng calls out (time, fs, network)
4. Define CBI          → direct engine access for Sim
5. Apply SBS           → wrap every boundary with hooks
6. Verify parity       → Box without Sim = real service behavior
```

## Hook Types

```typescript
type AsyncHook<Ctx, T> = (ctx: Ctx, next: () => Promise<T>) => Promise<T>
type SyncHook<T> = (next: () => T) => T
```

AsyncHook — IBI and async OBI. SyncHook — WASM-boundary OBI (time, random).
