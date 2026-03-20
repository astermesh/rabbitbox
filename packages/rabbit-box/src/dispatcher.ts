import type { ConsumerRegistry, ConsumerEntry } from './consumer-registry.ts';
import type { Channel } from './channel.ts';
import type { IMessageStore } from './message-store.ts';
import type { DeliveredMessage, BrokerMessage } from './types/message.ts';

/**
 * Round-robin message dispatcher with prefetch enforcement.
 *
 * Delivers messages from a queue's message store to registered consumers,
 * rotating fairly across consumers and respecting both per-consumer and
 * per-channel prefetch limits. Handles lazy TTL expiry at queue head
 * before delivery.
 *
 * Supports consumer priorities: higher-priority consumers receive messages
 * first, with round-robin within the same priority level. Lower-priority
 * consumers only receive messages when all higher-priority consumers are
 * at their prefetch limits.
 */
export interface DispatcherOptions {
  /** Async delivery scheduler. Defaults to queueMicrotask(). */
  readonly schedule?: (callback: () => void) => void;
  /** Time provider for TTL expiry checks. Defaults to Date.now(). */
  readonly now?: () => number;
  /** Called for each message that expires at queue head during dispatch. */
  readonly onExpire?: (queueName: string, message: BrokerMessage) => void;
}

export class Dispatcher {
  private readonly registry: ConsumerRegistry;
  /** Per-queue round-robin index (used for uniform-priority fast path). */
  private readonly rrIndex = new Map<string, number>();
  /** Per-queue-per-priority round-robin index (used for mixed-priority dispatch). */
  private readonly priorityRrIndex = new Map<string, number>();
  private readonly schedule: (callback: () => void) => void;
  private readonly now: () => number;
  private readonly onExpire:
    | ((queueName: string, message: BrokerMessage) => void)
    | undefined;

  constructor(registry: ConsumerRegistry, options?: DispatcherOptions) {
    this.registry = registry;
    this.schedule = options?.schedule ?? ((cb) => queueMicrotask(cb));
    this.now = options?.now ?? (() => Date.now());
    this.onExpire = options?.onExpire;
  }

  /**
   * Dispatch pending messages from a queue to its consumers.
   *
   * Implements fair round-robin: rotates through consumers starting from
   * the last position, skipping consumers at their prefetch limit or
   * whose channel is unavailable/paused. Holds messages in the queue
   * when all consumers are at their limits.
   *
   * @param queueName - Queue to dispatch from
   * @param store - Message store for the queue
   * @param getChannel - Lookup function to resolve channel by number
   */
  dispatch(
    queueName: string,
    store: IMessageStore,
    getChannel: (channelNumber: number) => Channel | undefined
  ): void {
    // Drain expired messages from queue head (lazy expiry).
    // Must happen before consumer check: expired messages are removed
    // even when no consumers are registered.
    const expired = store.drainExpired(this.now());
    if (this.onExpire) {
      for (const message of expired) {
        this.onExpire(queueName, message);
      }
    }

    const consumers = this.registry.getConsumersForQueue(queueName);
    if (consumers.length === 0) return;

    // Single active consumer: deliver only to the active (first) consumer
    if (this.registry.isSingleActiveConsumer(queueName)) {
      const activeConsumer = consumers[0];
      if (activeConsumer) {
        this.dispatchSAC(activeConsumer, store, getChannel);
      }
      return;
    }

    // Check if consumers have mixed priorities.
    // Consumers are sorted by priority descending, so comparing first and last
    // is sufficient to detect mixed priorities.
    const first = consumers[0];
    const last = consumers[consumers.length - 1];
    const hasMixedPriorities =
      consumers.length > 1 &&
      first !== undefined &&
      last !== undefined &&
      first.priority !== last.priority;

    if (hasMixedPriorities) {
      this.dispatchWithPriority(queueName, consumers, store, getChannel);
    } else {
      this.dispatchRoundRobin(queueName, consumers, store, getChannel);
    }
  }

  /**
   * Standard round-robin dispatch for consumers at the same priority level.
   */
  private dispatchRoundRobin(
    queueName: string,
    consumers: readonly ConsumerEntry[],
    store: IMessageStore,
    getChannel: (channelNumber: number) => Channel | undefined
  ): void {
    let startIndex = this.rrIndex.get(queueName) ?? 0;

    while (store.count() > 0) {
      const eligible = this.findEligibleRoundRobin(
        consumers,
        startIndex,
        getChannel
      );
      if (!eligible) break;

      const message = store.dequeue();
      if (!message) break;

      this.deliver(eligible.consumer, eligible.channel, message);
      startIndex = eligible.nextIndex;
      this.rrIndex.set(queueName, startIndex);
    }
  }

  /**
   * Priority-aware dispatch: try highest priority level first, with
   * round-robin within each level. Only falls through to lower priority
   * when all consumers at higher priority are at their prefetch limits.
   */
  private dispatchWithPriority(
    queueName: string,
    consumers: readonly ConsumerEntry[],
    store: IMessageStore,
    getChannel: (channelNumber: number) => Channel | undefined
  ): void {
    while (store.count() > 0) {
      const eligible = this.findEligibleByPriority(
        queueName,
        consumers,
        getChannel
      );
      if (!eligible) break;

      const message = store.dequeue();
      if (!message) break;

      this.deliver(eligible.consumer, eligible.channel, message);
    }
  }

