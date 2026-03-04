# Boxing

Boxing RabbitMQ (AMQP 0-9-1 message broker) — protocol analysis, Eng design, interface mapping.

## Boxing Process

- [Boxing Analysis](boxing-analysis.md) — AMQP 0-9-1 protocol internals, boxing process, SBI hook types, cross-platform analysis, implementation strategy
- [Eng Options Survey](eng-options-survey.md) — existing JS/TS libraries, AMQP server implementations, protocol resources

## AMQP 0-9-1 Reference

Supplementary protocol reference material.

- [AMQP 0-9-1 Protocol](amqp/amqp-protocol.md) — protocol overview, concepts, method classes, transport layer
- [Exchange Types and Routing](amqp/exchange-types.md) — direct, topic, fanout, headers exchanges and routing semantics
- [Messages and Properties](amqp/messages-and-properties.md) — message structure, standard properties, headers, delivery modes
- [Consumer Acknowledgments and QoS](amqp/acknowledgments-and-qos.md) — ack, nack, reject, prefetch, consumer modes
- [Publisher Confirms](amqp/publisher-confirms.md) — confirm mode, delivery tags, async confirms, data safety
- [JS/TS Client Libraries](amqp/js-ts-clients.md) — amqplib, rabbitmq-client, amqp-client.js, cross-platform
- [Connections and Channels](amqp/connections-and-channels.md) — lifecycle, multiplexing, heartbeats, recovery, TLS
- [Virtual Hosts](amqp/virtual-hosts.md) — multi-tenancy, permissions, limits, default queue types
- [Dead Letter Exchanges](amqp/dead-letter-exchanges.md) — DLX configuration, triggers, x-death headers
- [TTL and Expiration](amqp/ttl-and-expiration.md) — per-message TTL, per-queue TTL, queue expiration
- [Priority Queues](amqp/priority-queues.md) — classic vs quorum priority, starvation prevention
- [Queue Types Comparison](amqp/queue-types.md) — classic queues, quorum queues, streams
- [RabbitMQ Streams](amqp/streams.md) — append-only logs, consumer offsets, replay, super streams
- [Management HTTP API](amqp/management-api.md) — endpoints reference, authentication, monitoring

---

[← Back](../README.md)
