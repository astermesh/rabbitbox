import type { Channel } from '../channel.ts';
import type { ExchangeRegistry } from '../exchange-registry.ts';
import { type QueueRegistry, validateMaxPriority } from '../queue-registry.ts';
import type { BindingStore } from '../binding-store.ts';
import type { ConsumerRegistry } from '../consumer-registry.ts';
import type { IMessageStore } from '../message-store.ts';
import type { Dispatcher } from '../dispatcher.ts';
import { type QueueExpiry, validateExpires } from '../queue-expiry.ts';
import type { DeliveredMessage, MessageProperties } from '../types/message.ts';
import type { ExchangeType } from '../types/exchange.ts';
import type { AcknowledgmentDeps } from '../acknowledgment.ts';
import { publish } from '../publish.ts';
import { ack, nack, reject } from '../acknowledgment.ts';
import { deadLetter } from '../dead-letter.ts';
import { EventEmitter } from './event-emitter.ts';
import type {
  AssertExchangeOptions,
  AssertExchangeResult,
  AssertQueueOptions,
  AssertQueueResult,
  ChannelEvents,
  ConsumeOptions,
  ConsumeResult,
  DeleteExchangeOptions,
  DeleteQueueOptions,
  GetOptions,
  PublishMessageOptions,
  PurgeResult,
  ReturnedMessage,
  ConfirmEvent,
} from './types.ts';

/** Dependencies injected into ApiChannel by ApiConnection. */
export interface ApiChannelDeps {
  readonly channel: Channel;
  readonly exchangeRegistry: ExchangeRegistry;
  readonly queueRegistry: QueueRegistry;
  readonly bindingStore: BindingStore;
  readonly consumerRegistry: ConsumerRegistry;
  readonly dispatcher: Dispatcher;
  readonly getMessageStore: (queue: string) => IMessageStore;
  readonly getChannel: (channelNumber: number) => Channel | undefined;
  readonly connectionId: string;
  readonly onClose: (channelNumber: number) => void;
  /** Register an exclusive queue for auto-delete on connection close. */
  readonly registerExclusiveQueue: (name: string) => void;
  /** Remove a message store for a deleted queue. */
  readonly removeMessageStore: (name: string) => void;
  /** Returns all queue names that have message stores. */
  readonly getAllQueueNames: () => Iterable<string>;
  /** Authenticated username for user-id validation. */
  readonly authenticatedUserId: string;
  /** Queue expiry manager (x-expires). */
  readonly queueExpiry: QueueExpiry;
  /** Time provider from OBI. */
  readonly now?: () => number;
  /** SBI hooks for channel-level operations. */
  readonly hooks?: Partial<import('@rabbitbox/sbi').RabbitHooks>;
  /** Perform auto-delete for a queue (full cleanup). */
  readonly autoDeleteQueue?: (queueName: string) => void;
  /** Check and perform auto-delete for an exchange after binding removal. */
  readonly checkExchangeAutoDelete?: (exchangeName: string) => void;
  /** Mark an exchange as having had bindings. */
  readonly markExchangeHasHadBindings?: (exchangeName: string) => void;
}

export class ApiChannel extends EventEmitter<ChannelEvents> {
  private readonly deps: ApiChannelDeps;
  private closed = false;
  private readonly ackDeps: AcknowledgmentDeps;

  /** Pending publisher delivery tags not yet confirmed. */
  private readonly pendingConfirms = new Set<number>();

  /** Resolve callbacks for waitForConfirms() callers. */
  private readonly confirmWaiters: (() => void)[] = [];

