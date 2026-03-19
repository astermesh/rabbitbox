import type { BrokerMessage, DeliveredMessage } from './types/message.ts';
import type { UnackedMessage } from './types/consumer.ts';
import type {
  Hook,
  GetCtx,
  GetResult as SbiGetResult,
  RecoverCtx,
  RecoverResult,
  CheckExchangeCtx,
  CheckExchangeResult,
  CheckQueueCtx,
  CheckQueueResult as SbiCheckQueueResult,
  PrefetchCtx,
  PrefetchResult,
  ConfirmSelectCtx,
  ConfirmSelectResult,
} from '@rabbitbox/sbi';
import { connectionError } from './errors/factories.ts';
import { runHooked } from './hook-runner.ts';

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
/** Optional hooks for channel operations. */
export interface ChannelHooks {
  readonly get?: Hook<GetCtx, SbiGetResult>;
  readonly recover?: Hook<RecoverCtx, RecoverResult>;
  readonly checkExchange?: Hook<CheckExchangeCtx, CheckExchangeResult>;
  readonly checkQueue?: Hook<CheckQueueCtx, SbiCheckQueueResult>;
  readonly prefetch?: Hook<PrefetchCtx, PrefetchResult>;
  readonly confirmSelect?: Hook<ConfirmSelectCtx, ConfirmSelectResult>;
}

export class Channel {
  readonly channelNumber: number;
  private state: ChannelState = 'open';
  private deliveryTagSeq = 0;
  private readonly _unacked = new Map<number, UnackedMessage>();
  private flowActive = true;
  private readonly deps: ChannelDeps;
  private readonly hooks: ChannelHooks;

  /**
   * Per-consumer prefetch limit (basic.qos with global=false).
   * In RabbitMQ, global=false means per-consumer, not per-channel.
   * 0 = unlimited.
   */
  private _consumerPrefetch = 0;

  /**
   * Per-channel shared prefetch limit (basic.qos with global=true).
   * Applies to total unacked messages across all consumers on this channel.
   * 0 = unlimited.
   */
  private _channelPrefetch = 0;

  /** Whether publisher confirms are enabled on this channel. */
  private _confirmMode = false;

