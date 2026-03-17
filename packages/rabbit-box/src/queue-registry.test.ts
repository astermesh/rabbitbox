import { describe, expect, it } from 'vitest';
import { QueueRegistry } from './queue-registry.ts';
import { ChannelError } from './errors/amqp-error.ts';
import {
  ACCESS_REFUSED,
  NOT_FOUND,
  PRECONDITION_FAILED,
  RESOURCE_LOCKED,
} from './errors/reply-codes.ts';

function defined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

const QUEUE_CLASS = 50;
const QUEUE_DECLARE = 10;
const QUEUE_DELETE = 40;
const QUEUE_PURGE = 30;

function createRegistry(generateName?: () => string): QueueRegistry {
  return new QueueRegistry(generateName ? { generateName } : undefined);
}

// ── declareQueue ────────────────────────────────────────────────────

describe('declareQueue', () => {
  it('creates a new queue with default options', () => {
    const reg = createRegistry();
    const result = reg.declareQueue('orders', {});
    expect(result).toEqual({ queue: 'orders', messageCount: 0, consumerCount: 0 });
  });

  it('creates a queue with custom options', () => {
    const reg = createRegistry();
    const result = reg.declareQueue('durable-q', {
      durable: true,
      exclusive: false,
      autoDelete: false,
      arguments: { 'x-message-ttl': 60000 },
    });
    expect(result).toEqual({ queue: 'durable-q', messageCount: 0, consumerCount: 0 });
  });

  it('generates amq.gen-* name when name is empty', () => {
    let counter = 0;
    const reg = createRegistry(() => `amq.gen-test-${++counter}`);
    const result = reg.declareQueue('', {});
    expect(result.queue).toBe('amq.gen-test-1');
    expect(result.messageCount).toBe(0);
    expect(result.consumerCount).toBe(0);
  });

  it('generates unique names for each empty-name declare', () => {
    let counter = 0;
    const reg = createRegistry(() => `amq.gen-test-${++counter}`);
    const r1 = reg.declareQueue('', {});
    const r2 = reg.declareQueue('', {});
    expect(r1.queue).not.toBe(r2.queue);
  });

  it('default generateName produces amq.gen- prefix', () => {
    const reg = createRegistry();
    const result = reg.declareQueue('', {});
    expect(result.queue).toMatch(/^amq\.gen-/);
  });

  // ── Idempotent re-declare ───────────────────────────────────────

  it('is idempotent when re-declared with same options', () => {
    const reg = createRegistry();
    const opts = { durable: true, autoDelete: false, exclusive: false, arguments: {} };
    reg.declareQueue('q1', opts);
    const result = reg.declareQueue('q1', opts);
    expect(result).toEqual({ queue: 'q1', messageCount: 0, consumerCount: 0 });
  });

  it('is idempotent with default options (all false)', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    const result = reg.declareQueue('q1', {});
    expect(result).toEqual({ queue: 'q1', messageCount: 0, consumerCount: 0 });
  });

  it('is idempotent with matching arguments', () => {
    const reg = createRegistry();
    const args = { 'x-message-ttl': 5000, 'x-max-length': 100 };
    reg.declareQueue('q1', { arguments: args });
    const result = reg.declareQueue('q1', { arguments: { ...args } });
    expect(result).toEqual({ queue: 'q1', messageCount: 0, consumerCount: 0 });
  });

  // ── PRECONDITION_FAILED on option mismatch ──────────────────────

  it('throws PRECONDITION_FAILED when durable differs', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', { durable: true });
    expect(() => reg.declareQueue('q1', { durable: false })).toThrow(ChannelError);
    try {
      reg.declareQueue('q1', { durable: false });
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(PRECONDITION_FAILED);
      expect(e.replyText).toBe(
        "PRECONDITION_FAILED - inequivalent arg 'durable' for queue 'q1' in vhost '/': received 'false' but current is 'true'"
      );
      expect(e.classId).toBe(QUEUE_CLASS);
      expect(e.methodId).toBe(QUEUE_DECLARE);
    }
  });

  it('throws PRECONDITION_FAILED when autoDelete differs', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', { autoDelete: true });
    expect(() => reg.declareQueue('q1', { autoDelete: false })).toThrow(ChannelError);
    try {
      reg.declareQueue('q1', { autoDelete: false });
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(PRECONDITION_FAILED);
      expect(e.replyText).toMatch(/inequivalent arg 'auto_delete'/);
    }
  });

  it('throws PRECONDITION_FAILED when exclusive differs', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', { exclusive: true }, 'conn-1');
    expect(() => reg.declareQueue('q1', { exclusive: false }, 'conn-1')).toThrow(ChannelError);
    try {
      reg.declareQueue('q1', { exclusive: false }, 'conn-1');
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(PRECONDITION_FAILED);
      expect(e.replyText).toMatch(/inequivalent arg 'exclusive'/);
    }
  });

  it('throws PRECONDITION_FAILED when arguments differ', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', { arguments: { 'x-message-ttl': 5000 } });
    expect(() =>
      reg.declareQueue('q1', { arguments: { 'x-message-ttl': 10000 } })
    ).toThrow(ChannelError);
    try {
      reg.declareQueue('q1', { arguments: { 'x-message-ttl': 10000 } });
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(PRECONDITION_FAILED);
      expect(e.replyText).toMatch(/inequivalent arg 'x-message-ttl'/);
    }
  });

  it('throws PRECONDITION_FAILED when arguments keys differ', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', { arguments: { 'x-message-ttl': 5000 } });
    expect(() =>
      reg.declareQueue('q1', { arguments: {} })
    ).toThrow(ChannelError);
  });

  it('throws PRECONDITION_FAILED when new declare has extra arguments', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', { arguments: {} });
    expect(() =>
      reg.declareQueue('q1', { arguments: { 'x-max-length': 100 } })
    ).toThrow(ChannelError);
  });

  // ── Exclusive queue access ──────────────────────────────────────

  it('allows owner connection to re-declare exclusive queue', () => {
    const reg = createRegistry();
    reg.declareQueue('exclusive-q', { exclusive: true }, 'conn-1');
    const result = reg.declareQueue('exclusive-q', { exclusive: true }, 'conn-1');
    expect(result).toEqual({ queue: 'exclusive-q', messageCount: 0, consumerCount: 0 });
  });

  it('throws RESOURCE_LOCKED when non-owner declares exclusive queue', () => {
    const reg = createRegistry();
    reg.declareQueue('exclusive-q', { exclusive: true }, 'conn-1');
    expect(() =>
      reg.declareQueue('exclusive-q', { exclusive: true }, 'conn-2')
    ).toThrow(ChannelError);
    try {
      reg.declareQueue('exclusive-q', { exclusive: true }, 'conn-2');
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(RESOURCE_LOCKED);
      expect(e.replyText).toBe(
        "RESOURCE_LOCKED - cannot obtain exclusive access to locked queue 'exclusive-q' in vhost '/'"
      );
      expect(e.classId).toBe(QUEUE_CLASS);
      expect(e.methodId).toBe(QUEUE_DECLARE);
    }
  });

  it('RESOURCE_LOCKED takes priority over PRECONDITION_FAILED for exclusive queues', () => {
    const reg = createRegistry();
    reg.declareQueue('exclusive-q', { exclusive: true, durable: true }, 'conn-1');
    try {
      // Different connection AND different options — should get RESOURCE_LOCKED, not PRECONDITION_FAILED
      reg.declareQueue('exclusive-q', { exclusive: true, durable: false }, 'conn-2');
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(RESOURCE_LOCKED);
    }
  });

  // ── Reserved amq.* prefix ──────────────────────────────────────

  it('throws ACCESS_REFUSED for queue name starting with amq.', () => {
    const reg = createRegistry();
    expect(() => reg.declareQueue('amq.custom', {})).toThrow(ChannelError);
    try {
      reg.declareQueue('amq.custom', {});
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(ACCESS_REFUSED);
      expect(e.replyText).toBe(
        "ACCESS_REFUSED - queue name 'amq.custom' contains reserved prefix 'amq.*'"
      );
      expect(e.classId).toBe(QUEUE_CLASS);
      expect(e.methodId).toBe(QUEUE_DECLARE);
    }
  });

  it('allows server-generated amq.gen-* names', () => {
    const reg = createRegistry(() => 'amq.gen-abc123');
    const result = reg.declareQueue('', {});
    expect(result.queue).toBe('amq.gen-abc123');
  });

  // ── Return value with counts ────────────────────────────────────

  it('returns current messageCount and consumerCount on re-declare', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    reg.setMessageCount('q1', 5);
    reg.setConsumerCount('q1', 2);
    const result = reg.declareQueue('q1', {});
    expect(result).toEqual({ queue: 'q1', messageCount: 5, consumerCount: 2 });
  });
});

