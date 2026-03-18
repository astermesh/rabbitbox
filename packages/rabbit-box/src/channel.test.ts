import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Channel } from './channel.ts';
import type { ChannelDeps } from './channel.ts';
import type { BrokerMessage } from './types/message.ts';
import { ChannelError } from './errors/amqp-error.ts';
import { CHANNEL_ERROR } from './errors/reply-codes.ts';

function makeMessage(body = 'test'): BrokerMessage {
  return {
    body: new TextEncoder().encode(body),
    properties: {},
    exchange: '',
    routingKey: 'test',
    mandatory: false,
    immediate: false,
    deliveryCount: 0,
    enqueuedAt: Date.now(),
    priority: 0,
  };
}

describe('Channel', () => {
  type OnRequeueFn = ChannelDeps['onRequeue'];
  type OnCloseFn = ChannelDeps['onClose'];

  let onRequeue: ReturnType<typeof vi.fn<OnRequeueFn>>;
  let onClose: ReturnType<typeof vi.fn<OnCloseFn>>;
  let deps: ChannelDeps;
  let channel: Channel;

  beforeEach(() => {
    onRequeue = vi.fn<OnRequeueFn>();
    onClose = vi.fn<OnCloseFn>();
    deps = { onRequeue, onClose };
    channel = new Channel(1, deps);
  });

  // ── Initial state ───────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts in open state', () => {
      expect(channel.getState()).toBe('open');
    });

    it('has the assigned channel number', () => {
      expect(channel.channelNumber).toBe(1);
    });

    it('has zero unacked messages', () => {
      expect(channel.unackedCount).toBe(0);
    });

    it('has flow active by default', () => {
      expect(channel.isFlowActive()).toBe(true);
    });
  });

  // ── Delivery tag sequence ───────────────────────────────────────────

  describe('delivery tag sequence', () => {
    it('starts at 1', () => {
      expect(channel.nextDeliveryTag()).toBe(1);
    });

    it('increments sequentially', () => {
      expect(channel.nextDeliveryTag()).toBe(1);
      expect(channel.nextDeliveryTag()).toBe(2);
      expect(channel.nextDeliveryTag()).toBe(3);
    });

    it('is per-channel (independent across channels)', () => {
      const ch2 = new Channel(2, deps);
      expect(channel.nextDeliveryTag()).toBe(1);
      expect(ch2.nextDeliveryTag()).toBe(1);
      expect(channel.nextDeliveryTag()).toBe(2);
      expect(ch2.nextDeliveryTag()).toBe(2);
    });

    it('throws on closed channel', () => {
      channel.close();
      expect(() => channel.nextDeliveryTag()).toThrow(ChannelError);
    });
  });

  // ── Unacked message tracking ────────────────────────────────────────

  describe('unacked message tracking', () => {
    it('tracks an unacked message', () => {
      const msg = makeMessage();
      channel.trackUnacked(1, msg, 'q1');
      expect(channel.unackedCount).toBe(1);

      const entry = channel.getUnacked(1);
      expect(entry).toBeDefined();
      expect(entry?.deliveryTag).toBe(1);
      expect(entry?.message).toBe(msg);
      expect(entry?.queueName).toBe('q1');
    });

    it('tracks multiple unacked messages', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q2');
      channel.trackUnacked(3, makeMessage('c'), 'q1');
      expect(channel.unackedCount).toBe(3);
    });

    it('removes an unacked message by delivery tag', () => {
      const msg = makeMessage();
      channel.trackUnacked(1, msg, 'q1');

      const removed = channel.removeUnacked(1);
      expect(removed).toBeDefined();
      expect(removed?.deliveryTag).toBe(1);
      expect(channel.unackedCount).toBe(0);
    });

    it('returns undefined for unknown delivery tag', () => {
      expect(channel.getUnacked(999)).toBeUndefined();
      expect(channel.removeUnacked(999)).toBeUndefined();
    });

    it('exposes read-only unackedMessages map', () => {
      const msg = makeMessage();
      channel.trackUnacked(1, msg, 'q1');

      const map = channel.unackedMessages;
      expect(map.size).toBe(1);
      expect(map.get(1)?.queueName).toBe('q1');
    });
  });

  // ── removeUnackedUpTo (multiple ack) ────────────────────────────────

  describe('removeUnackedUpTo', () => {
    it('removes all messages up to and including the given tag', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q1');
      channel.trackUnacked(3, makeMessage('c'), 'q1');
      channel.trackUnacked(4, makeMessage('d'), 'q1');

      const removed = channel.removeUnackedUpTo(3);
      expect(removed).toHaveLength(3);
      expect(removed.map((r) => r.deliveryTag)).toEqual([1, 2, 3]);
      expect(channel.unackedCount).toBe(1);
      expect(channel.getUnacked(4)).toBeDefined();
    });

    it('returns empty array when no tags match', () => {
      channel.trackUnacked(5, makeMessage(), 'q1');
      const removed = channel.removeUnackedUpTo(3);
      expect(removed).toHaveLength(0);
      expect(channel.unackedCount).toBe(1);
    });

    it('handles single message', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');
      const removed = channel.removeUnackedUpTo(1);
      expect(removed).toHaveLength(1);
      expect(channel.unackedCount).toBe(0);
    });
  });

  // ── Flow control ────────────────────────────────────────────────────

  describe('flow control', () => {
    it('can pause flow', () => {
      channel.setFlow(false);
      expect(channel.isFlowActive()).toBe(false);
    });

    it('can resume flow', () => {
      channel.setFlow(false);
      channel.setFlow(true);
      expect(channel.isFlowActive()).toBe(true);
    });

    it('returns true when flow state changed', () => {
      expect(channel.setFlow(false)).toBe(true);
    });

    it('returns false when flow state unchanged', () => {
      expect(channel.setFlow(true)).toBe(false);
    });

    it('throws on closed channel', () => {
      channel.close();
      expect(() => channel.setFlow(false)).toThrow(ChannelError);
    });
  });

  // ── Close lifecycle ─────────────────────────────────────────────────

  describe('close', () => {
    it('transitions to closed state', () => {
      channel.close();
      expect(channel.getState()).toBe('closed');
    });

    it('requeues all unacked messages on close', () => {
      const msg1 = makeMessage('msg1');
      const msg2 = makeMessage('msg2');
      channel.trackUnacked(1, msg1, 'q1');
      channel.trackUnacked(2, msg2, 'q2');

      channel.close();

      expect(onRequeue).toHaveBeenCalledTimes(2);
      expect(onRequeue).toHaveBeenCalledWith('q1', msg1);
      expect(onRequeue).toHaveBeenCalledWith('q2', msg2);
    });

    it('clears unacked messages after close', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');
      channel.close();
      expect(channel.unackedCount).toBe(0);
    });

    it('notifies parent via onClose callback', () => {
      channel.close();
      expect(onClose).toHaveBeenCalledWith(1);
    });

    it('is idempotent — second close is a no-op', () => {
      channel.close();
      channel.close();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onRequeue).not.toHaveBeenCalled();
    });

    it('operations throw after close', () => {
      channel.close();
      expect(() => channel.assertOpen()).toThrow(ChannelError);
      expect(() => channel.nextDeliveryTag()).toThrow(ChannelError);
      expect(() => channel.setFlow(false)).toThrow(ChannelError);
    });

    it('error includes CHANNEL_ERROR reply code', () => {
      channel.close();
      try {
        channel.assertOpen();
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(CHANNEL_ERROR);
      }
    });
  });

  // ── assertOpen ──────────────────────────────────────────────────────

  describe('assertOpen', () => {
    it('does not throw when channel is open', () => {
      expect(() => channel.assertOpen()).not.toThrow();
    });

    it('throws ChannelError when channel is closed', () => {
      channel.close();
      expect(() => channel.assertOpen()).toThrow(ChannelError);
    });
  });
});