  /**
   * Find the next eligible consumer respecting priority levels.
   *
   * Groups consumers by priority (they are already sorted descending).
   * For each priority level from highest to lowest, tries round-robin
   * within that level. Returns the first eligible consumer found.
   */
  private findEligibleByPriority(
    queueName: string,
    consumers: readonly ConsumerEntry[],
    getChannel: (channelNumber: number) => Channel | undefined
  ): { consumer: ConsumerEntry; channel: Channel } | null {
    // Group consumers by priority (consumers are sorted by priority desc)
    let groupStart = 0;
    while (groupStart < consumers.length) {
      const startEntry = consumers[groupStart];
      if (!startEntry) break;
      const currentPriority = startEntry.priority;
      let groupEnd = groupStart + 1;
      while (groupEnd < consumers.length) {
        const entry = consumers[groupEnd];
        if (!entry || entry.priority !== currentPriority) break;
        groupEnd++;
      }

      const group = consumers.slice(groupStart, groupEnd);
      const rrKey = `${queueName}:${currentPriority}`;
      const rrStart = this.priorityRrIndex.get(rrKey) ?? 0;

      const result = this.findEligibleRoundRobin(group, rrStart, getChannel);
      if (result) {
        this.priorityRrIndex.set(rrKey, result.nextIndex);
        return { consumer: result.consumer, channel: result.channel };
      }

      // No eligible consumer at this priority → try lower
      groupStart = groupEnd;
    }

    return null;
  }

  /**
   * Dispatch messages to the single active consumer only.
   *
   * Respects prefetch limits. Messages stay in the queue when
   * the active consumer is unavailable or at its prefetch limit.
   * Inactive consumers never receive messages.
   */
  private dispatchSAC(
    activeConsumer: ConsumerEntry,
    store: IMessageStore,
    getChannel: (channelNumber: number) => Channel | undefined
  ): void {
    const channel = getChannel(activeConsumer.channelNumber);
    if (!channel || !channel.isFlowActive()) return;

    while (store.count() > 0) {
      if (!activeConsumer.noAck) {
        if (
          channel.consumerPrefetch > 0 &&
          activeConsumer.unackedCount >= channel.consumerPrefetch
        ) {
          break;
        }
        if (
          channel.channelPrefetch > 0 &&
          channel.unackedCount >= channel.channelPrefetch
        ) {
          break;
        }
      }

      const message = store.dequeue();
      if (!message) break;

      this.deliver(activeConsumer, channel, message);
    }
  }

  /**
   * Find the next eligible consumer using round-robin rotation.
   *
   * Scans all consumers starting from startIndex, wrapping around.
   * A consumer is eligible if:
   * - Its channel exists and has flow active
   * - It is not at its per-consumer prefetch limit (or is noAck)
   * - Its channel is not at the per-channel prefetch limit (or consumer is noAck)
   */
  private findEligibleRoundRobin(
    consumers: readonly ConsumerEntry[],
    startIndex: number,
    getChannel: (channelNumber: number) => Channel | undefined
  ): { consumer: ConsumerEntry; channel: Channel; nextIndex: number } | null {
    const len = consumers.length;

    for (let i = 0; i < len; i++) {
      const idx = (startIndex + i) % len;
      const consumer = consumers[idx];
      if (!consumer) continue;

      const channel = getChannel(consumer.channelNumber);
      if (!channel) continue;
      if (!channel.isFlowActive()) continue;

      if (!consumer.noAck) {
        // Per-consumer prefetch check
        if (
          channel.consumerPrefetch > 0 &&
          consumer.unackedCount >= channel.consumerPrefetch
        ) {
          continue;
        }

        // Per-channel prefetch check
        if (
          channel.channelPrefetch > 0 &&
          channel.unackedCount >= channel.channelPrefetch
        ) {
          continue;
        }
      }

      return { consumer, channel, nextIndex: (idx + 1) % len };
    }

    return null;
  }

  /**
   * Deliver a message to a consumer.
   *
   * Assigns a delivery tag, tracks in channel's unacked map (unless noAck),
   * and invokes the consumer callback asynchronously via queueMicrotask.
   */
  private deliver(
    consumer: ConsumerEntry,
    channel: Channel,
    message: BrokerMessage
  ): void {
    const deliveryTag = channel.nextDeliveryTag();
    const redelivered = message.deliveryCount > 0;

    if (!consumer.noAck) {
      channel.trackUnacked(
        deliveryTag,
        message,
        consumer.queueName,
        consumer.consumerTag
      );
      this.registry.incrementUnacked(consumer.consumerTag);
    }

    const delivered: DeliveredMessage = {
      deliveryTag,
      redelivered,
      exchange: message.exchange,
      routingKey: message.routingKey,
      consumerTag: consumer.consumerTag,
      body: message.body,
      properties: message.properties,
    };

    this.schedule(() => consumer.callback(delivered));
  }
}
