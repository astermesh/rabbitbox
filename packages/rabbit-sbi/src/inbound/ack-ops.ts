// =============================================================================
// ack
// =============================================================================

export interface AckMeta {
  readonly messageExists: boolean;
  readonly consumerTag: string;
  readonly queue: string;
  realDurationMs?: number;
}

export interface AckCtx {
  readonly deliveryTag: number;
  readonly multiple: boolean;
  readonly meta: AckMeta;
}

export type AckResult = undefined;

// =============================================================================
// nack
// =============================================================================

export interface NackMeta {
  readonly messageExists: boolean;
  readonly willDeadLetter: boolean;
  readonly consumerTag: string;
  readonly queue: string;
  realDurationMs?: number;
}

export interface NackCtx {
  readonly deliveryTag: number;
  readonly multiple: boolean;
  readonly requeue: boolean;
  readonly meta: NackMeta;
}

export type NackResult = undefined;

// =============================================================================
// reject
// =============================================================================

export interface RejectMeta {
  readonly messageExists: boolean;
  readonly willDeadLetter: boolean;
  readonly consumerTag: string;
  readonly queue: string;
  realDurationMs?: number;
}

export interface RejectCtx {
  readonly deliveryTag: number;
  readonly requeue: boolean;
  readonly meta: RejectMeta;
}

export type RejectResult = undefined;

// =============================================================================
// recover
// =============================================================================

export interface RecoverMeta {
  readonly unackedCount: number;
  realDurationMs?: number;
}

export interface RecoverCtx {
  readonly requeue: boolean;
  readonly meta: RecoverMeta;
}

export type RecoverResult = undefined;
