import type { ApiChannel } from '@rabbitbox/box';
import { EventEmitter } from '@rabbitbox/box';
import type {
  AmqplibChannelEvents,
  AmqplibMessage,
  AmqplibMessageProperties,
  AmqplibReturnedMessage,
} from './types.ts';
import type {
  ExchangeType,
  DeliveredMessage,
  MessageProperties,
} from '@rabbitbox/box';

/**
 * amqplib-compatible Channel wrapper around RabbitBox ApiChannel.
 *
 * Adapts RabbitBox's API to match amqplib's method signatures and
 * message format (fields/properties/content structure).
 */
export type ConfirmCallback = (
  err: Error | null,
  ok: Record<string, never>
) => void;

export class AmqplibChannel extends EventEmitter<AmqplibChannelEvents> {
  /** @internal */
  readonly inner: ApiChannel;
  readonly isConfirmChannel: boolean;
  private closed = false;

  /** Pending confirm callbacks keyed by publisher delivery tag. */
  private readonly confirmCallbacks = new Map<number, ConfirmCallback>();
  /** Mirrors inner channel's delivery tag sequence to map callbacks. */
  private confirmSeq = 0;
  /** Whether any nack was received since last waitForConfirms drain. */
  private hasNacked = false;

  constructor(inner: ApiChannel, confirmMode: boolean) {
    super();
    this.inner = inner;
    this.isConfirmChannel = confirmMode;

    // Forward events from the inner channel
    inner.on('close', () => {
      this.emitClose();
    });
    inner.on('error', (err: Error) => {
      this.emitError(err);
    });
    inner.on('return', (msg) => {
      const adapted: AmqplibReturnedMessage = {
        fields: {
          replyCode: msg.replyCode,
          replyText: msg.replyText,
          exchange: msg.exchange,
          routingKey: msg.routingKey,
        },
        properties: toAmqplibProperties(msg.properties),
        content: toBuffer(msg.body),
      };
      this.emitReturn(adapted);
    });

    if (confirmMode) {
      inner.on('ack', (event) => {
        const cb = this.confirmCallbacks.get(event.deliveryTag);
        if (cb) {
          this.confirmCallbacks.delete(event.deliveryTag);
          cb(null, {} as Record<string, never>);
        }
      });
      inner.on('nack', (event) => {
        this.hasNacked = true;
        const cb = this.confirmCallbacks.get(event.deliveryTag);
        if (cb) {
          this.confirmCallbacks.delete(event.deliveryTag);
          cb(new Error('Message was nacked'), {} as Record<string, never>);
        }
      });
    }
  }

  // ── Topology: Exchanges ─────────────────────────────────────────────

  async assertExchange(
    exchange: string,
    type: ExchangeType,
    options?: {
      durable?: boolean;
      autoDelete?: boolean;
      internal?: boolean;
      arguments?: Record<string, unknown>;
    }
  ): Promise<{ exchange: string }> {
    this.assertOpen();
    return this.inner.assertExchange(exchange, type, options);
  }

  async deleteExchange(
    exchange: string,
    options?: { ifUnused?: boolean }
  ): Promise<Record<string, never>> {
    this.assertOpen();
    await this.inner.deleteExchange(exchange, options);
    return {};
  }

  async checkExchange(exchange: string): Promise<{ exchange: string }> {
    this.assertOpen();
    await this.inner.checkExchange(exchange);
    return { exchange };
  }

  // ── Topology: Queues ────────────────────────────────────────────────

  async assertQueue(
    queue?: string,
    options?: {
      durable?: boolean;
      exclusive?: boolean;
      autoDelete?: boolean;
      arguments?: Record<string, unknown>;
    }
  ): Promise<{ queue: string; messageCount: number; consumerCount: number }> {
    this.assertOpen();
    return this.inner.assertQueue(queue ?? '', options);
  }

  async deleteQueue(
    queue: string,
    options?: { ifUnused?: boolean; ifEmpty?: boolean }
  ): Promise<{ messageCount: number }> {
    this.assertOpen();
    return this.inner.deleteQueue(queue, options);
  }

  async checkQueue(
    queue: string
  ): Promise<{ queue: string; messageCount: number; consumerCount: number }> {
    this.assertOpen();
    return this.inner.checkQueue(queue);
  }

  async purgeQueue(queue: string): Promise<{ messageCount: number }> {
    this.assertOpen();
    return this.inner.purgeQueue(queue);
  }

  // ── Topology: Bindings ──────────────────────────────────────────────

  async bindQueue(
    queue: string,
    source: string,
    pattern: string,
    args?: Record<string, unknown>
  ): Promise<Record<string, never>> {
    this.assertOpen();
    await this.inner.bindQueue(queue, source, pattern, args);
    return {};
  }

  async unbindQueue(
    queue: string,
    source: string,
    pattern: string,
    args?: Record<string, unknown>
  ): Promise<Record<string, never>> {
    this.assertOpen();
    await this.inner.unbindQueue(queue, source, pattern, args);
    return {};
  }

  async bindExchange(
    destination: string,
    source: string,
    pattern: string,
    args?: Record<string, unknown>
  ): Promise<Record<string, never>> {
    this.assertOpen();
    await this.inner.bindExchange(destination, source, pattern, args);
    return {};
  }

  async unbindExchange(
    destination: string,
    source: string,
    pattern: string,
    args?: Record<string, unknown>
  ): Promise<Record<string, never>> {
    this.assertOpen();
    await this.inner.unbindExchange(destination, source, pattern, args);
    return {};
  }

  // ── Publishing ──────────────────────────────────────────────────────

