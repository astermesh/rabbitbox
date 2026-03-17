# T02: End-to-End Integration Tests

Comprehensive test suite exercising full publish-to-consume flows through the public API.

## Scope

Test scenarios:
- **Basic publish/consume**: single producer, single consumer, message received correctly
- **Fanout broadcast**: one publish delivered to multiple bound queues
- **Topic routing**: wildcard patterns (* and #), edge cases
- **Headers routing**: all 4 x-match modes
- **Direct routing**: default exchange, named direct exchange
- **Multiple consumers**: round-robin dispatch verified across 3+ consumers
- **Prefetch limiting**: verify dispatch pauses when consumer hits prefetch limit, resumes on ack
- **Ack/nack/reject flows**: ack removes from unacked, nack with requeue re-delivers, reject without requeue discards
- **Requeue behavior**: requeued message has redelivered=true, delivered to next consumer
- **Mandatory message return**: unroutable mandatory message triggers return event
- **CC/BCC routing**: message routed to additional keys, BCC stripped from delivered message
- **Passive declare**: checkExchange/checkQueue success and 404 failure
- **Channel error**: invalid operation closes channel, connection stays open
- **Connection close**: cascades to all channels, exclusive queues deleted
- **Multiple channels**: independent delivery tag sequences, independent errors
- **user-id validation**: matching and mismatching userId property

## Inputs

- S06T01 public API

## Outputs

- Test files co-located in `packages/rabbit-box/src/`
- All tests pass on Node.js (primary), ideally cross-runtime

## Key Constraints

- Tests must verify behavioral parity with real RabbitMQ (not just "it doesn't crash")
- Each test should assert specific RabbitMQ-compatible behavior
- Use descriptive test names that reference the RabbitMQ behavior being verified

---

[← Back](../README.md)
