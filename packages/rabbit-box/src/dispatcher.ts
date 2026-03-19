import type { ConsumerRegistry, ConsumerEntry } from './consumer-registry.ts';
import type { Channel } from './channel.ts';
import type { MessageStore } from './message-store.ts';
import type { DeliveredMessage, BrokerMessage } from './types/message.ts';

/**
 * Round-robin message dispatcher with prefetch enforcement.
 *
 * Delivers messages from a queue's message store to registered consumers,
 * rotating fairly across consumers and respecting both per-consumer and
 * per-channel prefetch limits.
 */
export interface DispatcherOptions {
  /** Async delivery scheduler. Defaults to queueMicrotask(). */
  readonly schedule?: (callback: () => void) => void;
}

export class Dispatcher {
  private readonly registry: ConsumerRegistry;
  /** Per-queue round-robin index. */
  private readonly rrIndex = new Map<string, number>();
  private readonly schedule: (callback: () => void) => void;

  constructor(registry: ConsumerRegistry, options?: DispatcherOptions) {
    this.registry = registry;
    this.schedule = options?.schedule ?? queueMicrotask;
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
    store: MessageStore,
    getChannel: (channelNumber: number) => Channel | undefined
  ): void {
    const consumers = this.registry.getConsumersForQueue(queueName);
    if (consumers.length === 0) return;

    let startIndex = this.rrIndex.get(queueName) ?? 0;

    while (store.count() > 0) {
      const eligible = this.findEligibleConsumer(
        consumers,
        startIndex,
        getChannel
      );
      if (!eligible) break; // all consumers at limit or unavailable

      const message = store.dequeue();
      if (!message) break;

      const { consumer, channel, nextIndex } = eligible;

      this.deliver(consumer, channel, message);
      startIndex = nextIndex;
      this.rrIndex.set(queueName, startIndex);
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
  private findEligibleConsumer(
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
