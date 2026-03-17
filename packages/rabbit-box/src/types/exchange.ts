/**
 * AMQP 0-9-1 exchange types supported by RabbitMQ.
 */
export type ExchangeType = 'direct' | 'fanout' | 'topic' | 'headers';

/**
 * Exchange entity as declared in the broker.
 *
 * Field names match the AMQP 0-9-1 exchange.declare method arguments.
 */
export interface Exchange {
  readonly name: string;
  readonly type: ExchangeType;
  readonly durable: boolean;
  readonly autoDelete: boolean;
  readonly internal: boolean;
  readonly arguments: Record<string, unknown>;
  readonly alternateExchange?: string;
}
