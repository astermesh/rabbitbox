# AMQP 0-9-1 Formal State Machines

Formal state machine definitions for AMQP 0-9-1 connections, channels, messages, and consumers as implemented by RabbitMQ. These definitions are derived from the AMQP 0-9-1 specification and RabbitMQ's documented behavior. Every behavioral detail here represents a parity requirement for RabbitBox.

## 1. Connection State Machine

### 1.1 States

| State | Description |
|---|---|
| `CLOSED` | No TCP connection. Initial and terminal state. |
| `TCP_CONNECTING` | TCP SYN sent; waiting for SYN-ACK. |
| `PROTOCOL_SENT` | TCP established; client has sent the 8-byte protocol header `"AMQP\x00\x00\x09\x01"`. |
| `STARTING` | Waiting for `connection.start` from server. |
| `AUTHENTICATING` | `connection.start-ok` sent; SASL exchange in progress. May cycle through `connection.secure` / `connection.secure-ok` rounds. |
| `TUNING` | `connection.tune` received; client has sent `connection.tune-ok`, now waiting to send `connection.open`. |
| `OPENING` | `connection.open` sent; waiting for `connection.open-ok`. |
| `OPEN` | Fully established. Channels may be opened and used. |
| `BLOCKING` | Server sent `connection.blocked` (resource alarm active). Publishing is suspended. |
| `CLOSING` | `connection.close` has been sent or received; draining the close handshake. |
| `ERROR` | A hard protocol error was received or sent; connection is being torn down. |

### 1.2 Connection Protocol Grammar (from AMQP 0-9-1 Spec)

```
connection       = open-connection *use-connection close-connection
open-connection  = C:protocol-header
                   S:START C:START-OK
                   *challenge
                   S:TUNE C:TUNE-OK
                   C:OPEN S:OPEN-OK
challenge        = S:SECURE C:SECURE-OK
use-connection   = *channel
close-connection = C:CLOSE S:CLOSE-OK / S:CLOSE C:CLOSE-OK
```

### 1.3 State Transitions

```
CLOSED
  → TCP_CONNECTING     : client initiates TCP connect()

TCP_CONNECTING
  → PROTOCOL_SENT      : TCP established; client sends 8-byte protocol header
  → CLOSED             : TCP connect() fails (ECONNREFUSED, timeout)

PROTOCOL_SENT
  → STARTING           : protocol header accepted by server (server begins sending connection.start)
  → CLOSED             : server sends non-AMQP bytes or immediately closes TCP
                         (e.g., protocol version mismatch — server responds with "AMQP0091" and closes)

STARTING
  → AUTHENTICATING     : server sends connection.start; client sends connection.start-ok
  → ERROR              : server sends connection.close instead (invalid vhost early, etc.)
  → CLOSED             : TCP disconnect during handshake timeout (default 10 s)

AUTHENTICATING
  → AUTHENTICATING     : server sends connection.secure; client sends connection.secure-ok (repeats)
  → TUNING             : server sends connection.tune (SASL complete)
  → ERROR              : server sends connection.close with 403 ACCESS_REFUSED (auth failure)
                         or 530 NOT_ALLOWED (authentication failure notification extension)
  → CLOSED             : TCP disconnect

TUNING
  → OPENING            : client sends connection.tune-ok then connection.open immediately
  → CLOSED             : TCP disconnect; handshake timeout

OPENING
  → OPEN               : server sends connection.open-ok
  → ERROR              : server sends connection.close with 402 INVALID_PATH (unknown vhost)
                         or 530 NOT_ALLOWED (no permission for vhost)
  → CLOSED             : TCP disconnect; handshake timeout

OPEN
  → BLOCKING           : server sends connection.blocked (resource alarm; requires client capability)
  → CLOSING            : client sends connection.close (clean shutdown)
  → CLOSING            : server sends connection.close (operator action, resource limits)
  → ERROR              : server sends connection.close with a hard error code (frame error, etc.)
  → CLOSED             : TCP disconnect (heartbeat timeout or network failure)

BLOCKING
  → OPEN               : server sends connection.unblocked (all alarms cleared)
  → CLOSING            : client or server initiates connection.close while blocked
  → CLOSED             : TCP disconnect

CLOSING
  → CLOSED             : connection.close-ok received (or sent in response to server-initiated close)
  → CLOSED             : TCP disconnect during close handshake

ERROR
  → CLOSED             : TCP connection torn down after error frame sent/received
```

