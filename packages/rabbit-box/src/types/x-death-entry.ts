/**
 * Reason a message was dead-lettered.
 */
export type XDeathReason = 'rejected' | 'expired' | 'maxlen' | 'delivery_limit';

/**
 * Single entry in the x-death header array.
 *
 * Tracks the history of a message being dead-lettered. Each entry records
 * one dead-lettering event from a specific queue for a specific reason.
 * Field names match the RabbitMQ x-death header fields exactly.
 */
export interface XDeathEntry {
  readonly queue: string;
  readonly reason: XDeathReason;
  readonly count: number;
  readonly exchange: string;
  readonly 'routing-keys': string[];
  readonly time: number;
  readonly 'original-expiration'?: string;
}
