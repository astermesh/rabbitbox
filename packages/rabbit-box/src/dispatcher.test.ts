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

describe('Dispatcher', () => {
  let registry: ConsumerRegistry;
  let dispatcher: Dispatcher;

  beforeEach(() => {
    registry = new ConsumerRegistry();
    dispatcher = new Dispatcher(registry);
  });

  // ── Basic dispatch ────────────────────────────────────────────────

  describe('basic dispatch', () => {
    it('delivers a message to a single consumer', () => {
      const channel = new Channel(1, makeDeps());
      const received: DeliveredMessage[] = [];
      const cb = (msg: DeliveredMessage) => received.push(msg);
      const store = new MessageStore();

      registry.register('q1', 1, cb, {});
      store.enqueue(makeMessage('hello'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );

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

    it('assigns sequential delivery tags from channel', () => {
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

    it('does nothing when message store is empty', () => {
      const channel = new Channel(1, makeDeps());
      const cb = vi.fn();
      const store = new MessageStore();

      registry.register('q1', 1, cb, {});

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );

      expect(cb).not.toHaveBeenCalled();
    });

    it('sets redelivered=true for messages with deliveryCount > 0', () => {
      const channel = new Channel(1, makeDeps());
      const received: DeliveredMessage[] = [];
      const cb = (msg: DeliveredMessage) => received.push(msg);
      const store = new MessageStore();

      registry.register('q1', 1, cb, {});
      store.enqueue(makeMessage('redelivered-msg', true));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );

      expect(received[0]?.redelivered).toBe(true);
    });

    it('includes consumerTag in delivered message', () => {
      const channel = new Channel(1, makeDeps());
      const received: DeliveredMessage[] = [];
      const cb = (msg: DeliveredMessage) => received.push(msg);
      const store = new MessageStore();

      registry.register('q1', 1, cb, { consumerTag: 'my-tag' });
      store.enqueue(makeMessage());

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );

      expect(received[0]?.consumerTag).toBe('my-tag');
    });
  });

  // ── Round-robin dispatch ──────────────────────────────────────────

  describe('round-robin dispatch', () => {
    it('distributes messages fairly across consumers', () => {
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

      expect(received1).toEqual(['a', 'c']);
      expect(received2).toEqual(['b', 'd']);
    });

    it('round-robin persists across dispatch calls', () => {
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

      store.enqueue(makeMessage('b'));
      dispatcher.dispatch('q1', store, getChannel);

      store.enqueue(makeMessage('c'));
      dispatcher.dispatch('q1', store, getChannel);

      expect(received1).toEqual(['a', 'c']);
      expect(received2).toEqual(['b']);
    });

    it('skips consumer whose channel is missing', () => {
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

      expect(received1).toEqual(['a', 'b']);
      expect(received2).toEqual([]);
    });
  });

  // ── Per-consumer prefetch (global=false) ──────────────────────────

  describe('per-consumer prefetch', () => {
    it('stops delivering when consumer reaches prefetch limit', () => {
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

      expect(received).toEqual(['a', 'b']);
      expect(store.count()).toBe(1); // 'c' still in queue
    });

    it('skips consumer at limit and delivers to next', () => {
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

      // a → consumer 1 (now at limit), b → consumer 2 (now at limit), c stays
      expect(received1).toEqual(['a']);
      expect(received2).toEqual(['b']);
      expect(store.count()).toBe(1);
    });

    it('holds messages when all consumers at prefetch limit', () => {
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

      expect(cb).toHaveBeenCalledTimes(1);
      expect(store.count()).toBe(1);
    });

    it('does not apply prefetch to noAck consumers', () => {
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

      expect(received).toEqual(['a', 'b', 'c']);
    });
  });

  // ── Per-channel prefetch (global=true) ────────────────────────────

  describe('per-channel prefetch', () => {
    it('stops delivering when channel reaches shared prefetch limit', () => {
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

      expect(received).toEqual(['a', 'b']);
      expect(store.count()).toBe(1);
    });

    it('channel prefetch is shared across consumers on same channel', () => {
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

      // 3 messages total delivered across both consumers, 'd' stays
      expect(received1.length + received2.length).toBe(3);
      expect(store.count()).toBe(1);
    });

    it('both per-consumer and per-channel prefetch apply simultaneously', () => {
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

      // Per-consumer limit of 1: each consumer gets at most 1
      // Total: 2 delivered (even though channel limit is 3)
      expect(received1).toEqual(['a']);
      expect(received2).toEqual(['b']);
      expect(store.count()).toBe(2);
    });
  });

  // ── Flow control interaction ──────────────────────────────────────

  describe('flow control', () => {
    it('does not deliver when channel flow is paused', () => {
      const channel = new Channel(1, makeDeps());
      channel.setFlow(false);
      const cb = vi.fn();
      const store = new MessageStore();

      registry.register('q1', 1, cb, {});
      store.enqueue(makeMessage('a'));

      dispatcher.dispatch('q1', store, (ch) =>
        ch === 1 ? channel : undefined
      );

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

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles consumer added between dispatch calls', () => {
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

      expect(received1).toContain('a');
      // Second dispatch distributes across both
      expect(received1.length + received2.length).toBe(3);
    });

    it('handles consumer removed between dispatch calls', () => {
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

      registry.cancel(tag);

      store.enqueue(makeMessage('b'));
      dispatcher.dispatch('q1', store, (ch) => (ch === 1 ? ch1 : undefined));

      expect(received).toEqual(['a']);
      expect(store.count()).toBe(1); // 'b' stays in queue
    });

    it('delivers messages from independent queues separately', () => {
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

      expect(receivedQ1).toEqual(['q1-a']);
      expect(receivedQ2).toEqual(['q2-a']);
    });
  });
});
