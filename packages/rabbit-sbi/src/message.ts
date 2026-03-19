/**
 * AMQP 0-9-1 basic properties that accompany a message.
 *
 * Covers the 13 standard properties. Field names match the AMQP spec.
 * Used by SBI hook contexts for message observation.
 */
export interface MessageProperties {
  readonly contentType?: string;
  readonly contentEncoding?: string;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly deliveryMode?: 1 | 2;
  readonly priority?: number;
  readonly correlationId?: string;
  readonly replyTo?: string;
  readonly expiration?: string;
  readonly messageId?: string;
  readonly timestamp?: number;
  readonly type?: string;
  readonly userId?: string;
  readonly appId?: string;
}

/** Reason a message was dead-lettered. */
export type XDeathReason = 'rejected' | 'expired' | 'maxlen' | 'delivery_limit';

/** Single entry in the x-death header array tracking dead-letter history. */
export interface XDeathEntry {
  readonly queue: string;
  readonly reason: XDeathReason;
  readonly count: number;
  readonly exchange: string;
  readonly 'routing-keys': readonly string[];
  readonly time: number;
  readonly 'original-expiration'?: string;
}

/**
 * Internal broker representation of a message.
 *
 * Combines published content with broker-internal tracking fields.
 */
export interface BrokerMessage {
  readonly body: Uint8Array;
  readonly properties: MessageProperties;
  readonly exchange: string;
  readonly routingKey: string;
  readonly mandatory: boolean;
  readonly immediate: boolean;
  readonly deliveryCount: number;
  readonly enqueuedAt: number;
  readonly expiresAt?: number;
  readonly priority: number;
  readonly xDeath?: readonly XDeathEntry[];
}

/**
 * Message as delivered to a consumer via basic.deliver or basic.get-ok.
 *
 * Combines delivery metadata with message content and properties.
 */
export interface DeliveredMessage {
  readonly deliveryTag: number;
  readonly redelivered: boolean;
  readonly exchange: string;
  readonly routingKey: string;
  readonly consumerTag?: string;
  readonly messageCount?: number;
  readonly body: Uint8Array;
  readonly properties: MessageProperties;
}
