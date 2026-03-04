# Virtual Hosts

## Overview

Virtual hosts (vhosts) provide logical grouping and isolation of AMQP entities within a single RabbitMQ broker. They are analogous to Apache virtual hosts or Nginx server blocks, enabling multi-tenancy on a single broker.

Each vhost is a completely isolated namespace containing its own:
- Exchanges
- Queues
- Bindings
- User permissions
- Policies
- Parameters

## Key Characteristics

- Client connections are scoped to a single vhost (specified during `connection.open`)
- Operations can only affect entities within the connected vhost
- Cross-vhost operations are not possible through a single connection
- For cross-vhost routing, use RabbitMQ Shovel or Federation plugins
- Unlike Apache virtual hosts, RabbitMQ vhosts are created/deleted dynamically (not in configuration files)

## Default Virtual Host

RabbitMQ includes a default vhost named `/` (forward slash). This vhost:
- Is always preserved and will never be deleted by bulk operations
- Is used when clients do not specify a vhost
- Is where the default `guest` user has permissions

## Creating Virtual Hosts

### CLI

```bash
rabbitmqctl add_vhost my-vhost
```

### HTTP API

```bash
curl -u admin:password -X PUT http://localhost:15672/api/vhosts/my-vhost
```

### With Metadata

```bash
rabbitmqctl add_vhost my-vhost \
  --description "Production environment" \
  --tags "production,critical" \
  --default-queue-type quorum
```

## Deleting Virtual Hosts

**Warning**: Deletion permanently removes ALL entities within the vhost.

```bash
rabbitmqctl delete_vhost my-vhost
```

### Deletion Protection

```bash
# Enable protection
rabbitmqctl enable_vhost_protection_from_deletion "my-vhost"

# Attempting to delete returns 412 Precondition Failed
rabbitmqctl delete_vhost "my-vhost"  # Fails

# Disable protection
rabbitmqctl disable_vhost_protection_from_deletion "my-vhost"
```

## Permissions

User permissions are scoped per virtual host. Permissions are defined as three regex patterns:

| Permission | Controls |
|---|---|
| Configure | Creating/deleting exchanges and queues matching the pattern |
| Write | Publishing to exchanges matching the pattern |
| Read | Consuming from queues matching the pattern |

```bash
# Grant full permissions to user "app" on vhost "my-vhost"
rabbitmqctl set_permissions -p my-vhost app ".*" ".*" ".*"

# Grant read-only permissions
rabbitmqctl set_permissions -p my-vhost reader "" "" ".*"
```

Topic-level permissions can further restrict access based on routing keys:

```bash
rabbitmqctl set_topic_permissions -p my-vhost app "amq.topic" "^app\\..*" "^app\\..*"
```

## Virtual Host Limits

### Max Connections

```bash
rabbitmqctl set_vhost_limits -p my-vhost '{"max-connections": 256}'
```

### Max Queues

```bash
rabbitmqctl set_vhost_limits -p my-vhost '{"max-queues": 1024}'
```

Use `-1` for unlimited.

## Default Queue Type

Each vhost can specify a default queue type:
- `classic` -- Classic queue (CQv2 in RabbitMQ 4.0+)
- `quorum` -- Quorum queue (Raft-based replicated)
- `stream` -- Stream queue

```bash
rabbitmqctl update_vhost_metadata my-vhost --default-queue-type quorum
```

Only affects new declarations; existing queues are not changed.

## Connection URL Format

Virtual host is specified in the AMQP connection URL:

```
amqp://user:pass@host:5672/my-vhost
amqps://user:pass@host:5671/my-vhost
```

The default vhost `/` is encoded as `%2F` in URLs:
```
amqp://user:pass@host:5672/%2F
```

---

[← Back](README.md)
