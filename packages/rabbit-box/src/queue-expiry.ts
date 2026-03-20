import type { ObiTimers } from './obi/types.ts';
import { channelError } from './errors/factories.ts';

const QUEUE_CLASS = 50;
const QUEUE_DECLARE = 10;

interface TimerEntry {
  readonly expiresMs: number;
  handle: unknown;
}

export interface QueueExpiryOptions {
  readonly timers: ObiTimers;
  readonly onExpire: (queueName: string) => void;
}

/**
 * Manages queue expiry timers (x-expires argument).
 *
 * When a queue is idle (no consumers, no basic.get, no re-declarations)
 * for the configured duration, the onExpire callback is invoked.
 * The caller is responsible for actually deleting the queue.
 */
export class QueueExpiry {
  private readonly timers: ObiTimers;
  private readonly onExpire: (queueName: string) => void;
  private readonly entries = new Map<string, TimerEntry>();

  constructor(options: QueueExpiryOptions) {
    this.timers = options.timers;
    this.onExpire = options.onExpire;
  }

  /**
   * Register a queue for expiry. Validates the expires value.
   * If already registered, resets the timer (handles re-declare).
   */
  register(queueName: string, expiresMs: number): void {
    validateExpires(expiresMs);

    // Clear existing timer if re-registering
    const existing = this.entries.get(queueName);
    if (existing) {
      this.timers.clearTimeout(existing.handle);
    }

    const handle = this.timers.setTimeout(() => {
      this.entries.delete(queueName);
      this.onExpire(queueName);
    }, expiresMs);

    this.entries.set(queueName, { expiresMs, handle });
  }

  /** Unregister a queue — clears its expiry timer. */
  unregister(queueName: string): void {
    const entry = this.entries.get(queueName);
    if (!entry) return;
    this.timers.clearTimeout(entry.handle);
    this.entries.delete(queueName);
  }

  /**
   * Reset the expiry timer on activity (consume, cancel with remaining
   * consumers, get, re-declare).
   */
  resetActivity(queueName: string): void {
    const entry = this.entries.get(queueName);
    if (!entry) return;
    this.timers.clearTimeout(entry.handle);
    entry.handle = this.timers.setTimeout(() => {
      this.entries.delete(queueName);
      this.onExpire(queueName);
    }, entry.expiresMs);
  }
}

export function validateExpires(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw channelError.preconditionFailed(
      `invalid arg 'x-expires' for queue in vhost '/': ${JSON.stringify(value)} is not a valid value`,
      QUEUE_CLASS,
      QUEUE_DECLARE
    );
  }
}
