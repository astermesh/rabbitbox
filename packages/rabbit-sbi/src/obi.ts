/**
 * Outbound Box Interface (OBI) — context and result types for all 6 outbound hooks.
 */

// ── time ────────────────────────────────────────────────────────────

export interface TimeCtx {
  readonly source:
    | 'message-timestamp'
    | 'ttl-check'
    | 'queue-expiry'
    | 'heartbeat'
    | 'now';
  readonly meta: Record<string, never>;
}

export type TimeResult = number;

// ── timers ──────────────────────────────────────────────────────────

export interface TimerSetCtx {
  readonly source:
    | 'ttl-expiry'
    | 'queue-expiry'
    | 'delayed-delivery'
    | 'heartbeat';
  readonly delayMs: number;
  readonly meta: Record<string, never>;
}

export type TimerHandle = unknown;

export type TimerSetResult = TimerHandle;

export interface TimerFireCtx {
  readonly handle: TimerHandle;
  readonly source: string;
  readonly meta: {
    readonly scheduledAt: number;
    readonly firedAt: number;
  };
}

export type TimerFireResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

// ── random ──────────────────────────────────────────────────────────

export interface RandomCtx {
  readonly source: 'consumer-tag' | 'message-id' | 'queue-name';
  readonly meta: Record<string, never>;
}

export type RandomResult = string;

// ── delivery ────────────────────────────────────────────────────────

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
  readonly message: {
    readonly deliveryTag: number;
    readonly redelivered: boolean;
    readonly exchange: string;
    readonly routingKey: string;
    readonly body: Uint8Array;
    readonly properties: Record<string, unknown>;
  };
  readonly meta: DeliveryMeta;
}

export type DeliveryResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

// ── return ──────────────────────────────────────────────────────────

export interface ReturnCtx {
  readonly exchange: string;
  readonly routingKey: string;
  readonly replyCode: number;
  readonly replyText: string;
  readonly message: {
    readonly body: Uint8Array;
    readonly properties: Record<string, unknown>;
  };
  readonly meta: {
    readonly mandatory: boolean;
    readonly publisherChannelId: string;
  };
}

export type ReturnResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

// ── persist ─────────────────────────────────────────────────────────

export interface PersistCtx {
  readonly operation: 'write-message' | 'write-topology' | 'fsync';
  readonly meta: {
    readonly messageCount?: number;
    readonly sizeBytes?: number;
  };
}

export type PersistResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;
