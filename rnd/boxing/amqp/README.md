# RabbitMQ and AMQP 0-9-1 Reference

Supplementary protocol reference material for [Boxing research](../README.md).

## Contents

- [AMQP 0-9-1 Protocol](amqp-protocol.md) — protocol overview, concepts, method classes, transport layer
- [Exchange Types and Routing](exchange-types.md) — direct, topic, fanout, headers exchanges and routing semantics
- [Messages and Properties](messages-and-properties.md) — message structure, standard properties, headers, delivery modes
- [Consumer Acknowledgments and QoS](acknowledgments-and-qos.md) — ack, nack, reject, prefetch, consumer modes
- [Publisher Confirms](publisher-confirms.md) — confirm mode, delivery tags, async confirms, data safety
- [JS/TS Client Libraries](js-ts-clients.md) — amqplib, rabbitmq-client, amqp-client.js, cross-platform

## Supplementary Reference

- [Connections and Channels](connections-and-channels.md) — lifecycle, multiplexing, heartbeats, recovery, TLS
- [Virtual Hosts](virtual-hosts.md) — multi-tenancy, permissions, limits, default queue types
- [Dead Letter Exchanges](dead-letter-exchanges.md) — DLX configuration, triggers, x-death headers
- [TTL and Expiration](ttl-and-expiration.md) — per-message TTL, per-queue TTL, queue expiration
- [Priority Queues](priority-queues.md) — classic vs quorum priority, starvation prevention
- [Queue Types Comparison](queue-types.md) — classic queues, quorum queues, streams
- [RabbitMQ Streams](streams.md) — append-only logs, consumer offsets, replay, super streams
- [Management HTTP API](management-api.md) — endpoints reference, authentication, monitoring

---

[← Back](../README.md)
