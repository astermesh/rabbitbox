import type { BrokerMessage, DeliveredMessage } from './types/message.ts';
import type { UnackedMessage } from './types/consumer.ts';
import { connectionError } from './errors/factories.ts';

/** AMQP class/method IDs for channel operations. */
const CHANNEL_CLASS = 20;
const CHANNEL_CLOSE = 40;

export type ChannelState = 'open' | 'closing' | 'closed';

/** Options for basic.get. */
export interface GetOptions {
  readonly noAck?: boolean;
}

/** Result returned by checkQueue (passive declare). */
export interface CheckQueueResult {
  readonly queue: string;
  readonly messageCount: number;
  readonly consumerCount: number;
}

/** Result of dequeuing a message from a queue. */
export interface DequeueResult {
  readonly message: BrokerMessage | null;
  readonly messageCount: number;
}

/**
 * Dependencies injected into a channel by its parent connection.
 */
export interface ChannelDeps {
  /** Requeue a message back to its originating queue. */
  readonly onRequeue: (queueName: string, message: BrokerMessage) => void;
  /** Notify parent connection that this channel has closed. */
  readonly onClose: (channelNumber: number) => void;
  /** Dequeue one message from a queue. Used by basic.get. */
  readonly onDequeue?: (queueName: string) => DequeueResult;
  /** Check that an exchange exists. Throws ChannelError NOT_FOUND if missing. */
  readonly onCheckExchange?: (name: string) => void;
  /** Check that a queue exists. Throws ChannelError NOT_FOUND if missing. */
  readonly onCheckQueue?: (name: string) => CheckQueueResult;
}

/**
 * In-process AMQP channel model.
 *
 * Each channel maintains its own delivery tag sequence, tracks unacknowledged
 * messages, and supports flow control. Closing a channel requeues all unacked
 * messages (matching real RabbitMQ behavior).
 */
export class Channel {
  readonly channelNumber: number;
  private state: ChannelState = 'open';
  private deliveryTagSeq = 0;
  private readonly _unacked = new Map<number, UnackedMessage>();
  private flowActive = true;
  private readonly deps: ChannelDeps;

  constructor(channelNumber: number, deps: ChannelDeps) {
    this.channelNumber = channelNumber;
    this.deps = deps;
  }

  getState(): ChannelState {
    return this.state;
  }

  /**
   * Generate the next delivery tag for this channel.
   * Tags start at 1 and increment per delivery (per-channel scope).
   */
  nextDeliveryTag(): number {
    this.assertOpen();
    return ++this.deliveryTagSeq;
  }

  /**
   * Throw if the channel is not in the open state.
   *
   * In real RabbitMQ, using a closed channel number triggers CHANNEL_ERROR (504).
   */
  assertOpen(): void {
    if (this.state !== 'open') {
      throw connectionError.channelError(
        `channel ${this.channelNumber} already closed`,
        CHANNEL_CLASS,
        CHANNEL_CLOSE
      );
    }
  }

  /** Record a message as unacknowledged on this channel. */
  trackUnacked(
    deliveryTag: number,
    message: BrokerMessage,
    queueName: string
  ): void {
    this._unacked.set(deliveryTag, { deliveryTag, message, queueName });
  }

  /** Retrieve an unacked message by delivery tag. */
  getUnacked(deliveryTag: number): UnackedMessage | undefined {
    return this._unacked.get(deliveryTag);
  }

  /** Read-only view of all unacknowledged messages. */
  get unackedMessages(): ReadonlyMap<number, UnackedMessage> {
    return this._unacked;
  }

  /** Number of unacknowledged messages on this channel. */
  get unackedCount(): number {
    return this._unacked.size;
  }

  /** Remove and return an unacked message by delivery tag. */
  removeUnacked(deliveryTag: number): UnackedMessage | undefined {
    const entry = this._unacked.get(deliveryTag);
    if (entry) {
      this._unacked.delete(deliveryTag);
    }
    return entry;
  }

  /**
   * Remove all unacked messages up to and including the given delivery tag.
   * Used for basic.ack with multiple=true.
   * Returns the removed entries.
   */
  removeUnackedUpTo(deliveryTag: number): UnackedMessage[] {
    const removed: UnackedMessage[] = [];
    for (const [tag, entry] of this._unacked) {
      if (tag <= deliveryTag) {
        removed.push(entry);
        this._unacked.delete(tag);
      }
    }
    return removed;
  }

  /**
   * Enable or disable content flow on this channel.
   * Returns true if the flow state actually changed.
   */
  setFlow(active: boolean): boolean {
    this.assertOpen();
    const changed = this.flowActive !== active;
    this.flowActive = active;
    return changed;
  }

  /** Whether content delivery is currently active on this channel. */
  isFlowActive(): boolean {
    return this.flowActive;
  }

  /**
   * Poll a single message from a queue (basic.get).
   *
   * Not affected by prefetch count. If noAck is false (default), the message
   * is tracked in the unacked map with a delivery tag.
   */
  get(queueName: string, options?: GetOptions): DeliveredMessage | null {
    this.assertOpen();

    if (!this.deps.onDequeue) {
      throw new Error('onDequeue dependency not provided');
    }

    const { message, messageCount } = this.deps.onDequeue(queueName);
    if (!message) return null;

    const noAck = options?.noAck ?? false;
    const deliveryTag = this.nextDeliveryTag();

    if (!noAck) {
      this.trackUnacked(deliveryTag, message, queueName);
    }

    return {
      deliveryTag,
      redelivered: message.deliveryCount > 0,
      exchange: message.exchange,
      routingKey: message.routingKey,
      messageCount,
      body: message.body,
      properties: message.properties,
    };
  }

  /**
   * Recover all unacknowledged messages on this channel (basic.recover).
   *
   * RabbitMQ ignores the requeue parameter — it always requeues regardless.
   * RabbitBox matches this behavior. Requeued messages get redelivered=true.
   */
  recover(_requeue?: boolean): void {
    this.assertOpen();

    for (const [, entry] of this._unacked) {
      const requeued: BrokerMessage = {
        ...entry.message,
        deliveryCount: entry.message.deliveryCount + 1,
      };
      this.deps.onRequeue(entry.queueName, requeued);
    }
    this._unacked.clear();
  }

  /**
   * Passive exchange declare — verify an exchange exists.
   *
   * Delegates to the exchange registry. Throws a channel error (NOT_FOUND)
   * if the exchange does not exist.
   */
  checkExchange(name: string): void {
    this.assertOpen();

    if (!this.deps.onCheckExchange) {
      throw new Error('onCheckExchange dependency not provided');
    }

    this.deps.onCheckExchange(name);
  }

  /**
   * Passive queue declare — verify a queue exists and get its stats.
   *
   * Delegates to the queue registry. Throws a channel error (NOT_FOUND)
   * if the queue does not exist.
   */
  checkQueue(name: string): CheckQueueResult {
    this.assertOpen();

    if (!this.deps.onCheckQueue) {
      throw new Error('onCheckQueue dependency not provided');
    }

    return this.deps.onCheckQueue(name);
  }

  /**
   * Close this channel.
   *
   * Requeues all unacknowledged messages to their original queues and notifies
   * the parent connection. Idempotent — calling close() on an already-closed
   * channel is a no-op.
   */
  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closing';

    // Requeue all unacked messages to their original queues
    for (const [, entry] of this._unacked) {
      this.deps.onRequeue(entry.queueName, entry.message);
    }
    this._unacked.clear();

    this.state = 'closed';
    this.deps.onClose(this.channelNumber);
  }
}