  constructor(channelNumber: number, deps: ChannelDeps, hooks?: ChannelHooks) {
    this.channelNumber = channelNumber;
    this.deps = deps;
    this.hooks = hooks ?? {};
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

  /**
   * Set prefetch count (basic.qos).
   *
   * RabbitMQ semantics:
   * - global=false → per-consumer limit (each consumer can have up to count unacked)
   * - global=true  → per-channel shared limit (total unacked across all consumers)
   *
   * A count of 0 means unlimited.
   */
  setPrefetch(count: number, global: boolean): void {
    const ctx: PrefetchCtx = {
      count,
      global,
      meta: {
        previousCount: global ? this._channelPrefetch : this._consumerPrefetch,
        channelConsumerCount: 0, // populated by caller if needed
      },
    };

    runHooked(this.hooks.prefetch, ctx, () => {
      this.assertOpen();
      if (global) {
        this._channelPrefetch = count;
      } else {
        this._consumerPrefetch = count;
      }
    });
  }

  /** Per-consumer prefetch limit (0 = unlimited). */
  get consumerPrefetch(): number {
    return this._consumerPrefetch;
  }

  /** Per-channel shared prefetch limit (0 = unlimited). */
  get channelPrefetch(): number {
    return this._channelPrefetch;
  }

  /** Record a message as unacknowledged on this channel. */
  trackUnacked(
    deliveryTag: number,
    message: BrokerMessage,
    queueName: string,
    consumerTag: string
  ): void {
    this._unacked.set(deliveryTag, {
      deliveryTag,
      message,
      queueName,
      consumerTag,
    });
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
    const noAck = options?.noAck ?? false;
    const ctx: GetCtx = {
      queue: queueName,
      noAck,
      meta: {
        queueExists: true, // caller validates queue existence
        messageCount: 0,
        consumerCount: 0,
      },
    };

    // No-hook fast path or hook integration
    if (!this.hooks.get) {
      return this.doGet(queueName, noAck);
    }

    const result = runHooked(this.hooks.get, ctx, () => {
      const delivered = this.doGet(queueName, noAck);
      if (!delivered) return null;
      return {
        deliveryTag: delivered.deliveryTag,
        redelivered: delivered.redelivered,
        exchange: delivered.exchange,
        routingKey: delivered.routingKey,
        messageCount: delivered.messageCount,
        body: delivered.body,
        properties: delivered.properties as Record<string, unknown>,
      };
    });

    return result as DeliveredMessage | null;
  }

  /** Internal get implementation shared by hooked and non-hooked paths. */
  private doGet(queueName: string, noAck: boolean): DeliveredMessage | null {
    this.assertOpen();

    if (!this.deps.onDequeue) {
      throw new Error('onDequeue dependency not provided');
    }

    const { message, messageCount } = this.deps.onDequeue(queueName);
    if (!message) return null;

    const deliveryTag = this.nextDeliveryTag();

    if (!noAck) {
      this.trackUnacked(deliveryTag, message, queueName, '');
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
    const ctx: RecoverCtx = {
      requeue: true, // RabbitMQ always requeues regardless of flag
      meta: {
        unackedCount: this._unacked.size,
      },
    };

    runHooked(this.hooks.recover, ctx, () => {
      this.assertOpen();

      for (const [, entry] of this._unacked) {
        const requeued: BrokerMessage = {
          ...entry.message,
          deliveryCount: entry.message.deliveryCount + 1,
        };
        this.deps.onRequeue(entry.queueName, requeued);
      }
      this._unacked.clear();
    });
  }

  /**
   * Passive exchange declare — verify an exchange exists.
   *
   * Delegates to the exchange registry. Throws a channel error (NOT_FOUND)
   * if the exchange does not exist.
   */
  checkExchange(name: string): void {
    const ctx: CheckExchangeCtx = {
      name,
      meta: {
        exists: true, // populated optimistically; eng throws if not found
      },
    };

    runHooked(this.hooks.checkExchange, ctx, () => {
      this.assertOpen();

      if (!this.deps.onCheckExchange) {
        throw new Error('onCheckExchange dependency not provided');
      }

      this.deps.onCheckExchange(name);
    });
  }

  /**
   * Passive queue declare — verify a queue exists and get its stats.
   *
   * Delegates to the queue registry. Throws a channel error (NOT_FOUND)
   * if the queue does not exist.
   */
  checkQueue(name: string): CheckQueueResult {
    const ctx: CheckQueueCtx = {
      name,
      meta: {
        exists: true,
        messageCount: 0,
        consumerCount: 0,
      },
    };

    return runHooked(this.hooks.checkQueue, ctx, () => {
      this.assertOpen();

      if (!this.deps.onCheckQueue) {
        throw new Error('onCheckQueue dependency not provided');
      }

      return this.deps.onCheckQueue(name);
    }) as CheckQueueResult;
  }

  /** Whether publisher confirms mode is active. */
  get confirmMode(): boolean {
    return this._confirmMode;
  }

  /**
   * Enable publisher confirms on this channel (confirm.select).
   */
  confirmSelect(): void {
    const ctx: ConfirmSelectCtx = {
      meta: {
        alreadyInConfirmMode: this._confirmMode,
        channelIsTransactional: false,
      },
    };

    runHooked(this.hooks.confirmSelect, ctx, () => {
      this.assertOpen();
      this._confirmMode = true;
    });
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

    // Requeue all unacked messages to their original queues.
    // In real RabbitMQ, channel-close requeues set redelivered=true.
    for (const [, entry] of this._unacked) {
      const requeued: BrokerMessage = {
        ...entry.message,
        deliveryCount: entry.message.deliveryCount + 1,
      };
      this.deps.onRequeue(entry.queueName, requeued);
    }
    this._unacked.clear();

    this.state = 'closed';
    this.deps.onClose(this.channelNumber);
  }
}
