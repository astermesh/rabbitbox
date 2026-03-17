# T02: Routing Algorithms

Implement per-type routing matchers for all four AMQP exchange types.

## Scope

- `directMatch(routingKey, bindingKey)` — exact string equality
- `fanoutMatch()` — always true (all bindings match)
- `topicMatch(routingKey, pattern)` — recursive wildcard matcher:
  - Split by `.` delimiter
  - `*` matches exactly one word
  - `#` matches zero or more words
  - `#` at end always matches remaining
  - `#` in middle: try all suffix positions
  - Empty routing key edge cases
- `headersMatch(messageHeaders, bindingArgs, xMatch)` — four modes:
  - `all`: every binding arg (excluding x-* keys) must match in message headers
  - `any`: at least one binding arg (excluding x-* keys) must match
  - `all-with-x`: same as all but x-* keys ARE included
  - `any-with-x`: same as any but x-* keys ARE included
  - Void-typed binding arg: check key presence only, not value
  - `x-match` key itself always excluded from comparison
- `route(exchange, routingKey, messageHeaders?)` — dispatch to correct matcher, return matched binding set

## Inputs

- S02T01 exchange registry, S01 types
- Boxing analysis §6, eng-options-survey §4-5

## Outputs

- `packages/rabbit-box/src/routing.ts`
- Unit tests: extensive edge cases for topic matching (empty segments, multiple #, trailing dots), headers matching (all 4 modes, void values, x-match validation)

## Key Constraints

- Topic matching must handle all edge cases identically to RabbitMQ (verified in research)
- Invalid x-match value must produce error: "expected all, any, all-with-x, or any-with-x"
- Correctness over performance — simple recursive matcher is fine

---

[← Back](../README.md)
