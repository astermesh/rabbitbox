export { connect, AmqplibConnection } from './connection.ts';
export { AmqplibChannel, type ConfirmCallback } from './channel.ts';
export type {
  ConnectionEvents,
  AmqplibChannelEvents,
  AmqplibMessage,
  AmqplibMessageProperties,
  AmqplibReturnedMessage,
} from './types.ts';

// Default export matching amqplib pattern: import amqp from 'rabbit-amqplib'
import { connect } from './connection.ts';
export default { connect };
