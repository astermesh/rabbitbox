import type { RabbitHooks } from '@rabbitbox/sbi';
import type { ExchangeType } from '../types/exchange.ts';
import type { MessageProperties } from '../types/message.ts';

/** Options for RabbitBox.create(). */
export interface RabbitBoxOptions {
  readonly hooks?: Partial<RabbitHooks>;
  /** Authenticated username for user-id validation (default: 'guest'). */
  readonly username?: string;
  /** Reserved for future multi-vhost support. */
  readonly vhost?: string;
}

/** Options for assertExchange. */
export interface AssertExchangeOptions {
  readonly durable?: boolean;
  readonly autoDelete?: boolean;
  readonly internal?: boolean;
  readonly arguments?: Record<string, unknown>;
}

/** Result of assertExchange. */
export interface AssertExchangeResult {
  readonly exchange: string;
}

/** Options for deleteExchange. */
export interface DeleteExchangeOptions {
  readonly ifUnused?: boolean;
}

/** Options for assertQueue. */
export interface AssertQueueOptions {
  readonly durable?: boolean;
  readonly exclusive?: boolean;
  readonly autoDelete?: boolean;
  readonly arguments?: Record<string, unknown>;
}

/** Result of assertQueue / checkQueue. */
export interface AssertQueueResult {
  readonly queue: string;
  readonly messageCount: number;
  readonly consumerCount: number;
}

/** Options for deleteQueue. */
export interface DeleteQueueOptions {
  readonly ifUnused?: boolean;
  readonly ifEmpty?: boolean;
}

/** Result of deleteQueue / purgeQueue. */
export interface PurgeResult {
  readonly messageCount: number;
}

/** Options for publish / sendToQueue. */
export interface PublishMessageOptions extends MessageProperties {
  readonly mandatory?: boolean;
  readonly CC?: string | string[];
  readonly BCC?: string | string[];
}

/** Options for consume. */
export interface ConsumeOptions {
  readonly consumerTag?: string;
  readonly noAck?: boolean;
  readonly exclusive?: boolean;
}

/** Result of consume. */
export interface ConsumeResult {
  readonly consumerTag: string;
}

/** Options for get. */
export interface GetOptions {
  readonly noAck?: boolean;
}

/** Connection event map. */
export interface ConnectionEvents {
  error: (err: Error) => void;
  close: () => void;
}

/** Channel event map. */
export interface ChannelEvents {
  error: (err: Error) => void;
  close: () => void;
  return: (msg: ReturnedMessage) => void;
  drain: () => void;
}

/** A message returned via basic.return. */
export interface ReturnedMessage {
  readonly replyCode: number;
  readonly replyText: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly body: Uint8Array;
  readonly properties: MessageProperties;
}

export type { ExchangeType, MessageProperties };