// ── deleteQueue ─────────────────────────────────────────────────────

describe('deleteQueue', () => {
  it('deletes an existing queue and returns messageCount', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    const result = reg.deleteQueue('q1');
    expect(result).toEqual({ messageCount: 0 });
  });

  it('returns messageCount of deleted queue', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    reg.setMessageCount('q1', 42);
    const result = reg.deleteQueue('q1');
    expect(result).toEqual({ messageCount: 42 });
  });

  it('queue is gone after deletion', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    reg.deleteQueue('q1');
    expect(() => reg.checkQueue('q1')).toThrow(ChannelError);
  });

  it('throws NOT_FOUND for non-existent queue', () => {
    const reg = createRegistry();
    expect(() => reg.deleteQueue('ghost')).toThrow(ChannelError);
    try {
      reg.deleteQueue('ghost');
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(NOT_FOUND);
      expect(e.replyText).toBe(
        "NOT_FOUND - no queue 'ghost' in vhost '/'"
      );
      expect(e.classId).toBe(QUEUE_CLASS);
      expect(e.methodId).toBe(QUEUE_DELETE);
    }
  });

  it('throws PRECONDITION_FAILED with ifUnused when queue has consumers', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    reg.setConsumerCount('q1', 1);
    expect(() => reg.deleteQueue('q1', { ifUnused: true })).toThrow(ChannelError);
    try {
      reg.deleteQueue('q1', { ifUnused: true });
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(PRECONDITION_FAILED);
      expect(e.replyText).toBe(
        "PRECONDITION_FAILED - queue 'q1' in vhost '/' in use"
      );
      expect(e.classId).toBe(QUEUE_CLASS);
      expect(e.methodId).toBe(QUEUE_DELETE);
    }
  });

  it('allows ifUnused delete when queue has no consumers', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    const result = reg.deleteQueue('q1', { ifUnused: true });
    expect(result).toEqual({ messageCount: 0 });
  });

  it('throws PRECONDITION_FAILED with ifEmpty when queue has messages', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    reg.setMessageCount('q1', 10);
    expect(() => reg.deleteQueue('q1', { ifEmpty: true })).toThrow(ChannelError);
    try {
      reg.deleteQueue('q1', { ifEmpty: true });
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(PRECONDITION_FAILED);
      expect(e.replyText).toBe(
        "PRECONDITION_FAILED - queue 'q1' in vhost '/' is not empty"
      );
      expect(e.classId).toBe(QUEUE_CLASS);
      expect(e.methodId).toBe(QUEUE_DELETE);
    }
  });

  it('allows ifEmpty delete when queue is empty', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    const result = reg.deleteQueue('q1', { ifEmpty: true });
    expect(result).toEqual({ messageCount: 0 });
  });

  it('checks both ifUnused and ifEmpty together', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    reg.setConsumerCount('q1', 1);
    reg.setMessageCount('q1', 5);
    // ifUnused is checked first
    expect(() => reg.deleteQueue('q1', { ifUnused: true, ifEmpty: true })).toThrow(ChannelError);
    try {
      reg.deleteQueue('q1', { ifUnused: true, ifEmpty: true });
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(PRECONDITION_FAILED);
      expect(e.replyText).toMatch(/in use/);
    }
  });
});