  constructor(deps: ApiChannelDeps) {
    super();
    this.deps = deps;
    this.ackDeps = {
      onRequeue: (queueName, message) => {
        this.deps.getMessageStore(queueName).requeue(message);
      },
      onDispatch: (queueName) => {
        this.deps.dispatcher.dispatch(
          queueName,
          this.deps.getMessageStore(queueName),
          this.deps.getChannel
        );
      },
      onDeadLetter: (queueName, message) => {
        deadLetter(message, queueName, 'rejected', {
          getQueue: (name) => this.deps.queueRegistry.getQueue(name),
          exchangeExists: (name) =>
            this.deps.exchangeRegistry.hasExchange(name),
          now: this.deps.now ?? (() => Date.now()),
          republish: (exchange, routingKey, body, properties) => {
            publish({
              exchange,
              routingKey,
              body,
              properties,
              mandatory: false,
              immediate: false,
              exchangeRegistry: this.deps.exchangeRegistry,
              bindingStore: this.deps.bindingStore,
              queueRegistry: this.deps.queueRegistry,
              getMessageStore: this.deps.getMessageStore,
              onReturn: () => undefined,
              onDispatch: (qn) => {
                this.deps.dispatcher.dispatch(
                  qn,
                  this.deps.getMessageStore(qn),
                  this.deps.getChannel
                );
              },
              authenticatedUserId: this.deps.authenticatedUserId,
              now: this.deps.now,
            });
          },
        });
      },
    };
  }

  // ── Topology: Exchanges ─────────────────────────────────────────────

  async assertExchange(
    name: string,
    type: ExchangeType,
    options?: AssertExchangeOptions
  ): Promise<AssertExchangeResult> {
    this.assertOpen();
    this.deps.exchangeRegistry.declareExchange(name, type, options);
    return { exchange: name };
  }

  async deleteExchange(
    name: string,
    options?: DeleteExchangeOptions
  ): Promise<void> {
    this.assertOpen();
    this.deps.exchangeRegistry.deleteExchange(name, options?.ifUnused);
    this.deps.bindingStore.removeBindingsForExchange(name);
  }

  async checkExchange(name: string): Promise<void> {
    this.assertOpen();
    this.deps.exchangeRegistry.checkExchange(name);
  }

  // ── Topology: Queues ────────────────────────────────────────────────

  async assertQueue(
    name?: string,
    options?: AssertQueueOptions
  ): Promise<AssertQueueResult> {
    this.assertOpen();
    // Validate x-expires before creating the queue
    const expiresArg = options?.arguments?.['x-expires'];
    if (expiresArg !== undefined) {
      validateExpires(expiresArg as number);
    }
    // Validate x-max-priority before creating the queue
    const maxPriorityArg = options?.arguments?.['x-max-priority'];
    if (maxPriorityArg !== undefined) {
      validateMaxPriority(maxPriorityArg as number);
    }
    const result = this.deps.queueRegistry.declareQueue(
      name ?? '',
      options ?? {},
      this.deps.connectionId
    );
    // Ensure a message store exists for this queue
    this.deps.getMessageStore(result.queue);
    // Register exclusive queues for auto-delete on connection close
    if (options?.exclusive) {
      this.deps.registerExclusiveQueue(result.queue);
    }
    // Register or reset queue expiry timer (x-expires)
    const queue = this.deps.queueRegistry.getQueue(result.queue);
    if (queue?.expires !== undefined) {
      this.deps.queueExpiry.register(result.queue, queue.expires);
    }
    return result;
  }

  async deleteQueue(
    name: string,
    options?: DeleteQueueOptions
  ): Promise<PurgeResult> {
    this.assertOpen();
    // Collect exchanges that have bindings to this queue before removal
    const affectedExchanges = this.deps.bindingStore
      .getBindingsForQueue(name)
      .map((b) => b.exchange);
    const result = this.deps.queueRegistry.deleteQueue(
      name,
      options,
      this.deps.connectionId
    );
    this.deps.bindingStore.removeBindingsForQueue(name);
    // Cancel all consumers on the deleted queue
    const consumers = this.deps.consumerRegistry.getConsumersForQueue(name);
    for (const consumer of [...consumers]) {
      this.deps.consumerRegistry.cancel(consumer.consumerTag);
    }
    // Clean up message store and expiry timer
    this.deps.removeMessageStore(name);
    this.deps.queueExpiry.unregister(name);
    // Check auto-delete for exchanges that lost bindings
    if (this.deps.checkExchangeAutoDelete) {
      const unique = new Set(affectedExchanges);
      for (const exchangeName of unique) {
        this.deps.checkExchangeAutoDelete(exchangeName);
      }
    }
    return result;
  }

