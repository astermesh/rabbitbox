import type { Channel } from './channel.ts';
import type { BrokerMessage } from './types/message.ts';
import type { UnackedMessage } from './types/consumer.ts';
import type {
  Hook,
  AckCtx,
  AckResult,
  NackCtx,
  NackResult,
  RejectCtx,
  RejectResult,
} from '@rabbitbox/sbi';
import { channelError } from './errors/factories.ts';
import { runHooked } from './hook-runner.ts';

/** AMQP class/method IDs for basic operations. */
const BASIC_CLASS = 60;
const BASIC_ACK = 80;
const BASIC_REJECT = 90;
const BASIC_NACK = 120;

/**
 * Dependencies injected into acknowledgment operations.
 */
export interface AcknowledgmentDeps {
  /** Requeue a message back to its originating queue (at head). */
  readonly onRequeue: (queueName: string, message: BrokerMessage) => void;
  /** Trigger consumer dispatch for a queue (after freeing prefetch capacity). */
  readonly onDispatch: (queueName: string) => void;
}

/**
 * Create a requeued copy of a message with incremented deliveryCount.
 * The incremented deliveryCount signals redelivered=true on next delivery.
 */
function requeuedMessage(message: BrokerMessage): BrokerMessage {
  return { ...message, deliveryCount: message.deliveryCount + 1 };
}

/**
 * Collect unique queue names from a set of unacked entries and dispatch each.
 */
function dispatchQueues(
  entries: UnackedMessage[],
  deps: AcknowledgmentDeps
): void {
  const queues = new Set<string>();
  for (const entry of entries) {
    queues.add(entry.queueName);
  }
  for (const queueName of queues) {
    deps.onDispatch(queueName);
  }
}

/**
 * Remove and return ALL unacked messages from a channel.
 * Used for delivery-tag 0 with multiple=true (AMQP "all messages so far").
 */
function removeAll(channel: Channel): UnackedMessage[] {
  const entries: UnackedMessage[] = [];
  for (const [, entry] of channel.unackedMessages) {
    entries.push(entry);
  }
  if (entries.length > 0) {
    let maxTag = 0;
    for (const entry of entries) {
      if (entry.deliveryTag > maxTag) {
        maxTag = entry.deliveryTag;
      }
    }
    channel.removeUnackedUpTo(maxTag);
  }
  return entries;
}

/**
 * Process entries for nack/reject: optionally requeue, then dispatch.
 */
function processNacked(
  entries: UnackedMessage[],
  requeue: boolean,
  deps: AcknowledgmentDeps
): void {
  if (requeue) {
    for (const entry of entries) {
      deps.onRequeue(entry.queueName, requeuedMessage(entry.message));
    }
  }
  dispatchQueues(entries, deps);
}

/**
 * Acknowledge a delivered message (basic.ack).
 *
 * - `multiple=false`: ack the single delivery tag
 * - `multiple=true`: ack all tags ≤ the given tag on this channel
 *
 * Throws PRECONDITION_FAILED if the tag is unknown or already acked.
 * Frees prefetch capacity and triggers re-dispatch for affected queues.
 */
export function ack(
  channel: Channel,
  deliveryTag: number,
  multiple: boolean,
  deps: AcknowledgmentDeps,
  hook?: Hook<AckCtx, AckResult>
): void {
  const existing = channel.getUnacked(deliveryTag);
  const ctx: AckCtx = {
    deliveryTag,
    multiple,
    meta: {
      messageExists:
        existing !== undefined || (multiple && channel.unackedCount > 0),
      consumerTag: existing?.consumerTag ?? '',
      queue: existing?.queueName ?? '',
    },
  };

  runHooked(hook, ctx, () => {
    channel.assertOpen();

    if (multiple) {
      const removed =
        deliveryTag === 0
          ? removeAll(channel)
          : channel.removeUnackedUpTo(deliveryTag);
      if (removed.length === 0) {
        throw channelError.preconditionFailed(
          `unknown delivery tag ${deliveryTag}`,
          BASIC_CLASS,
          BASIC_ACK
        );
      }
      dispatchQueues(removed, deps);
    } else {
      const entry = channel.removeUnacked(deliveryTag);
      if (entry === undefined) {
        throw channelError.preconditionFailed(
          `unknown delivery tag ${deliveryTag}`,
          BASIC_CLASS,
          BASIC_ACK
        );
      }
      deps.onDispatch(entry.queueName);
    }
  });
}

