import type { BrokerMessage, MessageProperties } from './types/message.ts';
import type { Queue } from './types/queue.ts';
import type { XDeathEntry, XDeathReason } from './types/x-death-entry.ts';

/**
 * Dependencies injected into the dead-letter module.
 */
export interface DeadLetterDeps {
  /** Look up a queue by name. */
  readonly getQueue: (name: string) => Queue | undefined;
  /** Check whether an exchange exists in the registry. */
  readonly exchangeExists: (name: string) => boolean;
  /** Re-publish the dead-lettered message through the normal routing pipeline. */
  readonly republish: (
    exchange: string,
    routingKey: string,
    body: Uint8Array,
    properties: MessageProperties
  ) => void;
  /** Time provider for x-death timestamps (returns milliseconds since epoch). */
  readonly now: () => number;
}

/**
 * Dead-letter a message due to TTL expiry.
 *
 * Convenience wrapper around deadLetter() with reason "expired".
 */
export function deadLetterExpired(
  message: BrokerMessage,
  queueName: string,
  deps: DeadLetterDeps
): void {
  deadLetter(message, queueName, 'expired', deps);
}

/**
 * Dead-letter a message from a queue.
 *
 * Implements RabbitMQ dead letter exchange (DLX) semantics:
 * 1. Check queue has x-dead-letter-exchange configured
 * 2. Check DLX exchange exists (silently drop if not)
 * 3. Build/update x-death header entry (increment count for same queue+reason)
 * 4. Set quick-access headers (x-first-death-*, x-last-death-*)
 * 5. Remove expiration property (prevent re-expiry in target queue)
 * 6. Re-publish to DLX exchange through normal routing pipeline
 */
export function deadLetter(
  message: BrokerMessage,
  queueName: string,
  reason: XDeathReason,
  deps: DeadLetterDeps
): void {
  const queue = deps.getQueue(queueName);
  if (!queue || queue.deadLetterExchange === undefined) return;

  const dlxExchange = queue.deadLetterExchange;
  if (!deps.exchangeExists(dlxExchange)) return;

  // Cycle detection: rejected reason bypasses entirely (intentional client action)
  if (reason !== 'rejected' && isDeadLetterCycle(message, queueName)) return;

  const dlRoutingKey = queue.deadLetterRoutingKey ?? message.routingKey;

  // Read existing x-death array from message headers
  const existingXDeath = readXDeath(message.properties.headers);
  const now = Math.floor(deps.now() / 1000);

  // Find existing entry with same queue+reason
  const existingIdx = existingXDeath.findIndex(
    (e) => e.queue === queueName && e.reason === reason
  );

  let newEntry: XDeathEntry;
  if (existingIdx >= 0) {
    const old = existingXDeath[existingIdx] as XDeathEntry;
    newEntry = { ...old, count: old.count + 1, time: now };
    existingXDeath.splice(existingIdx, 1);
  } else {
    newEntry = {
      queue: queueName,
      reason,
      count: 1,
      exchange: message.exchange,
      'routing-keys': [message.routingKey],
      time: now,
    };
    if (reason === 'expired' && message.properties.expiration) {
      newEntry = {
        ...newEntry,
        'original-expiration': message.properties.expiration,
      };
    }
  }

  const xDeath: XDeathEntry[] = [newEntry, ...existingXDeath];

  // Build updated headers
  const headers: Record<string, unknown> = {
    ...message.properties.headers,
    'x-death': xDeath,
  };

  // Quick-access headers: x-first-death-* only on first death
  if (!headers['x-first-death-queue']) {
    headers['x-first-death-queue'] = queueName;
    headers['x-first-death-reason'] = reason;
    headers['x-first-death-exchange'] = message.exchange;
  }
  headers['x-last-death-queue'] = queueName;
  headers['x-last-death-reason'] = reason;
  headers['x-last-death-exchange'] = message.exchange;

  // Remove expiration property, keep everything else
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { expiration: _removed, ...restProps } = message.properties;
  const properties: MessageProperties = { ...restProps, headers };

  deps.republish(dlxExchange, dlRoutingKey, message.body, properties);
}

/**
 * Read x-death array from message headers, returning a mutable copy.
 */
function readXDeath(
  headers: Record<string, unknown> | undefined
): XDeathEntry[] {
  if (!headers) return [];
  const raw = headers['x-death'];
  if (!Array.isArray(raw)) return [];
  return [...raw] as XDeathEntry[];
}

// ── Pure functions for overflow/publish pipeline ─────────────────────

export interface DeadLetterOptions {
  readonly queueName: string;
  readonly reason: XDeathReason;
  readonly deadLetterRoutingKey?: string;
  readonly now: number;
}

/**
 * Prepare a message for dead-lettering.
 *
 * Updates x-death headers, removes expiration property,
 * and sets quick-access headers (x-first-death-*, x-last-death-*).
 */
export function prepareDeadLetter(
  message: BrokerMessage,
  opts: DeadLetterOptions
): BrokerMessage {
  const newEntry: XDeathEntry = {
    queue: opts.queueName,
    reason: opts.reason,
    count: 1,
    exchange: message.exchange,
    'routing-keys': [message.routingKey],
    time: opts.now,
    ...(message.properties.expiration !== undefined
      ? { 'original-expiration': message.properties.expiration }
      : {}),
  };

  const existingXDeath = message.xDeath ?? [];
  const xDeath = updateXDeath(existingXDeath, newEntry);

  const existingHeaders = message.properties.headers ?? {};
  const headers: Record<string, unknown> = {
    ...existingHeaders,
    'x-death': xDeath,
    'x-last-death-queue': opts.queueName,
    'x-last-death-reason': opts.reason,
    'x-last-death-exchange': message.exchange,
  };

  if (!('x-first-death-queue' in existingHeaders)) {
    headers['x-first-death-queue'] = opts.queueName;
    headers['x-first-death-reason'] = opts.reason;
    headers['x-first-death-exchange'] = message.exchange;
  }

  // Remove expiration from properties (prevent re-expiry in DLX target)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { expiration: _expiration, ...restProps } = message.properties;

  return {
    ...message,
    routingKey: opts.deadLetterRoutingKey ?? message.routingKey,
    properties: { ...restProps, headers } as MessageProperties,
    xDeath,
    mandatory: false,
    deliveryCount: 0,
  };
}

/**
 * Check if dead-lettering would create a cycle.
 *
 * A cycle exists when the message has already been dead-lettered from
 * the same queue and all death reasons are automatic (not 'rejected').
 */
export function isDeadLetterCycle(
  message: BrokerMessage,
  sourceQueue: string
): boolean {
  if (!message.xDeath || message.xDeath.length === 0) return false;

  const fromSameQueue = message.xDeath.some((e) => e.queue === sourceQueue);
  if (!fromSameQueue) return false;

  return message.xDeath.every((e) => e.reason !== 'rejected');
}

function updateXDeath(
  existing: readonly XDeathEntry[],
  newEntry: XDeathEntry
): XDeathEntry[] {
  const result = [...existing];
  const idx = result.findIndex(
    (e) => e.queue === newEntry.queue && e.reason === newEntry.reason
  );

  if (idx >= 0) {
    const old = result[idx] as XDeathEntry;
    const updated: XDeathEntry = {
      ...old,
      count: old.count + 1,
      time: newEntry.time,
      ...(newEntry['original-expiration'] !== undefined
        ? { 'original-expiration': newEntry['original-expiration'] }
        : {}),
    };
    result.splice(idx, 1);
    result.unshift(updated);
  } else {
    result.unshift(newEntry);
  }

  return result;
}
