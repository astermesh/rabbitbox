import { Channel } from './channel.ts';
import type { BrokerMessage } from './types/message.ts';
import { ConnectionError } from './errors/amqp-error.ts';
import { COMMAND_INVALID } from './errors/reply-codes.ts';

/** AMQP class ID for connection operations. */
const CONNECTION_CLASS = 10;

export type ConnectionState = 'open' | 'closing' | 'closed';

/**
 * Dependencies injected into a connection.
 */
export interface ConnectionDeps {
  /** Requeue a message back to its originating queue. */
  readonly onRequeue: (queueName: string, message: BrokerMessage) => void;
  /** Delete an exclusive queue owned by this connection. */
  readonly onDeleteQueue: (queueName: string, connectionId: string) => void;
}

/**
 * In-process AMQP connection model.
 *
 * Manages a set of channels and tracks exclusive queues.
 * Closing a connection closes all channels (requeueing their unacked messages)
 * and deletes all exclusive queues owned by the connection.
 */
export class Connection {
  readonly connectionId: string;
  private state: ConnectionState = 'open';
  private readonly _channels = new Map<number, Channel>();
  private nextChannelNum = 0;
  private readonly exclusiveQueues = new Set<string>();
  private readonly deps: ConnectionDeps;

  constructor(connectionId: string, deps: ConnectionDeps) {
    this.connectionId = connectionId;
    this.deps = deps;
  }

  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Create a new channel on this connection.
   * Channel numbers are assigned sequentially starting at 1.
   */
  createChannel(): Channel {
    this.assertOpen();
    const num = ++this.nextChannelNum;
    const ch = new Channel(num, {
      onRequeue: this.deps.onRequeue,
      onClose: (channelNumber: number) => {
        this._channels.delete(channelNumber);
      },
    });
    this._channels.set(num, ch);
    return ch;
  }

  /** Retrieve a channel by its number. */
  getChannel(channelNumber: number): Channel | undefined {
    return this._channels.get(channelNumber);
  }

  /** Read-only view of all channels. */
  get channels(): ReadonlyMap<number, Channel> {
    return this._channels;
  }

  /** Number of open channels on this connection. */
  get channelCount(): number {
    return this._channels.size;
  }

  /** Register an exclusive queue as owned by this connection. */
  registerExclusiveQueue(name: string): void {
    this.exclusiveQueues.add(name);
  }

  /** Unregister an exclusive queue (e.g. when explicitly deleted). */
  unregisterExclusiveQueue(name: string): void {
    this.exclusiveQueues.delete(name);
  }

  /**
   * Close this connection.
   *
   * 1. Closes all channels (requeuing their unacked messages)
   * 2. Deletes all exclusive queues owned by this connection
   *
   * Idempotent — calling close() on an already-closed connection is a no-op.
   */
  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closing';

    // Close all channels — collect first to avoid mutation during iteration
    const channels = [...this._channels.values()];
    this._channels.clear();
    for (const ch of channels) {
      ch.close();
    }

    // Delete exclusive queues
    for (const name of this.exclusiveQueues) {
      try {
        this.deps.onDeleteQueue(name, this.connectionId);
      } catch {
        // Queue might already be deleted — silently ignore
      }
    }
    this.exclusiveQueues.clear();

    this.state = 'closed';
  }

  /**
   * Throw if the connection is not in the open state.
   */
  assertOpen(): void {
    if (this.state !== 'open') {
      throw new ConnectionError(
        COMMAND_INVALID,
        'COMMAND_INVALID - connection is closing or closed',
        CONNECTION_CLASS,
        0
      );
    }
  }
}

/**
 * Factory function to create a new connection.
 *
 * @param connectionId - Unique identifier for this connection
 * @param deps - Dependency callbacks for cleanup operations
 */
export function createConnection(
  connectionId: string,
  deps: ConnectionDeps
): Connection {
  return new Connection(connectionId, deps);
}