### 1.4 Error Codes and Their Scope

Error codes partition into **hard errors** (close the connection) and **soft errors** (close only the channel). Hard errors appear in `connection.close`; soft errors appear in `channel.close`.

#### Hard Errors (Connection-Level)

| Code | Name | Trigger |
|---|---|---|
| 320 | `CONNECTION_FORCED` | Operator closed the connection via management API or CLI |
| 402 | `INVALID_PATH` | Unknown or inaccessible virtual host in `connection.open` |
| 501 | `FRAME_ERROR` | Malformed AMQP frame received (bad frame type, wrong end byte) |
| 502 | `SYNTAX_ERROR` | Invalid field values inside a frame |
| 503 | `COMMAND_INVALID` | Method sent in an invalid state (e.g., `channel.open` on channel 0) |
| 504 | `CHANNEL_ERROR` | Channel operation attempted on a channel that was not opened correctly |
| 505 | `UNEXPECTED_FRAME` | Frame received that is not valid in the current context |
| 506 | `RESOURCE_ERROR` | Server cannot allocate the resource due to system limits |
| 530 | `NOT_ALLOWED` | Operation forbidden by server policy; also used for auth failure notifications |
| 540 | `NOT_IMPLEMENTED` | Method or feature is not implemented by this server |
| 541 | `INTERNAL_ERROR` | Unexpected server-side error |

#### Soft Errors (Channel-Level)

| Code | Name | Trigger |
|---|---|---|
| 311 | `CONTENT_TOO_LARGE` | Published message body exceeds `frame_max` constraints |
| 312 | `NO_ROUTE` | `basic.return` reply code: message with `mandatory=true` had no matching queue (RabbitMQ extension; not in original AMQP 0-9-1 spec) |
| 313 | `NO_CONSUMERS` | `basic.return` reply code: message with `immediate=true` had no ready consumers (unused in modern RabbitMQ — `immediate=true` causes 540 connection error) |
| 403 | `ACCESS_REFUSED` | Insufficient permissions for the operation |
| 404 | `NOT_FOUND` | Referenced exchange or queue does not exist |
| 405 | `RESOURCE_LOCKED` | Exclusive queue accessed from a different connection |
| 406 | `PRECONDITION_FAILED` | Re-declaration with different properties; bad argument value |

Note: 312 and 313 are classified as `soft-error` in the AMQP spec but in practice RabbitMQ uses them exclusively as `basic.return` reply codes — they do not trigger `channel.close`.

### 1.5 TCP Disconnect Behavior by State

| State at Disconnect | Server Behavior |
|---|---|
| `TCP_CONNECTING` | Client-side only; connection attempt fails |
| `PROTOCOL_SENT` | Server silently drops the half-open connection after handshake timeout (10 s default) |
| `STARTING` | Server drops; logs a closed connection warning |
| `AUTHENTICATING` | Server drops; logs a closed connection warning |
| `TUNING` | Server drops; logs a closed connection warning |
| `OPENING` | Server drops; logs a closed connection warning |
| `OPEN` | Server detects via heartbeat miss or TCP RST/FIN; all channels and their consumers are torn down; unacked messages on those channels are requeued; exclusive queues declared by the connection are deleted |
| `BLOCKING` | Same as `OPEN`; all cleanup applies |
| `CLOSING` | Server detects incomplete close; treats as abrupt disconnect; same cleanup as `OPEN` |

### 1.6 Blocked Connection Extension

The `connection.blocked` / `connection.unblocked` pair is a RabbitMQ extension to AMQP 0-9-1. Clients must advertise the `connection.blocked` capability in `connection.start-ok` client-properties to receive these notifications.

