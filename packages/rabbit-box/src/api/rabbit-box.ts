import { ExchangeRegistry } from '../exchange-registry.ts';
import { QueueRegistry } from '../queue-registry.ts';
import { BindingStore } from '../binding-store.ts';
import { ConsumerRegistry } from '../consumer-registry.ts';
import { MessageStore } from '../message-store.ts';
import { Dispatcher } from '../dispatcher.ts';
import { deadLetterExpired } from '../dead-letter.ts';
import { publish as publishMessage } from '../publish.ts';
import { ApiConnection } from './connection.ts';
import type { RabbitBoxOptions } from './types.ts';
import type { BrokerMessage } from '../types/message.ts';

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

  const getMessageStore = (queueName: string): MessageStore => {
    let store = messageStores.get(queueName);
    if (!store) {
      const queue = queueRegistry.getQueue(queueName);
      store = new MessageStore({ messageTtl: queue?.messageTtl });
      messageStores.set(queueName, store);
    }
    return store;
  };

  const handleExpiredMessage = (
    queueName: string,
    message: BrokerMessage
  ): void => {
    deadLetterExpired(message, queueName, {
      getQueue: (name) => queueRegistry.getQueue(name),
      exchangeExists: (name) => exchangeRegistry.hasExchange(name),
      now: () => Date.now(),
      republish: (exchange, routingKey, body, properties) => {
        publishMessage({
          exchange,
          routingKey,
          body,
          properties,
          mandatory: false,
          immediate: false,
          exchangeRegistry,
          bindingStore,
          queueRegistry,
          getMessageStore,
          onReturn: () => undefined, // dead-lettered messages are not returned
          onDispatch: (q) => {
            dispatcher.dispatch(q, getMessageStore(q), () => undefined);
          },
        });
      },
    });
  };

  const dispatcher = new Dispatcher(consumerRegistry, {
    onExpire: handleExpiredMessage,
  });

  const state = {
    exchangeRegistry,
    queueRegistry,
    bindingStore,
    consumerRegistry,
    dispatcher,
    messageStores,
    onExpire: handleExpiredMessage,
    now: () => Date.now(),
  };

  return new ApiConnection(connectionId, state, _options?.username);
}

export const RabbitBox = { create };
