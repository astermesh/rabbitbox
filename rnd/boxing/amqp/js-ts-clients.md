# JavaScript / TypeScript Client Libraries

## Overview

The JavaScript/TypeScript ecosystem for RabbitMQ includes several libraries at different abstraction levels. This document covers the main options, their trade-offs, and cross-platform considerations for Node.js, Deno, and Bun.

## Library Landscape

| Library | npm Weekly Downloads | TypeScript | Auto-Reconnect | Dependencies | Browser |
|---|---|---|---|---|---|
| amqplib | ~937,000 | Via @types/amqplib | No | Few | No |
| amqp-connection-manager | ~170,000 | Built-in | Yes | amqplib | No |
| rabbitmq-client | Growing | Native | Yes | Zero | No |
| @cloudamqp/amqp-client | Smaller | Native | Yes (high-level API) | Zero | Yes (WebSocket) |
| rascal | ~20,000 | Yes | Yes | amqplib | No |
| @stomp/stompjs | ~100,000 | Built-in | Yes | Zero | Yes (WebSocket) |

## amqplib (amqp.node)

The most widely used AMQP 0-9-1 client for Node.js. Low-level, protocol-faithful implementation.

### Key Characteristics

- Implements the complete AMQP 0-9-1 specification
- Both callback and promise/async-await APIs
- Two channel types: Channel (standard) and ConfirmChannel (with publisher confirms)
- No automatic reconnection, no topology recovery
- Requires Node.js v10+
- Versions 0.10.7+ required for RabbitMQ 4.1.0+

### API Overview

```javascript
import amqplib from "amqplib";

// Connect
const conn = await amqplib.connect("amqp://user:pass@localhost:5672/vhost");

// Create channel (or createConfirmChannel for publisher confirms)
const ch = await conn.createChannel();

// Declare topology
await ch.assertExchange("my-exchange", "topic", { durable: true });
await ch.assertQueue("my-queue", { durable: true });
await ch.bindQueue("my-queue", "my-exchange", "routing.#");

// Set prefetch
await ch.prefetch(100);

// Publish
ch.publish("my-exchange", "routing.key", Buffer.from(JSON.stringify(data)), {
  contentType: "application/json",
  persistent: true,
  messageId: "unique-id",
  timestamp: Date.now() / 1000,
  headers: { "x-custom": "value" },
});

// Consume
ch.consume("my-queue", (msg) => {
  if (msg) {
    const body = JSON.parse(msg.content.toString());
    console.log("Received:", body);
    ch.ack(msg);
  }
}, { noAck: false });

// ConfirmChannel with publisher confirms
const confirmCh = await conn.createConfirmChannel();
confirmCh.sendToQueue("my-queue", Buffer.from("hello"), {}, (err) => {
  if (err) console.error("Nacked!");
  else console.log("Confirmed!");
});
await confirmCh.waitForConfirms();

// Graceful shutdown
await ch.close();
await conn.close();
```

### Channel API Reference

**Queue operations**: `assertQueue`, `checkQueue`, `deleteQueue`, `purgeQueue`, `bindQueue`, `unbindQueue`

**Exchange operations**: `assertExchange`, `checkExchange`, `deleteExchange`, `bindExchange`, `unbindExchange`

**Publishing**: `publish(exchange, routingKey, content, options)`, `sendToQueue(queue, content, options)`

**Consuming**: `consume(queue, callback, options)`, `cancel(consumerTag)`, `get(queue, options)`

**Acknowledgment**: `ack(msg, allUpTo?)`, `ackAll()`, `nack(msg, allUpTo?, requeue?)`, `nackAll(requeue?)`, `reject(msg, requeue?)`

**Configuration**: `prefetch(count, global?)`, `recover()`

### Publish Options

