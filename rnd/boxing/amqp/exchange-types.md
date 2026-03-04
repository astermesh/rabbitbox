# Exchange Types and Routing

## Exchange Fundamentals

Exchanges are AMQP entities that receive messages from publishers and route copies to queues based on rules called **bindings**. Each exchange has:

- **Name** -- identifier used by publishers
- **Type** -- determines the routing algorithm
- **Durability** -- survives broker restarts if durable
- **Auto-delete** -- removed when last queue unbinds
- **Internal** -- cannot receive messages from publishers directly, only from other exchanges
- **Arguments** -- optional, plugin-specific settings (e.g., alternate exchange)

If a message cannot be routed to any queue:
- If the `mandatory` flag is set, the message is returned to the publisher via `basic.return`
- Otherwise, the message is silently dropped

## Exchange Types

### Direct Exchange

**Routing algorithm**: Exact match between message routing key and binding routing key.

```
Publisher --[routing_key="order.created"]--> Direct Exchange
                                               |
                    binding_key="order.created" +--> Queue A  (matches)
                    binding_key="order.shipped"  +--> Queue B  (no match)
                    binding_key="order.created" +--> Queue C  (matches)
```

- Delivers messages to queues whose binding key exactly equals the message routing key
- Multiple queues can bind with the same key -- the message is copied to all matching queues
- Ideal for unicast and simple multicast routing
- Use cases: task distribution, direct point-to-point messaging

### Default Exchange

A special pre-declared direct exchange with an empty string name (`""`). Every queue is automatically bound to it using the queue name as the binding key.

```javascript
// Publishing to the default exchange routes directly to the named queue
channel.sendToQueue("my-queue", Buffer.from("hello"));
// Equivalent to:
channel.publish("", "my-queue", Buffer.from("hello"));
```

This creates the illusion of publishing directly to a queue, though the message still goes through an exchange.

### Fanout Exchange

**Routing algorithm**: Ignores the routing key entirely. Routes copies to ALL bound queues.

```
Publisher --[any routing key]--> Fanout Exchange
                                    |
                                    +--> Queue A
                                    +--> Queue B
                                    +--> Queue C
```

- Every bound queue receives a copy of every message
- Routing key is ignored -- bindings need no pattern
- Ideal for broadcast scenarios
- Use cases: sports score updates, chat room distribution, system-wide notifications, log fanout

### Topic Exchange

**Routing algorithm**: Pattern matching between message routing key and binding pattern using dot-delimited words and wildcards.

```
Publisher --[routing_key="stock.nyse.ibm"]--> Topic Exchange
                                                 |
                    pattern="stock.nyse.*"       +--> Queue A (matches)
                    pattern="stock.#"            +--> Queue B (matches)
                    pattern="stock.nasdaq.*"     +--> Queue C (no match)
                    pattern="#"                  +--> Queue D (matches everything)
```

**Routing key format**: Dot-delimited words (e.g., `stock.nyse.ibm`, `log.error.auth`)

**Wildcard tokens** (only valid in binding patterns, not in published routing keys):
- `*` (star) -- matches exactly one word
- `#` (hash) -- matches zero or more words

**Special cases**:
- A binding pattern of `#` matches all messages (behaves like fanout)
- A binding pattern with no wildcards behaves like a direct exchange

Use cases: multi-criteria routing, log distribution by severity/source, geographic routing, categorized event distribution

### Headers Exchange

**Routing algorithm**: Matches against message header attributes instead of the routing key.

```
Publisher --[headers: {format: "pdf", type: "report"}]--> Headers Exchange
                                                            |
                    x-match="all", format="pdf", type="report"  +--> Queue A (matches)
                    x-match="any", format="pdf", type="log"     +--> Queue B (matches)
                    x-match="all", format="csv", type="report"  +--> Queue C (no match)
```

**Binding arguments**:
- `x-match = "all"` -- ALL specified headers must match (logical AND)
- `x-match = "any"` -- ANY one header must match (logical OR)

Headers prefixed with `x-` (except `x-match`) are not used for matching.

- The routing key is completely ignored
- More flexible than topic exchanges for multi-attribute routing
- Slightly slower than other exchange types due to header inspection
- Use cases: content-based routing, multi-dimensional filtering

## Exchange-to-Exchange Bindings (RabbitMQ Extension)

RabbitMQ extends AMQP 0-9-1 to allow exchanges to be bound to other exchanges, creating routing topologies:

```
Source Exchange --> Intermediate Exchange --> Queue
```

This enables complex routing architectures without requiring publisher awareness of the full topology.

## Alternate Exchanges

An exchange can declare an **alternate exchange** (via `alternate-exchange` argument). When a message cannot be routed to any queue from the primary exchange, it is re-published to the alternate exchange instead of being dropped.

```
Primary Exchange --[no matching bindings]--> Alternate Exchange --> Dead Letter Queue
```

This provides a safety net for unroutable messages without requiring the `mandatory` flag.

## Sender-Selected Distribution (RabbitMQ Extension)

Publishers can specify additional routing destinations via message headers:

- **CC** header: Array of additional routing keys; the message is routed to these as well. CC values are visible to consumers.
- **BCC** header: Same as CC, but the header is removed before delivery (invisible to consumers).

## Performance Considerations

| Exchange Type | Routing Speed | Memory per Binding |
|---|---|---|
| Fanout | Fastest (no key matching) | Lowest |
| Direct | Very fast (hash lookup) | Low |
| Topic | Fast (trie-based matching) | Moderate |
| Headers | Slowest (header inspection) | Higher |

For high-throughput scenarios, prefer direct or fanout exchanges. Topic exchanges are a good balance of flexibility and performance. Headers exchanges are best reserved for scenarios where routing key patterns are insufficient.

---

[← Back](README.md)
