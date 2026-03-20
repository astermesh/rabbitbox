import type { ExchangeRegistry } from '../exchange-registry.ts';
import type { QueueRegistry } from '../queue-registry.ts';
import type { BindingStore } from '../binding-store.ts';
import type { ConsumerRegistry } from '../consumer-registry.ts';
import type { IMessageStore } from '../message-store.ts';
import type { Dispatcher } from '../dispatcher.ts';
import type { QueueExpiry } from '../queue-expiry.ts';
import { Channel } from '../channel.ts';
import { connectionError } from '../errors/factories.ts';
import { EventEmitter } from './event-emitter.ts';
import { ApiChannel } from './channel.ts';
import type { BrokerMessage } from '../types/message.ts';
import type { ConnectionEvents } from './types.ts';

const CONNECTION_CLASS = 10;

/** All shared broker state owned by a single RabbitBox instance. */
export interface BrokerState {
  readonly exchangeRegistry: ExchangeRegistry;
  readonly queueRegistry: QueueRegistry;
  readonly bindingStore: BindingStore;
  readonly consumerRegistry: ConsumerRegistry;
  readonly dispatcher: Dispatcher;
  readonly messageStores: Map<string, IMessageStore>;
  /** Lazy-create and return the message store for a queue. */
  readonly getMessageStore: (queueName: string) => IMessageStore;
  /** Queue expiry manager (x-expires). */
  readonly queueExpiry: QueueExpiry;
  /** Called when a message expires (TTL). Used for dead-lettering. */
  readonly onExpire?: (queueName: string, message: BrokerMessage) => void;
  /** Time provider for TTL expiry checks. */
  readonly now?: () => number;
  /** SBI hooks passed through from RabbitBox.create(). */
  readonly hooks?: Partial<import('@rabbitbox/sbi').RabbitHooks>;
  /** Perform auto-delete for a queue (full cleanup). */
  readonly autoDeleteQueue?: (queueName: string) => void;
  /** Check and perform auto-delete for an exchange after binding removal. */
  readonly checkExchangeAutoDelete?: (exchangeName: string) => void;
  /** Mark an exchange as having had bindings. */
  readonly markExchangeHasHadBindings?: (exchangeName: string) => void;
}

export class ApiConnection extends EventEmitter<ConnectionEvents> {
  readonly connectionId: string;
  readonly username: string;
  private readonly state: BrokerState;
  private readonly channels = new Map<
    number,
    { api: ApiChannel; internal: Channel }
  >();
  private readonly exclusiveQueues = new Set<string>();
  private nextChannelNum = 0;
  private closed = false;

  constructor(connectionId: string, state: BrokerState, username = 'guest') {
    super();
    this.connectionId = connectionId;
    this.state = state;
    this.username = username;
  }

  /** Create a new connection sharing the same broker state. */
  createConnection(username?: string): ApiConnection {
    const id = `${this.connectionId}-conn-${this.state.now?.() ?? Date.now()}`;
    return new ApiConnection(id, this.state, username ?? this.username);
  }

  async createChannel(): Promise<ApiChannel> {
    this.assertOpen();

    const num = ++this.nextChannelNum;

    const internal = new Channel(num, {
      onRequeue: (queueName, message) => {
        this.getMessageStore(queueName).requeue(message);
      },
      onClose: () => {
        this.channels.delete(num);
      },
      onDequeue: (queueName) => {
        const store = this.getMessageStore(queueName);
        // Drain expired messages from head before dequeuing (lazy expiry)
        const now = this.state.now?.() ?? Date.now();
        const expired = store.drainExpired(now);
        if (this.state.onExpire) {
          for (const msg of expired) {
            this.state.onExpire(queueName, msg);
          }
        }
        const message = store.dequeue();
        return { message, messageCount: store.count() };
      },
      onCheckExchange: (name) => {
        this.state.exchangeRegistry.checkExchange(name);
      },
      onCheckQueue: (name) => {
        return this.state.queueRegistry.checkQueue(name, this.connectionId);
      },
    });

    const apiChannel = new ApiChannel({
      channel: internal,
      exchangeRegistry: this.state.exchangeRegistry,
      queueRegistry: this.state.queueRegistry,
      bindingStore: this.state.bindingStore,
      consumerRegistry: this.state.consumerRegistry,
      dispatcher: this.state.dispatcher,
      getMessageStore: (queue) => this.getMessageStore(queue),
      getChannel: (channelNumber) => this.getInternalChannel(channelNumber),
      connectionId: this.connectionId,
      onClose: (channelNumber) => {
        this.channels.delete(channelNumber);
      },
      registerExclusiveQueue: (name) => this.registerExclusiveQueue(name),
      removeMessageStore: (name) => this.state.messageStores.delete(name),
      getAllQueueNames: () => this.state.messageStores.keys(),
      queueExpiry: this.state.queueExpiry,
      authenticatedUserId: this.username,
      now: this.state.now,
      hooks: this.state.hooks,
      autoDeleteQueue: this.state.autoDeleteQueue,
      checkExchangeAutoDelete: this.state.checkExchangeAutoDelete,
      markExchangeHasHadBindings: this.state.markExchangeHasHadBindings,
    });

    this.channels.set(num, { api: apiChannel, internal });
    return apiChannel;
  }

  /** Register an exclusive queue as owned by this connection. */
  registerExclusiveQueue(name: string): void {
    this.exclusiveQueues.add(name);
  }

  /** Unregister an exclusive queue. */
  unregisterExclusiveQueue(name: string): void {
    this.exclusiveQueues.delete(name);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Close all channels — collect first to avoid mutation during iteration
    const entries = [...this.channels.values()];
    this.channels.clear();
    for (const { api } of entries) {
      await api.close();
    }

    // Delete exclusive queues
    for (const name of this.exclusiveQueues) {
      try {
        this.state.queueRegistry.deleteQueue(
          name,
          undefined,
          this.connectionId
        );
        this.state.bindingStore.removeBindingsForQueue(name);
      } catch {
        // Queue might already be deleted — silently ignore
      }
      this.state.queueExpiry.unregister(name);
    }
    this.exclusiveQueues.clear();

    this.emit('close');
  }

  getMessageStore(queueName: string): IMessageStore {
    return this.state.getMessageStore(queueName);
  }

  private getInternalChannel(channelNumber: number): Channel | undefined {
    return this.channels.get(channelNumber)?.internal;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw connectionError.commandInvalid(
        'connection is closing or closed',
        CONNECTION_CLASS,
        0
      );
    }
  }
}
