export type {
  Exchange,
  ExchangeType,
  Queue,
  OverflowBehavior,
  MessageProperties,
  BrokerMessage,
  DeliveredMessage,
  Consumer,
  UnackedMessage,
  Binding,
  XDeathEntry,
  XDeathReason,
} from './types/index.ts';

export {
  AmqpError,
  ChannelError,
  ConnectionError,
} from './errors/amqp-error.ts';
export * from './errors/reply-codes.ts';
export { channelError, connectionError } from './errors/factories.ts';
export { ExchangeRegistry } from './exchange-registry.ts';
export type {
  DeclareExchangeOptions,
  ExchangeRegistryHooks,
} from './exchange-registry.ts';
export { BindingStore } from './binding-store.ts';
export type {
  BindingStoreOptions,
  BindingStoreHooks,
} from './binding-store.ts';
export { MessageStore } from './message-store.ts';
export type { MessageStoreOptions } from './message-store.ts';
export {
  directMatch,
  fanoutMatch,
  topicMatch,
  headersMatch,
  route,
} from './routing.ts';
export { publish } from './publish.ts';
export type { PublishResult, PublishOptions } from './publish.ts';
export { ack, nack, reject, ackAll, nackAll } from './acknowledgment.ts';
export type { AcknowledgmentDeps } from './acknowledgment.ts';
export {
  deadLetter,
  deadLetterExpired,
  prepareDeadLetter,
  isDeadLetterCycle,
} from './dead-letter.ts';
export type { DeadLetterDeps, DeadLetterOptions } from './dead-letter.ts';
export { Channel } from './channel.ts';
export type {
  ChannelState,
  ChannelDeps,
  ChannelHooks,
  GetOptions,
  CheckQueueResult,
  DequeueResult,
} from './channel.ts';
export { Connection, createConnection } from './connection.ts';
export type { ConnectionState, ConnectionDeps } from './connection.ts';
export { ConsumerRegistry } from './consumer-registry.ts';
export type {
  ConsumeOptions,
  ConsumerEntry,
  ConsumerRegistryHooks,
} from './consumer-registry.ts';
export { Dispatcher } from './dispatcher.ts';
export type { DispatcherOptions } from './dispatcher.ts';
export { runHooked } from './hook-runner.ts';
export { QueueRegistry } from './queue-registry.ts';
export type {
  DeclareQueueOptions,
  DeleteQueueOptions,
  QueueDeclareOk,
  QueueDeleteOk,
  QueueRegistryOptions,
  QueueRegistryHooks,
} from './queue-registry.ts';
export type {
  ObiTime,
  ObiTimers,
  ObiRandom,
  ObiDelivery,
  ReturnContext,
  ObiReturn,
  ObiPersist,
  ObiHooks,
} from './obi/index.ts';
export {
  createDefaultTime,
  createDefaultTimers,
  createDefaultRandom,
  createDefaultDelivery,
  createDefaultReturn,
  createDefaultPersist,
  createDefaultObiHooks,
} from './obi/index.ts';

// Public API
export { RabbitBox } from './api/rabbit-box.ts';
export { ApiConnection } from './api/connection.ts';
export { ApiChannel } from './api/channel.ts';
export { EventEmitter } from './api/event-emitter.ts';
export type {
  RabbitBoxOptions,
  AssertExchangeOptions,
  AssertExchangeResult,
  DeleteExchangeOptions,
  AssertQueueOptions,
  AssertQueueResult,
  DeleteQueueOptions as ApiDeleteQueueOptions,
  PurgeResult,
  PublishMessageOptions,
  ConsumeOptions as ApiConsumeOptions,
  ConsumeResult as ApiConsumeResult,
  GetOptions as ApiGetOptions,
  ConnectionEvents,
  ChannelEvents,
  ReturnedMessage,
} from './api/types.ts';
