import type { DeliveredMessage } from './types/message.ts';
import { channelError } from './errors/factories.ts';

/** AMQP class/method IDs for basic operations. */
const BASIC_CLASS = 60;
const BASIC_CONSUME = 20;

/** Options for registering a consumer. */
export interface ConsumeOptions {
  readonly consumerTag?: string;
  readonly exclusive?: boolean;
  readonly noAck?: boolean;
}

/** Internal mutable consumer entry. */
export interface ConsumerEntry {
  readonly consumerTag: string;
  readonly queueName: string;
  readonly channelNumber: number;
  readonly callback: (msg: DeliveredMessage) => void;
  readonly noAck: boolean;
  readonly exclusive: boolean;
  unackedCount: number;
}

export interface ConsumerRegistryOptions {
  /** Check if a queue exists before registering a consumer. */
  readonly queueExists?: (name: string) => boolean;
  /** Generate a consumer tag. */
  readonly generateTag?: () => string;
}

let tagCounter = 0;
function defaultGenerateTag(): string {
  return `amq.ctag-${++tagCounter}`;
}

/**
 * Registry for consumer subscriptions.
 *
 * Manages consumer registration, cancellation, and lookup by tag or queue.
 * Enforces exclusive consumer semantics per queue.
 */
export class ConsumerRegistry {
  private readonly byTag = new Map<string, ConsumerEntry>();
  private readonly byQueue = new Map<string, ConsumerEntry[]>();
  private readonly generateTag: () => string;
  private readonly queueExists: ((name: string) => boolean) | undefined;

  constructor(options?: ConsumerRegistryOptions) {
    this.generateTag = options?.generateTag ?? defaultGenerateTag;
    this.queueExists = options?.queueExists;
  }

  /**
   * Register a consumer on a queue.
   *
   * @returns The consumer tag (generated or provided).
   */
  register(
    queueName: string,
    channelNumber: number,
    callback: (msg: DeliveredMessage) => void,
    options: ConsumeOptions
  ): string {
    // Validate queue exists
    if (this.queueExists && !this.queueExists(queueName)) {
      throw channelError.notFound(
        `no queue '${queueName}' in vhost '/'`,
        BASIC_CLASS,
        BASIC_CONSUME
      );
    }

    const consumerTag = options.consumerTag || this.generateTag();

    // Reject duplicate tag
    if (this.byTag.has(consumerTag)) {
      throw channelError.notFound(
        `consumer tag '${consumerTag}' already in use`,
        BASIC_CLASS,
        BASIC_CONSUME
      );
    }

    const exclusive = options.exclusive ?? false;
    const noAck = options.noAck ?? false;

    const queueConsumers = this.byQueue.get(queueName) ?? [];

    // Exclusive validation
    if (exclusive && queueConsumers.length > 0) {
      throw channelError.accessRefused(
        `cannot obtain exclusive access to queue '${queueName}'`,
        BASIC_CLASS,
        BASIC_CONSUME
      );
    }
    if (queueConsumers.length > 0 && queueConsumers.some((c) => c.exclusive)) {
      throw channelError.accessRefused(
        `queue '${queueName}' has an exclusive consumer`,
        BASIC_CLASS,
        BASIC_CONSUME
      );
    }

    const entry: ConsumerEntry = {
      consumerTag,
      queueName,
      channelNumber,
      callback,
      noAck,
      exclusive,
      unackedCount: 0,
    };

    this.byTag.set(consumerTag, entry);
    queueConsumers.push(entry);
    this.byQueue.set(queueName, queueConsumers);

    return consumerTag;
  }

  /**
   * Cancel a consumer by tag.
   *
   * @returns The cancelled consumer entry, or undefined if not found.
   */
  cancel(consumerTag: string): ConsumerEntry | undefined {
    const entry = this.byTag.get(consumerTag);
    if (!entry) return undefined;

    this.byTag.delete(consumerTag);

    const queueConsumers = this.byQueue.get(entry.queueName);
    if (queueConsumers) {
      const idx = queueConsumers.indexOf(entry);
      if (idx !== -1) {
        queueConsumers.splice(idx, 1);
      }
      if (queueConsumers.length === 0) {
        this.byQueue.delete(entry.queueName);
      }
    }

    return entry;
  }

  /**
   * Cancel all consumers for a given channel.
   *
   * @returns Array of cancelled consumer entries.
   */
  cancelByChannel(channelNumber: number): ConsumerEntry[] {
    const cancelled: ConsumerEntry[] = [];
    for (const [tag, entry] of this.byTag) {
      if (entry.channelNumber === channelNumber) {
        cancelled.push(entry);
        this.byTag.delete(tag);

        const queueConsumers = this.byQueue.get(entry.queueName);
        if (queueConsumers) {
          const idx = queueConsumers.indexOf(entry);
          if (idx !== -1) {
            queueConsumers.splice(idx, 1);
          }
          if (queueConsumers.length === 0) {
            this.byQueue.delete(entry.queueName);
          }
        }
      }
    }
    return cancelled;
  }

  /** Get a consumer by tag. */
  getConsumer(consumerTag: string): ConsumerEntry | undefined {
    return this.byTag.get(consumerTag);
  }

  /** Get all consumers for a queue, in registration order. */
  getConsumersForQueue(queueName: string): readonly ConsumerEntry[] {
    return this.byQueue.get(queueName) ?? [];
  }

  /** Number of consumers on a queue. */
  getConsumerCount(queueName: string): number {
    return this.byQueue.get(queueName)?.length ?? 0;
  }

  /** Increment unacked count for a consumer. */
  incrementUnacked(consumerTag: string): void {
    const entry = this.byTag.get(consumerTag);
    if (entry) {
      entry.unackedCount++;
    }
  }

  /** Decrement unacked count for a consumer (floors at 0). */
  decrementUnacked(consumerTag: string): void {
    const entry = this.byTag.get(consumerTag);
    if (entry && entry.unackedCount > 0) {
      entry.unackedCount--;
    }
  }
}
