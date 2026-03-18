import type { BrokerMessage } from './types/message.ts';
import type { UnackedMessage } from './types/consumer.ts';
import { connectionError } from './errors/factories.ts';

/** AMQP class/method IDs for channel operations. */
const CHANNEL_CLASS = 20;
const CHANNEL_CLOSE = 40;

export type ChannelState = 'open' | 'closing' | 'closed';

/**
 * Dependencies injected into a channel by its parent connection.
 */
export interface ChannelDeps {
  /** Requeue a message back to its originating queue. */
  readonly onRequeue: (queueName: string, message: BrokerMessage) => void;
  /** Notify parent connection that this channel has closed. */
  readonly onClose: (channelNumber: number) => void;
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
