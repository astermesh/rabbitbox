// =============================================================================
// exchangeDeclare
// =============================================================================

export interface ExchangeDeclareMeta {
  readonly alreadyExists: boolean;
  realDurationMs?: number;
}

export interface ExchangeDeclareCtx {
  readonly name: string;
  readonly type: 'direct' | 'fanout' | 'topic' | 'headers';
  readonly durable: boolean;
  readonly autoDelete: boolean;
  readonly internal: boolean;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly meta: ExchangeDeclareMeta;
}

export interface ExchangeDeclareResult {
  readonly exchange: string;
}

// =============================================================================
// checkExchange (passive declare)
// =============================================================================

export interface CheckExchangeMeta {
  readonly exists: boolean;
  realDurationMs?: number;
}

export interface CheckExchangeCtx {
  readonly name: string;
  readonly meta: CheckExchangeMeta;
}

export type CheckExchangeResult = undefined;

// =============================================================================
// exchangeDelete
// =============================================================================

export interface ExchangeDeleteMeta {
  readonly exists: boolean;
  readonly hasBindings: boolean;
  realDurationMs?: number;
}

export interface ExchangeDeleteCtx {
  readonly name: string;
  readonly ifUnused: boolean;
  readonly meta: ExchangeDeleteMeta;
}

export type ExchangeDeleteResult = undefined;

// =============================================================================
// exchangeBind
// =============================================================================

export interface ExchangeBindMeta {
  readonly destinationExists: boolean;
  readonly sourceExists: boolean;
  realDurationMs?: number;
}

export interface ExchangeBindCtx {
  readonly destination: string;
  readonly source: string;
  readonly routingKey: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly meta: ExchangeBindMeta;
}

export type ExchangeBindResult = undefined;

// =============================================================================
// exchangeUnbind
// =============================================================================

export interface ExchangeUnbindMeta {
  readonly destinationExists: boolean;
  readonly sourceExists: boolean;
  realDurationMs?: number;
}

export interface ExchangeUnbindCtx {
  readonly destination: string;
  readonly source: string;
  readonly routingKey: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly meta: ExchangeUnbindMeta;
}

export type ExchangeUnbindResult = undefined;

// =============================================================================
// queueDeclare
// =============================================================================

export interface QueueDeclareMeta {
  readonly alreadyExists: boolean;
  readonly messageCount: number;
  readonly consumerCount: number;
  realDurationMs?: number;
}

export interface QueueDeclareCtx {
  readonly name: string;
  readonly durable: boolean;
  readonly exclusive: boolean;
  readonly autoDelete: boolean;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly meta: QueueDeclareMeta;
}

export interface QueueDeclareResult {
  readonly queue: string;
  readonly messageCount: number;
  readonly consumerCount: number;
}

// =============================================================================
// checkQueue (passive declare)
// =============================================================================

export interface CheckQueueMeta {
  readonly exists: boolean;
  readonly messageCount: number;
  readonly consumerCount: number;
  realDurationMs?: number;
}

export interface CheckQueueCtx {
  readonly name: string;
  readonly meta: CheckQueueMeta;
}

export interface CheckQueueResult {
  readonly queue: string;
  readonly messageCount: number;
  readonly consumerCount: number;
}

// =============================================================================
// queueDelete
// =============================================================================

export interface QueueDeleteMeta {
  readonly exists: boolean;
  readonly messageCount: number;
  readonly consumerCount: number;
  realDurationMs?: number;
}

export interface QueueDeleteCtx {
  readonly name: string;
  readonly ifUnused: boolean;
  readonly ifEmpty: boolean;
  readonly meta: QueueDeleteMeta;
}

export interface QueueDeleteResult {
  readonly messageCount: number;
}

// =============================================================================
// queueBind
// =============================================================================

export interface QueueBindMeta {
  readonly queueExists: boolean;
  readonly exchangeExists: boolean;
  realDurationMs?: number;
}

export interface QueueBindCtx {
  readonly queue: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly meta: QueueBindMeta;
}

export type QueueBindResult = undefined;

// =============================================================================
// queueUnbind
// =============================================================================

export interface QueueUnbindMeta {
  readonly bindingExists: boolean;
  realDurationMs?: number;
}

export interface QueueUnbindCtx {
  readonly queue: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly meta: QueueUnbindMeta;
}

export type QueueUnbindResult = undefined;

// =============================================================================
// purge
// =============================================================================

export interface PurgeMeta {
  readonly queueExists: boolean;
  readonly messageCount: number;
  realDurationMs?: number;
}

export interface PurgeCtx {
  readonly queue: string;
  readonly meta: PurgeMeta;
}

export interface PurgeResult {
  readonly messageCount: number;
}