- `connection.blocked` is sent the **first time** a resource alarm activates.
- `connection.unblocked` is sent when **all** resource alarms have cleared.
- During the `BLOCKING` state, publishing operations are suspended by the broker (TCP back-pressure is applied); the connection is otherwise functional for consuming.
- The blocked state does not affect channel management methods.

---

## 2. Channel State Machine

### 2.1 States

| State | Description |
|---|---|
| `CLOSED` | Channel number not in use. Initial and terminal state. |
| `OPENING` | `channel.open` sent; waiting for `channel.open-ok`. |
| `OPEN` | Channel is active; all method classes are valid. |
| `FLOW_PAUSED` | Server or client sent `channel.flow active=false`; consumer deliveries are suspended. |
| `CLOSING_CLIENT` | Client sent `channel.close`; waiting for `channel.close-ok`. |
| `CLOSING_SERVER` | Server sent `channel.close`; client must respond with `channel.close-ok`. |
| `ERRORED` | Server sent `channel.close` with a non-200 reply code (soft error); channel is defunct. |

### 2.2 Channel Protocol Grammar (from AMQP 0-9-1 Spec)

```
channel      = open-channel *use-channel close-channel
open-channel = C:OPEN S:OPEN-OK
use-channel  = C:FLOW S:FLOW-OK / S:FLOW C:FLOW-OK / functional-class
close-channel = C:CLOSE S:CLOSE-OK / S:CLOSE C:CLOSE-OK
```

### 2.3 State Transitions

```
CLOSED
  → OPENING           : client sends channel.open (channel ID selected by client, 1-based)

OPENING
  → OPEN              : server sends channel.open-ok
  → [connection ERROR]: if channel ID already in use, server closes the connection
                        (504 CHANNEL_ERROR — this is a hard/connection-level error)

OPEN
  → FLOW_PAUSED       : either peer sends channel.flow with active=false
  → CLOSING_CLIENT    : client sends channel.close (reply-code=200, reply-text="OK")
  → CLOSING_SERVER    : server sends channel.close with reply-code=200 (normal close)
  → ERRORED           : server sends channel.close with non-200 reply code (soft error)
  → CLOSED            : underlying connection closes (TCP disconnect or connection.close)

FLOW_PAUSED
  → OPEN              : either peer sends channel.flow with active=true
  → CLOSING_CLIENT    : client sends channel.close
  → CLOSING_SERVER    : server sends channel.close
  → CLOSED            : underlying connection closes

CLOSING_CLIENT
  → CLOSED            : server sends channel.close-ok; channel ID is released
  → CLOSED            : underlying connection closes

CLOSING_SERVER
  → CLOSED            : client sends channel.close-ok; channel ID is released

ERRORED
  → CLOSED            : client sends channel.close-ok in response to the server's channel.close
                        (client must always respond even on error close)
```

### 2.4 Valid Operations per State

| Operation | OPEN | FLOW_PAUSED | CLOSING_CLIENT | CLOSING_SERVER | ERRORED |
|---|---|---|---|---|---|
| Exchange methods | Yes | Yes | No | No | No |
| Queue methods | Yes | Yes | No | No | No |
| `basic.publish` | Yes | Yes | No | No | No |
| `basic.consume` | Yes | Yes | No | No | No |
| `basic.cancel` | Yes | Yes | No | No | No |
| `basic.ack` / `basic.nack` / `basic.reject` | Yes | Yes | No | No | No |
| `basic.get` | Yes | Yes (not affected by flow) | No | No | No |
| `channel.flow` | Yes | Yes | No | No | No |
| `channel.close` | Yes | Yes | No | No | No |
| `channel.close-ok` | No | No | No | Yes (required) | Yes (required) |

Note: `channel.flow` controls consumer deliveries (push API) only. `basic.get` (pull API) is not affected by flow control.

### 2.5 Clean Close vs Error Close