// ── checkQueue ──────────────────────────────────────────────────────

describe('checkQueue', () => {
  it('returns queue info for existing queue', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    const result = reg.checkQueue('q1');
    expect(result).toEqual({ queue: 'q1', messageCount: 0, consumerCount: 0 });
  });

  it('returns current counts', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    reg.setMessageCount('q1', 7);
    reg.setConsumerCount('q1', 3);
    const result = reg.checkQueue('q1');
    expect(result).toEqual({ queue: 'q1', messageCount: 7, consumerCount: 3 });
  });

  it('throws NOT_FOUND for non-existent queue', () => {
    const reg = createRegistry();
    expect(() => reg.checkQueue('ghost')).toThrow(ChannelError);
    try {
      reg.checkQueue('ghost');
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(NOT_FOUND);
      expect(e.replyText).toBe(
        "NOT_FOUND - no queue 'ghost' in vhost '/'"
      );
      expect(e.classId).toBe(QUEUE_CLASS);
      expect(e.methodId).toBe(QUEUE_DECLARE);
    }
  });

  it('throws RESOURCE_LOCKED for exclusive queue from different connection', () => {
    const reg = createRegistry();
    reg.declareQueue('exclusive-q', { exclusive: true }, 'conn-1');
    expect(() => reg.checkQueue('exclusive-q', 'conn-2')).toThrow(ChannelError);
    try {
      reg.checkQueue('exclusive-q', 'conn-2');
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(RESOURCE_LOCKED);
      expect(e.replyText).toBe(
        "RESOURCE_LOCKED - cannot obtain exclusive access to locked queue 'exclusive-q' in vhost '/'"
      );
      expect(e.classId).toBe(QUEUE_CLASS);
      expect(e.methodId).toBe(QUEUE_DECLARE);
    }
  });

  it('allows owner to check exclusive queue', () => {
    const reg = createRegistry();
    reg.declareQueue('exclusive-q', { exclusive: true }, 'conn-1');
    const result = reg.checkQueue('exclusive-q', 'conn-1');
    expect(result).toEqual({ queue: 'exclusive-q', messageCount: 0, consumerCount: 0 });
  });
});

