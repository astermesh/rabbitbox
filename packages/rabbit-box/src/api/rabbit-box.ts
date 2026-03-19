import { ExchangeRegistry } from '../exchange-registry.ts';
import { QueueRegistry } from '../queue-registry.ts';
import { BindingStore } from '../binding-store.ts';
import { ConsumerRegistry } from '../consumer-registry.ts';
import { MessageStore } from '../message-store.ts';
import { Dispatcher } from '../dispatcher.ts';
import { ApiConnection } from './connection.ts';
import type { RabbitBoxOptions } from './types.ts';

let connectionCounter = 0;

/**
 * Create a new in-memory RabbitMQ connection.
 *
 * Each call creates an independent broker instance with its own
 * exchanges, queues, bindings, and consumers.
 *
 * Usage:
 * ```ts
 * const connection = RabbitBox.create();
 * const channel = await connection.createChannel();
 * await channel.assertQueue('my-queue');
 * channel.sendToQueue('my-queue', new Uint8Array([1, 2, 3]));
 * ```
 */
function create(_options?: RabbitBoxOptions): ApiConnection {
  const connectionId = `rabbitbox-${++connectionCounter}`;

  const messageStores = new Map<string, MessageStore>();

  const exchangeRegistry: ExchangeRegistry = new ExchangeRegistry({
    bindingCount: (name: string): number => bindingStore.bindingCount(name),
  });

  const queueRegistry = new QueueRegistry();

  const bindingStore: BindingStore = new BindingStore({
    hasExchange: (name: string): boolean => exchangeRegistry.hasExchange(name),
    hasQueue: (name: string): boolean =>
      queueRegistry.getQueue(name) !== undefined,
  });

  const consumerRegistry = new ConsumerRegistry({
    queueExists: (name) => queueRegistry.getQueue(name) !== undefined,
  });

  const dispatcher = new Dispatcher(consumerRegistry);

  const state = {
    exchangeRegistry,
    queueRegistry,
    bindingStore,
    consumerRegistry,
    dispatcher,
    messageStores,
  };

  return new ApiConnection(connectionId, state, _options?.username);
}

export const RabbitBox = { create };