```typescript
interface PublishOptions {
  contentType?: string;
  contentEncoding?: string;
  headers?: Record<string, any>;
  deliveryMode?: 1 | 2;     // 1=transient, 2=persistent
  persistent?: boolean;       // alias for deliveryMode=2
  priority?: number;          // 0-9
  correlationId?: string;
  replyTo?: string;
  expiration?: string;        // TTL in ms as string
  messageId?: string;
  timestamp?: number;         // seconds since epoch
  type?: string;
  userId?: string;
  appId?: string;
  mandatory?: boolean;        // return if unroutable
  CC?: string[];              // additional routing keys
  BCC?: string[];             // hidden additional routing keys
}
```

### TypeScript Support

TypeScript definitions are maintained separately:
```bash
npm install amqplib @types/amqplib
```

### Limitations

- No automatic reconnection
- No topology recovery after reconnect
- No connection pooling
- Low-level API requires significant boilerplate for production use
- Payload must be a Buffer (no automatic serialization)

## amqp-connection-manager

A thin wrapper around amqplib that adds automatic reconnection, round-robin broker failover, and in-memory message queuing during disconnects.

### Key Characteristics

- Built-in TypeScript types (no @types package needed)
- Setup functions re-run on every reconnection
- Messages queued in memory when disconnected
- Multiple broker URL support with round-robin
- Supports both promises and callbacks

### API Overview

```javascript
import amqp from "amqp-connection-manager";

// Connect with multiple broker URLs
const connection = amqp.connect(
  ["amqp://host1:5672", "amqp://host2:5672"],
  {
    heartbeatIntervalInSeconds: 5,
    reconnectTimeInSeconds: 5,
  }
);

connection.on("connect", () => console.log("Connected"));
connection.on("disconnect", (err) => console.log("Disconnected", err));

// Create channel wrapper with setup function
const channelWrapper = connection.createChannel({
  json: true,     // auto-serialize/deserialize JSON
  confirm: true,  // use ConfirmChannel
  setup: async (channel) => {
    // This runs on every reconnection
    await channel.assertExchange("my-exchange", "topic", { durable: true });
    await channel.assertQueue("my-queue", { durable: true });
    await channel.bindQueue("my-queue", "my-exchange", "routing.#");
    await channel.prefetch(100);

    await channel.consume("my-queue", (msg) => {
      const body = JSON.parse(msg.content.toString());
      console.log("Received:", body);
      channel.ack(msg);
    });
  },
});

// Publish (queued in memory if disconnected)
await channelWrapper.publish("my-exchange", "routing.key", { hello: "world" });

// Publish with timeout
await channelWrapper.publish("my-exchange", "routing.key", data, {
  timeout: 10000,  // reject promise after 10s if not confirmed
});
```

### Configuration Options

| Option | Default | Description |
|---|---|---|
| `heartbeatIntervalInSeconds` | 5 | AMQP heartbeat interval |
| `reconnectTimeInSeconds` | heartbeat value | Delay between reconnection attempts |
| `findServers(callback)` | - | Dynamic server discovery (Consul, etcd) |
| `connectionOptions` | - | Options passed to amqplib connect |

### Channel Wrapper Options

| Option | Default | Description |
|---|---|---|
| `json` | false | Auto-encode/decode JSON payloads |
| `confirm` | true | Use ConfirmChannel |
| `publishTimeout` | - | Default timeout for all publishes |
| `setup` | - | Function to run on each (re)connection |

### When to Use

- You need amqplib's low-level API but with reliable reconnection
- Multiple broker failover is required
- Messages should be queued during broker downtime
- Existing amqplib code needs to be made more resilient

## rabbitmq-client (node-rabbitmq-client)

A modern, zero-dependency RabbitMQ client with native TypeScript, auto-reconnect, and high-level Consumer/Publisher interfaces.

### Key Characteristics

- Zero npm dependencies
- Native TypeScript (no @types package needed)
- Automatic reconnection and channel recovery for all edge cases
- High-level Consumer, Publisher, and RPCClient interfaces
- Performance comparable to amqplib
- Listed on the official RabbitMQ client libraries page
- Versions 5.0.3+ required for RabbitMQ 4.1.0+

### API Overview

