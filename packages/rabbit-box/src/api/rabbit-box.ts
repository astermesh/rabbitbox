import { ExchangeRegistry } from '../exchange-registry.ts';
import { QueueRegistry } from '../queue-registry.ts';
import { BindingStore } from '../binding-store.ts';
import { ConsumerRegistry } from '../consumer-registry.ts';
import { MessageStore, type IMessageStore } from '../message-store.ts';
import { PriorityMessageStore } from '../priority-message-store.ts';
import { Dispatcher } from '../dispatcher.ts';
import { QueueExpiry } from '../queue-expiry.ts';
import { deadLetterExpired } from '../dead-letter.ts';
import { publish as publishMessage } from '../publish.ts';
import { createDefaultObiHooks } from '../obi/defaults.ts';
import { ApiConnection } from './connection.ts';
import type { RabbitBoxOptions } from './types.ts';
import type { BrokerMessage } from '../types/message.ts';
import type { ObiHooks } from '../obi/types.ts';

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
function create(options?: RabbitBoxOptions): ApiConnection {
  const connectionId = `rabbitbox-${++connectionCounter}`;
  const hooks = options?.hooks;
  const defaults = createDefaultObiHooks();
  const obi: ObiHooks = {
    time: options?.obi?.time ?? defaults.time,
    timers: options?.obi?.timers ?? defaults.timers,
    random: options?.obi?.random ?? defaults.random,
    delivery: options?.obi?.delivery ?? defaults.delivery,
    return: options?.obi?.return ?? defaults.return,
    persist: options?.obi?.persist ?? defaults.persist,
  };

  const messageStores = new Map<string, IMessageStore>();

  const exchangeRegistry: ExchangeRegistry = new ExchangeRegistry({
    bindingCount: (name: string): number => bindingStore.bindingCount(name),
    hooks: hooks
      ? {
          exchangeDeclare: hooks.exchangeDeclare,
          checkExchange: hooks.checkExchange,
          exchangeDelete: hooks.exchangeDelete,
        }
      : undefined,
  });

  const queueRegistry = new QueueRegistry({
    generateName: () => `amq.gen-${obi.random.uuid()}`,
    getMessageCount: (queueName: string): number => {
      const store = messageStores.get(queueName);
      return store ? store.count() : 0;
    },
    hooks: hooks
      ? {
          queueDeclare: hooks.queueDeclare,
          checkQueue: hooks.checkQueue,
          queueDelete: hooks.queueDelete,
          purge: hooks.purge,
        }
      : undefined,
  });

  const bindingStore: BindingStore = new BindingStore({
    hasExchange: (name: string): boolean => exchangeRegistry.hasExchange(name),
    hasQueue: (name: string): boolean =>
      queueRegistry.getQueue(name) !== undefined,
    hooks: hooks
      ? {
          queueBind: hooks.queueBind,
          queueUnbind: hooks.queueUnbind,
          exchangeBind: hooks.exchangeBind,
          exchangeUnbind: hooks.exchangeUnbind,
        }
      : undefined,
  });

  const consumerRegistry = new ConsumerRegistry({
    queueExists: (name) => queueRegistry.getQueue(name) !== undefined,
  });

  const getMessageStore = (queueName: string): IMessageStore => {
    let store = messageStores.get(queueName);
    if (!store) {
      const queue = queueRegistry.getQueue(queueName);
      if (queue?.maxPriority !== undefined) {
        store = new PriorityMessageStore({
          maxPriority: queue.maxPriority,
          messageTtl: queue.messageTtl,
          now: () => obi.time.now(),
        });
      } else {
        store = new MessageStore({
          messageTtl: queue?.messageTtl,
          now: () => obi.time.now(),
        });
      }
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
      now: () => obi.time.now(),
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
    schedule: (cb) => obi.delivery.schedule(cb),
    now: () => obi.time.now(),
    onExpire: handleExpiredMessage,
  });

  const queueExpiry = new QueueExpiry({
    timers: obi.timers,
    onExpire: (queueName) => {
      // Queue expiry: delete queue silently, messages NOT dead-lettered
      try {
        queueRegistry.deleteQueue(queueName);
      } catch {
        // Queue might already be deleted — silently ignore
        return;
      }
      bindingStore.removeBindingsForQueue(queueName);
      const consumers = consumerRegistry.getConsumersForQueue(queueName);
      for (const consumer of [...consumers]) {
        consumerRegistry.cancel(consumer.consumerTag);
      }
      messageStores.delete(queueName);
    },
  });

  const state = {
    exchangeRegistry,
    queueRegistry,
    bindingStore,
    consumerRegistry,
    dispatcher,
    messageStores,
    getMessageStore,
    queueExpiry,
    onExpire: handleExpiredMessage,
    now: () => obi.time.now(),
    hooks,
  };

  return new ApiConnection(connectionId, state, options?.username);
}

export const RabbitBox = { create };