/**
 * Negatively acknowledge a delivered message (basic.nack — RabbitMQ extension).
 *
 * - `multiple=false`: nack the single delivery tag
 * - `multiple=true`: nack all tags ≤ the given tag on this channel
 * - `requeue=true`: return messages to queue head with redelivered flag
 * - `requeue=false`: discard messages (dead-letter in Phase 2)
 *
 * Throws PRECONDITION_FAILED if the tag is unknown or already nacked.
 */
export function nack(
  channel: Channel,
  deliveryTag: number,
  multiple: boolean,
  requeue: boolean,
  deps: AcknowledgmentDeps,
  hook?: Hook<NackCtx, NackResult>
): void {
  const existing = channel.getUnacked(deliveryTag);
  const ctx: NackCtx = {
    deliveryTag,
    multiple,
    requeue,
    meta: {
      messageExists:
        existing !== undefined || (multiple && channel.unackedCount > 0),
      willDeadLetter: !requeue,
      consumerTag: existing?.consumerTag ?? '',
      queue: existing?.queueName ?? '',
    },
  };

  runHooked(hook, ctx, () => {
    channel.assertOpen();

    if (multiple) {
      const removed =
        deliveryTag === 0
          ? removeAll(channel)
          : channel.removeUnackedUpTo(deliveryTag);
      if (removed.length === 0) {
        throw channelError.preconditionFailed(
          `unknown delivery tag ${deliveryTag}`,
          BASIC_CLASS,
          BASIC_NACK
        );
      }
      processNacked(removed, requeue, deps);
    } else {
      const entry = channel.removeUnacked(deliveryTag);
      if (entry === undefined) {
        throw channelError.preconditionFailed(
          `unknown delivery tag ${deliveryTag}`,
          BASIC_CLASS,
          BASIC_NACK
        );
      }
      processNacked([entry], requeue, deps);
    }
  });
}

/**
 * Reject a delivered message (basic.reject).
 *
 * Same as nack but for a single message only (no multiple flag).
 * - `requeue=true`: return message to queue head with redelivered flag
 * - `requeue=false`: discard message (dead-letter in Phase 2)
 *
 * Throws PRECONDITION_FAILED if the tag is unknown or already rejected.
 */
export function reject(
  channel: Channel,
  deliveryTag: number,
  requeue: boolean,
  deps: AcknowledgmentDeps,
  hook?: Hook<RejectCtx, RejectResult>
): void {
  const existing = channel.getUnacked(deliveryTag);
  const ctx: RejectCtx = {
    deliveryTag,
    requeue,
    meta: {
      messageExists: existing !== undefined,
      willDeadLetter: !requeue,
      consumerTag: existing?.consumerTag ?? '',
      queue: existing?.queueName ?? '',
    },
  };

  runHooked(hook, ctx, () => {
    channel.assertOpen();

    const entry = channel.removeUnacked(deliveryTag);
    if (entry === undefined) {
      throw channelError.preconditionFailed(
        `unknown delivery tag ${deliveryTag}`,
        BASIC_CLASS,
        BASIC_REJECT
      );
    }
    processNacked([entry], requeue, deps);
  });
}

/**
 * Acknowledge all outstanding messages on this channel.
 * Convenience wrapper equivalent to ack(maxTag, multiple=true).
 */
export function ackAll(channel: Channel, deps: AcknowledgmentDeps): void {
  channel.assertOpen();

  const entries = removeAll(channel);
  if (entries.length === 0) return;

  dispatchQueues(entries, deps);
}

/**
 * Negatively acknowledge all outstanding messages on this channel.
 * Convenience wrapper equivalent to nack(maxTag, multiple=true, requeue).
 *
 * @param requeue - Whether to requeue messages
 */
export function nackAll(
  channel: Channel,
  requeue: boolean,
  deps: AcknowledgmentDeps
): void {
  channel.assertOpen();

  const entries = removeAll(channel);
  if (entries.length === 0) return;

  processNacked(entries, requeue, deps);
}
