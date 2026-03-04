# TTL and Expiration

## Three TTL Mechanisms

1. **Per-queue message TTL** -- all messages in the queue expire after a set time
2. **Per-message TTL** -- individual messages have their own expiration
3. **Queue TTL** -- the queue itself is deleted after inactivity

## Per-Queue Message TTL

```javascript
channel.assertQueue("my-queue", { arguments: { "x-message-ttl": 60000 } });
```

Or via policy: `rabbitmqctl set_policy TTL ".*" '{"message-ttl": 60000}' --apply-to queues`

- TTL of 0 = messages expire immediately unless delivered to a consumer directly
- Expired messages removed at queue head

## Per-Message TTL

```javascript
channel.publish("exchange", "key", payload, { expiration: "60000" });
```

- `expiration` is a **string** in milliseconds
- When both per-queue and per-message TTL exist, the lower value applies
- Expired messages only removed when reaching queue head (can accumulate)

## Queue TTL (x-expires)

Deletes the queue itself after inactivity:

```javascript
channel.assertQueue("temp-queue", { arguments: { "x-expires": 300000 } });
```

- Queue is "in use" if it has consumers, was recently redeclared, or had `basic.get` called
- Messages in expired queues are NOT dead-lettered -- they are discarded
- Must be a positive integer (cannot be 0)
- Not supported for streams

## TTL and Dead Lettering

When a message expires due to TTL and the queue has a DLX configured:
- The message is dead-lettered with reason `expired`
- The `expiration` property is removed to prevent re-expiration in the DLX target
- The original TTL is stored in `x-death` as `original-expiration`

---

[← Back](README.md)
