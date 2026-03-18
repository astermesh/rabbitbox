# T03: Publish Pipeline

**Status:** done

Implement the full publish flow from exchange to consumer dispatch trigger.

## Scope

- `publish(exchange, routingKey, body, properties, options)`:
  1. Validate exchange exists — if not and name is not `""`, channel error NOT_FOUND
  2. Check `internal` flag — publishing to internal exchange → ACCESS_REFUSED channel error
  3. Route via exchange type → get set of matched (queue, binding) pairs
  4. Process CC/BCC headers: route message additionally using each CC/BCC routing key; strip BCC header before enqueue
  5. For each matched queue: enqueue message copy
  6. If no queues matched and `mandatory=true`: emit basic.return (replyCode 312 NO_ROUTE)
  7. After enqueue: trigger consumer dispatch for each affected queue
  8. Return `{routed: boolean}` — true if at least one queue received the message
- Default exchange routing: publish to `""` routes to queue named by routingKey
- user-id validation: if message has userId property, validate against connection authenticated user

## Inputs

- S02 exchange routing + bindings, S03T01 queue registry, S03T02 message storage

## Outputs

- `packages/rabbit-box/src/publish.ts`
- Unit tests: route to single queue, fanout to multiple, no match (non-mandatory = silent, mandatory = return), internal exchange rejection, CC/BCC routing, user-id validation

## Key Constraints

- Each matched queue gets its own copy of the message (not shared reference)
- Mandatory return must include original message content and properties
- BCC header must be stripped from delivered message (invisible to consumers)
- Consumer dispatch is triggered but actual delivery is S04's responsibility

---

[← Back](../README.md)
