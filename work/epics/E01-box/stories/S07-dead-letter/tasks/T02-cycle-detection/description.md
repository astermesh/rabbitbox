# T02: Cycle Detection

Implement DLX cycle detection matching RabbitMQ's exact algorithm.

## Scope

- Before dead-lettering a message, check its x-death records
- Cycle detection algorithm:
  1. Look for x-death entry where `queue` matches the target queue (queue the message is about to be dead-lettered TO)
  2. If found: check all death reasons in the cycle path
  3. If ALL reasons are automatic (`expired`, `maxlen`, `delivery_limit`) → drop the message (cycle detected)
  4. If ANY reason is `rejected` → allow the cycle (client explicitly rejected, considered intentional)
- No numeric iteration limit — detection is based on queue name presence in history
- `rejected` reason completely bypasses cycle detection (shortcut)

## Inputs

- S07T01 DLX routing module

## Outputs

- Cycle detection logic in `packages/rabbit-box/src/dead-letter.ts`
- Unit tests: simple A↔B cycle with expired (dropped), cycle with rejected (allowed), no cycle (normal), complex multi-hop cycle

## Key Constraints

- Must match RabbitMQ source code behavior exactly (verified against rabbit_dead_letter.erl)
- No arbitrary limits — only the x-death queue name check
- `rejected` always breaks cycle detection

---

[← Back](../README.md)
