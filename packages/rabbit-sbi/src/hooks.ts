import type { Hook } from './hook.ts';
import type {
  PublishCtx,
  PublishResult,
  ConsumeCtx,
  ConsumeResult,
  GetCtx,
  GetResult,
  CancelCtx,
  CancelResult,
  AckCtx,
  AckResult,
  NackCtx,
  NackResult,
  RejectCtx,
  RejectResult,
  RecoverCtx,
  RecoverResult,
  ExchangeDeclareCtx,
  ExchangeDeclareResult,
  CheckExchangeCtx,
  CheckExchangeResult,
  ExchangeDeleteCtx,
  ExchangeDeleteResult,
  ExchangeBindCtx,
  ExchangeBindResult,
  ExchangeUnbindCtx,
  ExchangeUnbindResult,
  QueueDeclareCtx,
  QueueDeclareResult,
  CheckQueueCtx,
  CheckQueueResult,
  QueueDeleteCtx,
  QueueDeleteResult,
  QueueBindCtx,
  QueueBindResult,
  QueueUnbindCtx,
  QueueUnbindResult,
  PurgeCtx,
  PurgeResult,
  PrefetchCtx,
  PrefetchResult,
  ConfirmSelectCtx,
  ConfirmSelectResult,
} from './ibi.ts';
import type {
  TimeCtx,
  TimeResult,
  TimerSetCtx,
  TimerSetResult,
  RandomCtx,
  RandomResult,
  DeliveryCtx,
  DeliveryResult,
  ReturnCtx,
  ReturnResult,
  PersistCtx,
  PersistResult,
} from './obi.ts';

/** All 21 inbound hook points. */
export interface RabbitInboundHooks {
  // Message operations
  readonly publish?: Hook<PublishCtx, PublishResult>;
  readonly consume?: Hook<ConsumeCtx, ConsumeResult>;
  readonly get?: Hook<GetCtx, GetResult>;
  readonly cancel?: Hook<CancelCtx, CancelResult>;

  // Acknowledgment
  readonly ack?: Hook<AckCtx, AckResult>;
  readonly nack?: Hook<NackCtx, NackResult>;
  readonly reject?: Hook<RejectCtx, RejectResult>;
  readonly recover?: Hook<RecoverCtx, RecoverResult>;

  // Topology
  readonly exchangeDeclare?: Hook<ExchangeDeclareCtx, ExchangeDeclareResult>;
  readonly checkExchange?: Hook<CheckExchangeCtx, CheckExchangeResult>;
  readonly exchangeDelete?: Hook<ExchangeDeleteCtx, ExchangeDeleteResult>;
  readonly exchangeBind?: Hook<ExchangeBindCtx, ExchangeBindResult>;
  readonly exchangeUnbind?: Hook<ExchangeUnbindCtx, ExchangeUnbindResult>;
  readonly queueDeclare?: Hook<QueueDeclareCtx, QueueDeclareResult>;
  readonly checkQueue?: Hook<CheckQueueCtx, CheckQueueResult>;
  readonly queueDelete?: Hook<QueueDeleteCtx, QueueDeleteResult>;
  readonly queueBind?: Hook<QueueBindCtx, QueueBindResult>;
  readonly queueUnbind?: Hook<QueueUnbindCtx, QueueUnbindResult>;
  readonly purge?: Hook<PurgeCtx, PurgeResult>;

  // QoS
  readonly prefetch?: Hook<PrefetchCtx, PrefetchResult>;

  // Channel mode
  readonly confirmSelect?: Hook<ConfirmSelectCtx, ConfirmSelectResult>;
}

/** All 6 outbound hook points. */
export interface RabbitOutboundHooks {
  readonly time?: Hook<TimeCtx, TimeResult>;
  readonly timers?: Hook<TimerSetCtx, TimerSetResult>;
  readonly random?: Hook<RandomCtx, RandomResult>;
  readonly delivery?: Hook<DeliveryCtx, DeliveryResult>;
  readonly return?: Hook<ReturnCtx, ReturnResult>;
  readonly persist?: Hook<PersistCtx, PersistResult>;
}

/** Combined hooks interface. */
export type RabbitHooks = RabbitInboundHooks & RabbitOutboundHooks;
