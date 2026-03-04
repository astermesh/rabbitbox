# RabbitMQ Management HTTP API

## Overview

HTTP-based API for monitoring and administering RabbitMQ. Default port 15672, JSON format, HTTP Basic Auth.

## Roles

| Tag | Access |
|---|---|
| `management` | Basic UI, own vhosts |
| `policymaker` | + policies |
| `monitoring` | + read-only global metrics |
| `administrator` | Full control |

## Key Endpoints

### System

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/overview` | System overview |
| GET | `/api/nodes` | All cluster nodes |
| GET | `/api/nodes/{name}` | Node details |
| GET/POST | `/api/definitions` | Export/import all definitions |

### Connections and Channels

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/connections` | All connections |
| DELETE | `/api/connections/{name}` | Force-close connection |
| GET | `/api/channels` | All channels |

### Exchanges

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/exchanges/{vhost}` | List exchanges |
| PUT/DELETE | `/api/exchanges/{vhost}/{name}` | Declare/delete exchange |
| POST | `/api/exchanges/{vhost}/{name}/publish` | Publish message |

### Queues

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/queues/{vhost}` | List queues |
| PUT/DELETE | `/api/queues/{vhost}/{name}` | Declare/delete queue |
| DELETE | `/api/queues/{vhost}/{name}/contents` | Purge queue |
| POST | `/api/queues/{vhost}/{name}/get` | Get messages |

### Bindings

| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/bindings/{vhost}/e/{exchange}/q/{queue}` | Exchange-to-queue bindings |
| GET/POST | `/api/bindings/{vhost}/e/{source}/e/{dest}` | Exchange-to-exchange bindings |

### Virtual Hosts

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/vhosts` | List vhosts |
| PUT/DELETE | `/api/vhosts/{name}` | Create/delete vhost |
| PUT/DELETE | `/api/vhost-limits/{vhost}/{name}` | Manage limits |

### Users and Permissions

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/users` | List users |
| PUT/DELETE | `/api/users/{name}` | Create/delete user |
| PUT/DELETE | `/api/permissions/{vhost}/{user}` | Set/delete permissions |
| GET | `/api/whoami` | Current user |

### Policies

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/policies/{vhost}` | List policies |
| PUT/DELETE | `/api/policies/{vhost}/{name}` | Manage policies |

### Health Checks

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health/checks/alarms` | Cluster alarms |
| GET | `/api/health/checks/virtual-hosts` | All vhosts running |
| GET | `/api/health/checks/node-is-quorum-critical` | Quorum status |
| GET | `/api/health/checks/ready-to-serve-clients` | Combined readiness |

### Streams

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/stream/connections` | Stream connections |
| GET | `/api/stream/publishers` | Stream publishers |
| GET | `/api/stream/consumers` | Stream consumers |

## Usage Examples

```bash
# List queues
curl -u guest:guest http://localhost:15672/api/queues

# Declare a queue
curl -u guest:guest -X PUT http://localhost:15672/api/queues/%2F/my-queue \
  -H "Content-Type: application/json" \
  -d '{"durable": true}'

# Publish a message
curl -u guest:guest -X POST http://localhost:15672/api/exchanges/%2F/amq.default/publish \
  -H "Content-Type: application/json" \
  -d '{"properties": {}, "routing_key": "my-queue", "payload": "hello", "payload_encoding": "string"}'

# Export definitions
curl -u guest:guest http://localhost:15672/api/definitions > definitions.json
```

---

[← Back](README.md)
