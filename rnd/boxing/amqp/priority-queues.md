# Priority Queues

## Declaration

Priority support must be explicitly enabled:

```javascript
channel.assertQueue("priority-queue", { arguments: { "x-max-priority": 10 } });
```

## Classic Queue Priorities

- Range: [0, 255], but single-digit recommended (resource cost per level)
- Each priority level creates separate internal sub-queues
- Messages without priority treated as 0
- Starvation prevention: cyclic processing across priority levels

## Quorum Queue Priorities (RabbitMQ 4.0+)

Only **two effective levels**:

| Priority Value | Internal Level |
|---|---|
| 0-4 (or unset) | Normal |
| 5-255 | High |

Always delivers a proportion of normal-priority messages to prevent starvation.

## Important: Prefetch Interaction

Priority ordering only applies to messages **waiting in the queue**. Messages already dispatched to a consumer's prefetch buffer are delivered in FIFO order. Priority only matters when there is a backlog.

## Publishing with Priority

```javascript
channel.publish("exchange", "key", payload, { priority: 5 });
```

## Alternatives

- Separate queues per priority level with different consumer scaling
- Consumer priorities (`x-priority` argument on `basic.consume`)
- Different prefetch values per consumer group

---

[← Back](README.md)
