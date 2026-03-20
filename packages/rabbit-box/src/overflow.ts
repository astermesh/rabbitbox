import type { Queue } from './types/queue.ts';
import type { IMessageStore } from './message-store.ts';
import type { BrokerMessage } from './types/message.ts';

export interface EnqueueWithOverflowResult {
  /** Whether the message was successfully enqueued. */
  readonly enqueued: boolean;
  /** Messages dropped from head due to drop-head overflow. */
  readonly dropped: BrokerMessage[];
}

export interface OverflowContext {
  readonly queue: Queue;
  readonly store: IMessageStore;
}

/**
 * Enqueue a message with overflow policy enforcement.
 *
 * - drop-head (default): enqueue, then remove excess from head
 * - reject-publish: reject if queue is already at capacity
 * - reject-publish-dlx: same as reject-publish (caller handles dead-lettering)
 */
export function enqueueWithOverflow(
  message: BrokerMessage,
  ctx: OverflowContext
): EnqueueWithOverflowResult {
  const { queue, store } = ctx;
  const overflow = queue.overflowBehavior ?? 'drop-head';
  const hasLimits =
    queue.maxLength !== undefined || queue.maxLengthBytes !== undefined;

  if (!hasLimits) {
    store.enqueue(message);
    return { enqueued: true, dropped: [] };
  }

  if (overflow === 'reject-publish' || overflow === 'reject-publish-dlx') {
    if (isAtLimit(queue, store)) {
      return { enqueued: false, dropped: [] };
    }
    store.enqueue(message);
    return { enqueued: true, dropped: [] };
  }

  // drop-head: enqueue first, then drop excess from head
  store.enqueue(message);
  const dropped: BrokerMessage[] = [];
  while (isOverLimit(queue, store)) {
    const msg = store.dequeue();
    if (msg) dropped.push(msg);
    else break;
  }
  return { enqueued: true, dropped };
}

/** Queue is at or above its limit — no room for a new message. */
function isAtLimit(queue: Queue, store: IMessageStore): boolean {
  if (queue.maxLength !== undefined && store.count() >= queue.maxLength)
    return true;
  if (
    queue.maxLengthBytes !== undefined &&
    store.byteSize() >= queue.maxLengthBytes
  )
    return true;
  return false;
}

/** Queue has exceeded its limit — needs to drop from head. */
function isOverLimit(queue: Queue, store: IMessageStore): boolean {
  if (queue.maxLength !== undefined && store.count() > queue.maxLength)
    return true;
  if (
    queue.maxLengthBytes !== undefined &&
    store.byteSize() > queue.maxLengthBytes
  )
    return true;
  return false;
}
