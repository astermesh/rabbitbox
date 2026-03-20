import type { BrokerMessage, MessageProperties } from './types/message.ts';
import type { XDeathEntry, XDeathReason } from './types/x-death-entry.ts';
import type { Queue } from './types/queue.ts';

/**
 * Dependencies for dead-letter operations.
 */
export interface DeadLetterDeps {
  /** Look up a queue by name. */
  readonly getQueue: (name: string) => Queue | undefined;
  /** Republish a message to an exchange. */
  readonly republish: (
    exchange: string,
    routingKey: string,
    message: BrokerMessage
  ) => void;
  /** Time provider for x-death timestamps. */
  readonly now: () => number;
}

/**
 * Dead-letter a message due to TTL expiry.
 *
 * If the source queue has a dead-letter exchange configured, the message is
 * republished with x-death headers. Otherwise the message is silently discarded.
 *
 * Matches RabbitMQ behavior:
 * - Builds x-death entry with reason "expired"
 * - Stores original expiration in x-death entry
 * - Strips expiration property from the republished message
 * - Uses dead-letter routing key if configured, otherwise original routing key
 * - Increments count if an x-death entry for the same queue+reason exists
 */
export function deadLetterExpired(
  queueName: string,
  message: BrokerMessage,
  deps: DeadLetterDeps
): void {
  deadLetter(queueName, message, 'expired', deps);
}

/**
 * Dead-letter a message for a given reason.
 *
 * Generic dead-letter function used by TTL expiry and future rejection/maxlen paths.
 */
export function deadLetter(
  queueName: string,
  message: BrokerMessage,
  reason: XDeathReason,
  deps: DeadLetterDeps
): void {
  const queue = deps.getQueue(queueName);
  if (!queue?.deadLetterExchange && queue?.deadLetterExchange !== '') return;

  const dlx = queue.deadLetterExchange;
  const dlRoutingKey = queue.deadLetterRoutingKey ?? message.routingKey;

  const now = deps.now();
  const existingXDeath = message.xDeath ?? [];

  // Check for existing x-death entry with same queue + reason → increment count
  const existingIndex = existingXDeath.findIndex(
    (e) => e.queue === queueName && e.reason === reason
  );

  let xDeath: XDeathEntry[];
  if (existingIndex >= 0) {
    xDeath = existingXDeath.map((e, i) =>
      i === existingIndex ? { ...e, count: e.count + 1, time: now } : e
    );
  } else {
    const entry: XDeathEntry = {
      queue: queueName,
      reason,
      count: 1,
      exchange: message.exchange,
      'routing-keys': [message.routingKey],
      time: now,
      ...(message.properties.expiration !== undefined
        ? { 'original-expiration': message.properties.expiration }
        : {}),
    };
    xDeath = [entry, ...existingXDeath];
  }

  // Strip expiration from properties so message doesn't expire again in DLX queue
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { expiration: _expiration, ...restProps } = message.properties;
  const headers: Record<string, unknown> = {
    ...restProps.headers,
    'x-death': xDeath,
  };

  // x-first-death-*: the oldest entry (last in array)
  const firstDeath = xDeath[xDeath.length - 1] as XDeathEntry;
  headers['x-first-death-queue'] = firstDeath.queue;
  headers['x-first-death-reason'] = firstDeath.reason;
  headers['x-first-death-exchange'] = firstDeath.exchange;

  // x-last-death-*: the newest entry (first in array)
  const lastDeath = xDeath[0] as XDeathEntry;
  headers['x-last-death-queue'] = lastDeath.queue;
  headers['x-last-death-reason'] = lastDeath.reason;
  headers['x-last-death-exchange'] = lastDeath.exchange;

  const properties: MessageProperties = { ...restProps, headers };

  const dlMessage: BrokerMessage = {
    ...message,
    properties,
    exchange: dlx,
    routingKey: dlRoutingKey,
    xDeath,
    deliveryCount: 0,
    enqueuedAt: 0, // will be overwritten on enqueue
  };

  deps.republish(dlx, dlRoutingKey, dlMessage);
}
