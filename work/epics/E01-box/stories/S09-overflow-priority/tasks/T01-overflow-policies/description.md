# T01: Overflow Policies

Implement queue size limits and overflow handling.

## Scope

- `x-max-length` (message count limit) and `x-max-length-bytes` (byte size limit)
- Three overflow behaviors via `x-overflow` argument:
  - `drop-head` (default): remove oldest message from head
    - If DLX configured: dead-letter removed message with reason `"maxlen"`
    - Otherwise: discard
  - `reject-publish`: reject the new incoming message
    - Publisher confirm: nack the publish
    - Non-confirm mode: silently drop
    - basic.return NOT sent (this is not the same as mandatory)
  - `reject-publish-dlx`: reject the new message AND dead-letter it
    - Dead-letter the rejected incoming message with reason `"maxlen"`
- Check limits on each enqueue
- Both limits can be set simultaneously (either triggers overflow)

## Inputs

- S03 message storage + publish pipeline, S07 DLX routing

## Outputs

- Overflow logic in message storage / enqueue path
- Unit tests: drop-head discard, drop-head with DLX, reject-publish, reject-publish-dlx, both limits, count vs bytes

## Key Constraints

- drop-head is the default when no x-overflow specified
- reject-publish does NOT send basic.return (different mechanism from mandatory)
- Dead-letter reason must be "maxlen" for all overflow-triggered dead-lettering

---

[← Back](../README.md)
