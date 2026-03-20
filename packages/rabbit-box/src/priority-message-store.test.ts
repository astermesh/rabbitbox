import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PriorityMessageStore } from './priority-message-store.ts';
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

function assertDefined<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).toBeDefined();
  return value as T;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('PriorityMessageStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor / initial state ───────────────────────────────────

  describe('initial state', () => {
    it('starts empty', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      expect(store.count()).toBe(0);
      expect(store.byteSize()).toBe(0);
      expect(store.peek()).toBeNull();
      expect(store.dequeue()).toBeNull();
    });
  });

  // ── Priority ordering ─────────────────────────────────────────────

  describe('priority ordering', () => {
    it('dequeues higher priority messages before lower priority', () => {
      const store = new PriorityMessageStore({ maxPriority: 10 });

      store.enqueue(makeMessage({ routingKey: 'low', priority: 1 }));
      store.enqueue(makeMessage({ routingKey: 'high', priority: 5 }));
      store.enqueue(makeMessage({ routingKey: 'medium', priority: 3 }));

      expect(assertDefined(store.dequeue()).routingKey).toBe('high');
      expect(assertDefined(store.dequeue()).routingKey).toBe('medium');
      expect(assertDefined(store.dequeue()).routingKey).toBe('low');
      expect(store.dequeue()).toBeNull();
    });

    it('preserves FIFO within same priority level', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });

      store.enqueue(makeMessage({ routingKey: 'p3-first', priority: 3 }));
      store.enqueue(makeMessage({ routingKey: 'p3-second', priority: 3 }));
      store.enqueue(makeMessage({ routingKey: 'p3-third', priority: 3 }));

      expect(assertDefined(store.dequeue()).routingKey).toBe('p3-first');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p3-second');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p3-third');
    });

    it('interleaves priority and FIFO correctly', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });

      store.enqueue(makeMessage({ routingKey: 'p1-a', priority: 1 }));
      store.enqueue(makeMessage({ routingKey: 'p3-a', priority: 3 }));
      store.enqueue(makeMessage({ routingKey: 'p1-b', priority: 1 }));
      store.enqueue(makeMessage({ routingKey: 'p3-b', priority: 3 }));
      store.enqueue(makeMessage({ routingKey: 'p2-a', priority: 2 }));

      expect(assertDefined(store.dequeue()).routingKey).toBe('p3-a');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p3-b');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p2-a');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p1-a');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p1-b');
    });

    it('handles priority 0 (default) as lowest', () => {
      const store = new PriorityMessageStore({ maxPriority: 3 });

      store.enqueue(makeMessage({ routingKey: 'default', priority: 0 }));
      store.enqueue(makeMessage({ routingKey: 'low', priority: 1 }));

      expect(assertDefined(store.dequeue()).routingKey).toBe('low');
      expect(assertDefined(store.dequeue()).routingKey).toBe('default');
    });

    it('handles maxPriority=1 (two levels: 0 and 1)', () => {
      const store = new PriorityMessageStore({ maxPriority: 1 });

      store.enqueue(makeMessage({ routingKey: 'normal', priority: 0 }));
      store.enqueue(makeMessage({ routingKey: 'urgent', priority: 1 }));
      store.enqueue(makeMessage({ routingKey: 'normal2', priority: 0 }));

      expect(assertDefined(store.dequeue()).routingKey).toBe('urgent');
      expect(assertDefined(store.dequeue()).routingKey).toBe('normal');
      expect(assertDefined(store.dequeue()).routingKey).toBe('normal2');
    });
  });

  // ── Priority clamping ─────────────────────────────────────────────

  describe('priority clamping', () => {
    it('clamps message priority to maxPriority', () => {
      const store = new PriorityMessageStore({ maxPriority: 3 });

      store.enqueue(makeMessage({ routingKey: 'clamped', priority: 10 }));
      store.enqueue(makeMessage({ routingKey: 'at-max', priority: 3 }));

      // Both should be at same effective priority (3), FIFO order
      expect(assertDefined(store.dequeue()).routingKey).toBe('clamped');
      expect(assertDefined(store.dequeue()).routingKey).toBe('at-max');
    });

    it('clamps priority 255 to maxPriority', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });

      store.enqueue(makeMessage({ routingKey: 'max-255', priority: 255 }));
      store.enqueue(makeMessage({ routingKey: 'at-5', priority: 5 }));
      store.enqueue(makeMessage({ routingKey: 'at-4', priority: 4 }));

      // max-255 is clamped to 5, same as at-5, so FIFO between them
      expect(assertDefined(store.dequeue()).routingKey).toBe('max-255');
      expect(assertDefined(store.dequeue()).routingKey).toBe('at-5');
      expect(assertDefined(store.dequeue()).routingKey).toBe('at-4');
    });

    it('treats negative priority as 0', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });

      store.enqueue(makeMessage({ routingKey: 'negative', priority: -1 }));
      store.enqueue(makeMessage({ routingKey: 'zero', priority: 0 }));

      // Both at priority 0, FIFO order
      expect(assertDefined(store.dequeue()).routingKey).toBe('negative');
      expect(assertDefined(store.dequeue()).routingKey).toBe('zero');
    });
  });

  // ── Default priority ──────────────────────────────────────────────

  describe('default priority', () => {
    it('uses priority 0 when message has no priority property', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });

      // message.priority defaults to 0 (set by publish pipeline)
      store.enqueue(makeMessage({ routingKey: 'no-priority', priority: 0 }));
      store.enqueue(makeMessage({ routingKey: 'has-priority', priority: 1 }));

      expect(assertDefined(store.dequeue()).routingKey).toBe('has-priority');
      expect(assertDefined(store.dequeue()).routingKey).toBe('no-priority');
    });
  });

  // ── enqueue ───────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('sets enqueuedAt to current timestamp', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      vi.setSystemTime(5000);
      const result = store.enqueue(makeMessage({ priority: 2 }));
      expect(result.enqueuedAt).toBe(5000);
    });

    it('computes expiresAt from per-message expiration', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      vi.setSystemTime(10000);
      const msg = makeMessage({
        priority: 1,
        properties: { expiration: '5000' },
      });
      const result = store.enqueue(msg);
      expect(result.expiresAt).toBe(15000);
    });

    it('computes expiresAt from queue messageTtl', () => {
      const store = new PriorityMessageStore({
        maxPriority: 5,
        messageTtl: 3000,
      });
      vi.setSystemTime(10000);
      const result = store.enqueue(makeMessage({ priority: 2 }));
      expect(result.expiresAt).toBe(13000);
    });

    it('updates count and byteSize', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });

      store.enqueue(
        makeMessage({
          priority: 1,
          body: new Uint8Array([1, 2, 3]),
        })
      );
      expect(store.count()).toBe(1);
      expect(store.byteSize()).toBe(3);

      store.enqueue(
        makeMessage({
          priority: 3,
          body: new Uint8Array([4, 5]),
        })
      );
      expect(store.count()).toBe(2);
      expect(store.byteSize()).toBe(5);
    });
  });

  // ── dequeue ───────────────────────────────────────────────────────

  describe('dequeue', () => {
    it('returns null for empty store', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      expect(store.dequeue()).toBeNull();
    });

    it('updates count and byteSize on dequeue', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      store.enqueue(
        makeMessage({ priority: 2, body: new Uint8Array([1, 2, 3]) })
      );
      store.enqueue(makeMessage({ priority: 1, body: new Uint8Array([4, 5]) }));
      expect(store.count()).toBe(2);
      expect(store.byteSize()).toBe(5);

      store.dequeue(); // removes priority 2 message (3 bytes)
      expect(store.count()).toBe(1);
      expect(store.byteSize()).toBe(2);

      store.dequeue(); // removes priority 1 message (2 bytes)
      expect(store.count()).toBe(0);
      expect(store.byteSize()).toBe(0);
    });
  });

  // ── peek ──────────────────────────────────────────────────────────

  describe('peek', () => {
    it('returns null for empty store', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      expect(store.peek()).toBeNull();
    });

    it('returns highest priority head without removing', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      store.enqueue(makeMessage({ routingKey: 'low', priority: 1 }));
      store.enqueue(makeMessage({ routingKey: 'high', priority: 5 }));

      expect(assertDefined(store.peek()).routingKey).toBe('high');
      expect(assertDefined(store.peek()).routingKey).toBe('high');
      expect(store.count()).toBe(2);
    });
  });

  // ── purge ─────────────────────────────────────────────────────────

  describe('purge', () => {
    it('returns 0 for empty store', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      expect(store.purge()).toBe(0);
    });

    it('removes all messages across all priority levels', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      store.enqueue(makeMessage({ priority: 0 }));
      store.enqueue(makeMessage({ priority: 3 }));
      store.enqueue(makeMessage({ priority: 5 }));

      const purged = store.purge();
      expect(purged).toBe(3);
      expect(store.count()).toBe(0);
      expect(store.byteSize()).toBe(0);
      expect(store.peek()).toBeNull();
    });
  });

  // ── requeue ───────────────────────────────────────────────────────

  describe('requeue', () => {
    it('requeues message into correct priority bucket at head', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      store.enqueue(makeMessage({ routingKey: 'p3-first', priority: 3 }));

      const requeued = makeMessage({ routingKey: 'p3-requeued', priority: 3 });
      store.requeue(requeued);

      // Requeued at head of priority 3 bucket
      expect(assertDefined(store.dequeue()).routingKey).toBe('p3-requeued');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p3-first');
    });

    it('requeues into the correct priority bucket (not the highest)', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      store.enqueue(makeMessage({ routingKey: 'p5', priority: 5 }));
      store.enqueue(makeMessage({ routingKey: 'p1-first', priority: 1 }));

      const requeued = makeMessage({ routingKey: 'p1-requeued', priority: 1 });
      store.requeue(requeued);

      // Priority 5 is still highest, then requeued goes before p1-first
      expect(assertDefined(store.dequeue()).routingKey).toBe('p5');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p1-requeued');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p1-first');
    });

    it('updates count and byteSize on requeue', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      store.enqueue(
        makeMessage({ priority: 1, body: new Uint8Array([1, 2, 3]) })
      );
      expect(store.count()).toBe(1);
      expect(store.byteSize()).toBe(3);

      store.requeue(makeMessage({ priority: 2, body: new Uint8Array([4, 5]) }));
      expect(store.count()).toBe(2);
      expect(store.byteSize()).toBe(5);
    });
  });

  // ── drainExpired ──────────────────────────────────────────────────

  describe('drainExpired', () => {
    it('returns empty array when store is empty', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      expect(store.drainExpired(999999)).toEqual([]);
    });

    it('drains expired messages from all priority levels', () => {
      const store = new PriorityMessageStore({
        maxPriority: 5,
        messageTtl: 1000,
      });
      vi.setSystemTime(10000);
      store.enqueue(makeMessage({ routingKey: 'p1', priority: 1 }));
      store.enqueue(makeMessage({ routingKey: 'p3', priority: 3 }));
      store.enqueue(makeMessage({ routingKey: 'p5', priority: 5 }));

      // All expire at 11000; now = 12000
      const expired = store.drainExpired(12000);
      expect(expired).toHaveLength(3);
      expect(store.count()).toBe(0);
    });

    it('drains expired messages in priority order (highest first)', () => {
      const store = new PriorityMessageStore({
        maxPriority: 5,
        messageTtl: 1000,
      });
      vi.setSystemTime(10000);
      store.enqueue(makeMessage({ routingKey: 'p1', priority: 1 }));
      store.enqueue(makeMessage({ routingKey: 'p3', priority: 3 }));

      const expired = store.drainExpired(12000);
      expect(expired).toHaveLength(2);
      expect(expired[0]?.routingKey).toBe('p3');
      expect(expired[1]?.routingKey).toBe('p1');
    });

    it('does not drain non-expired messages', () => {
      const store = new PriorityMessageStore({
        maxPriority: 5,
        messageTtl: 10000,
      });
      vi.setSystemTime(10000);
      store.enqueue(makeMessage({ routingKey: 'alive', priority: 3 }));

      const expired = store.drainExpired(12000);
      expect(expired).toHaveLength(0);
      expect(store.count()).toBe(1);
    });

    it('partially drains buckets (stops at non-expired head per bucket)', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      vi.setSystemTime(10000);

      // Priority 3: expired then alive
      store.enqueue(
        makeMessage({
          routingKey: 'p3-expired',
          priority: 3,
          properties: { expiration: '1000' },
        })
      );
      vi.setSystemTime(10500);
      store.enqueue(
        makeMessage({
          routingKey: 'p3-alive',
          priority: 3,
          properties: { expiration: '10000' },
        })
      );

      const expired = store.drainExpired(12000);
      expect(expired).toHaveLength(1);
      expect(expired[0]?.routingKey).toBe('p3-expired');
      expect(store.count()).toBe(1);
      expect(assertDefined(store.peek()).routingKey).toBe('p3-alive');
    });
  });

  // ── Dispatch interaction ──────────────────────────────────────────

  describe('dispatch interaction', () => {
    it('messages dequeued one at a time respect priority order', () => {
      const store = new PriorityMessageStore({ maxPriority: 10 });

      // Simulate interleaved publishes
      store.enqueue(makeMessage({ routingKey: 'p0-a', priority: 0 }));
      store.enqueue(makeMessage({ routingKey: 'p5-a', priority: 5 }));
      store.enqueue(makeMessage({ routingKey: 'p3-a', priority: 3 }));
      store.enqueue(makeMessage({ routingKey: 'p5-b', priority: 5 }));
      store.enqueue(makeMessage({ routingKey: 'p0-b', priority: 0 }));

      const order: string[] = [];
      while (store.count() > 0) {
        order.push(assertDefined(store.dequeue()).routingKey);
      }

      expect(order).toEqual(['p5-a', 'p5-b', 'p3-a', 'p0-a', 'p0-b']);
    });
  });

  // ── Overflow integration ──────────────────────────────────────────

  describe('overflow integration', () => {
    it('count and byteSize are accurate for overflow checks', () => {
      const store = new PriorityMessageStore({ maxPriority: 3 });

      store.enqueue(makeMessage({ priority: 1, body: new Uint8Array([1, 2]) }));
      store.enqueue(
        makeMessage({ priority: 3, body: new Uint8Array([3, 4, 5]) })
      );
      store.enqueue(makeMessage({ priority: 0, body: new Uint8Array([6]) }));

      expect(store.count()).toBe(3);
      expect(store.byteSize()).toBe(6);

      // Dequeue removes highest priority first
      store.dequeue(); // removes p3 (3 bytes)
      expect(store.count()).toBe(2);
      expect(store.byteSize()).toBe(3);
    });

    it('drop-head dequeues highest priority message first', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });

      store.enqueue(makeMessage({ routingKey: 'p1', priority: 1 }));
      store.enqueue(makeMessage({ routingKey: 'p5', priority: 5 }));
      store.enqueue(makeMessage({ routingKey: 'p3', priority: 3 }));

      // drop-head calls dequeue() — removes highest priority
      const dropped = assertDefined(store.dequeue());
      expect(dropped.routingKey).toBe('p5');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles maxPriority=0 (single level, same as regular FIFO)', () => {
      const store = new PriorityMessageStore({ maxPriority: 0 });

      store.enqueue(makeMessage({ routingKey: 'first', priority: 0 }));
      store.enqueue(makeMessage({ routingKey: 'second', priority: 0 }));

      expect(assertDefined(store.dequeue()).routingKey).toBe('first');
      expect(assertDefined(store.dequeue()).routingKey).toBe('second');
    });

    it('handles messages with zero-length body', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      store.enqueue(makeMessage({ body: new Uint8Array(0), priority: 3 }));

      expect(store.count()).toBe(1);
      expect(store.byteSize()).toBe(0);

      const msg = assertDefined(store.dequeue());
      expect(msg.body.byteLength).toBe(0);
    });

    it('byte size never goes negative', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });
      store.enqueue(makeMessageWithBody([1]));
      store.dequeue();

      expect(store.byteSize()).toBe(0);
      store.dequeue(); // extra dequeue
      expect(store.byteSize()).toBe(0);
    });

    it('handles many priority levels', () => {
      const store = new PriorityMessageStore({ maxPriority: 255 });

      store.enqueue(makeMessage({ routingKey: 'p0', priority: 0 }));
      store.enqueue(makeMessage({ routingKey: 'p255', priority: 255 }));
      store.enqueue(makeMessage({ routingKey: 'p128', priority: 128 }));

      expect(assertDefined(store.dequeue()).routingKey).toBe('p255');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p128');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p0');
    });

    it('interleaved enqueue/dequeue maintains priority ordering', () => {
      const store = new PriorityMessageStore({ maxPriority: 5 });

      store.enqueue(makeMessage({ routingKey: 'p1-a', priority: 1 }));
      store.enqueue(makeMessage({ routingKey: 'p3-a', priority: 3 }));
      expect(assertDefined(store.dequeue()).routingKey).toBe('p3-a');

      store.enqueue(makeMessage({ routingKey: 'p2-a', priority: 2 }));
      expect(assertDefined(store.dequeue()).routingKey).toBe('p2-a');
      expect(assertDefined(store.dequeue()).routingKey).toBe('p1-a');
      expect(store.dequeue()).toBeNull();
    });
  });
});