// ── purgeQueue ──────────────────────────────────────────────────────

describe('purgeQueue', () => {
  it('returns messageCount 0 for empty queue', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    const result = reg.purgeQueue('q1');
    expect(result).toEqual({ messageCount: 0 });
  });

  it('returns previous messageCount and resets to 0', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    reg.setMessageCount('q1', 25);
    const result = reg.purgeQueue('q1');
    expect(result).toEqual({ messageCount: 25 });
    // After purge, count is 0
    const info = reg.checkQueue('q1');
    expect(info.messageCount).toBe(0);
  });

  it('throws NOT_FOUND for non-existent queue', () => {
    const reg = createRegistry();
    expect(() => reg.purgeQueue('ghost')).toThrow(ChannelError);
    try {
      reg.purgeQueue('ghost');
    } catch (err) {
      const e = err as ChannelError;
      expect(e.replyCode).toBe(NOT_FOUND);
      expect(e.replyText).toBe(
        "NOT_FOUND - no queue 'ghost' in vhost '/'"
      );
      expect(e.classId).toBe(QUEUE_CLASS);
      expect(e.methodId).toBe(QUEUE_PURGE);
    }
  });
});

// ── Queue object construction ───────────────────────────────────────

describe('queue object', () => {
  it('stores queue with correct properties', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {
      durable: true,
      exclusive: false,
      autoDelete: true,
      arguments: { 'x-message-ttl': 60000 },
    });
    const queue = defined(reg.getQueue('q1'));
    expect(queue.name).toBe('q1');
    expect(queue.durable).toBe(true);
    expect(queue.exclusive).toBe(false);
    expect(queue.autoDelete).toBe(true);
    expect(queue.arguments).toEqual({ 'x-message-ttl': 60000 });
  });

  it('defaults to durable=false, exclusive=false, autoDelete=false', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    const queue = defined(reg.getQueue('q1'));
    expect(queue.durable).toBe(false);
    expect(queue.exclusive).toBe(false);
    expect(queue.autoDelete).toBe(false);
    expect(queue.arguments).toEqual({});
  });

  it('extracts derived fields from arguments', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {
      arguments: {
        'x-message-ttl': 60000,
        'x-expires': 300000,
        'x-max-length': 1000,
        'x-max-length-bytes': 1048576,
        'x-overflow': 'reject-publish',
        'x-dead-letter-exchange': 'dlx',
        'x-dead-letter-routing-key': 'dlq',
        'x-max-priority': 10,
        'x-single-active-consumer': true,
      },
    });
    const queue = defined(reg.getQueue('q1'));
    expect(queue.messageTtl).toBe(60000);
    expect(queue.expires).toBe(300000);
    expect(queue.maxLength).toBe(1000);
    expect(queue.maxLengthBytes).toBe(1048576);
    expect(queue.overflowBehavior).toBe('reject-publish');
    expect(queue.deadLetterExchange).toBe('dlx');
    expect(queue.deadLetterRoutingKey).toBe('dlq');
    expect(queue.maxPriority).toBe(10);
    expect(queue.singleActiveConsumer).toBe(true);
  });

  it('omits derived fields when arguments are absent', () => {
    const reg = createRegistry();
    reg.declareQueue('q1', {});
    const queue = defined(reg.getQueue('q1'));
    expect(queue.messageTtl).toBeUndefined();
    expect(queue.expires).toBeUndefined();
    expect(queue.maxLength).toBeUndefined();
    expect(queue.maxLengthBytes).toBeUndefined();
    expect(queue.overflowBehavior).toBeUndefined();
    expect(queue.deadLetterExchange).toBeUndefined();
    expect(queue.deadLetterRoutingKey).toBeUndefined();
    expect(queue.maxPriority).toBeUndefined();
    expect(queue.singleActiveConsumer).toBeUndefined();
  });

  it('returns undefined for non-existent queue via getQueue', () => {
    const reg = createRegistry();
    expect(reg.getQueue('nope')).toBeUndefined();
  });
});
