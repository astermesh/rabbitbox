import { describe, expect, it } from 'vitest';
import { enqueueWithOverflow } from './overflow.ts';
import { MessageStore } from './message-store.ts';
import type { BrokerMessage } from './types/message.ts';
import type { Queue } from './types/queue.ts';

// ── Helpers ─────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<BrokerMessage> = {}): BrokerMessage {
  return {
    body: new Uint8Array([1, 2, 3]),
    properties: {},
    exchange: '',
    routingKey: '',
    mandatory: false,
    immediate: false,
    deliveryCount: 0,
    enqueuedAt: 0,
    priority: 0,
    ...overrides,
  };
}

function assertDefined<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).toBeDefined();
  return value as T;
}

function makeMessageWithSize(bytes: number): BrokerMessage {
  return makeMessage({ body: new Uint8Array(bytes) });
}

function makeQueue(overrides: Partial<Queue> = {}): Queue {
  return {
    name: 'test-queue',
    durable: false,
    exclusive: false,
    autoDelete: false,
    arguments: {},
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('enqueueWithOverflow', () => {
  // ── No limits ──────────────────────────────────────────────────────

  describe('no limits configured', () => {
    it('enqueues normally when no maxLength or maxLengthBytes', () => {
      const store = new MessageStore();
      const queue = makeQueue();
      const msg = makeMessage({ routingKey: 'a' });

      const result = enqueueWithOverflow(msg, { queue, store });

      expect(result.enqueued).toBe(true);
      expect(result.dropped).toHaveLength(0);
      expect(store.count()).toBe(1);
    });
  });

  // ── drop-head with maxLength ───────────────────────────────────────

  describe('drop-head with maxLength', () => {
    it('enqueues without dropping when under limit', () => {
      const store = new MessageStore();
      const queue = makeQueue({ maxLength: 3 });

      enqueueWithOverflow(makeMessage({ routingKey: 'a' }), { queue, store });
      enqueueWithOverflow(makeMessage({ routingKey: 'b' }), { queue, store });
      const result = enqueueWithOverflow(makeMessage({ routingKey: 'c' }), {
        queue,
        store,
      });

      expect(result.enqueued).toBe(true);
      expect(result.dropped).toHaveLength(0);
      expect(store.count()).toBe(3);
    });

    it('drops head message when exceeding maxLength', () => {
      const store = new MessageStore();
      const queue = makeQueue({ maxLength: 2 });

      enqueueWithOverflow(makeMessage({ routingKey: 'first' }), {
        queue,
        store,
      });
      enqueueWithOverflow(makeMessage({ routingKey: 'second' }), {
        queue,
        store,
      });
      const result = enqueueWithOverflow(makeMessage({ routingKey: 'third' }), {
        queue,
        store,
      });

      expect(result.enqueued).toBe(true);
      expect(result.dropped).toHaveLength(1);
      expect((result.dropped[0] as BrokerMessage).routingKey).toBe('first');
      expect(store.count()).toBe(2);
    });

    it('drops multiple messages to enforce limit (e.g. maxLength=1)', () => {
      const store = new MessageStore();
      const queue = makeQueue({ maxLength: 3 });

      // Fill to 3
      enqueueWithOverflow(makeMessage({ routingKey: 'a' }), { queue, store });
      enqueueWithOverflow(makeMessage({ routingKey: 'b' }), { queue, store });
      enqueueWithOverflow(makeMessage({ routingKey: 'c' }), { queue, store });

      // Now reduce limit to 1 by creating new queue ref
      const smallQueue = makeQueue({ maxLength: 1 });
      const result = enqueueWithOverflow(makeMessage({ routingKey: 'd' }), {
        queue: smallQueue,
        store,
      });

      expect(result.enqueued).toBe(true);
      expect(result.dropped).toHaveLength(3); // a, b, c dropped
      expect(store.count()).toBe(1);
      expect(assertDefined(store.peek()).routingKey).toBe('d');
    });

    it('uses drop-head as default overflow behavior', () => {
      const store = new MessageStore();
      // No overflowBehavior set — should default to drop-head
      const queue = makeQueue({ maxLength: 1 });

      enqueueWithOverflow(makeMessage({ routingKey: 'first' }), {
        queue,
        store,
      });
      const result = enqueueWithOverflow(
        makeMessage({ routingKey: 'second' }),
        { queue, store }
      );

      expect(result.enqueued).toBe(true);
      expect(result.dropped).toHaveLength(1);
      expect((result.dropped[0] as BrokerMessage).routingKey).toBe('first');
      expect(store.count()).toBe(1);
    });
  });

  // ── drop-head with maxLengthBytes ──────────────────────────────────

  describe('drop-head with maxLengthBytes', () => {
    it('enqueues without dropping when under byte limit', () => {
      const store = new MessageStore();
      const queue = makeQueue({ maxLengthBytes: 100 });

      const result = enqueueWithOverflow(makeMessageWithSize(50), {
        queue,
        store,
      });

      expect(result.enqueued).toBe(true);
      expect(result.dropped).toHaveLength(0);
      expect(store.byteSize()).toBe(50);
    });

    it('drops head messages when exceeding byte limit', () => {
      const store = new MessageStore();
      const queue = makeQueue({ maxLengthBytes: 10 });

      enqueueWithOverflow(makeMessageWithSize(4), { queue, store }); // 4
      enqueueWithOverflow(makeMessageWithSize(4), { queue, store }); // 8
      const result = enqueueWithOverflow(makeMessageWithSize(5), {
        queue,
        store,
      }); // 13 > 10

      expect(result.enqueued).toBe(true);
      expect(result.dropped.length).toBeGreaterThanOrEqual(1);
      expect(store.byteSize()).toBeLessThanOrEqual(10);
    });

    it('drops multiple head messages for one large incoming message', () => {
      const store = new MessageStore();
      const queue = makeQueue({ maxLengthBytes: 10 });

      enqueueWithOverflow(makeMessageWithSize(3), { queue, store }); // 3
      enqueueWithOverflow(makeMessageWithSize(3), { queue, store }); // 6
      enqueueWithOverflow(makeMessageWithSize(3), { queue, store }); // 9
      const result = enqueueWithOverflow(makeMessageWithSize(8), {
        queue,
        store,
      }); // 17 > 10

      expect(result.enqueued).toBe(true);
      // Need to drop enough so total <= 10
      // After drop 3: 14, drop 3: 11, drop 3: 8 <= 10
      expect(result.dropped).toHaveLength(3);
      expect(store.byteSize()).toBe(8);
    });
  });

  // ── drop-head with both limits ─────────────────────────────────────

  describe('drop-head with both limits', () => {
    it('enforces both maxLength and maxLengthBytes', () => {
      const store = new MessageStore();
      const queue = makeQueue({ maxLength: 5, maxLengthBytes: 10 });

      // Enqueue 3 messages of 3 bytes each = 9 bytes, 3 messages
      enqueueWithOverflow(makeMessageWithSize(3), { queue, store });
      enqueueWithOverflow(makeMessageWithSize(3), { queue, store });
      enqueueWithOverflow(makeMessageWithSize(3), { queue, store });

      // Enqueue 5 bytes → total 14 > 10 (byte limit hit, not count limit)
      const result = enqueueWithOverflow(makeMessageWithSize(5), {
        queue,
        store,
      });

      expect(result.enqueued).toBe(true);
      expect(result.dropped.length).toBeGreaterThanOrEqual(1);
      expect(store.byteSize()).toBeLessThanOrEqual(10);
    });

    it('either limit can trigger overflow independently', () => {
      const store = new MessageStore();
      // maxLength=2, maxLengthBytes=100 — count limit will trigger first
      const queue = makeQueue({ maxLength: 2, maxLengthBytes: 100 });

      enqueueWithOverflow(makeMessageWithSize(1), { queue, store });
      enqueueWithOverflow(makeMessageWithSize(1), { queue, store });
      const result = enqueueWithOverflow(makeMessageWithSize(1), {
        queue,
        store,
      });

      expect(result.enqueued).toBe(true);
      expect(result.dropped).toHaveLength(1);
      expect(store.count()).toBe(2);
    });
  });

  // ── reject-publish with maxLength ──────────────────────────────────

  describe('reject-publish with maxLength', () => {
    it('accepts messages when under limit', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLength: 3,
        overflowBehavior: 'reject-publish',
      });

      const r1 = enqueueWithOverflow(makeMessage({ routingKey: 'a' }), {
        queue,
        store,
      });
      const r2 = enqueueWithOverflow(makeMessage({ routingKey: 'b' }), {
        queue,
        store,
      });
      const r3 = enqueueWithOverflow(makeMessage({ routingKey: 'c' }), {
        queue,
        store,
      });

      expect(r1.enqueued).toBe(true);
      expect(r2.enqueued).toBe(true);
      expect(r3.enqueued).toBe(true);
      expect(store.count()).toBe(3);
    });

    it('rejects message when at maxLength', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLength: 2,
        overflowBehavior: 'reject-publish',
      });

      enqueueWithOverflow(makeMessage({ routingKey: 'a' }), { queue, store });
      enqueueWithOverflow(makeMessage({ routingKey: 'b' }), { queue, store });
      const result = enqueueWithOverflow(makeMessage({ routingKey: 'c' }), {
        queue,
        store,
      });

      expect(result.enqueued).toBe(false);
      expect(result.dropped).toHaveLength(0);
      expect(store.count()).toBe(2);
    });

    it('does not drop any existing messages', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLength: 2,
        overflowBehavior: 'reject-publish',
      });

      enqueueWithOverflow(makeMessage({ routingKey: 'a' }), { queue, store });
      enqueueWithOverflow(makeMessage({ routingKey: 'b' }), { queue, store });
      enqueueWithOverflow(makeMessage({ routingKey: 'c' }), { queue, store });

      // Original messages should remain intact
      expect(assertDefined(store.peek()).routingKey).toBe('a');
      expect(store.count()).toBe(2);
    });

    it('accepts again after consuming reduces count below limit', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLength: 2,
        overflowBehavior: 'reject-publish',
      });

      enqueueWithOverflow(makeMessage({ routingKey: 'a' }), { queue, store });
      enqueueWithOverflow(makeMessage({ routingKey: 'b' }), { queue, store });

      // Reject
      expect(
        enqueueWithOverflow(makeMessage({ routingKey: 'c' }), { queue, store })
          .enqueued
      ).toBe(false);

      // Consume one message
      store.dequeue();
      expect(store.count()).toBe(1);

      // Now should accept
      const result = enqueueWithOverflow(makeMessage({ routingKey: 'd' }), {
        queue,
        store,
      });
      expect(result.enqueued).toBe(true);
      expect(store.count()).toBe(2);
    });
  });

  // ── reject-publish with maxLengthBytes ─────────────────────────────

  describe('reject-publish with maxLengthBytes', () => {
    it('rejects when at byte limit', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLengthBytes: 10,
        overflowBehavior: 'reject-publish',
      });

      enqueueWithOverflow(makeMessageWithSize(10), { queue, store }); // at limit
      const result = enqueueWithOverflow(makeMessageWithSize(1), {
        queue,
        store,
      });

      expect(result.enqueued).toBe(false);
      expect(store.count()).toBe(1);
    });

    it('accepts when under byte limit', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLengthBytes: 10,
        overflowBehavior: 'reject-publish',
      });

      const result = enqueueWithOverflow(makeMessageWithSize(9), {
        queue,
        store,
      });
      expect(result.enqueued).toBe(true);
    });
  });

  // ── reject-publish-dlx ─────────────────────────────────────────────

  describe('reject-publish-dlx', () => {
    it('rejects message when at limit (same as reject-publish)', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLength: 1,
        overflowBehavior: 'reject-publish-dlx',
        deadLetterExchange: 'dlx',
      });

      enqueueWithOverflow(makeMessage({ routingKey: 'a' }), { queue, store });
      const result = enqueueWithOverflow(makeMessage({ routingKey: 'b' }), {
        queue,
        store,
      });

      expect(result.enqueued).toBe(false);
      expect(result.dropped).toHaveLength(0);
      expect(store.count()).toBe(1);
    });

    it('accepts when under limit', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLength: 2,
        overflowBehavior: 'reject-publish-dlx',
        deadLetterExchange: 'dlx',
      });

      const result = enqueueWithOverflow(makeMessage(), { queue, store });
      expect(result.enqueued).toBe(true);
    });
  });

  // ── Both limits with reject-publish ────────────────────────────────

  describe('both limits with reject-publish', () => {
    it('rejects when count limit hit (bytes still ok)', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLength: 2,
        maxLengthBytes: 1000,
        overflowBehavior: 'reject-publish',
      });

      enqueueWithOverflow(makeMessageWithSize(1), { queue, store });
      enqueueWithOverflow(makeMessageWithSize(1), { queue, store });
      const result = enqueueWithOverflow(makeMessageWithSize(1), {
        queue,
        store,
      });

      expect(result.enqueued).toBe(false);
    });

    it('rejects when byte limit hit (count still ok)', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLength: 100,
        maxLengthBytes: 5,
        overflowBehavior: 'reject-publish',
      });

      enqueueWithOverflow(makeMessageWithSize(5), { queue, store });
      const result = enqueueWithOverflow(makeMessageWithSize(1), {
        queue,
        store,
      });

      expect(result.enqueued).toBe(false);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('maxLength=0 rejects all messages with reject-publish', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLength: 0,
        overflowBehavior: 'reject-publish',
      });

      const result = enqueueWithOverflow(makeMessage(), { queue, store });
      expect(result.enqueued).toBe(false);
    });

    it('maxLength=0 with drop-head immediately drops the enqueued message', () => {
      const store = new MessageStore();
      const queue = makeQueue({ maxLength: 0 });

      const result = enqueueWithOverflow(makeMessage(), { queue, store });

      expect(result.enqueued).toBe(true);
      expect(result.dropped).toHaveLength(1);
      expect(store.count()).toBe(0);
    });

    it('maxLengthBytes=0 rejects all messages with reject-publish', () => {
      const store = new MessageStore();
      const queue = makeQueue({
        maxLengthBytes: 0,
        overflowBehavior: 'reject-publish',
      });

      const result = enqueueWithOverflow(makeMessageWithSize(0), {
        queue,
        store,
      });
      // 0-byte message: byteSize() = 0 >= maxLengthBytes = 0 → reject
      expect(result.enqueued).toBe(false);
    });
  });
});
