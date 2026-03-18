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
export type { DeclareExchangeOptions } from './exchange-registry.ts';
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
