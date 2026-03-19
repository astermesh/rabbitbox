import type { Queue, OverflowBehavior } from './types/queue.ts';
import { channelError } from './errors/factories.ts';

/** AMQP class/method IDs for queue operations. */
const QUEUE_CLASS = 50;
const QUEUE_DECLARE = 10;
const QUEUE_PURGE = 30;
const QUEUE_DELETE = 40;

/** Options accepted by declareQueue. */
export interface DeclareQueueOptions {
  durable?: boolean;
  exclusive?: boolean;
  autoDelete?: boolean;
  arguments?: Record<string, unknown>;
}

/** Options accepted by deleteQueue. */
export interface DeleteQueueOptions {
  ifUnused?: boolean;
  ifEmpty?: boolean;
}

/** Result returned by declareQueue and checkQueue. */
export interface QueueDeclareOk {
  queue: string;
  messageCount: number;
  consumerCount: number;
}

/** Result returned by deleteQueue and purgeQueue. */
export interface QueueDeleteOk {
  messageCount: number;
}

/** Internal queue entry with mutable runtime counts. */
interface QueueEntry {
  queue: Queue;
  ownerConnection?: string;
  messageCount: number;
  consumerCount: number;
}

export interface QueueRegistryOptions {
  generateName?: () => string;
}

function defaultGenerateName(): string {
  return `amq.gen-${globalThis.crypto.randomUUID()}`;
}

function buildQueue(name: string, opts: DeclareQueueOptions): Queue {
  const args = opts.arguments ?? {};
  return {
    name,
    durable: opts.durable ?? false,
    exclusive: opts.exclusive ?? false,
    autoDelete: opts.autoDelete ?? false,
    arguments: { ...args },
    messageTtl: args['x-message-ttl'] as number | undefined,
    expires: args['x-expires'] as number | undefined,
    maxLength: args['x-max-length'] as number | undefined,
    maxLengthBytes: args['x-max-length-bytes'] as number | undefined,
    overflowBehavior: args['x-overflow'] as OverflowBehavior | undefined,
    deadLetterExchange: args['x-dead-letter-exchange'] as string | undefined,
    deadLetterRoutingKey: args['x-dead-letter-routing-key'] as
      | string
      | undefined,
    maxPriority: args['x-max-priority'] as number | undefined,
    singleActiveConsumer: args['x-single-active-consumer'] as
      | boolean
      | undefined,
  };
}

/**
 * Deep-equal comparison for queue arguments tables.
 * Returns the first key that differs, or undefined if equal.
 */
function findArgumentDiff(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): string | undefined {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      return key;
    }
  }
  return undefined;
}

export class QueueRegistry {
  private readonly queues = new Map<string, QueueEntry>();
  private readonly generateName: () => string;

  constructor(options?: QueueRegistryOptions) {
    this.generateName = options?.generateName ?? defaultGenerateName;
  }

  declareQueue(
    name: string,
    opts: DeclareQueueOptions,
    connectionId?: string
  ): QueueDeclareOk {
    // Server-generated name for empty string
    if (name === '') {
      const generated = this.generateName();
      const queue = buildQueue(generated, {
        ...opts,
        exclusive: opts.exclusive ?? false,
      });
      const entry: QueueEntry = {
        queue,
        ownerConnection: connectionId,
        messageCount: 0,
        consumerCount: 0,
      };
      this.queues.set(generated, entry);
      return { queue: generated, messageCount: 0, consumerCount: 0 };
    }

    // Reserved prefix check — amq.* is reserved for broker-generated names
    if (name.startsWith('amq.')) {
      throw channelError.accessRefused(
        `queue name '${name}' contains reserved prefix 'amq.*'`,
        QUEUE_CLASS,
        QUEUE_DECLARE
      );
    }

    const existing = this.queues.get(name);

    if (existing) {
      // Exclusive queue — check ownership first (takes priority over precondition checks)
      if (
        existing.queue.exclusive &&
        existing.ownerConnection !== connectionId
      ) {
        throw channelError.resourceLocked(
          `cannot obtain exclusive access to locked queue '${name}' in vhost '/'`,
          QUEUE_CLASS,
          QUEUE_DECLARE
        );
      }

      // Equivalence check — all options must match
      const newDurable = opts.durable ?? false;
      const newAutoDelete = opts.autoDelete ?? false;
      const newExclusive = opts.exclusive ?? false;
      const newArgs = opts.arguments ?? {};

      if (existing.queue.durable !== newDurable) {
        throw channelError.preconditionFailed(
          `inequivalent arg 'durable' for queue '${name}' in vhost '/': received '${newDurable}' but current is '${existing.queue.durable}'`,
          QUEUE_CLASS,
          QUEUE_DECLARE
        );
      }

      if (existing.queue.autoDelete !== newAutoDelete) {
        throw channelError.preconditionFailed(
          `inequivalent arg 'auto_delete' for queue '${name}' in vhost '/': received '${newAutoDelete}' but current is '${existing.queue.autoDelete}'`,
          QUEUE_CLASS,
          QUEUE_DECLARE
        );
      }

      if (existing.queue.exclusive !== newExclusive) {
        throw channelError.preconditionFailed(
          `inequivalent arg 'exclusive' for queue '${name}' in vhost '/': received '${newExclusive}' but current is '${existing.queue.exclusive}'`,
          QUEUE_CLASS,
          QUEUE_DECLARE
        );
      }

      const diffKey = findArgumentDiff(existing.queue.arguments, newArgs);
      if (diffKey !== undefined) {
        throw channelError.preconditionFailed(
          `inequivalent arg '${diffKey}' for queue '${name}' in vhost '/': received '${JSON.stringify(newArgs[diffKey]) ?? 'undefined'}' but current is '${JSON.stringify(existing.queue.arguments[diffKey]) ?? 'undefined'}'`,
          QUEUE_CLASS,
          QUEUE_DECLARE
        );
      }

      return {
        queue: name,
        messageCount: existing.messageCount,
        consumerCount: existing.consumerCount,
      };
    }

    // New queue
    const queue = buildQueue(name, opts);
    const entry: QueueEntry = {
      queue,
      ownerConnection: opts.exclusive ? connectionId : undefined,
      messageCount: 0,
      consumerCount: 0,
    };
    this.queues.set(name, entry);
    return { queue: name, messageCount: 0, consumerCount: 0 };
  }

