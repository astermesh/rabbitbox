import type { XDeathEntry } from './x-death-entry.ts';

/**
 * All 14 AMQP 0-9-1 basic properties that can accompany a message.
 *
 * Field names match the AMQP basic content-header properties exactly.
 */
export interface MessageProperties {
  readonly contentType?: string;
  readonly contentEncoding?: string;
  readonly headers?: Record<string, unknown>;
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

/**
 * Internal broker representation of a message.
 *
 * Combines the published content with broker-internal tracking fields.
 * Uses Uint8Array for body to ensure cross-platform compatibility.
 */
export interface BrokerMessage {
  readonly body: Uint8Array;
  readonly properties: MessageProperties;
  readonly exchange: string;
  readonly routingKey: string;
  readonly mandatory: boolean;
  readonly immediate: boolean;

  // Internal tracking
  readonly deliveryCount: number;
  readonly enqueuedAt: number;
  readonly expiresAt?: number;
  readonly priority: number;
  readonly xDeath?: XDeathEntry[];
}

/**
 * Message as delivered to a consumer via basic.deliver or basic.get-ok.
 *
 * Combines delivery metadata fields with the message content and properties.
 * Field names match the AMQP basic.deliver / basic.get-ok method fields.
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