  async checkQueue(name: string): Promise<AssertQueueResult> {
    this.assertOpen();
    return this.deps.queueRegistry.checkQueue(name, this.deps.connectionId);
  }

  async purgeQueue(name: string): Promise<PurgeResult> {
    this.assertOpen();
    const result = this.deps.queueRegistry.purgeQueue(
      name,
      this.deps.connectionId
    );
    this.deps.getMessageStore(name).purge();
    return result;
  }

  // ── Topology: Bindings ──────────────────────────────────────────────

  async bindQueue(
    queue: string,
    exchange: string,
    routingKey: string,
    args?: Record<string, unknown>
  ): Promise<void> {
    this.assertOpen();
    this.deps.bindingStore.addBinding(exchange, queue, routingKey, args ?? {});
    this.deps.markExchangeHasHadBindings?.(exchange);
  }

  async unbindQueue(
    queue: string,
    exchange: string,
    routingKey: string,
    args?: Record<string, unknown>
  ): Promise<void> {
    this.assertOpen();
    this.deps.bindingStore.removeBinding(
      exchange,
      queue,
      routingKey,
      args ?? {}
    );
    this.deps.checkExchangeAutoDelete?.(exchange);
  }

  async bindExchange(
    destination: string,
    source: string,
    routingKey: string,
    args?: Record<string, unknown>
  ): Promise<void> {
    this.assertOpen();
    this.deps.bindingStore.addExchangeBinding(
      destination,
      source,
      routingKey,
      args ?? {}
    );
    this.deps.markExchangeHasHadBindings?.(source);
  }

  async unbindExchange(
    destination: string,
    source: string,
    routingKey: string,
    args?: Record<string, unknown>
  ): Promise<void> {
    this.assertOpen();
    this.deps.bindingStore.removeExchangeBinding(
      destination,
      source,
      routingKey,
      args ?? {}
    );
    this.deps.checkExchangeAutoDelete?.(source);
  }

  // ── Publishing ──────────────────────────────────────────────────────

  publish(
    exchange: string,
    routingKey: string,
    content: Uint8Array,
    options?: PublishMessageOptions
  ): boolean {
    this.assertOpen();
    const inConfirmMode = this.deps.channel.confirmMode;
    const deliveryTag = inConfirmMode
      ? this.deps.channel.nextPublisherDeliveryTag()
      : 0;

    if (deliveryTag > 0) {
      this.pendingConfirms.add(deliveryTag);
    }

    try {
      const properties = this.buildProperties(options);
      publish({
        exchange,
        routingKey,
        body: content,
        properties,
        mandatory: options?.mandatory ?? false,
        immediate: false,
        exchangeRegistry: this.deps.exchangeRegistry,
        bindingStore: this.deps.bindingStore,
        queueRegistry: this.deps.queueRegistry,
        getMessageStore: this.deps.getMessageStore,
        onReturn: (replyCode, replyText, ex, rk, body, props) => {
          const msg: ReturnedMessage = {
            replyCode,
            replyText,
            exchange: ex,
            routingKey: rk,
            body,
            properties: props,
          };
          // basic.return is emitted BEFORE basic.ack (handled by ordering below)
          this.emit('return', msg);
        },
        onDispatch: (queueName) => {
          this.deps.dispatcher.dispatch(
            queueName,
            this.deps.getMessageStore(queueName),
            this.deps.getChannel
          );
        },
        authenticatedUserId: this.deps.authenticatedUserId,
        now: this.deps.now,
        hook: this.deps.hooks?.publish,
      });

      // In confirm mode, send basic.ack after publish completes.
      // For mandatory unroutable messages, basic.return was already emitted
      // above (during publish pipeline), so the ordering is correct:
      // basic.return BEFORE basic.ack.
      if (deliveryTag > 0) {
        this.pendingConfirms.delete(deliveryTag);
        this.emitConfirmAck(deliveryTag);
      }
    } catch (err) {
      // On internal error, send basic.nack (rare — only for broker errors)
      if (deliveryTag > 0) {
        this.pendingConfirms.delete(deliveryTag);
        this.emitConfirmNack(deliveryTag);
      }
      throw err;
    }

    return true;
  }

