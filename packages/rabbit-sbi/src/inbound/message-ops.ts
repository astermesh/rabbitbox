import type { MessageProperties, DeliveredMessage } from '../message.ts';

// =============================================================================
// publish
// =============================================================================

export interface PublishMeta {
  readonly exchangeExists: boolean;
  readonly exchangeType: string | null;
  readonly matchedQueues?: number;
  realDurationMs?: number;
}

export interface PublishCtx {
  readonly exchange: string;
  readonly routingKey: string;
  readonly body: Uint8Array;
  readonly properties: MessageProperties;
  readonly mandatory: boolean;
  readonly meta: PublishMeta;
}

export interface PublishResult {
  readonly routed: boolean;
  readonly deliveryTag?: number;
}

// =============================================================================
// consume
// =============================================================================

export interface ConsumeMeta {
  readonly queueExists: boolean;
  readonly queueMessageCount: number;
  readonly existingConsumerCount: number;
  realDurationMs?: number;
}

export interface ConsumeCtx {
  readonly queue: string;
  readonly consumerTag: string;
  readonly noAck: boolean;
  readonly exclusive: boolean;
  readonly meta: ConsumeMeta;
}

export interface ConsumeResult {
  readonly consumerTag: string;
}

// =============================================================================
// get (polling)
// =============================================================================

export interface GetMeta {
  readonly queueExists: boolean;
  readonly messageCount: number;
  readonly consumerCount: number;
  realDurationMs?: number;
}

export interface GetCtx {
  readonly queue: string;
  readonly noAck: boolean;
  readonly meta: GetMeta;
}

export type GetResult = DeliveredMessage | null;

// =============================================================================
// cancel
// =============================================================================

export interface CancelMeta {
  readonly consumerExists: boolean;
  readonly queue?: string;
  realDurationMs?: number;
}

export interface CancelCtx {
  readonly consumerTag: string;
  readonly meta: CancelMeta;
}

export type CancelResult = undefined;
