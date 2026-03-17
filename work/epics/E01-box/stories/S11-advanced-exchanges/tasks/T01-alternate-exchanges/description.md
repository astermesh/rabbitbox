# T01: Alternate Exchanges

Implement alternate exchange fallback routing.

## Scope

- `alternate-exchange` argument on exchange declare
- When publish routes to zero queues through primary exchange:
  1. Check if primary exchange has alternate exchange configured
  2. If yes: re-route message to alternate exchange with original routing key
  3. If alternate also routes to zero queues: check alternate's alternate (chain)
  4. If ultimately no queues: apply mandatory logic (basic.return if mandatory)
- Mandatory flag is NOT checked at intermediate alternate exchanges — only at the final step
- Alternate exchange must exist at routing time (if deleted, behave as if not configured)

## Inputs

- S02 exchange registry, S03 publish pipeline

## Outputs

- Alternate exchange logic in publish pipeline
- Unit tests: alternate routes when primary fails, chain of alternates, mandatory only at end, deleted alternate

## Key Constraints

- Mandatory flag applies only after all alternate exchanges exhausted
- Alternate exchange routing uses the ORIGINAL routing key (not re-computed)
- Cycle protection: track visited exchanges to prevent infinite alternate loops

---

[← Back](../README.md)
