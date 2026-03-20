import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MessageStore } from './message-store.ts';
import type { BrokerMessage } from './types/message.ts';

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

function makeMessageWithBody(bytes: number[]): BrokerMessage {
  return makeMessage({ body: new Uint8Array(bytes) });
}

/** Asserts value is not null, then returns it typed. */
function assertDefined<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).toBeDefined();
  return value as T;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('MessageStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor ───────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts empty', () => {
      const store = new MessageStore();
      expect(store.count()).toBe(0);
      expect(store.byteSize()).toBe(0);
      expect(store.peek()).toBeNull();
      expect(store.dequeue()).toBeNull();
    });
  });

  // ── enqueue ───────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('adds message to tail', () => {
      const store = new MessageStore();
      const m1 = makeMessage({ routingKey: 'first' });
      const m2 = makeMessage({ routingKey: 'second' });

      store.enqueue(m1);
      store.enqueue(m2);

      expect(store.count()).toBe(2);
      const head = assertDefined(store.peek());
      expect(head.routingKey).toBe('first');
    });

    it('sets enqueuedAt to current timestamp', () => {
      const store = new MessageStore();
      vi.setSystemTime(5000);
      const result = store.enqueue(makeMessage());
      expect(result.enqueuedAt).toBe(5000);
    });

    it('computes expiresAt from per-message expiration', () => {
      const store = new MessageStore();
      vi.setSystemTime(10000);
      const msg = makeMessage({
        properties: { expiration: '5000' },
      });
      const result = store.enqueue(msg);
      expect(result.expiresAt).toBe(15000);
    });

    it('computes expiresAt from queue messageTtl', () => {
      const store = new MessageStore({ messageTtl: 3000 });
      vi.setSystemTime(10000);
      const result = store.enqueue(makeMessage());
      expect(result.expiresAt).toBe(13000);
    });

    it('uses minimum of per-message and queue TTL', () => {
      const store = new MessageStore({ messageTtl: 8000 });
      vi.setSystemTime(10000);
      const msg = makeMessage({
        properties: { expiration: '3000' },
      });
      const result = store.enqueue(msg);
      expect(result.expiresAt).toBe(13000); // min(3000, 8000) = 3000
    });

    it('uses minimum of per-message and queue TTL (queue is lower)', () => {
      const store = new MessageStore({ messageTtl: 2000 });
      vi.setSystemTime(10000);
      const msg = makeMessage({
        properties: { expiration: '5000' },
      });
      const result = store.enqueue(msg);
      expect(result.expiresAt).toBe(12000); // min(5000, 2000) = 2000
    });

    it('does not set expiresAt when no TTL configured', () => {
      const store = new MessageStore();
      const result = store.enqueue(makeMessage());
      expect(result.expiresAt).toBeUndefined();
    });

    it('returns the stored message with updated fields', () => {
      const store = new MessageStore();
      const original = makeMessage({ routingKey: 'test' });
      const result = store.enqueue(original);

      expect(result.routingKey).toBe('test');
      expect(result.enqueuedAt).toBe(1000000);
    });

    it('preserves all original message properties', () => {
      const store = new MessageStore();
      const body = new Uint8Array([10, 20, 30, 40]);
      const msg = makeMessage({
        body,
        properties: {
          contentType: 'application/json',
          headers: { 'x-custom': 'value' },
          deliveryMode: 2,
          priority: 5,
          correlationId: 'corr-1',
          replyTo: 'reply-queue',
          messageId: 'msg-1',
          timestamp: 999,
          type: 'order.created',
          userId: 'guest',
          appId: 'my-app',
        },
        exchange: 'amq.direct',
        routingKey: 'orders',
        mandatory: true,
        immediate: false,
        deliveryCount: 2,
        priority: 5,
        xDeath: [
          {
            queue: 'old-q',
            reason: 'rejected',
            count: 1,
            exchange: '',
            'routing-keys': ['key'],
            time: 500,
          },
        ],
      });

      const result = store.enqueue(msg);

      expect(result.body).toEqual(body);
      expect(result.properties.contentType).toBe('application/json');
      expect(result.properties.headers).toEqual({ 'x-custom': 'value' });
      expect(result.properties.deliveryMode).toBe(2);
      expect(result.properties.priority).toBe(5);
      expect(result.properties.correlationId).toBe('corr-1');
      expect(result.properties.replyTo).toBe('reply-queue');
      expect(result.properties.messageId).toBe('msg-1');
      expect(result.properties.timestamp).toBe(999);
      expect(result.properties.type).toBe('order.created');
      expect(result.properties.userId).toBe('guest');
      expect(result.properties.appId).toBe('my-app');
      expect(result.exchange).toBe('amq.direct');
      expect(result.routingKey).toBe('orders');
      expect(result.mandatory).toBe(true);
      expect(result.immediate).toBe(false);
      expect(result.deliveryCount).toBe(2);
      expect(result.priority).toBe(5);
      expect(result.xDeath).toHaveLength(1);

      const xDeathEntry = assertDefined(result.xDeath?.[0]);
      expect(xDeathEntry.queue).toBe('old-q');
    });

    it('handles expiration of "0" (immediate expiry)', () => {
      const store = new MessageStore();
      vi.setSystemTime(10000);
      const msg = makeMessage({ properties: { expiration: '0' } });
      const result = store.enqueue(msg);
      expect(result.expiresAt).toBe(10000);
    });

    it('updates byte size on enqueue', () => {
      const store = new MessageStore();
      store.enqueue(makeMessageWithBody([1, 2, 3])); // 3 bytes
      expect(store.byteSize()).toBe(3);
      store.enqueue(makeMessageWithBody([4, 5])); // 2 bytes
      expect(store.byteSize()).toBe(5);
    });
  });

  // ── dequeue ───────────────────────────────────────────────────────

  describe('dequeue', () => {
    it('returns null for empty store', () => {
      const store = new MessageStore();
      expect(store.dequeue()).toBeNull();
    });

    it('removes and returns head message (FIFO)', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ routingKey: 'first' }));
      store.enqueue(makeMessage({ routingKey: 'second' }));
      store.enqueue(makeMessage({ routingKey: 'third' }));

      expect(assertDefined(store.dequeue()).routingKey).toBe('first');
      expect(assertDefined(store.dequeue()).routingKey).toBe('second');
      expect(assertDefined(store.dequeue()).routingKey).toBe('third');
      expect(store.dequeue()).toBeNull();
    });

    it('decrements count', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage());
      store.enqueue(makeMessage());
      expect(store.count()).toBe(2);

      store.dequeue();
      expect(store.count()).toBe(1);

      store.dequeue();
      expect(store.count()).toBe(0);
    });

    it('updates byte size on dequeue', () => {
      const store = new MessageStore();
      store.enqueue(makeMessageWithBody([1, 2, 3])); // 3 bytes
      store.enqueue(makeMessageWithBody([4, 5])); // 2 bytes
      expect(store.byteSize()).toBe(5);

      store.dequeue();
      expect(store.byteSize()).toBe(2);

      store.dequeue();
      expect(store.byteSize()).toBe(0);
    });
  });

  // ── peek ──────────────────────────────────────────────────────────

  describe('peek', () => {
    it('returns null for empty store', () => {
      const store = new MessageStore();
      expect(store.peek()).toBeNull();
    });

    it('returns head message without removing it', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ routingKey: 'first' }));
      store.enqueue(makeMessage({ routingKey: 'second' }));

      expect(assertDefined(store.peek()).routingKey).toBe('first');
      expect(assertDefined(store.peek()).routingKey).toBe('first');
      expect(store.count()).toBe(2);
    });
  });

  // ── count ─────────────────────────────────────────────────────────

  describe('count', () => {
    it('tracks message count accurately', () => {
      const store = new MessageStore();
      expect(store.count()).toBe(0);

      store.enqueue(makeMessage());
      expect(store.count()).toBe(1);

      store.enqueue(makeMessage());
      expect(store.count()).toBe(2);

      store.dequeue();
      expect(store.count()).toBe(1);

      store.purge();
      expect(store.count()).toBe(0);
    });
  });

  // ── byteSize ──────────────────────────────────────────────────────

  describe('byteSize', () => {
    it('tracks total body byte size accurately', () => {
      const store = new MessageStore();
      expect(store.byteSize()).toBe(0);

      store.enqueue(makeMessageWithBody([1, 2, 3, 4, 5])); // 5
      expect(store.byteSize()).toBe(5);

      store.enqueue(makeMessageWithBody([10, 20, 30])); // 3
      expect(store.byteSize()).toBe(8);

      store.dequeue(); // remove 5 bytes
      expect(store.byteSize()).toBe(3);
    });

    it('handles empty body', () => {
      const store = new MessageStore();
      store.enqueue(makeMessageWithBody([]));
      expect(store.byteSize()).toBe(0);
    });

    it('handles large bodies', () => {
      const store = new MessageStore();
      const body = new Array(10000).fill(0);
      store.enqueue(makeMessageWithBody(body));
      expect(store.byteSize()).toBe(10000);
    });
  });

  // ── purge ─────────────────────────────────────────────────────────

  describe('purge', () => {
    it('returns 0 for empty store', () => {
      const store = new MessageStore();
      expect(store.purge()).toBe(0);
    });

    it('removes all messages and returns count', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage());
      store.enqueue(makeMessage());
      store.enqueue(makeMessage());

      const purged = store.purge();
      expect(purged).toBe(3);
      expect(store.count()).toBe(0);
      expect(store.byteSize()).toBe(0);
      expect(store.peek()).toBeNull();
    });

    it('resets byte size to zero', () => {
      const store = new MessageStore();
      store.enqueue(makeMessageWithBody([1, 2, 3]));
      store.enqueue(makeMessageWithBody([4, 5]));
      expect(store.byteSize()).toBe(5);

      store.purge();
      expect(store.byteSize()).toBe(0);
    });

    it('allows enqueue after purge', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ routingKey: 'old' }));
      store.purge();

      store.enqueue(makeMessage({ routingKey: 'new' }));
      expect(store.count()).toBe(1);
      expect(assertDefined(store.peek()).routingKey).toBe('new');
    });
  });

  // ── requeue ───────────────────────────────────────────────────────

  describe('requeue', () => {
    it('inserts at head by default', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ routingKey: 'first' }));
      store.enqueue(makeMessage({ routingKey: 'second' }));

      const requeued = makeMessage({ routingKey: 'requeued' });
      store.requeue(requeued);

      expect(assertDefined(store.peek()).routingKey).toBe('requeued');
      expect(store.count()).toBe(3);
    });

    it('inserts at head when position is "head"', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ routingKey: 'first' }));

      store.requeue(makeMessage({ routingKey: 'requeued' }), 'head');

      expect(assertDefined(store.peek()).routingKey).toBe('requeued');
    });

    it('inserts at specified numeric position', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ routingKey: 'a' }));
      store.enqueue(makeMessage({ routingKey: 'b' }));
      store.enqueue(makeMessage({ routingKey: 'c' }));

      store.requeue(makeMessage({ routingKey: 'inserted' }), 1);

      // Order should be: a, inserted, b, c
      expect(assertDefined(store.dequeue()).routingKey).toBe('a');
      expect(assertDefined(store.dequeue()).routingKey).toBe('inserted');
      expect(assertDefined(store.dequeue()).routingKey).toBe('b');
      expect(assertDefined(store.dequeue()).routingKey).toBe('c');
    });

    it('inserts at head when position is 0 (numeric)', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ routingKey: 'first' }));
      store.enqueue(makeMessage({ routingKey: 'second' }));

      store.requeue(makeMessage({ routingKey: 'requeued' }), 0);

      expect(assertDefined(store.peek()).routingKey).toBe('requeued');
      expect(store.count()).toBe(3);
    });

    it('clamps negative position to zero', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ routingKey: 'first' }));
      store.enqueue(makeMessage({ routingKey: 'second' }));

      store.requeue(makeMessage({ routingKey: 'requeued' }), -5);

      // Negative position should be clamped to 0 (head)
      expect(assertDefined(store.peek()).routingKey).toBe('requeued');
      expect(store.count()).toBe(3);
    });

    it('clamps position to store length', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ routingKey: 'a' }));

      store.requeue(makeMessage({ routingKey: 'requeued' }), 100);

      // Should end up at the end since position > length
      expect(assertDefined(store.dequeue()).routingKey).toBe('a');
      expect(assertDefined(store.dequeue()).routingKey).toBe('requeued');
    });

    it('requeue into empty store', () => {
      const store = new MessageStore();
      store.requeue(makeMessage({ routingKey: 'only' }));

      expect(store.count()).toBe(1);
      expect(assertDefined(store.peek()).routingKey).toBe('only');
    });

    it('updates byte size on requeue', () => {
      const store = new MessageStore();
      store.enqueue(makeMessageWithBody([1, 2, 3])); // 3 bytes
      expect(store.byteSize()).toBe(3);

      store.requeue(makeMessageWithBody([4, 5])); // 2 bytes
      expect(store.byteSize()).toBe(5);
    });

    it('preserves FIFO for multiple requeues at head', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ routingKey: 'original' }));

      // Requeue two messages at head — last requeued should be first
      store.requeue(makeMessage({ routingKey: 'req-1' }));
      store.requeue(makeMessage({ routingKey: 'req-2' }));

      expect(assertDefined(store.dequeue()).routingKey).toBe('req-2');
      expect(assertDefined(store.dequeue()).routingKey).toBe('req-1');
      expect(assertDefined(store.dequeue()).routingKey).toBe('original');
    });
  });

  // ── FIFO ordering ─────────────────────────────────────────────────

  describe('FIFO ordering', () => {
    it('maintains strict FIFO order across many messages', () => {
      const store = new MessageStore();
      const count = 100;

      for (let i = 0; i < count; i++) {
        store.enqueue(makeMessage({ routingKey: `msg-${i}` }));
      }

      for (let i = 0; i < count; i++) {
        expect(assertDefined(store.dequeue()).routingKey).toBe(`msg-${i}`);
      }

      expect(store.dequeue()).toBeNull();
    });

    it('interleaved enqueue/dequeue maintains order', () => {
      const store = new MessageStore();

      store.enqueue(makeMessage({ routingKey: 'a' }));
      store.enqueue(makeMessage({ routingKey: 'b' }));
      expect(assertDefined(store.dequeue()).routingKey).toBe('a');

      store.enqueue(makeMessage({ routingKey: 'c' }));
      expect(assertDefined(store.dequeue()).routingKey).toBe('b');
      expect(assertDefined(store.dequeue()).routingKey).toBe('c');
      expect(store.dequeue()).toBeNull();
    });
  });

  // ── drainExpired ────────────────────────────────────────────────────

  describe('drainExpired', () => {
    it('returns empty array when store is empty', () => {
      const store = new MessageStore();
      expect(store.drainExpired(999999)).toEqual([]);
    });

    it('returns empty array when head is not expired', () => {
      const store = new MessageStore({ messageTtl: 5000 });
      vi.setSystemTime(10000);
      store.enqueue(makeMessage());
      // expiresAt = 15000, now = 12000 → not expired
      expect(store.drainExpired(12000)).toEqual([]);
      expect(store.count()).toBe(1);
    });

    it('removes expired messages from head', () => {
      const store = new MessageStore({ messageTtl: 1000 });
      vi.setSystemTime(10000);
      store.enqueue(makeMessage({ routingKey: 'a' }));
      vi.setSystemTime(10500);
      store.enqueue(makeMessage({ routingKey: 'b' }));

      // Both expire at 11000 and 11500; now = 12000 → both expired
      const expired = store.drainExpired(12000);
      expect(expired).toHaveLength(2);
      expect(expired[0]?.routingKey).toBe('a');
      expect(expired[1]?.routingKey).toBe('b');
      expect(store.count()).toBe(0);
    });

    it('stops at first non-expired message', () => {
      const store = new MessageStore();
      vi.setSystemTime(10000);
      store.enqueue(
        makeMessage({
          routingKey: 'expired',
          properties: { expiration: '1000' },
        })
      );
      vi.setSystemTime(10500);
      store.enqueue(
        makeMessage({
          routingKey: 'alive',
          properties: { expiration: '10000' },
        })
      );

      // now = 12000: first expires at 11000 (expired), second at 20500 (alive)
      const expired = store.drainExpired(12000);
      expect(expired).toHaveLength(1);
      expect(expired[0]?.routingKey).toBe('expired');
      expect(store.count()).toBe(1);
      expect(assertDefined(store.peek()).routingKey).toBe('alive');
    });

    it('does not drain messages without expiresAt', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ routingKey: 'no-ttl' }));
      const expired = store.drainExpired(999999);
      expect(expired).toEqual([]);
      expect(store.count()).toBe(1);
    });

    it('updates count and byteSize', () => {
      const store = new MessageStore({ messageTtl: 1000 });
      vi.setSystemTime(10000);
      store.enqueue(makeMessageWithBody([1, 2, 3])); // 3 bytes
      store.enqueue(makeMessageWithBody([4, 5])); // 2 bytes

      expect(store.count()).toBe(2);
      expect(store.byteSize()).toBe(5);

      store.drainExpired(12000);
      expect(store.count()).toBe(0);
      expect(store.byteSize()).toBe(0);
    });

    it('uses strict less-than comparison (expiresAt === now is NOT expired)', () => {
      const store = new MessageStore({ messageTtl: 0 });
      vi.setSystemTime(10000);
      store.enqueue(makeMessage());
      // expiresAt = 10000, now = 10000 → NOT expired (strict <)
      expect(store.drainExpired(10000)).toEqual([]);
      expect(store.count()).toBe(1);
      // now = 10001 → expired
      const expired = store.drainExpired(10001);
      expect(expired).toHaveLength(1);
      expect(store.count()).toBe(0);
    });

    it('drains only head messages (per-message TTL head-only behavior)', () => {
      const store = new MessageStore();
      vi.setSystemTime(10000);
      // Message A: no TTL (never expires)
      store.enqueue(makeMessage({ routingKey: 'no-ttl' }));
      // Message B: TTL=1000 (behind A, would be expired but A blocks)
      store.enqueue(
        makeMessage({
          routingKey: 'has-ttl',
          properties: { expiration: '1000' },
        })
      );

      // now = 12000: B is expired but A is not and is ahead
      const expired = store.drainExpired(12000);
      expect(expired).toEqual([]); // A has no expiresAt → not expired → stops
      expect(store.count()).toBe(2);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles messages with zero-length body', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage({ body: new Uint8Array(0) }));

      expect(store.count()).toBe(1);
      expect(store.byteSize()).toBe(0);

      const msg = assertDefined(store.dequeue());
      expect(msg.body.byteLength).toBe(0);
    });

    it('dequeue after dequeue on single-element store returns null', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage());

      expect(store.dequeue()).not.toBeNull();
      expect(store.dequeue()).toBeNull();
    });

    it('byte size never goes negative', () => {
      const store = new MessageStore();
      store.enqueue(makeMessageWithBody([1]));
      store.dequeue();

      expect(store.byteSize()).toBe(0);
      // Extra dequeue should not cause negative
      store.dequeue();
      expect(store.byteSize()).toBe(0);
    });
  });
});
