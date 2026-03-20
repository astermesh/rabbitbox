import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ConsumerRegistry } from './consumer-registry.ts';
import type { DeliveredMessage } from './types/message.ts';
import { ChannelError, ConnectionError } from './errors/amqp-error.ts';
import {
  ACCESS_REFUSED,
  NOT_ALLOWED,
  NOT_FOUND,
} from './errors/reply-codes.ts';

describe('ConsumerRegistry', () => {
  let registry: ConsumerRegistry;
  let callback: (msg: DeliveredMessage | null) => void;

  beforeEach(() => {
    registry = new ConsumerRegistry();
    callback = vi.fn();
  });

  // ── Registration ──────────────────────────────────────────────────

  describe('register', () => {
    it('registers a consumer and returns consumerTag', () => {
      const tag = registry.register('q1', 1, callback, {});
      expect(tag).toBeDefined();
      expect(typeof tag).toBe('string');
      expect(tag.length).toBeGreaterThan(0);
    });

    it('uses provided consumerTag', () => {
      const tag = registry.register('q1', 1, callback, {
        consumerTag: 'my-tag',
      });
      expect(tag).toBe('my-tag');
    });

    it('generates unique tags when not provided', () => {
      const tag1 = registry.register('q1', 1, callback, {});
      const tag2 = registry.register('q1', 1, callback, {});
      expect(tag1).not.toBe(tag2);
    });

    it('stores consumer with correct properties', () => {
      const tag = registry.register('q1', 1, callback, {
        noAck: true,
        exclusive: false,
      });
      const consumer = registry.getConsumer(tag);
      expect(consumer).toBeDefined();
      expect(consumer?.consumerTag).toBe(tag);
      expect(consumer?.queueName).toBe('q1');
      expect(consumer?.channelNumber).toBe(1);
      expect(consumer?.noAck).toBe(true);
      expect(consumer?.exclusive).toBe(false);
    });

    it('defaults noAck to false', () => {
      const tag = registry.register('q1', 1, callback, {});
      expect(registry.getConsumer(tag)?.noAck).toBe(false);
    });

    it('defaults exclusive to false', () => {
      const tag = registry.register('q1', 1, callback, {});
      expect(registry.getConsumer(tag)?.exclusive).toBe(false);
    });

    it('increments consumer count for the queue', () => {
      expect(registry.getConsumerCount('q1')).toBe(0);
      registry.register('q1', 1, callback, {});
      expect(registry.getConsumerCount('q1')).toBe(1);
      registry.register('q1', 2, callback, {});
      expect(registry.getConsumerCount('q1')).toBe(2);
    });

    it('tracks consumers per queue independently', () => {
      registry.register('q1', 1, callback, {});
      registry.register('q2', 1, callback, {});
      expect(registry.getConsumerCount('q1')).toBe(1);
      expect(registry.getConsumerCount('q2')).toBe(1);
    });
  });

  // ── Exclusive consumer ────────────────────────────────────────────

  describe('exclusive consumer', () => {
    it('allows first exclusive consumer on a queue', () => {
      expect(() =>
        registry.register('q1', 1, callback, { exclusive: true })
      ).not.toThrow();
    });

    it('rejects second consumer on exclusive queue', () => {
      registry.register('q1', 1, callback, { exclusive: true });
      expect(() => registry.register('q1', 2, callback, {})).toThrow(
        ChannelError
      );
    });

    it('rejects exclusive consumer when queue already has consumers', () => {
      registry.register('q1', 1, callback, {});
      expect(() =>
        registry.register('q1', 2, callback, { exclusive: true })
      ).toThrow(ChannelError);
    });

    it('throws ACCESS_REFUSED for exclusive conflict', () => {
      registry.register('q1', 1, callback, { exclusive: true });
      try {
        registry.register('q1', 2, callback, {});
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(ACCESS_REFUSED);
      }
    });
  });

  // ── Cancellation ──────────────────────────────────────────────────

  describe('cancel', () => {
    it('removes consumer by tag', () => {
      const tag = registry.register('q1', 1, callback, {});
      const entry = registry.cancel(tag);
      expect(entry).toBeDefined();
      expect(entry?.consumerTag).toBe(tag);
      expect(registry.getConsumer(tag)).toBeUndefined();
    });

    it('decrements consumer count for the queue', () => {
      const tag = registry.register('q1', 1, callback, {});
      registry.register('q1', 2, callback, {});
      expect(registry.getConsumerCount('q1')).toBe(2);

      registry.cancel(tag);
      expect(registry.getConsumerCount('q1')).toBe(1);
    });

    it('returns undefined for unknown tag', () => {
      expect(registry.cancel('nonexistent')).toBeUndefined();
    });

    it('allows new exclusive consumer after previous one is cancelled', () => {
      const tag = registry.register('q1', 1, callback, { exclusive: true });
      registry.cancel(tag);
      expect(() =>
        registry.register('q1', 2, callback, { exclusive: true })
      ).not.toThrow();
    });
  });

  // ── Cancel by channel ─────────────────────────────────────────────

  describe('cancelByChannel', () => {
    it('removes all consumers for a given channel', () => {
      const tag1 = registry.register('q1', 1, callback, {});
      const tag2 = registry.register('q2', 1, callback, {});
      registry.register('q1', 2, callback, {});

      const cancelled = registry.cancelByChannel(1);
      expect(cancelled).toHaveLength(2);
      expect(cancelled.map((c) => c.consumerTag)).toContain(tag1);
      expect(cancelled.map((c) => c.consumerTag)).toContain(tag2);

      expect(registry.getConsumer(tag1)).toBeUndefined();
      expect(registry.getConsumer(tag2)).toBeUndefined();
      expect(registry.getConsumerCount('q1')).toBe(1);
      expect(registry.getConsumerCount('q2')).toBe(0);
    });

    it('returns empty array when no consumers for channel', () => {
      expect(registry.cancelByChannel(99)).toHaveLength(0);
    });
  });

  // ── Queue lookup ──────────────────────────────────────────────────

  describe('getConsumersForQueue', () => {
    it('returns empty array for queue with no consumers', () => {
      expect(registry.getConsumersForQueue('q1')).toEqual([]);
    });

    it('returns all consumers for a queue in registration order', () => {
      const tag1 = registry.register('q1', 1, callback, {});
      const tag2 = registry.register('q1', 2, callback, {});
      const consumers = registry.getConsumersForQueue('q1');
      expect(consumers).toHaveLength(2);
      expect(consumers[0]?.consumerTag).toBe(tag1);
      expect(consumers[1]?.consumerTag).toBe(tag2);
    });
  });

  // ── Queue existence check ─────────────────────────────────────────

  describe('queue validation', () => {
    it('throws NOT_FOUND when registering on nonexistent queue', () => {
      const reg = new ConsumerRegistry({
        queueExists: (name) => name !== 'missing',
      });
      expect(() => reg.register('missing', 1, callback, {})).toThrow(
        ChannelError
      );
      try {
        reg.register('missing', 1, callback, {});
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as ChannelError).replyCode).toBe(NOT_FOUND);
      }
    });
  });

  // ── Unacked count tracking ────────────────────────────────────────

  describe('unacked count tracking', () => {
    it('starts at 0', () => {
      const tag = registry.register('q1', 1, callback, {});
      expect(registry.getConsumer(tag)?.unackedCount).toBe(0);
    });

    it('increments unacked count', () => {
      const tag = registry.register('q1', 1, callback, {});
      registry.incrementUnacked(tag);
      registry.incrementUnacked(tag);
      expect(registry.getConsumer(tag)?.unackedCount).toBe(2);
    });

    it('decrements unacked count', () => {
      const tag = registry.register('q1', 1, callback, {});
      registry.incrementUnacked(tag);
      registry.incrementUnacked(tag);
      registry.decrementUnacked(tag);
      expect(registry.getConsumer(tag)?.unackedCount).toBe(1);
    });

    it('does not go below 0', () => {
      const tag = registry.register('q1', 1, callback, {});
      registry.decrementUnacked(tag);
      expect(registry.getConsumer(tag)?.unackedCount).toBe(0);
    });
  });

  // ── Duplicate consumerTag ─────────────────────────────────────────

  describe('duplicate consumerTag', () => {
    it('rejects duplicate consumer tag with NOT_ALLOWED connection error', () => {
      registry.register('q1', 1, callback, { consumerTag: 'dup' });
      try {
        registry.register('q1', 1, callback, { consumerTag: 'dup' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectionError);
        expect((err as ConnectionError).replyCode).toBe(NOT_ALLOWED);
      }
    });
  });

  // ── Single active consumer ─────────────────────────────────────────

  describe('single active consumer', () => {
    it('marks a queue as single-active-consumer', () => {
      registry.markSingleActiveConsumer('q1');
      expect(registry.isSingleActiveConsumer('q1')).toBe(true);
    });

    it('returns false for queues not marked as SAC', () => {
      expect(registry.isSingleActiveConsumer('q1')).toBe(false);
    });

    it('getActiveConsumer returns first registered consumer for SAC queue', () => {
      registry.markSingleActiveConsumer('q1');
      const tag1 = registry.register('q1', 1, callback, {});
      registry.register('q1', 2, callback, {});
      const active = registry.getActiveConsumer('q1');
      expect(active).toBeDefined();
      expect(active?.consumerTag).toBe(tag1);
    });

    it('getActiveConsumer returns undefined for non-SAC queue', () => {
      registry.register('q1', 1, callback, {});
      expect(registry.getActiveConsumer('q1')).toBeUndefined();
    });

    it('getActiveConsumer returns undefined when SAC queue has no consumers', () => {
      registry.markSingleActiveConsumer('q1');
      expect(registry.getActiveConsumer('q1')).toBeUndefined();
    });

    it('getActiveConsumer promotes next consumer after active is cancelled', () => {
      registry.markSingleActiveConsumer('q1');
      const tag1 = registry.register('q1', 1, callback, {});
      const tag2 = registry.register('q1', 2, callback, {});
      registry.cancel(tag1);
      const active = registry.getActiveConsumer('q1');
      expect(active?.consumerTag).toBe(tag2);
    });

    it('getActiveConsumer returns undefined after all consumers cancelled', () => {
      registry.markSingleActiveConsumer('q1');
      const tag1 = registry.register('q1', 1, callback, {});
      registry.cancel(tag1);
      expect(registry.getActiveConsumer('q1')).toBeUndefined();
    });

    it('preserves registration order for activation after cancelByChannel', () => {
      registry.markSingleActiveConsumer('q1');
      registry.register('q1', 1, callback, {}); // active (ch 1)
      const tag2 = registry.register('q1', 2, callback, {}); // waiting (ch 2)
      registry.register('q1', 1, callback, {}); // waiting (ch 1)

      registry.cancelByChannel(1); // removes first and third
      const active = registry.getActiveConsumer('q1');
      expect(active?.consumerTag).toBe(tag2);
    });

    it('rejects exclusive consumer on SAC queue', () => {
      registry.markSingleActiveConsumer('q1');
      try {
        registry.register('q1', 1, callback, { exclusive: true });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(ACCESS_REFUSED);
      }
    });

    it('allows non-exclusive consumer on SAC queue', () => {
      registry.markSingleActiveConsumer('q1');
      expect(() =>
        registry.register('q1', 1, callback, { exclusive: false })
      ).not.toThrow();
    });
  });
});
