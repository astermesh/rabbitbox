import type { BrokerMessage, DeliveredMessage } from './message.ts';

// =============================================================================
// time
// =============================================================================

export interface TimeMeta {
  realDurationMs?: number;
}

export interface TimeCtx {
  readonly source:
    | 'message-timestamp'
    | 'ttl-check'
    | 'queue-expiry'
    | 'heartbeat'
    | 'now';
  readonly meta: TimeMeta;
}

export type TimeResult = number;

// =============================================================================
// timers
// =============================================================================

export interface TimerSetMeta {
  realDurationMs?: number;
}

export interface TimerSetCtx {
  readonly source:
    | 'ttl-expiry'
    | 'queue-expiry'
    | 'delayed-delivery'
    | 'heartbeat';
  readonly delayMs: number;
  readonly meta: TimerSetMeta;
}

/** Opaque timer handle. Concrete type determined by the runtime. */
export type TimerHandle = unknown;

export type TimerSetResult = TimerHandle;

// =============================================================================
// random
// =============================================================================

export interface RandomMeta {
  realDurationMs?: number;
}

export interface RandomCtx {
  readonly source: 'consumer-tag' | 'message-id' | 'queue-name';
  readonly meta: RandomMeta;
}

export type RandomResult = string;

// =============================================================================
// delivery
// =============================================================================

export interface DeliveryMeta {
  readonly queueDepth: number;
  readonly consumerUnacked: number;
  readonly redelivered: boolean;
  realDurationMs?: number;
}

export interface DeliveryCtx {
  readonly queue: string;
  readonly consumerTag: string;
  readonly deliveryTag: number;
  readonly message: DeliveredMessage;
  readonly meta: DeliveryMeta;
}

export type DeliveryResult = undefined;

// =============================================================================
// return (mandatory messages)
// =============================================================================

export interface ReturnMeta {
  readonly mandatory: boolean;
  readonly publisherChannelId: string;
  realDurationMs?: number;
}

export interface ReturnCtx {
  readonly exchange: string;
  readonly routingKey: string;
  readonly replyCode: number;
  readonly replyText: string;
  readonly message: BrokerMessage;
  readonly meta: ReturnMeta;
}

export type ReturnResult = undefined;

// =============================================================================
// persist
// =============================================================================

export interface PersistMeta {
  readonly messageCount?: number;
  readonly sizeBytes?: number;
  realDurationMs?: number;
}

export interface PersistCtx {
  readonly operation: 'write-message' | 'write-topology' | 'fsync';
  readonly meta: PersistMeta;
}

export type PersistResult = undefined;