**Clean close** (reply-code=200):
- Initiated by client (`channel.close`) or server (e.g., queue auto-delete triggered)
- Unacked messages are requeued
- No error information attached to the close frame
- Channel can be replaced with a new one of the same or different ID

**Error close** (reply-code != 200, soft error):
- Initiated by server when an operation violates protocol rules
- `channel.close` carries reply-code, reply-text, class-id, and method-id identifying the offending method
- Unacked messages are requeued (same behavior as clean close)
- The channel is permanently unusable; the connection is NOT closed
- Client must open a new channel to continue work

**In both cases**: unacked consumer deliveries on the closing channel are requeued to their originating queues with the `redelivered` flag set to `true`.

### 2.6 Confirm Mode Sub-State

When `confirm.select` is sent on an `OPEN` channel, the channel enters confirm mode. This is an irreversible sub-state within `OPEN` — confirm mode cannot be disabled on a channel.

In confirm mode:
- Every `basic.publish` is assigned a monotonically increasing **delivery-tag** (sequence number), starting at 1.
- The server responds with `basic.ack` (message accepted) or `basic.nack` (message could not be accepted) on the same channel.
- The broker tracks unconfirmed messages in an internal structure keyed by sequence number.
- If a queue that received the message crashes abnormally, the broker sends `basic.nack` for that message.
- If a queue exits normally (e.g., deleted), the broker treats the message as confirmed (`basic.ack`).
- If a message is not routed to any queue (unroutable), the broker sends `basic.ack` immediately (the message is the broker's responsibility even if dropped).
- On channel close (clean or error), any unconfirmed publishes receive no confirmation — the publisher must treat them as unconfirmed and handle accordingly.

---

## 3. Message Lifecycle State Machine

### 3.1 States

| State | Description |
|---|---|
| `IN_TRANSIT` | `basic.publish` frame(s) sent by client but not yet fully received by broker. |
| `ROUTING` | Broker has received the complete message and is evaluating exchange bindings. |
| `RETURNED` | Unroutable with `mandatory=true`; broker is sending `basic.return` to publisher. |
| `QUEUED` | Message is stored in one or more matching queues (state is per queue slot). |
| `EXPIRING` | Message TTL has elapsed; message is eligible for dead-lettering or discard. |
| `DELIVERING` | Broker has sent `basic.deliver` (push) or `basic.get-ok` (pull) to a consumer; consumer has not yet acked. |
| `UNACKED` | Delivery is outstanding; consumer received the message but has not acked/nacked. |
| `ACKED` | Consumer sent `basic.ack`; message is permanently removed from the queue. Terminal. |
| `NACKED_REQUEUE` | Consumer sent `basic.nack` or `basic.reject` with `requeue=true`; message returns to queue head at original position if possible. |
| `NACKED_DISCARD` | Consumer sent `basic.nack` or `basic.reject` with `requeue=false` and no DLX configured; message is dropped. Terminal. |
| `DEAD_LETTERED` | Message moved to Dead Letter Exchange due to rejection, TTL, or overflow. |
| `DISCARDED` | Message dropped without dead-lettering (no DLX, mandatory=false unroutable). Terminal. |

### 3.2 State Transitions

```
[publisher calls basic.publish]
  → IN_TRANSIT        : frames flowing to broker

IN_TRANSIT
  → ROUTING           : all body frames received by broker

ROUTING
  → QUEUED            : exchange binding matched one or more queues; message written to each
  → RETURNED          : no binding matched AND mandatory=true → broker sends basic.return to publisher
  → DISCARDED         : no binding matched AND mandatory=false AND no alternate exchange configured
  → QUEUED (alt-x)    : no binding matched AND alternate exchange configured → routed to alternate exchange

QUEUED
  → DELIVERING        : consumer is registered (basic.consume) and prefetch allows delivery;
                        or client calls basic.get and queue is non-empty
  → EXPIRING          : per-message TTL elapsed OR per-queue x-message-ttl elapsed
  → DEAD_LETTERED     : queue overflow (x-max-length or x-max-length-bytes exceeded with drop-head policy)
  → DISCARDED         : queue expires (x-expires elapsed) — note: queue expiry does NOT dead-letter messages

EXPIRING
  → DEAD_LETTERED     : DLX is configured on the queue
  → DISCARDED         : DLX is not configured

DELIVERING
  → UNACKED           : broker sent basic.deliver (push) or basic.get-ok (pull);
                        consumer has not yet sent basic.ack; ack mode is manual

DELIVERING (auto-ack mode)
  → ACKED             : broker considers the message acked immediately upon delivery
                        (no client ack required; "fire and forget")

UNACKED
  → ACKED             : consumer sends basic.ack (delivery-tag matches)
  → ACKED             : consumer sends basic.ack with multiple=true (all up to this tag)
  → NACKED_REQUEUE    : consumer sends basic.nack or basic.reject with requeue=true
  → NACKED_DISCARD    : consumer sends basic.nack or basic.reject with requeue=false, no DLX
  → DEAD_LETTERED     : consumer sends basic.nack or basic.reject with requeue=false, DLX configured
  → NACKED_REQUEUE    : channel closes (clean or error) — all unacked messages requeued automatically
  → NACKED_REQUEUE    : consumer sends basic.recover (requeue=true only; requeue=false not supported)
  → DEAD_LETTERED     : delivery-limit exceeded on quorum queue (x-delivery-limit policy)

NACKED_REQUEUE
  → QUEUED            : message re-enters the queue, ideally at original position;
                        redelivered flag set to true in subsequent deliveries

DEAD_LETTERED
  → ROUTING           : message published to DLX; routing key is x-dead-letter-routing-key
                        if set, otherwise original routing keys are preserved;
                        x-death headers appended (queue, reason, count, timestamp, exchange, routing-keys);
                        per-message TTL removed from dead-lettered message header;
                        if DLX does not exist, message is silently discarded
  → DISCARDED         : DLX exists but no binding routes the message

RETURNED
  → [publisher receives basic.return frame]; message is not stored anywhere; Terminal from broker POV.

ACKED    : terminal
DISCARDED: terminal
NACKED_DISCARD: terminal
```

### 3.3 Dead-Letter Header Modifications

When a message is dead-lettered, the broker modifies its headers:

- Adds `x-death` array entry (AMQP 0-9-1) with: `queue`, `reason` (rejected/expired/maxlen/delivery_limit), `count`, `time`, `exchange`, `routing-keys`, and optionally `original-expiration`
- On first dead-lettering: sets `x-first-death-queue`, `x-first-death-reason`, `x-first-death-exchange`
- Removes the `expiration` property to prevent re-expiry in downstream queues (original value recorded as `original-expiration` in `x-death`)
- Removes `CC` header if the dead-letter routing key differs from the original
- Removes `BCC` header unconditionally (per sender-selected distribution rules)
- Replaces the exchange name with the DLX name

A message can be dead-lettered multiple times; each event appends a new entry to `x-death`.

### 3.4 basic.return Details

`basic.return` is sent synchronously from broker to publisher on the same channel as the offending `basic.publish`. The frame contains:

- `reply-code`: 312 (`NO_ROUTE`) if no binding matched; 313 (`NO_CONSUMERS`) if `immediate=true` and no ready consumer
- `reply-text`: human-readable reason
- `exchange` and `routing-key`: original publish target

The publisher's returned-message handler must be registered before publishing with `mandatory=true`; otherwise the returned message has nowhere to go on the client side (client library behavior varies).

Note: `immediate=true` was removed in RabbitMQ 3.0 and is no longer supported. Publishing with `immediate=true` results in a connection-level error (540 NOT_IMPLEMENTED, reply-text `"NOT_IMPLEMENTED - immediate=true"`).

---

## 4. Consumer State Machine

### 4.1 States

| State | Description |
|---|---|
| `UNREGISTERED` | No consumer exists with this tag on this channel. |
| `REGISTERING` | `basic.consume` sent; waiting for `basic.consume-ok`. |
| `ACTIVE` | Consumer is registered; broker is dispatching messages. |
| `FLOW_PAUSED` | Channel-level flow is suspended (`channel.flow active=false`); no new deliveries. |
| `CANCELLING_CLIENT` | Client sent `basic.cancel`; waiting for `basic.cancel-ok`. |
| `CANCELLING_SERVER` | Broker sent `basic.cancel` (server-initiated cancellation); client must send `basic.cancel-ok`. |
| `CANCELLED` | Consumer is unregistered. No further deliveries will be dispatched. |

### 4.2 State Transitions

```
UNREGISTERED
  → REGISTERING       : client sends basic.consume (with consumer-tag or empty for auto-generated tag)

REGISTERING
  → ACTIVE            : server sends basic.consume-ok (consumer-tag confirmed)
  → [channel ERRORED] : server closes channel (e.g., queue not found → 404 NOT_FOUND;
                        exclusive queue taken → 405 RESOURCE_LOCKED;
                        consumer tag already in use → 406 PRECONDITION_FAILED)

ACTIVE
  → FLOW_PAUSED       : channel.flow active=false received or sent
  → CANCELLING_CLIENT : client sends basic.cancel with the consumer-tag
  → CANCELLING_SERVER : server sends basic.cancel (queue deleted, node failure, HA failover, queue unavailable)
                        Note: requires client capability consumer_cancel_notify=true in connection.start-ok
  → CANCELLED         : channel closes (clean or error) — all consumers on the channel are implicitly cancelled
  → CANCELLED         : connection closes — all consumers on the connection are cancelled

FLOW_PAUSED
  → ACTIVE            : channel.flow active=true restores delivery
  → CANCELLING_CLIENT : client sends basic.cancel
  → CANCELLING_SERVER : server sends basic.cancel
  → CANCELLED         : channel or connection closes

CANCELLING_CLIENT
  → CANCELLED         : server sends basic.cancel-ok
  → CANCELLED         : channel closes before cancel-ok arrives

CANCELLING_SERVER
  → CANCELLED         : client sends basic.cancel-ok
  → CANCELLED         : channel closes before client responds
```

### 4.3 Server-Initiated Cancellation Triggers

The broker sends `basic.cancel` (without waiting for a client request) in these situations:

| Trigger | Details |
|---|---|
| Queue deleted | Queue the consumer is subscribed to is deleted via `queue.delete` or management API |
| Node failure (clustered) | The node hosting the queue process fails; consumer must re-register after recovery |
| Queue becomes unavailable | Classic mirrored queue loses quorum; quorum queue leadership change |
| Exclusive queue owner disconnect | Connection owning an exclusive queue closes; all consumers of that queue are cancelled |

Race condition: the client may send `basic.cancel` simultaneously with the server sending `basic.cancel`. The broker does not treat this as an error; it responds with `basic.cancel-ok` normally. Both sides converge on `CANCELLED`.

### 4.4 Effect on In-Flight Deliveries

Cancellation (client or server initiated) does **not** affect messages already dispatched to the consumer:

- Messages already sent via `basic.deliver` before the cancellation are still outstanding.
- These in-flight unacked messages remain in the `UNACKED` state.
- The consumer application is expected to ack or nack them after receiving `basic.cancel-ok`.
- If the consumer closes the channel without acking, the messages are automatically requeued.
- There is no automatic discard of in-flight messages on cancel.

### 4.5 Consumer Tags

- Consumer tags are scoped to a **channel**, not a connection.
- If the client provides an empty `consumer-tag` in `basic.consume`, the server generates a unique tag.
- A consumer tag must be unique within its channel; re-using an existing tag causes a 530 `NOT_ALLOWED` connection error (reply-text `"NOT_ALLOWED - attempt to reuse consumer tag '<tag>'"`).
- Consumer tags survive channel flow but not channel close.

### 4.6 Consumer Priorities (RabbitMQ Extension)

RabbitMQ extends AMQP 0-9-1 with consumer priorities via the `x-priority` argument in `basic.consume`. Higher-priority consumers receive messages first. Lower-priority consumers only receive messages when all higher-priority consumers are saturated (at their prefetch limit). This does not change the state machine but affects dispatch ordering within `ACTIVE` state.

---

## 5. Cross-Cutting Behavioral Rules

### 5.1 Channel 0

Channel 0 is the **connection-control channel**. All `connection.*` methods are sent and received on channel 0. No other method class may use channel 0. Sending a non-connection method on channel 0 results in a hard error (503 `COMMAND_INVALID`).

### 5.2 Delivery Tag Scoping

Delivery tags are monotonically increasing integers scoped per channel. They start at 1 when the channel opens (or when confirm mode begins for publisher delivery tags). Acknowledging a delivery tag on a different channel than it was received on results in a 406 `PRECONDITION_FAILED` channel error.

### 5.3 Prefetch (QoS) and Delivery Gates

`basic.qos` sets the maximum number of unacked messages a channel (or connection, with `global=true`) will have outstanding before the broker stops dispatching new messages. A consumer in the `ACTIVE` state will not receive new deliveries if the prefetch window is full.

- `count=0` means unlimited (no prefetch limit).
- `global=false` (default): limit applies per consumer.
- `global=true`: limit applies to all consumers on the channel.

### 5.4 Heartbeat and Connection Health

Heartbeat frames are sent on channel 0 approximately every `heartbeat/2` seconds. Any AMQP traffic resets the timer. If no traffic (including heartbeats) is seen for the full heartbeat interval, the connection is considered dead and torn down. All cleanup described in section 1.5 (`OPEN` disconnect) applies.

### 5.5 Exclusive Queue Ownership

An exclusive queue is tied to the **connection** (not the channel) that declared it. It is accessible only from that connection. When the connection closes for any reason (clean or unclean), the queue is automatically deleted. Any consumers registered on that queue from other channels of the same connection are cancelled first.

### 5.6 Auto-Delete Queue Behavior

An auto-delete queue is deleted when its **last consumer cancels** (or its last consumer's channel closes). It is not deleted when declared with no consumers — at least one consumer must have been registered and then cancelled for the auto-delete to trigger.

---

## Sources

- [AMQP 0-9-1 Specification Reference](https://github.com/rabbitmq/amqp-0.9.1-spec/blob/main/docs/amqp-0-9-1-reference.md) — official method grammar and state machine definitions
- [AMQP 0-9-1 Protocol Specification PDF](https://www.rabbitmq.com/resources/specs/amqp0-9-1.pdf) — authoritative protocol definition
- [AMQP 0-9-1 Machine-Readable XML](https://github.com/postwait/node-amqp/blob/master/amqp-0-9-1.xml) — constant definitions including hard/soft error classification
- [RabbitMQ Connections](https://www.rabbitmq.com/docs/connections) — connection lifecycle documentation
- [RabbitMQ Consumer Cancel Notification](https://www.rabbitmq.com/docs/consumer-cancel) — server-initiated consumer cancellation
- [RabbitMQ Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms) — ack/nack behavior, channel close and unacked messages
- [RabbitMQ Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx) — DLX triggers, routing key behavior, x-death headers
- [RabbitMQ Publishers](https://www.rabbitmq.com/docs/publishers) — mandatory flag, basic.return, publisher confirms
- [RabbitMQ Protocol Extensions](https://www.rabbitmq.com/docs/extensions) — connection.blocked, consumer cancel notification, basic.nack, confirm.select
- [RabbitMQ Blocked Connection Notifications](https://www.rabbitmq.com/docs/connection-blocked) — connection.blocked / connection.unblocked semantics
- [RabbitMQ Publisher Confirms Internals](https://github.com/rabbitmq/internals/blob/master/publisher_confirms.md) — confirm tracking data structures
- [AMQP Error Codes — Apache Qpid](https://cwiki.apache.org/confluence/display/qpid/AMQP+Error+Codes) — error code reference

---

[← Back](README.md)