  sendToQueue(
    queue: string,
    content: Uint8Array,
    options?: PublishMessageOptions
  ): boolean {
    return this.publish('', queue, content, options);
  }

  // ── Consuming ───────────────────────────────────────────────────────

  async consume(
    queue: string,
    callback: (msg: DeliveredMessage) => void,
    options?: ConsumeOptions
  ): Promise<ConsumeResult> {
    this.assertOpen();
    const consumerTag = this.deps.consumerRegistry.register(
      queue,
      this.deps.channel.channelNumber,
      callback,
      {
        consumerTag: options?.consumerTag,
        noAck: options?.noAck,
        exclusive: options?.exclusive,
      }
    );
    this.deps.queueRegistry.setConsumerCount(
      queue,
      this.deps.consumerRegistry.getConsumerCount(queue)
    );
    // Reset queue expiry timer on consume activity
    this.deps.queueExpiry.resetActivity(queue);
    // Dispatch any pending messages to the new consumer
    this.deps.dispatcher.dispatch(
      queue,
      this.deps.getMessageStore(queue),
      this.deps.getChannel
    );
    return { consumerTag };
  }

  async cancel(consumerTag: string): Promise<void> {
    this.assertOpen();
    const entry = this.deps.consumerRegistry.cancel(consumerTag);
    if (entry) {
      const newCount = this.deps.consumerRegistry.getConsumerCount(
        entry.queueName
      );
      this.deps.queueRegistry.setConsumerCount(entry.queueName, newCount);
      // Reset expiry timer on cancel if consumers remain
      if (newCount > 0) {
        this.deps.queueExpiry.resetActivity(entry.queueName);
      }
      // Auto-delete queue when last consumer is cancelled
      if (
        newCount === 0 &&
        this.deps.autoDeleteQueue &&
        this.deps.queueRegistry.isAutoDeleteReady(entry.queueName)
      ) {
        this.deps.autoDeleteQueue(entry.queueName);
      }
    }
  }

  // ── Acknowledgment ──────────────────────────────────────────────────

  ack(message: DeliveredMessage, allUpTo?: boolean): void {
    this.assertOpen();
    // Decrement consumer unacked count BEFORE ack so that the dispatch
    // triggered inside ack() sees the freed prefetch capacity.
    this.updateConsumerUnacked(message);
    ack(this.deps.channel, message.deliveryTag, allUpTo ?? false, this.ackDeps);
  }

  nack(message: DeliveredMessage, allUpTo?: boolean, requeue?: boolean): void {
    this.assertOpen();
    this.updateConsumerUnacked(message);
    nack(
      this.deps.channel,
      message.deliveryTag,
      allUpTo ?? false,
      requeue ?? true,
      this.ackDeps
    );
  }

  reject(message: DeliveredMessage, requeue?: boolean): void {
    this.assertOpen();
    this.updateConsumerUnacked(message);
    reject(
      this.deps.channel,
      message.deliveryTag,
      requeue ?? true,
      this.ackDeps
    );
  }

  // ── Polling ─────────────────────────────────────────────────────────

  async get(
    queue: string,
    options?: GetOptions
  ): Promise<DeliveredMessage | false> {
    this.assertOpen();
    // Reset queue expiry timer on basic.get activity
    this.deps.queueExpiry.resetActivity(queue);
    const result = this.deps.channel.get(queue, options);
    return result ?? false;
  }

  // ── QoS ─────────────────────────────────────────────────────────────

  async prefetch(count: number, global?: boolean): Promise<void> {
    this.assertOpen();
    this.deps.channel.setPrefetch(count, global ?? false);
  }

  // ── Recovery ────────────────────────────────────────────────────────

