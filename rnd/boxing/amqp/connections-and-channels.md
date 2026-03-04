# Connections and Channels

## Connections

### What is an AMQP Connection

An AMQP connection is a TCP connection between a client application and the RabbitMQ broker. Connections are designed to be **long-lived** -- a new connection should not be opened per protocol operation.

### Connection Lifecycle

```
1. Client opens TCP connection to broker (port 5672 for AMQP, 5671 for AMQPS)
2. Client sends protocol header: "AMQP 0 0 9 1"
3. Server responds with connection.start (capabilities, auth mechanisms)
4. Client sends connection.start-ok (selected auth, credentials)
5. Optional SASL challenge/response exchange
6. Server sends connection.tune (channel_max, frame_max, heartbeat)
7. Client sends connection.tune-ok (negotiated values)
8. Client sends connection.open (virtual host selection)
9. Server sends connection.open-ok
10. Connection is ready -- client can open channels
```

### Connection Parameters Negotiated During Tune

| Parameter | Description | Default |
|---|---|---|
| `channel_max` | Maximum channels per connection | Negotiated (0 = no limit) |
| `frame_max` | Maximum frame size in bytes | 131072 (128 KB) |
| `heartbeat` | Heartbeat interval in seconds | 60 |

### Connection Closure

Connections should be closed gracefully:

```javascript
await connection.close(); // Sends connection.close, waits for connection.close-ok
```

Abrupt TCP termination (without `connection.close`) leaves the broker holding resources until heartbeat timeout detects the dead connection.

### TLS / AMQPS

- Port 5671 for TLS-encrypted connections
- Uses standard TLS certificate chain verification
- Highly recommended for production to prevent traffic sniffing and MITM attacks
- Client libraries typically accept `amqps://` URLs

### Connection Authentication

RabbitMQ supports multiple SASL mechanisms:
- **PLAIN**: Username/password in cleartext (use with TLS)
- **AMQPLAIN**: RabbitMQ-specific variant of PLAIN
- **EXTERNAL**: TLS client certificate authentication
- **RABBIT-CR-DEMO**: Challenge-response demo (not for production)

### Connection Monitoring

Important metrics:
- Number of open connections
- Connection open/close rate (churn)
- Per-connection channel count
- Per-connection data transfer rate

## Channels

### What is a Channel

Channels are **lightweight logical connections** multiplexed over a single TCP connection. Every AMQP protocol operation happens on a channel. Channels provide:

- Connection multiplexing without multiple TCP connections
- Error isolation (a channel error does not close the connection)
- Concurrent operations within a single application

### Why Channels Exist

Opening a new TCP connection for every operation would be:
- Expensive in terms of system resources (file descriptors, TCP buffers)
- Slow due to TCP and TLS handshake overhead
- Problematic for firewalls and NAT configurations

Channels solve this by sharing one TCP connection for many logical streams of communication.

### Channel Lifecycle

```javascript
// Open
const channel = await connection.createChannel();

// Use for operations...
await channel.assertQueue("my-queue");
channel.sendToQueue("my-queue", Buffer.from("hello"));

// Close when done
await channel.close();
```

Channels are meant to be **long-lived**, similar to connections. Opening a channel involves a network roundtrip, so frequent open/close is inefficient.

### Channel IDs

Each channel has a numeric ID (1 to `channel_max`). The ID is automatically assigned by the client library. Both broker and client use the ID to multiplex frames on the TCP connection.

### Channel Limits

**Per connection**: Negotiated via `channel_max` during connection setup. Can be configured server-side:
```ini
channel_max = 100
```

**Per node**: Total channels across all connections:
```ini
channel_max_per_node = 500
```

Exceeding limits causes a fatal connection error.

### Channel Errors

Protocol exceptions close the channel (not the connection). Common errors:

| Code | Name | Cause |
|---|---|---|
| 403 | ACCESS_REFUSED | Insufficient permissions |
| 404 | NOT_FOUND | Queue or exchange does not exist |
| 405 | RESOURCE_LOCKED | Exclusive queue accessed from wrong connection |
| 406 | PRECONDITION_FAILED | Redeclaring resource with different properties |

After a channel error:
- The channel is closed and cannot be reused
- Other channels on the same connection are unaffected
- The application should open a new channel

### Channel Best Practices

- Use **one channel per thread/consumer** in multi-threaded applications
- Keep channels long-lived (do not open/close per message)
- Use single-digit number of channels per connection for most applications
- Monitor for channel leaks (channels opened but never closed)
- Close channels explicitly when done -- do not rely on garbage collection

### Channel Resource Usage

Each channel consumes:
- Memory on both client and server
- An Erlang process on the broker
- Relatively small overhead per channel, but adds up at scale

### ConfirmChannel vs Regular Channel

Two channel types in most client libraries:

| Feature | Channel | ConfirmChannel |
|---|---|---|
| Publisher confirms | No | Yes |
| `publish` returns | Boolean (flow control) | Boolean + callback/promise for confirm |
| `waitForConfirms` | N/A | Waits for all pending confirms |
| Overhead | Lower | Slightly higher (tracking confirms) |

## Heartbeats

### Purpose

Heartbeats detect dead TCP connections at the application layer. Without heartbeats, a broken TCP connection (e.g., network cable unplugged) would take approximately 11 minutes to detect on Linux (TCP retransmission timeout).

### How They Work

- Heartbeat frames are sent approximately every `heartbeat / 2` seconds
- If no traffic (including heartbeats) is received for the full heartbeat interval, the peer considers the connection dead
- After two missed heartbeats, the connection is closed
- Any AMQP traffic (publishes, acks, etc.) resets the heartbeat timer

### Timeout Negotiation

The heartbeat timeout is negotiated during `connection.tune`:
- Server proposes its configured value (default: 60 seconds)
- Client reconciles with its own configured value
- If either peer specifies 0 (disabled), the larger value is used
- Otherwise, the smaller value is used

### Recommended Values

- **5 to 20 seconds** is optimal for most environments
- Values below 5 seconds risk false positives from network congestion
- Values of 1 second or lower are very likely to cause false positives
- Disabling heartbeats (0) without TCP keepalives is strongly discouraged

### TCP Keepalives

TCP keepalives serve a similar purpose at the OS level but require kernel tuning:
- Can complement AMQP heartbeats as additional defense
- Protect against idle connection termination by proxies/load balancers
- Work across all protocols, not just AMQP
- Default TCP keepalive timeout is typically too long for production use

## Connection Recovery

### Automatic Recovery (Library-Dependent)

Some client libraries provide automatic connection recovery:

| Library | Auto-Recovery |
|---|---|
| amqplib (Node.js) | No built-in recovery |
| amqp-connection-manager | Yes, with topology re-setup |
| rabbitmq-client | Yes, built-in |
| @cloudamqp/amqp-client | Yes (high-level API) |
| RabbitMQ Java client | Yes, built-in |
| RabbitMQ .NET client | Yes, built-in |

### Manual Recovery Pattern

For libraries without automatic recovery:

```javascript
async function connect() {
  const conn = await amqplib.connect(url);
  conn.on("error", (err) => console.error("Connection error", err));
  conn.on("close", () => {
    console.log("Connection closed, reconnecting...");
    setTimeout(connect, 5000); // Exponential backoff recommended
  });
  // Set up channels, consumers, etc.
}
```

### What Needs Recovery

After reconnection:
1. Channels must be re-opened
2. Exchanges and queues must be re-declared (or verified)
3. Bindings must be re-established
4. Consumers must be re-registered
5. Prefetch settings must be re-applied
6. Confirm mode must be re-enabled

---

[← Back](README.md)
