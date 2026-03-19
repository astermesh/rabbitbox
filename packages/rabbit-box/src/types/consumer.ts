import type { BrokerMessage, DeliveredMessage } from './message.ts';

/**
 * A message held by the broker pending acknowledgment from a consumer.
 */
export interface UnackedMessage {
  readonly deliveryTag: number;
  readonly message: BrokerMessage;
  readonly queueName: string;
  readonly consumerTag: string;
}

/**
 * Consumer entity as registered via basic.consume.
 *
 * Tracks the consumer's subscription parameters and unacknowledged message state.
 */
export interface Consumer {
  readonly consumerTag: string;
  readonly queueName: string;
  readonly callback: (msg: DeliveredMessage) => void;
  readonly noAck: boolean;
  readonly exclusive: boolean;
}
