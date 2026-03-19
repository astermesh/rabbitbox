/**
 * Inbound Box Interface (IBI) — context and result types for all 21 inbound hooks.
 */

// ── Message operations ──────────────────────────────────────────────

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
  readonly properties: Record<string, unknown>;
  readonly mandatory: boolean;
  readonly meta: PublishMeta;
}

export interface PublishResult {
  readonly routed: boolean;
}

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

export type GetResult = {
  readonly deliveryTag: number;
  readonly redelivered: boolean;
  readonly exchange: string;
  readonly routingKey: string;
  readonly messageCount?: number;
  readonly body: Uint8Array;
  readonly properties: Record<string, unknown>;
} | null;

export interface CancelMeta {
  readonly consumerExists: boolean;
  readonly queue: string;
  realDurationMs?: number;
}

export interface CancelCtx {
  readonly consumerTag: string;
  readonly meta: CancelMeta;
}

export interface CancelResult {
  readonly consumerTag: string;
}

// ── Acknowledgment operations ───────────────────────────────────────

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

export type AckResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

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

export type NackResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

export interface RejectCtx {
  readonly deliveryTag: number;
  readonly requeue: boolean;
  readonly meta: NackMeta;
}

export type RejectResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

export interface RecoverMeta {
  readonly unackedCount: number;
  realDurationMs?: number;
}

export interface RecoverCtx {
  readonly requeue: boolean;
  readonly meta: RecoverMeta;
}

export type RecoverResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

// ── Topology operations ─────────────────────────────────────────────

export interface ExchangeDeclareMeta {
  readonly alreadyExists: boolean;
  realDurationMs?: number;
}

export interface ExchangeDeclareCtx {
  readonly name: string;
  readonly type: string;
  readonly durable: boolean;
  readonly autoDelete: boolean;
  readonly internal: boolean;
  readonly arguments: Record<string, unknown>;
  readonly meta: ExchangeDeclareMeta;
}

export type ExchangeDeclareResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

export interface CheckExchangeMeta {
  readonly exists: boolean;
  realDurationMs?: number;
}

export interface CheckExchangeCtx {
  readonly name: string;
  readonly meta: CheckExchangeMeta;
}

export type CheckExchangeResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

export interface ExchangeDeleteMeta {
  readonly exists: boolean;
  realDurationMs?: number;
}

export interface ExchangeDeleteCtx {
  readonly name: string;
  readonly ifUnused: boolean;
  readonly meta: ExchangeDeleteMeta;
}

export type ExchangeDeleteResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

export interface ExchangeBindMeta {
  readonly destinationExists: boolean;
  readonly sourceExists: boolean;
  realDurationMs?: number;
}

export interface ExchangeBindCtx {
  readonly destination: string;
  readonly source: string;
  readonly routingKey: string;
  readonly arguments: Record<string, unknown>;
  readonly meta: ExchangeBindMeta;
}

export type ExchangeBindResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

export interface ExchangeUnbindCtx {
  readonly destination: string;
  readonly source: string;
  readonly routingKey: string;
  readonly arguments: Record<string, unknown>;
  readonly meta: ExchangeBindMeta;
}

export type ExchangeUnbindResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

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
  readonly arguments: Record<string, unknown>;
  readonly meta: QueueDeclareMeta;
}

export interface QueueDeclareResult {
  readonly queue: string;
  readonly messageCount: number;
  readonly consumerCount: number;
}

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

export interface QueueDeleteMeta {
  readonly exists: boolean;
  readonly messageCount: number;
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

export interface QueueBindMeta {
  readonly queueExists: boolean;
  readonly exchangeExists: boolean;
  realDurationMs?: number;
}

export interface QueueBindCtx {
  readonly queue: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly arguments: Record<string, unknown>;
  readonly meta: QueueBindMeta;
}

export type QueueBindResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

export interface QueueUnbindCtx {
  readonly queue: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly arguments: Record<string, unknown>;
  readonly meta: QueueBindMeta;
}

export type QueueUnbindResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

export interface PurgeMeta {
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

// ── QoS ─────────────────────────────────────────────────────────────

export interface PrefetchMeta {
  readonly previousCount: number;
  readonly channelConsumerCount: number;
  realDurationMs?: number;
}

export interface PrefetchCtx {
  readonly count: number;
  readonly global: boolean;
  readonly meta: PrefetchMeta;
}

export type PrefetchResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;

// ── Channel mode ────────────────────────────────────────────────────

export interface ConfirmSelectMeta {
  readonly alreadyInConfirmMode: boolean;
  readonly channelIsTransactional: boolean;
  realDurationMs?: number;
}

export interface ConfirmSelectCtx {
  readonly meta: ConfirmSelectMeta;
}

export type ConfirmSelectResult = // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  void;
