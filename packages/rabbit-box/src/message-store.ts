import type { BrokerMessage } from './types/message.ts';

export interface MessageStoreOptions {
  readonly messageTtl?: number;
  /** Time provider for timestamps. Defaults to Date.now(). */
  readonly now?: () => number;
}

/**
 * Common contract for message stores (FIFO and priority-aware).
 *
 * Both MessageStore (plain FIFO) and PriorityMessageStore implement
 * this interface so they can be used interchangeably by the dispatcher,
 * overflow logic, and publish pipeline.
 */
export interface IMessageStore {
  enqueue(message: BrokerMessage): BrokerMessage;
  dequeue(): BrokerMessage | null;
  drainExpired(now: number): BrokerMessage[];
  peek(): BrokerMessage | null;
  count(): number;
  byteSize(): number;
  purge(): number;
  requeue(message: BrokerMessage, position?: 'head' | number): void;
}

/**
 * Per-queue FIFO message storage.
 *
 * Maintains strict FIFO ordering and accurate byte-size tracking.
 * Handles TTL computation on enqueue (both per-message and per-queue).
 */
export class MessageStore implements IMessageStore {
  private messages: BrokerMessage[] = [];
  private totalByteSize = 0;
  private readonly messageTtl: number | undefined;
  private readonly now: () => number;

  constructor(options?: MessageStoreOptions) {
    this.messageTtl = options?.messageTtl;
    this.now = options?.now ?? (() => Date.now());
  }

  /** Add message to tail. Sets enqueuedAt and computes expiresAt from TTL. */
  enqueue(message: BrokerMessage): BrokerMessage {
    const enqueuedAt = this.now();
    const expiresAt = this.computeExpiresAt(enqueuedAt, message);

    const stored: BrokerMessage = {
      ...message,
      enqueuedAt,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };

    this.messages.push(stored);
    this.totalByteSize += stored.body.byteLength;
    return stored;
  }

  /** Remove and return head message, or null if empty. */
  dequeue(): BrokerMessage | null {
    const message = this.messages.shift();
    if (message === undefined) return null;
    this.totalByteSize -= message.body.byteLength;
    return message;
  }

  /**
   * Remove and return all consecutively expired messages from the head.
   *
   * Stops at the first non-expired message or a message without expiresAt.
   * Uses strict less-than: a message with expiresAt === now is NOT expired,
   * matching RabbitMQ's TTL=0 behavior (deliver if consumer ready, expire otherwise).
   *
   * This implements RabbitMQ's lazy expiry at queue head — messages behind
   * a non-expired head never expire independently (per-message TTL quirk).
   */
  drainExpired(now: number): BrokerMessage[] {
    const expired: BrokerMessage[] = [];
    while (this.messages.length > 0) {
      const head = this.messages[0] as BrokerMessage;
      if (head.expiresAt !== undefined && head.expiresAt < now) {
        this.messages.shift();
        this.totalByteSize -= head.body.byteLength;
        expired.push(head);
      } else {
        break;
      }
    }
    return expired;
  }

  /** Read head message without removing, or null if empty. */
  peek(): BrokerMessage | null {
    return this.messages[0] ?? null;
  }

  /** Current message count. */
  count(): number {
    return this.messages.length;
  }

  /** Total byte size of all stored message bodies. */
  byteSize(): number {
    return this.totalByteSize;
  }

  /** Remove all messages. Returns the number of messages purged. */
  purge(): number {
    const count = this.messages.length;
    this.messages = [];
    this.totalByteSize = 0;
    return count;
  }

  /**
   * Reinsert a message (e.g. after nack/reject with requeue).
   *
   * - No position or `'head'`: insert at head (front of queue)
   * - Numeric position: insert at that index (clamped to bounds)
   */
  requeue(message: BrokerMessage, position?: 'head' | number): void {
    const index =
      position === undefined || position === 'head'
        ? 0
        : Math.max(0, Math.min(position, this.messages.length));

    this.messages.splice(index, 0, message);
    this.totalByteSize += message.body.byteLength;
  }

  private computeExpiresAt(
    enqueuedAt: number,
    message: BrokerMessage
  ): number | undefined {
    const parsed =
      message.properties.expiration !== undefined
        ? parseInt(message.properties.expiration, 10)
        : undefined;
    // Invalid expiration strings are ignored (matches RabbitMQ behavior)
    const perMessageTtl =
      parsed !== undefined && !Number.isNaN(parsed) ? parsed : undefined;

    if (perMessageTtl !== undefined && this.messageTtl !== undefined) {
      return enqueuedAt + Math.min(perMessageTtl, this.messageTtl);
    }
    if (perMessageTtl !== undefined) {
      return enqueuedAt + perMessageTtl;
    }
    if (this.messageTtl !== undefined) {
      return enqueuedAt + this.messageTtl;
    }
    return undefined;
  }
}
