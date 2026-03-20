import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Dispatcher } from './dispatcher.ts';
import { ConsumerRegistry } from './consumer-registry.ts';
import { Channel } from './channel.ts';
import type { ChannelDeps } from './channel.ts';
import { MessageStore } from './message-store.ts';
import type { BrokerMessage, DeliveredMessage } from './types/message.ts';

function makeMessage(body = 'test', redelivered = false): BrokerMessage {
  return {
    body: new TextEncoder().encode(body),
    properties: {},
    exchange: '',
    routingKey: 'test',
    mandatory: false,
    immediate: false,
    deliveryCount: redelivered ? 1 : 0,
    enqueuedAt: Date.now(),
    priority: 0,
  };
}

function makeDeps(): ChannelDeps {
  return {
    onRequeue: vi.fn(),
    onClose: vi.fn(),
  };
}

/** Flush all pending microtasks (queueMicrotask callbacks). */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Dispatcher', () => {
  let registry: ConsumerRegistry;
  let dispatcher: Dispatcher;

  beforeEach(() => {
    registry = new ConsumerRegistry();
    dispatcher = new Dispatcher(registry);
  });

  // ── Basic dispatch ────────────────────────────────────────────────

  describe('basic dispatch', () => {
    it('delivers a message to a single consumer', async () => {
      const channel = new Channel(1, makeDeps());
      const received: DeliveredMessage[] = [];
      const cb = (msg: DeliveredMessage) => received.push(msg);
      const store = new MessageStore();

      registry.register('q1', 1, cb, {});
      store.enqueue(makeMessage('hello'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      expect(received).toHaveLength(1);
      const msg = received[0];
      expect(msg).toBeDefined();
      expect(new TextDecoder().decode(msg?.body ?? new Uint8Array())).toBe(
        'hello'
      );
      expect(msg?.deliveryTag).toBe(1);
      expect(msg?.redelivered).toBe(false);
      expect(msg?.exchange).toBe('');
      expect(msg?.routingKey).toBe('test');
    });

    it('assigns sequential delivery tags from channel', async () => {
      const channel = new Channel(1, makeDeps());
      const tags: number[] = [];
      const cb = (msg: DeliveredMessage) => tags.push(msg.deliveryTag);
      const store = new MessageStore();

      registry.register('q1', 1, cb, {});
      store.enqueue(makeMessage('a'));
      store.enqueue(makeMessage('b'));
      store.enqueue(makeMessage('c'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      expect(tags).toEqual([1, 2, 3]);
    });

    it('tracks unacked messages on channel when noAck=false', () => {
      const channel = new Channel(1, makeDeps());
      const cb = vi.fn();
      const store = new MessageStore();

      registry.register('q1', 1, cb, { noAck: false });
      store.enqueue(makeMessage('a'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );

      // Unacked tracking is synchronous, no need to flush
      expect(channel.unackedCount).toBe(1);
    });

    it('does not track unacked when noAck=true', () => {
      const channel = new Channel(1, makeDeps());
      const cb = vi.fn();
      const store = new MessageStore();

      registry.register('q1', 1, cb, { noAck: true });
      store.enqueue(makeMessage('a'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );

      expect(channel.unackedCount).toBe(0);
    });

    it('does nothing when no consumers exist', () => {
      const store = new MessageStore();
      store.enqueue(makeMessage('a'));

      dispatcher.dispatch('q1', store, () => undefined);

      expect(store.count()).toBe(1); // message stays in queue
    });

    it('does nothing when message store is empty', async () => {
      const channel = new Channel(1, makeDeps());
      const cb = vi.fn();
      const store = new MessageStore();

      registry.register('q1', 1, cb, {});

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      expect(cb).not.toHaveBeenCalled();
    });

    it('sets redelivered=true for messages with deliveryCount > 0', async () => {
      const channel = new Channel(1, makeDeps());
      const received: DeliveredMessage[] = [];
      const cb = (msg: DeliveredMessage) => received.push(msg);
      const store = new MessageStore();

      registry.register('q1', 1, cb, {});
      store.enqueue(makeMessage('redelivered-msg', true));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      expect(received[0]?.redelivered).toBe(true);
    });

    it('includes consumerTag in delivered message', async () => {
      const channel = new Channel(1, makeDeps());
      const received: DeliveredMessage[] = [];
      const cb = (msg: DeliveredMessage) => received.push(msg);
      const store = new MessageStore();

      registry.register('q1', 1, cb, { consumerTag: 'my-tag' });
      store.enqueue(makeMessage());

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      expect(received[0]?.consumerTag).toBe('my-tag');
    });

    it('delivers consumer callback asynchronously via microtask', () => {
      const channel = new Channel(1, makeDeps());
      const received: DeliveredMessage[] = [];
      const cb = (msg: DeliveredMessage) => received.push(msg);
      const store = new MessageStore();

      registry.register('q1', 1, cb, {});
      store.enqueue(makeMessage('a'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );

      // Callback must NOT have fired synchronously
      expect(received).toHaveLength(0);
    });
  });

  // ── Round-robin dispatch ──────────────────────────────────────────

  describe('round-robin dispatch', () => {
    it('distributes messages fairly across consumers', async () => {
      const ch1 = new Channel(1, makeDeps());
      const ch2 = new Channel(2, makeDeps());
      const received1: string[] = [];
      const received2: string[] = [];
      const store = new MessageStore();

      registry.register(
        'q1',
        1,
        (msg) => received1.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );
      registry.register(
        'q1',
        2,
        (msg) => received2.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );

      store.enqueue(makeMessage('a'));
      store.enqueue(makeMessage('b'));
      store.enqueue(makeMessage('c'));
      store.enqueue(makeMessage('d'));

      dispatcher.dispatch('q1', store, (ch) => {
        if (ch === 1) return ch1;
        if (ch === 2) return ch2;
        return undefined;
      });
      await flushMicrotasks();

      expect(received1).toEqual(['a', 'c']);
      expect(received2).toEqual(['b', 'd']);
    });

    it('round-robin persists across dispatch calls', async () => {
      const ch1 = new Channel(1, makeDeps());
      const ch2 = new Channel(2, makeDeps());
      const received1: string[] = [];
      const received2: string[] = [];
      const store = new MessageStore();

      registry.register(
        'q1',
        1,
        (msg) => received1.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );
      registry.register(
        'q1',
        2,
        (msg) => received2.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );

      const getChannel = (ch: number) => {
        if (ch === 1) return ch1;
        if (ch === 2) return ch2;
        return undefined;
      };

      store.enqueue(makeMessage('a'));
      dispatcher.dispatch('q1', store, getChannel);
      await flushMicrotasks();

      store.enqueue(makeMessage('b'));
      dispatcher.dispatch('q1', store, getChannel);
      await flushMicrotasks();

      store.enqueue(makeMessage('c'));
      dispatcher.dispatch('q1', store, getChannel);
      await flushMicrotasks();

      expect(received1).toEqual(['a', 'c']);
      expect(received2).toEqual(['b']);
    });

    it('skips consumer whose channel is missing', async () => {
      const ch1 = new Channel(1, makeDeps());
      const received1: string[] = [];
      const received2: string[] = [];
      const store = new MessageStore();

      registry.register(
        'q1',
        1,
        (msg) => received1.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );
      registry.register(
        'q1',
        2,
        (msg) => received2.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );

      store.enqueue(makeMessage('a'));
      store.enqueue(makeMessage('b'));

      // Channel 2 is not available
      dispatcher.dispatch('q1', store, (ch) => (ch === 1 ? ch1 : undefined));
      await flushMicrotasks();

      expect(received1).toEqual(['a', 'b']);
      expect(received2).toEqual([]);
    });
  });

  // ── Per-consumer prefetch (global=false) ──────────────────────────

  describe('per-consumer prefetch', () => {
    it('stops delivering when consumer reaches prefetch limit', async () => {
      const channel = new Channel(1, makeDeps());
      channel.setPrefetch(2, false);
      const received: string[] = [];
      const store = new MessageStore();

      registry.register(
        'q1',
        1,
        (msg) => received.push(new TextDecoder().decode(msg.body)),
        {}
      );

      store.enqueue(makeMessage('a'));
      store.enqueue(makeMessage('b'));
      store.enqueue(makeMessage('c'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      expect(received).toEqual(['a', 'b']);
      expect(store.count()).toBe(1); // 'c' still in queue
    });

    it('skips consumer at limit and delivers to next', async () => {
      const ch1 = new Channel(1, makeDeps());
      const ch2 = new Channel(2, makeDeps());
      ch1.setPrefetch(1, false);
      ch2.setPrefetch(1, false);
      const received1: string[] = [];
      const received2: string[] = [];
      const store = new MessageStore();

      registry.register(
        'q1',
        1,
        (msg) => received1.push(new TextDecoder().decode(msg.body)),
        {}
      );
      registry.register(
        'q1',
        2,
        (msg) => received2.push(new TextDecoder().decode(msg.body)),
        {}
      );

      store.enqueue(makeMessage('a'));
      store.enqueue(makeMessage('b'));
      store.enqueue(makeMessage('c'));

      dispatcher.dispatch('q1', store, (ch) => {
        if (ch === 1) return ch1;
        if (ch === 2) return ch2;
        return undefined;
      });
      await flushMicrotasks();

      // a → consumer 1 (now at limit), b → consumer 2 (now at limit), c stays
      expect(received1).toEqual(['a']);
      expect(received2).toEqual(['b']);
      expect(store.count()).toBe(1);
    });

    it('holds messages when all consumers at prefetch limit', async () => {
      const channel = new Channel(1, makeDeps());
      channel.setPrefetch(1, false);
      const cb = vi.fn();
      const store = new MessageStore();

      registry.register('q1', 1, cb, {});
      store.enqueue(makeMessage('a'));
      store.enqueue(makeMessage('b'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      expect(cb).toHaveBeenCalledTimes(1);
      expect(store.count()).toBe(1);
    });

    it('does not apply prefetch to noAck consumers', async () => {
      const channel = new Channel(1, makeDeps());
      channel.setPrefetch(1, false);
      const received: string[] = [];
      const store = new MessageStore();

      registry.register(
        'q1',
        1,
        (msg) => received.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );

      store.enqueue(makeMessage('a'));
      store.enqueue(makeMessage('b'));
      store.enqueue(makeMessage('c'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      expect(received).toEqual(['a', 'b', 'c']);
    });
  });

  // ── Per-channel prefetch (global=true) ────────────────────────────

  describe('per-channel prefetch', () => {
    it('stops delivering when channel reaches shared prefetch limit', async () => {
      const channel = new Channel(1, makeDeps());
      channel.setPrefetch(2, true);
      const received: string[] = [];
      const store = new MessageStore();

      registry.register(
        'q1',
        1,
        (msg) => received.push(new TextDecoder().decode(msg.body)),
        {}
      );

      store.enqueue(makeMessage('a'));
      store.enqueue(makeMessage('b'));
      store.enqueue(makeMessage('c'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      expect(received).toEqual(['a', 'b']);
      expect(store.count()).toBe(1);
    });

    it('channel prefetch is shared across consumers on same channel', async () => {
      const channel = new Channel(1, makeDeps());
      channel.setPrefetch(3, true);
      const received1: string[] = [];
      const received2: string[] = [];
      const store = new MessageStore();

      registry.register(
        'q1',
        1,
        (msg) => received1.push(new TextDecoder().decode(msg.body)),
        {}
      );
      registry.register(
        'q1',
        1,
        (msg) => received2.push(new TextDecoder().decode(msg.body)),
        {}
      );

      store.enqueue(makeMessage('a'));
      store.enqueue(makeMessage('b'));
      store.enqueue(makeMessage('c'));
      store.enqueue(makeMessage('d'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      // 3 messages total delivered across both consumers, 'd' stays
      expect(received1.length + received2.length).toBe(3);
      expect(store.count()).toBe(1);
    });

    it('both per-consumer and per-channel prefetch apply simultaneously', async () => {
      const channel = new Channel(1, makeDeps());
      channel.setPrefetch(1, false); // per-consumer: 1
      channel.setPrefetch(3, true); // per-channel: 3
      const received1: string[] = [];
      const received2: string[] = [];
      const store = new MessageStore();

      registry.register(
        'q1',
        1,
        (msg) => received1.push(new TextDecoder().decode(msg.body)),
        {}
      );
      registry.register(
        'q1',
        1,
        (msg) => received2.push(new TextDecoder().decode(msg.body)),
        {}
      );

      store.enqueue(makeMessage('a'));
      store.enqueue(makeMessage('b'));
      store.enqueue(makeMessage('c'));
      store.enqueue(makeMessage('d'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      // Per-consumer limit of 1: each consumer gets at most 1
      // Total: 2 delivered (even though channel limit is 3)
      expect(received1).toEqual(['a']);
      expect(received2).toEqual(['b']);
      expect(store.count()).toBe(2);
    });
  });

  // ── Flow control interaction ──────────────────────────────────────

  describe('flow control', () => {
    it('does not deliver when channel flow is paused', async () => {
      const channel = new Channel(1, makeDeps());
      channel.setFlow(false);
      const cb = vi.fn();
      const store = new MessageStore();

      registry.register('q1', 1, cb, {});
      store.enqueue(makeMessage('a'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );
      await flushMicrotasks();

      expect(cb).not.toHaveBeenCalled();
      expect(store.count()).toBe(1);
    });
  });

  // ── Consumer unacked count tracking ───────────────────────────────

  describe('consumer unacked count', () => {
    it('increments consumer unacked count on delivery', () => {
      const channel = new Channel(1, makeDeps());
      const store = new MessageStore();

      const tag = registry.register('q1', 1, vi.fn(), {});
      store.enqueue(makeMessage('a'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );

      // Unacked tracking is synchronous, verified before microtask flush
      expect(registry.getConsumer(tag)?.unackedCount).toBe(1);
    });

    it('does not increment when noAck=true', () => {
      const channel = new Channel(1, makeDeps());
      const store = new MessageStore();

      const tag = registry.register('q1', 1, vi.fn(), { noAck: true });
      store.enqueue(makeMessage('a'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );

      expect(registry.getConsumer(tag)?.unackedCount).toBe(0);
    });
  });

  // ── TTL expiry during dispatch ───────────────────────────────────

  describe('TTL expiry during dispatch', () => {
    it('skips expired messages and delivers non-expired', async () => {
      let time = 10000;
      const expiredMessages: { queue: string; msg: BrokerMessage }[] = [];
      const reg = new ConsumerRegistry();
      const disp = new Dispatcher(reg, {
        now: () => time,
        onExpire: (q, m) => expiredMessages.push({ queue: q, msg: m }),
      });

      const channel = new Channel(1, makeDeps());
      const received: DeliveredMessage[] = [];
      const store = new MessageStore({ now: () => time });

      reg.register('q1', 1, (msg) => received.push(msg), { noAck: true });

      // Enqueue expired message (TTL=1000, enqueued at 10000, expires at 11000)
      store.enqueue(
        makeMessage('expired-msg') // enqueuedAt=10000
      );
      // Manually create a message with expiresAt set
      time = 10500;
      store.enqueue(
        makeMessage('alive-msg') // enqueuedAt=10500
      );

      // Advance time past first message's natural expiry but we need expiresAt
      // Let's use a store with messageTtl instead
      const store2 = new MessageStore({ messageTtl: 1000, now: () => time });
      time = 10000;
      store2.enqueue(makeMessage('will-expire')); // expiresAt=11000
      time = 10500;
      store2.enqueue(makeMessage('will-survive')); // expiresAt=11500

      // Advance time: first expired, second alive
      time = 11200;
      disp.dispatch('q1', store2, (ch) => (ch === 1 ? channel : undefined));
      await flushMicrotasks();

      expect(expiredMessages).toHaveLength(1);
      expect(new TextDecoder().decode(expiredMessages[0]?.msg.body)).toBe(
        'will-expire'
      );
      expect(received).toHaveLength(1);
      expect(new TextDecoder().decode(received[0]?.body)).toBe('will-survive');
    });

    it('drains expired messages even with no consumers', () => {
      let time = 10000;
      const expiredMessages: BrokerMessage[] = [];
      const reg = new ConsumerRegistry();
      const disp = new Dispatcher(reg, {
        now: () => time,
        onExpire: (_q, m) => expiredMessages.push(m),
      });

      const store = new MessageStore({ messageTtl: 1000, now: () => time });
      store.enqueue(makeMessage('a'));
      store.enqueue(makeMessage('b'));

      time = 12000;
      disp.dispatch('q1', store, () => undefined);

      expect(expiredMessages).toHaveLength(2);
      expect(store.count()).toBe(0);
    });

    it('TTL=0 message delivered when consumer is ready (same tick)', async () => {
      const time = 10000;
      const expiredMessages: BrokerMessage[] = [];
      const reg = new ConsumerRegistry();
      const disp = new Dispatcher(reg, {
        now: () => time,
        onExpire: (_q, m) => expiredMessages.push(m),
      });

      const channel = new Channel(1, makeDeps());
      const received: DeliveredMessage[] = [];
      const store = new MessageStore({ messageTtl: 0, now: () => time });

      reg.register('q1', 1, (msg) => received.push(msg), { noAck: true });

      // expiresAt = 10000, now() = 10000 → strict < means NOT expired
      store.enqueue(makeMessage('ttl-zero'));

      disp.dispatch('q1', store, (ch) => (ch === 1 ? channel : undefined));
      await flushMicrotasks();

      expect(expiredMessages).toHaveLength(0);
      expect(received).toHaveLength(1);
      expect(new TextDecoder().decode(received[0]?.body)).toBe('ttl-zero');
    });

    it('TTL=0 message expires when no consumer and time advances', () => {
      let time = 10000;
      const expiredMessages: BrokerMessage[] = [];
      const reg = new ConsumerRegistry();
      const disp = new Dispatcher(reg, {
        now: () => time,
        onExpire: (_q, m) => expiredMessages.push(m),
      });

      const store = new MessageStore({ messageTtl: 0, now: () => time });
      store.enqueue(makeMessage('ttl-zero'));

      // No consumers, advance time by 1ms
      time = 10001;
      disp.dispatch('q1', store, () => undefined);

      expect(expiredMessages).toHaveLength(1);
      expect(store.count()).toBe(0);
    });

    it('reports correct queue name in onExpire callback', () => {
      let time = 10000;
      const expiredQueues: string[] = [];
      const reg = new ConsumerRegistry();
      const disp = new Dispatcher(reg, {
        now: () => time,
        onExpire: (q) => expiredQueues.push(q),
      });

      const store = new MessageStore({ messageTtl: 1000, now: () => time });
      store.enqueue(makeMessage('a'));

      time = 12000;
      disp.dispatch('my-queue', store, () => undefined);

      expect(expiredQueues).toEqual(['my-queue']);
    });

    it('head-only expiry: message behind non-expired head stays', async () => {
      let time = 10000;
      const expiredMessages: BrokerMessage[] = [];
      const reg = new ConsumerRegistry();
      const disp = new Dispatcher(reg, {
        now: () => time,
        onExpire: (_q, m) => expiredMessages.push(m),
      });

      const channel = new Channel(1, makeDeps());
      const received: DeliveredMessage[] = [];
      const store = new MessageStore({ now: () => time });

      reg.register('q1', 1, (msg) => received.push(msg), { noAck: true });

      // Message A: no TTL (never expires)
      store.enqueue(makeMessage('no-ttl'));

      // Message B: per-message TTL=1000
      const msgB: BrokerMessage = {
        ...makeMessage('has-ttl'),
        properties: { expiration: '1000' },
      };
      store.enqueue(msgB); // expiresAt = 11000

      // Advance past B's TTL, but A is head and has no expiresAt
      time = 12000;
      disp.dispatch('q1', store, (ch) => (ch === 1 ? channel : undefined));
      await flushMicrotasks();

      // A is not expired → delivered. B is now head but not drained (dispatch already ran)
      expect(expiredMessages).toHaveLength(0);
      expect(received).toHaveLength(2); // both delivered since A blocks B's expiry
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles consumer added between dispatch calls', async () => {
      const ch1 = new Channel(1, makeDeps());
      const ch2 = new Channel(2, makeDeps());
      const received1: string[] = [];
      const received2: string[] = [];
      const store = new MessageStore();

      const getChannel = (ch: number) => {
        if (ch === 1) return ch1;
        if (ch === 2) return ch2;
        return undefined;
      };

      registry.register(
        'q1',
        1,
        (msg) => received1.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );

      store.enqueue(makeMessage('a'));
      dispatcher.dispatch('q1', store, getChannel);
      await flushMicrotasks();

      // Add second consumer
      registry.register(
        'q1',
        2,
        (msg) => received2.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );

      store.enqueue(makeMessage('b'));
      store.enqueue(makeMessage('c'));
      dispatcher.dispatch('q1', store, getChannel);
      await flushMicrotasks();

      expect(received1).toContain('a');
      // Second dispatch distributes across both
      expect(received1.length + received2.length).toBe(3);
    });

    it('handles consumer removed between dispatch calls', async () => {
      const ch1 = new Channel(1, makeDeps());
      const received: string[] = [];
      const store = new MessageStore();

      const tag = registry.register(
        'q1',
        1,
        (msg) => received.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );

      store.enqueue(makeMessage('a'));
      dispatcher.dispatch('q1', store, (ch) => (ch === 1 ? ch1 : undefined));
      await flushMicrotasks();

      registry.cancel(tag);

      store.enqueue(makeMessage('b'));
      dispatcher.dispatch('q1', store, (ch) => (ch === 1 ? ch1 : undefined));
      await flushMicrotasks();

      expect(received).toEqual(['a']);
      expect(store.count()).toBe(1); // 'b' stays in queue
    });

    it('delivers messages from independent queues separately', async () => {
      const channel = new Channel(1, makeDeps());
      const receivedQ1: string[] = [];
      const receivedQ2: string[] = [];
      const store1 = new MessageStore();
      const store2 = new MessageStore();

      registry.register(
        'q1',
        1,
        (msg) => receivedQ1.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );
      registry.register(
        'q2',
        1,
        (msg) => receivedQ2.push(new TextDecoder().decode(msg.body)),
        { noAck: true }
      );

      store1.enqueue(makeMessage('q1-a'));
      store2.enqueue(makeMessage('q2-a'));

      const getChannel = (ch: number) => (ch === 1 ? channel : undefined);

      dispatcher.dispatch('q1', store1, getChannel);
      dispatcher.dispatch('q2', store2, getChannel);
      await flushMicrotasks();

      expect(receivedQ1).toEqual(['q1-a']);
      expect(receivedQ2).toEqual(['q2-a']);
    });
  });
});
