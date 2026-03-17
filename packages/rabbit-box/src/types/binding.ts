/**
 * Binding between an exchange and a queue.
 *
 * Field names match the AMQP 0-9-1 queue.bind method arguments.
 */
export interface Binding {
  readonly exchange: string;
  readonly queue: string;
  readonly routingKey: string;
  readonly arguments: Record<string, unknown>;
}