  publish(
    exchange: string,
    routingKey: string,
    content: Uint8Array,
    options?: AmqplibMessageProperties & {
      mandatory?: boolean;
      CC?: string | string[];
      BCC?: string | string[];
    },
    callback?: ConfirmCallback
  ): boolean {
    this.assertOpen();
    if (this.isConfirmChannel) {
      const tag = ++this.confirmSeq;
      if (callback) {
        this.confirmCallbacks.set(tag, callback);
      }
    }
    const result = this.inner.publish(exchange, routingKey, content, options);
    this.emit('drain');
    return result;
  }

  sendToQueue(
    queue: string,
    content: Uint8Array,
    options?: AmqplibMessageProperties & {
      mandatory?: boolean;
      CC?: string | string[];
      BCC?: string | string[];
    },
    callback?: ConfirmCallback
  ): boolean {
    this.assertOpen();
    return this.publish('', queue, content, options, callback);
  }

  // ── Consuming ───────────────────────────────────────────────────────

  async consume(
    queue: string,
    callback: (msg: AmqplibMessage | null) => void,
    options?: {
      consumerTag?: string;
      noAck?: boolean;
      exclusive?: boolean;
      arguments?: Record<string, unknown>;
    }
  ): Promise<{ consumerTag: string }> {
    this.assertOpen();
    return this.inner.consume(
      queue,
      (msg: DeliveredMessage | null) => {
        if (msg === null) {
          callback(null);
          return;
        }
        callback(toAmqplibMessage(msg));
      },
      options
    );
  }

  async cancel(consumerTag: string): Promise<{ consumerTag: string }> {
    this.assertOpen();
    await this.inner.cancel(consumerTag);
    return { consumerTag };
  }

  // ── Polling ─────────────────────────────────────────────────────────

  async get(
    queue: string,
    options?: { noAck?: boolean }
  ): Promise<AmqplibMessage | false> {
    this.assertOpen();
    const result = await this.inner.get(queue, options);
    if (result === false) return false;
    return toAmqplibMessage(result);
  }

  // ── Acknowledgment ──────────────────────────────────────────────────

  ack(message: AmqplibMessage, allUpTo?: boolean): void {
    this.assertOpen();
    this.inner.ack(fromAmqplibMessage(message), allUpTo);
  }

  ackAll(): void {
    this.assertOpen();
    this.inner.ackAll();
  }

  nack(message: AmqplibMessage, allUpTo?: boolean, requeue?: boolean): void {
    this.assertOpen();
    this.inner.nack(fromAmqplibMessage(message), allUpTo, requeue);
  }

  nackAll(requeue?: boolean): void {
    this.assertOpen();
    this.inner.nackAll(requeue);
  }

  reject(message: AmqplibMessage, requeue?: boolean): void {
    this.assertOpen();
    this.inner.reject(fromAmqplibMessage(message), requeue);
  }

  // ── QoS ─────────────────────────────────────────────────────────────

  async prefetch(
    count: number,
    global?: boolean
  ): Promise<Record<string, never>> {
    this.assertOpen();
    await this.inner.prefetch(count, global);
    return {};
  }

  // ── Recovery ────────────────────────────────────────────────────────

  async recover(): Promise<Record<string, never>> {
    this.assertOpen();
    await this.inner.recover();
    return {};
  }

  // ── Publisher Confirms ──────────────────────────────────────────────

  async waitForConfirms(): Promise<void> {
    this.assertOpen();
    await this.inner.waitForConfirms();
    if (this.hasNacked) {
      this.hasNacked = false;
      throw new Error('Not all messages were acked');
    }
  }

  // ── Close ───────────────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.inner.close();
  }

  // ── Internal event helpers ──────────────────────────────────────────

  /** @internal */
  emitClose(): void {
    this.emit('close');
  }

  /** @internal */
  emitError(err: Error): void {
    this.emit('error', err);
  }

  /** @internal */
  emitReturn(msg: AmqplibReturnedMessage): void {
    this.emit('return', msg);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Channel closed');
    }
  }
}

// ── Message format conversion ───────────────────────────────────────

function toAmqplibProperties(
  props: MessageProperties
): AmqplibMessageProperties {
  return {
    contentType: props.contentType,
    contentEncoding: props.contentEncoding,
    headers: props.headers,
    deliveryMode: props.deliveryMode,
    priority: props.priority,
    correlationId: props.correlationId,
    replyTo: props.replyTo,
    expiration: props.expiration,
    messageId: props.messageId,
    timestamp: props.timestamp,
    type: props.type,
    userId: props.userId,
    appId: props.appId,
  };
}

function toAmqplibMessage(msg: DeliveredMessage): AmqplibMessage {
  return {
    fields: {
      deliveryTag: msg.deliveryTag,
      redelivered: msg.redelivered,
      exchange: msg.exchange,
      routingKey: msg.routingKey,
      consumerTag: msg.consumerTag ?? '',
      messageCount: msg.messageCount,
    },
    properties: toAmqplibProperties(msg.properties),
    content: toBuffer(msg.body),
  };
}

/**
 * Convert a Uint8Array to a Node.js Buffer.
 * If the input is already a Buffer, returns it as-is (no copy).
 */
function toBuffer(data: Uint8Array): Buffer {
  if (Buffer.isBuffer(data)) return data;
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Convert an amqplib-format message back to a DeliveredMessage
 * for passing to ack/nack/reject on the inner channel.
 */
function fromAmqplibMessage(msg: AmqplibMessage): DeliveredMessage {
  return {
    deliveryTag: msg.fields.deliveryTag,
    redelivered: msg.fields.redelivered,
    exchange: msg.fields.exchange,
    routingKey: msg.fields.routingKey,
    consumerTag: msg.fields.consumerTag,
    messageCount: msg.fields.messageCount,
    body: msg.content,
    properties: msg.properties as MessageProperties,
  };
}
