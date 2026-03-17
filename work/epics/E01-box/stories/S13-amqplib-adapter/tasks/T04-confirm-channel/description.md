# T04: ConfirmChannel & Events

Implement amqplib-compatible ConfirmChannel.

## Scope

- `createConfirmChannel()` → ConfirmChannel
  - Internally creates channel + calls confirmSelect
- ConfirmChannel extends Channel:
  - `publish(exchange, routingKey, content, options?, callback?)` — callback: `(err, ok) => void`
  - `sendToQueue(queue, content, options?, callback?)` — same callback
  - Callback called when publisher confirm received (ack or nack from broker)
  - `waitForConfirms()` → Promise<void> — resolves when all outstanding confirms received
- Channel events:
  - `return` event: emitted for mandatory unroutable messages, payload is the returned message
  - `drain` event: emitted when write buffer drains (always immediate for in-process)

## Inputs

- S13T03 message operations, S10 publisher confirms

## Outputs

- ConfirmChannel class in adapter
- Unit tests: publish with callback, waitForConfirms, return event, drain event

## Key Constraints

- ConfirmChannel publish callback receives (err, ok) — err is null on success, Error on nack
- waitForConfirms rejects if any outstanding publish was nacked
- Return event must fire BEFORE confirm callback for mandatory messages (order matters)

---

[← Back](../README.md)
