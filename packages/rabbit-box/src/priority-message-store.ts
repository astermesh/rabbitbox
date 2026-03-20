import type { BrokerMessage } from './types/message.ts';
import {
  MessageStore,
  type IMessageStore,
  type MessageStoreOptions,
} from './message-store.ts';

export interface PriorityMessageStoreOptions extends MessageStoreOptions {
  readonly maxPriority: number;
}

/**
 * Priority-aware message storage for queues declared with x-max-priority.
 *
 * Maintains a separate internal MessageStore (sub-queue) per priority level.
 * Higher priority messages are dequeued before lower priority. Within the
 * same priority level, FIFO ordering is preserved.
 */
export class PriorityMessageStore implements IMessageStore {
  private readonly buckets: MessageStore[];
  private readonly maxPriority: number;

  constructor(options: PriorityMessageStoreOptions) {
    this.maxPriority = options.maxPriority;
    this.buckets = [];
    for (let i = 0; i <= this.maxPriority; i++) {
      this.buckets.push(
        new MessageStore({
          messageTtl: options.messageTtl,
          now: options.now,
        })
      );
    }
  }

  private clampPriority(priority: number): number {
    return Math.max(0, Math.min(priority, this.maxPriority));
  }

  private bucket(priority: number): MessageStore {
    return this.buckets[priority] as MessageStore;
  }

  /** Add message to the appropriate priority bucket. */
  enqueue(message: BrokerMessage): BrokerMessage {
    const priority = this.clampPriority(message.priority);
    return this.bucket(priority).enqueue(message);
  }

  /** Remove and return the highest-priority head message, or null if empty. */
  dequeue(): BrokerMessage | null {
    for (let i = this.maxPriority; i >= 0; i--) {
      const msg = this.bucket(i).dequeue();
      if (msg) return msg;
    }
    return null;
  }

  /**
   * Remove and return all consecutively expired messages from each bucket.
   *
   * Drains from highest priority to lowest, applying RabbitMQ's lazy
   * head-only expiry independently per priority level.
   */
  drainExpired(now: number): BrokerMessage[] {
    const expired: BrokerMessage[] = [];
    for (let i = this.maxPriority; i >= 0; i--) {
      const bucketExpired = this.bucket(i).drainExpired(now);
      for (const msg of bucketExpired) {
        expired.push(msg);
      }
    }
    return expired;
  }

  /** Read the highest-priority head message without removing, or null if empty. */
  peek(): BrokerMessage | null {
    for (let i = this.maxPriority; i >= 0; i--) {
      const msg = this.bucket(i).peek();
      if (msg) return msg;
    }
    return null;
  }

  /** Total message count across all priority levels. */
  count(): number {
    let total = 0;
    for (const bucket of this.buckets) {
      total += bucket.count();
    }
    return total;
  }

  /** Total byte size of all stored message bodies across all priority levels. */
  byteSize(): number {
    let total = 0;
    for (const bucket of this.buckets) {
      total += bucket.byteSize();
    }
    return total;
  }

  /** Remove all messages from all priority levels. Returns total purged count. */
  purge(): number {
    let total = 0;
    for (const bucket of this.buckets) {
      total += bucket.purge();
    }
    return total;
  }

  /**
   * Reinsert a message into the appropriate priority bucket.
   *
   * Position semantics are the same as MessageStore.requeue —
   * applied within the message's priority-level sub-queue.
   */
  requeue(message: BrokerMessage, position?: 'head' | number): void {
    const priority = this.clampPriority(message.priority);
    this.bucket(priority).requeue(message, position);
  }
}
