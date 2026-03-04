# Dead Letter Exchanges

## Overview

Dead letter exchanges (DLX) provide a mechanism for handling messages that cannot be delivered or processed. When a message is "dead-lettered", it is re-published to a designated exchange for special handling -- logging, inspection, retry, or alerting.

## What Triggers Dead-Lettering

| Trigger | Description |
|---|---|
| **Consumer rejection** | `basic.reject` or `basic.nack` with `requeue=false` |
| **Message expiration** | Per-message TTL expires (via `expiration` property) |
| **Queue length exceeded** | Message dropped because the queue reached its `x-max-length` or `x-max-length-bytes` |
| **Delivery limit exceeded** | Quorum queue message returned more than `x-delivery-limit` times |

**Note**: If an entire queue expires (via `x-expires`), its messages are NOT dead-lettered -- they are simply discarded.

## Configuration

### Method 1: Policy-Based (Recommended)

```bash
rabbitmqctl set_policy DLX ".*" \
  '{"dead-letter-exchange":"my-dlx", "dead-letter-routing-key":"dead-letter"}' \
  --apply-to queues
```

### Method 2: Queue Arguments

```javascript
channel.assertQueue("my-queue", {
  arguments: {
    "x-dead-letter-exchange": "my-dlx",
    "x-dead-letter-routing-key": "dead-letter"
  }
});
```

## Dead Letter Routing

- If `dead-letter-routing-key` is set, it replaces the original routing key
- If not set, the original routing key(s) are preserved
- The DLX exchange must exist or dead-lettered messages are lost

### Typical Topology

```
Source Queue --[dead-letter]--> DLX Exchange --[binding]--> Dead Letter Queue
```

## x-death Header (Death History)

Each dead-letter event adds an entry to the `x-death` header array:

| Field | Description |
|---|---|
| `queue` | Source queue name |
| `reason` | `rejected`, `expired`, `maxlen`, `delivery_limit` |
| `count` | Times dead-lettered from this queue for this reason |
| `exchange` | Original publish exchange |
| `routing-keys` | Original routing keys |
| `time` | Timestamp of the event |

Quick-access headers: `x-first-death-queue`, `x-first-death-reason`, `x-last-death-queue`, `x-last-death-reason`.

## Retry Patterns with DLX

### Simple Retry with TTL

```
Work Queue --[reject]--> DLX --> Retry Queue (TTL: 30s) --[expires]--> Work Exchange --> Work Queue
```

### At-Least-Once Dead-Lettering (Quorum Queues)

By default, dead-lettering has no internal publisher confirms (messages can be lost). Quorum queues support safe dead-lettering:

```bash
rabbitmqctl set_policy DLX-safe ".*" \
  '{"dead-letter-exchange":"my-dlx", "dead-letter-strategy":"at-least-once"}' \
  --apply-to queues
```

---

[← Back](README.md)
