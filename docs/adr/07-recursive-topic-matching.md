# 07: Recursive Topic Matching

## Status

Accepted

## Context

Topic exchanges route messages by matching routing keys against binding patterns with `*` (one word) and `#` (zero or more words) wildcards. RabbitMQ uses a trie data structure for this. The question is whether to replicate the trie or use a simpler algorithm.

## Decision

Topic exchange routing uses a recursive word-by-word matcher (`topicMatchWords`) with backtracking. The algorithm splits both the routing key and pattern into dot-separated words and recursively matches them, handling `*` and `#` wildcards.

## Alternatives Considered

- **Trie** (RabbitMQ's implementation) — faster for large binding sets, but significantly more complex to implement and harder to verify correct
- **DFA** — no backtracking once built, but expensive memory and binding-add cost
- **Regex compilation** — requires escaping and complex `#` handling, fragile

## Consequences

- Correctness is easier to verify — the recursive implementation directly maps to the AMQP spec definition
- Performance is adequate for testing scenarios (dozens of bindings, not thousands)
- If performance becomes an issue with large binding sets, the trie can be added as an optimization without changing the interface

---

[← Back](README.md)
