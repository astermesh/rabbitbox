/**
 * Overflow behavior when queue max-length or max-length-bytes is exceeded.
 */
export type OverflowBehavior =
  | 'drop-head'
  | 'reject-publish'
  | 'reject-publish-dlx';

/**
 * Queue entity as declared in the broker.
 *
 * Field names match the AMQP 0-9-1 queue.declare method arguments.
 * Derived fields are extracted from the arguments table for convenient access.
 */
export interface Queue {
  readonly name: string;
  readonly durable: boolean;
  readonly exclusive: boolean;
  readonly autoDelete: boolean;
  readonly arguments: Record<string, unknown>;

  // Derived from arguments
  readonly messageTtl?: number;
  readonly expires?: number;
  readonly maxLength?: number;
  readonly maxLengthBytes?: number;
  readonly overflowBehavior?: OverflowBehavior;
  readonly deadLetterExchange?: string;
  readonly deadLetterRoutingKey?: string;
  readonly maxPriority?: number;
  readonly singleActiveConsumer?: boolean;
}