  deleteQueue(
    name: string,
    opts?: DeleteQueueOptions,
    connectionId?: string
  ): QueueDeleteOk {
    const entry = this.queues.get(name);
    if (!entry) {
      throw channelError.notFound(
        `no queue '${name}' in vhost '/'`,
        QUEUE_CLASS,
        QUEUE_DELETE
      );
    }

    if (entry.queue.exclusive && entry.ownerConnection !== connectionId) {
      throw channelError.resourceLocked(
        `cannot obtain exclusive access to locked queue '${name}' in vhost '/'`,
        QUEUE_CLASS,
        QUEUE_DELETE
      );
    }

    if (opts?.ifUnused && entry.consumerCount > 0) {
      throw channelError.preconditionFailed(
        `queue '${name}' in vhost '/' in use`,
        QUEUE_CLASS,
        QUEUE_DELETE
      );
    }

    if (opts?.ifEmpty && entry.messageCount > 0) {
      throw channelError.preconditionFailed(
        `queue '${name}' in vhost '/' is not empty`,
        QUEUE_CLASS,
        QUEUE_DELETE
      );
    }

    const { messageCount } = entry;
    this.queues.delete(name);
    return { messageCount };
  }

  checkQueue(name: string, connectionId?: string): QueueDeclareOk {
    const entry = this.queues.get(name);
    if (!entry) {
      throw channelError.notFound(
        `no queue '${name}' in vhost '/'`,
        QUEUE_CLASS,
        QUEUE_DECLARE
      );
    }

    if (entry.queue.exclusive && entry.ownerConnection !== connectionId) {
      throw channelError.resourceLocked(
        `cannot obtain exclusive access to locked queue '${name}' in vhost '/'`,
        QUEUE_CLASS,
        QUEUE_DECLARE
      );
    }

    return {
      queue: name,
      messageCount: entry.messageCount,
      consumerCount: entry.consumerCount,
    };
  }

  purgeQueue(name: string, connectionId?: string): QueueDeleteOk {
    const entry = this.queues.get(name);
    if (!entry) {
      throw channelError.notFound(
        `no queue '${name}' in vhost '/'`,
        QUEUE_CLASS,
        QUEUE_PURGE
      );
    }

    if (entry.queue.exclusive && entry.ownerConnection !== connectionId) {
      throw channelError.resourceLocked(
        `cannot obtain exclusive access to locked queue '${name}' in vhost '/'`,
        QUEUE_CLASS,
        QUEUE_PURGE
      );
    }

    const { messageCount } = entry;
    entry.messageCount = 0;
    return { messageCount };
  }

  /** Get the Queue object (for inspection/testing). */
  getQueue(name: string): Queue | undefined {
    return this.queues.get(name)?.queue;
  }

  /** Set message count (used by message store or tests). */
  setMessageCount(name: string, count: number): void {
    const entry = this.queues.get(name);
    if (entry) {
      entry.messageCount = count;
    }
  }

  /** Set consumer count (used by consumer registry or tests). */
  setConsumerCount(name: string, count: number): void {
    const entry = this.queues.get(name);
    if (entry) {
      entry.consumerCount = count;
    }
  }
}