  async recover(): Promise<void> {
    this.assertOpen();
    this.deps.channel.recover();
    // Trigger dispatch for all queues that might have requeued messages
    this.dispatchAllQueues();
  }

  // ── Flow ────────────────────────────────────────────────────────────

  async flow(active: boolean): Promise<{ active: boolean }> {
    this.assertOpen();
    this.deps.channel.setFlow(active);
    if (active) {
      this.dispatchAllQueues();
    }
    return { active };
  }

  // ── Publisher Confirms ─────────────────────────────────────────────

  async confirmSelect(): Promise<void> {
    this.assertOpen();
    this.deps.channel.confirmSelect();
  }

  async waitForConfirms(): Promise<void> {
    this.assertOpen();
    if (this.pendingConfirms.size === 0) return;
    return new Promise<void>((resolve) => {
      this.confirmWaiters.push(resolve);
    });
  }

  // ── Close ───────────────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Cancel all consumers on this channel
    const cancelled = this.deps.consumerRegistry.cancelByChannel(
      this.deps.channel.channelNumber
    );
    // Update consumer counts and check auto-delete for affected queues
    const affectedQueues = new Set(cancelled.map((c) => c.queueName));
    for (const queueName of affectedQueues) {
      const newCount = this.deps.consumerRegistry.getConsumerCount(queueName);
      this.deps.queueRegistry.setConsumerCount(queueName, newCount);
      if (
        newCount === 0 &&
        this.deps.autoDeleteQueue &&
        this.deps.queueRegistry.isAutoDeleteReady(queueName)
      ) {
        this.deps.autoDeleteQueue(queueName);
      }
    }
    this.deps.channel.close();
    this.deps.onClose(this.deps.channel.channelNumber);
    this.emit('close');
  }

  // ── Internals ───────────────────────────────────────────────────────

  private assertOpen(): void {
    if (this.closed) {
      this.deps.channel.assertOpen(); // throws appropriate AMQP error
    }
  }

  private buildProperties(options?: PublishMessageOptions): MessageProperties {
    if (!options) return {};
    const headers: Record<string, unknown> = { ...options.headers };
    if (options.CC !== undefined)
      headers['CC'] = Array.isArray(options.CC) ? options.CC : [options.CC];
    if (options.BCC !== undefined)
      headers['BCC'] = Array.isArray(options.BCC) ? options.BCC : [options.BCC];

    // Build properties from only defined fields
    const props: Record<string, unknown> = {};
    const fields: (keyof MessageProperties)[] = [
      'contentType',
      'contentEncoding',
      'deliveryMode',
      'priority',
      'correlationId',
      'replyTo',
      'expiration',
      'messageId',
      'timestamp',
      'type',
      'userId',
      'appId',
    ];
    for (const field of fields) {
      if (options[field] !== undefined) {
        props[field] = options[field];
      }
    }
    if (Object.keys(headers).length > 0 || options.headers) {
      props['headers'] = headers;
    }
    return props as MessageProperties;
  }

  private updateConsumerUnacked(message: DeliveredMessage): void {
    if (message.consumerTag) {
      this.deps.consumerRegistry.decrementUnacked(message.consumerTag);
    }
  }

  private emitConfirmAck(deliveryTag: number): void {
    const event: ConfirmEvent = { deliveryTag, multiple: false };
    this.emit('ack', event);
    this.drainConfirmWaiters();
  }

  private emitConfirmNack(deliveryTag: number): void {
    const event: ConfirmEvent = { deliveryTag, multiple: false };
    this.emit('nack', event);
    this.drainConfirmWaiters();
  }

  private drainConfirmWaiters(): void {
    if (this.pendingConfirms.size === 0 && this.confirmWaiters.length > 0) {
      const waiters = this.confirmWaiters.splice(0);
      for (const resolve of waiters) {
        resolve();
      }
    }
  }

  private dispatchAllQueues(): void {
    for (const queueName of this.deps.getAllQueueNames()) {
      this.deps.dispatcher.dispatch(
        queueName,
        this.deps.getMessageStore(queueName),
        this.deps.getChannel
      );
    }
  }
}