```typescript
import { Connection } from "rabbitmq-client";

// Connect
const rabbit = new Connection("amqp://user:pass@localhost:5672/vhost");
rabbit.on("error", (err) => console.error("Connection error", err));
rabbit.on("connection", () => console.log("Connected"));

// Publisher (auto-reconnect, publisher confirms)
const pub = rabbit.createPublisher({
  confirm: true,
  maxAttempts: 3,
  exchanges: [{ exchange: "my-exchange", type: "topic" }],
});

await pub.send({ exchange: "my-exchange", routingKey: "routing.key" }, {
  hello: "world",  // Automatically serialized to JSON
});

// Consumer (auto-reconnect, topology re-declaration)
const sub = rabbit.createConsumer({
  queue: "my-queue",
  queueOptions: { durable: true },
  queueBindings: [
    { exchange: "my-exchange", routingKey: "routing.#" },
  ],
  prefetch: 100,
}, async (msg) => {
  console.log("Received:", msg.body);
  // Automatically acknowledged on successful return
  // Automatically nacked on thrown error
});

// RPC Client
const rpcClient = rabbit.createRPCClient({ confirm: true });
const response = await rpcClient.send("rpc-queue", { action: "getData" });
console.log("RPC response:", response.body);

// Graceful shutdown
await pub.close();
await sub.close();
await rpcClient.close();
await rabbit.close();
```

### Recovery Scenarios Handled

The Consumer and Publisher interfaces automatically recover from:
- Connection lost (server restart)
- Missed heartbeats (network timeout)
- Connection force-closed via Management UI
- Channel closed (publishing to non-existent exchange)
- Consumer closed from Management UI
- Queue deleted while consuming

### When to Use

- New projects that want a modern, TypeScript-first API
- Need robust reconnection without wrapper libraries
- Want minimal dependency footprint
- Building microservices with RPC patterns

## @cloudamqp/amqp-client (amqp-client.js)

AMQP 0-9-1 client that works in both Node.js (TCP) and browsers (WebSocket). Developed by CloudAMQP.

### Key Characteristics

- Native TypeScript, zero dependencies
- Dual transport: TCP for Node.js, WebSocket for browsers
- Two API levels: low-level AMQPClient and high-level AMQPSession
- "Secure by default" -- publishes not fulfilled until data reaches wire
- High performance (~300,000 msgs/s publish throughput)
- ~1,743 lines of code (very lean)

### API Overview

```typescript
// Node.js (TCP)
import { AMQPClient } from "@cloudamqp/amqp-client";

const client = new AMQPClient("amqp://localhost");
const conn = await client.connect();
const ch = await conn.channel();

const q = await ch.queue("my-queue", { durable: true });
await ch.basicPublish("", "my-queue", "Hello!", {
  contentType: "text/plain",
});

const consumer = await q.subscribe({ noAck: false }, async (msg) => {
  console.log(msg.bodyString());
  await msg.ack();
});

// Browser (WebSocket) -- requires relay proxy
import { AMQPWebSocketClient } from "@cloudamqp/amqp-client";

const wsClient = new AMQPWebSocketClient(
  "wss://relay-host/ws",
  "/",       // vhost
  "user",
  "pass"
);
const wsConn = await wsClient.connect();
// Same channel API as TCP client
```

### High-Level API (AMQPSession)

```typescript
// Automatic reconnection and consumer recovery
const session = new AMQPSession(client);
// Session handles reconnection with exponential backoff
```

### When to Use

- Need browser-side AMQP access (with WebSocket relay)
- Want a single library for both server and browser
- Need maximum publish throughput
- Prefer a lean, modern codebase

## rascal

Config-driven wrapper around amqplib for complex enterprise patterns.

### Key Characteristics

- Config-driven architecture (define topology in JSON/JS config objects)
- Multi-host connections with automatic failover
- Automatic error recovery
- Redelivery flood protection
- Transparent encryption/decryption
- Channel pooling
- Built on amqplib

### Config-Driven Example

