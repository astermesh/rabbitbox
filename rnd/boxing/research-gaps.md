# Research Gaps for Planning Readiness

Audit of existing research against what is needed to begin implementation planning.

## Blockers

### G1: No Public API Design

The boxing analysis defines 19 hook points (IBI/OBI) and internal architecture, but the **user-facing programmatic API** is not designed. Questions unanswered:

- What does `import { ... } from 'rabbitbox'` expose?
- Is the API modeled after amqplib's channel pattern, or a higher-level broker pattern?
- How do users create/configure a broker instance?
- How does the programmatic API relate to the amqplib adapter (Phase 3)?

Without this, implementation tasks cannot be scoped.

### G2: SimBox/SBP Framework Dependency Unknown

The analysis references "SBP hooks", "SimBox", "Laws", "RabbitSim", "KVBox test patterns", "@simbox/rabbit-*" packages. But:

- Where does the SimBox framework live? Is it an existing codebase or yet to be built?
- Is RabbitBox standalone or does it require SimBox as a dependency?
- What are the SBP hook type definitions? Are they defined elsewhere or must be created here?
- Can Phase 1 proceed without the SimBox framework?

This determines whether RabbitBox can be built independently.

### G3: Behavioral Parity Test Strategy Undefined

The #1 project principle is "exact RabbitMQ behavioral parity." The testing strategy (section 13.3) has 4 bullet points but no concrete plan:

- No strategy for running tests against a real RabbitMQ instance for comparison
- No Docker-based comparison testing approach defined
- No catalog of edge-case behaviors to verify (the research documents many edge cases but doesn't convert them to test requirements)
- No decision on whether to use an existing RabbitMQ test suite as a reference

### G4: No ADRs Exist

`docs/adr/` is empty. Key architectural decisions need ADRs before implementation:

- Storage model (in-memory data structures for queues, exchanges, bindings)
- Package structure (monorepo vs single package — section 13.2 suggests 5 packages)
- Public API style (channel-based vs broker-based)
- Cross-platform boundary (what APIs are allowed in core?)

## Important Gaps

### G5: Error Code and Message Catalog

**Partially resolved.** [State Machines](amqp/state-machines.md) now documents all 18 AMQP 0-9-1 error codes (11 hard + 7 soft) with codes, names, and scopes. What remains:

- Exact error message **strings** for each scenario (e.g., `"NOT_ALLOWED - attempt to reuse consumer tag '<tag>'"`)
- Catalog of which RabbitMQ operations trigger which specific error codes
- Edge cases where RabbitMQ deviates from AMQP spec error classification (e.g., `immediate=true` uses 540 NOT_IMPLEMENTED as a connection error despite being raised in channel context)

### G6: Concurrency Model

No analysis of how concurrent operations work in a single-threaded JS runtime:

- Multiple consumers on the same queue — round-robin dispatch ordering
- Publish during consume — event loop interleaving
- Channel-level operation serialization
- Implications for message ordering guarantees (open question #8)

### G7: State Machine Definitions

**Resolved.** See [State Machines](amqp/state-machines.md) for formal state machine definitions covering:

- Connection states and transitions (including BLOCKING, ERROR, TCP disconnect behavior)
- Channel states and transitions (including ERRORED, FLOW_PAUSED, confirm mode sub-state)
- Message lifecycle states (ROUTING through ACKED/DEAD_LETTERED/DISCARDED)
- Consumer states and transitions (including server-initiated cancel, in-flight delivery behavior)

### G8: Overflow Policy Behavior Details

**Partially resolved.** Web verification confirmed:

- Three overflow policies: `drop-head` (default), `reject-publish`, `reject-publish-dlx` (classic queues only; quorum queues do not support `reject-publish-dlx`)
- Overflow rejection uses `basic.nack` (via publisher confirms), NOT `basic.return`
- `reject-publish-dlx` combines rejection with dead-lettering of the rejected message

Still needed for implementation:

- Exact behavior when `x-max-length` vs `x-max-length-bytes` is exceeded simultaneously
- Whether overflow checks apply before or after routing to multiple queues

### G9: amqplib API Surface Mapping

Phase 3 plans an "amqplib-compatible adapter" but there is no systematic mapping of:

- Complete list of amqplib methods and their signatures
- Which methods are essential vs rarely used
- Behavioral differences between amqplib versions
- Type definitions to match (`@types/amqplib`)

### G10: Browser Runtime Constraints

Cross-platform section says "Browser: ✅ Pure TS" but no research on:

- Which Node.js APIs (if any) are used and need polyfills
- Timer precision differences (`setTimeout` minimum ~4ms in browsers)
- Bundle size target
- Whether `Buffer` usage in core needs to be avoided (use `Uint8Array` instead)

---

[← Back](README.md)