```javascript
const config = {
  vhosts: {
    "/": {
      connection: {
        url: "amqp://localhost",
      },
      exchanges: {
        "my-exchange": {
          type: "topic",
          options: { durable: true },
        },
      },
      queues: {
        "my-queue": {
          options: { durable: true },
        },
      },
      bindings: {
        "my-binding": {
          source: "my-exchange",
          destination: "my-queue",
          destinationType: "queue",
          bindingKey: "routing.#",
        },
      },
      publications: {
        "my-publication": {
          exchange: "my-exchange",
          routingKey: "routing.key",
        },
      },
      subscriptions: {
        "my-subscription": {
          queue: "my-queue",
          prefetch: 100,
        },
      },
    },
  },
};
```

### When to Use

- Complex enterprise integration patterns
- Need config-driven topology management
- Redelivery protection is important
- Already invested in amqplib ecosystem

## Cross-Platform Considerations

### Node.js

All libraries work on Node.js. This is the primary target for every library listed.

| Library | Min Node.js | Notes |
|---|---|---|
| amqplib | v10+ | Core dependency for many wrappers |
| amqp-connection-manager | v10+ | Depends on amqplib |
| rabbitmq-client | v16+ | Uses modern JS features |
| @cloudamqp/amqp-client | v14+ | Uses DataView, native TCP |
| rascal | v10+ | Depends on amqplib |

### Deno

Deno's Node.js compatibility layer (`npm:` specifier) enables some libraries:

| Library | Deno Status | Notes |
|---|---|---|
| amqplib | Partial | May work via `npm:amqplib`, depends on Node.js net compatibility |
| deno-amqp | Native | Pure Deno AMQP 0-9-1 implementation (github.com/lenkan/deno-amqp) |
| @cloudamqp/amqp-client | Likely works | Zero deps, uses standard APIs |
| @stomp/stompjs | Works | WebSocket-based, standard APIs |

**deno-amqp** is the recommended option for Deno-native projects -- it is a pure Deno implementation with no npm dependencies.

For Deno projects using npm compatibility, `amqplib` via `npm:amqplib` may work but is not guaranteed.

### Bun

Bun aims for Node.js compatibility but has some gaps:

| Library | Bun Status | Notes |
|---|---|---|
| amqplib | Works (recent Bun versions) | Earlier versions had `node:net` issues |
| amqp-connection-manager | Works | Depends on amqplib |
| rabbitmq-client | Issues reported | `node:net` socket compatibility problems in some versions |
| @cloudamqp/amqp-client | Uncertain | May have socket API differences |

Bun's Node.js compatibility improves with each release. Production use of AMQP libraries on Bun should be tested thoroughly against the specific Bun version being used.

Known issue: Bun v1.0.20 had `TypeError: Expected "port" to be a number between 0 and 65535` with some AMQP libraries due to incomplete `node:net` implementation. This has been improving in later versions.

### Browser

Only two approaches work in browsers:

1. **@cloudamqp/amqp-client** with WebSocket transport (requires relay proxy to RabbitMQ)
2. **@stomp/stompjs** with RabbitMQ Web STOMP plugin (no relay needed)
3. **mqtt.js / Paho** with RabbitMQ Web MQTT plugin (no relay needed)

## Choosing a Library

```
Need browser support?
  Yes --> Full AMQP features needed?
            Yes --> @cloudamqp/amqp-client (+ WebSocket relay)
            No  --> @stomp/stompjs (Web STOMP) or mqtt.js (Web MQTT)
  No  --> New project?
            Yes --> rabbitmq-client (modern, zero deps, auto-reconnect)
            No  --> Already using amqplib?
                      Yes --> Add amqp-connection-manager for reconnection
                      No  --> Complex enterprise patterns?
                                Yes --> rascal
                                No  --> rabbitmq-client or amqplib + amqp-connection-manager
```

## Recommendation Summary

| Use Case | Recommended Library |
|---|---|
| New Node.js project | rabbitmq-client |
| Existing amqplib project needs resilience | amqp-connection-manager |
| Maximum low-level control | amqplib |
| Complex enterprise patterns | rascal |
| Browser + Node.js same API | @cloudamqp/amqp-client |
| Browser only (simplest) | @stomp/stompjs |
| Deno native | deno-amqp |
| Maximum performance | @cloudamqp/amqp-client or rabbitmq-client |

---

[← Back](README.md)
