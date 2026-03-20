import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Channel } from './channel.ts';
import type {
  ChannelDeps,
  DequeueResult,
  CheckQueueResult,
} from './channel.ts';
import type { BrokerMessage } from './types/message.ts';
import { ChannelError, ConnectionError } from './errors/amqp-error.ts';
import {
  CHANNEL_ERROR,
  NOT_FOUND,
  PRECONDITION_FAILED,
} from './errors/reply-codes.ts';
import { channelError } from './errors/factories.ts';

function makeMessage(body = 'test', deliveryCount = 0): BrokerMessage {
  return {
    body: new TextEncoder().encode(body),
    properties: {},
    exchange: 'test-exchange',
    routingKey: 'test',
    mandatory: false,
    immediate: false,
    deliveryCount,
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
      expect(() => channel.nextDeliveryTag()).toThrow(ConnectionError);
    });
  });

  // ── Unacked message tracking ────────────────────────────────────────

  describe('unacked message tracking', () => {
    it('tracks an unacked message', () => {
      const msg = makeMessage();
      channel.trackUnacked(1, msg, 'q1', 'ctag-1');
      expect(channel.unackedCount).toBe(1);

      const entry = channel.getUnacked(1);
      expect(entry).toBeDefined();
      expect(entry?.deliveryTag).toBe(1);
      expect(entry?.message).toBe(msg);
      expect(entry?.queueName).toBe('q1');
      expect(entry?.consumerTag).toBe('ctag-1');
    });

    it('tracks multiple unacked messages', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1', 'ctag-1');
      channel.trackUnacked(2, makeMessage('b'), 'q2', 'ctag-2');
      channel.trackUnacked(3, makeMessage('c'), 'q1', 'ctag-1');
      expect(channel.unackedCount).toBe(3);
    });

    it('removes an unacked message by delivery tag', () => {
      const msg = makeMessage();
      channel.trackUnacked(1, msg, 'q1', 'ctag-1');

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
      channel.trackUnacked(1, msg, 'q1', 'ctag-1');

      const map = channel.unackedMessages;
      expect(map.size).toBe(1);
      expect(map.get(1)?.queueName).toBe('q1');
    });
  });

  // ── removeUnackedUpTo (multiple ack) ────────────────────────────────

  describe('removeUnackedUpTo', () => {
    it('removes all messages up to and including the given tag', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1', 'ctag-1');
      channel.trackUnacked(2, makeMessage('b'), 'q1', 'ctag-1');
      channel.trackUnacked(3, makeMessage('c'), 'q1', 'ctag-1');
      channel.trackUnacked(4, makeMessage('d'), 'q1', 'ctag-1');

      const removed = channel.removeUnackedUpTo(3);
      expect(removed).toHaveLength(3);
      expect(removed.map((r) => r.deliveryTag)).toEqual([1, 2, 3]);
      expect(channel.unackedCount).toBe(1);
      expect(channel.getUnacked(4)).toBeDefined();
    });

    it('returns empty array when no tags match', () => {
      channel.trackUnacked(5, makeMessage(), 'q1', 'ctag-1');
      const removed = channel.removeUnackedUpTo(3);
      expect(removed).toHaveLength(0);
      expect(channel.unackedCount).toBe(1);
    });

    it('handles single message', () => {
      channel.trackUnacked(1, makeMessage(), 'q1', 'ctag-1');
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
      expect(() => channel.setFlow(false)).toThrow(ConnectionError);
    });
  });

  // ── Close lifecycle ─────────────────────────────────────────────────

  describe('close', () => {
    it('transitions to closed state', () => {
      channel.close();
      expect(channel.getState()).toBe('closed');
    });

    it('requeues all unacked messages on close with redelivered flag', () => {
      const msg1 = makeMessage('msg1');
      const msg2 = makeMessage('msg2');
      channel.trackUnacked(1, msg1, 'q1', 'ctag-1');
      channel.trackUnacked(2, msg2, 'q2', 'ctag-2');

      channel.close();

      expect(onRequeue).toHaveBeenCalledTimes(2);
      expect(onRequeue).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ deliveryCount: 1 })
      );
      expect(onRequeue).toHaveBeenCalledWith(
        'q2',
        expect.objectContaining({ deliveryCount: 1 })
      );
    });

    it('clears unacked messages after close', () => {
      channel.trackUnacked(1, makeMessage(), 'q1', 'ctag-1');
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
      expect(() => channel.assertOpen()).toThrow(ConnectionError);
      expect(() => channel.nextDeliveryTag()).toThrow(ConnectionError);
      expect(() => channel.setFlow(false)).toThrow(ConnectionError);
    });

    it('error includes CHANNEL_ERROR reply code (connection-level per AMQP spec)', () => {
      channel.close();
      try {
        channel.assertOpen();
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectionError);
        expect((err as ConnectionError).replyCode).toBe(CHANNEL_ERROR);
      }
    });
  });

  // ── Prefetch ──────────────────────────────────────────────────────

  describe('prefetch', () => {
    it('defaults to 0 (unlimited) for both per-consumer and per-channel', () => {
      expect(channel.consumerPrefetch).toBe(0);
      expect(channel.channelPrefetch).toBe(0);
    });

    it('sets per-consumer prefetch with global=false', () => {
      channel.setPrefetch(10, false);
      expect(channel.consumerPrefetch).toBe(10);
      expect(channel.channelPrefetch).toBe(0);
    });

    it('sets per-channel prefetch with global=true', () => {
      channel.setPrefetch(20, true);
      expect(channel.channelPrefetch).toBe(20);
      expect(channel.consumerPrefetch).toBe(0);
    });

    it('allows setting both independently', () => {
      channel.setPrefetch(5, false);
      channel.setPrefetch(15, true);
      expect(channel.consumerPrefetch).toBe(5);
      expect(channel.channelPrefetch).toBe(15);
    });

    it('throws on closed channel', () => {
      channel.close();
      expect(() => channel.setPrefetch(10, false)).toThrow(ConnectionError);
    });
  });

  // ── assertOpen ──────────────────────────────────────────────────────

  describe('assertOpen', () => {
    it('does not throw when channel is open', () => {
      expect(() => channel.assertOpen()).not.toThrow();
    });

    it('throws ConnectionError when channel is closed (AMQP 504)', () => {
      channel.close();
      expect(() => channel.assertOpen()).toThrow(ConnectionError);
    });
  });

  // ── get (basic.get polling) ───────────────────────────────────────

  describe('get', () => {
    type DequeueFn = (queueName: string) => DequeueResult;
    let onDequeue: ReturnType<typeof vi.fn<DequeueFn>>;
    let channelWithGet: Channel;

    beforeEach(() => {
      onDequeue = vi.fn<DequeueFn>();
      channelWithGet = new Channel(1, {
        onRequeue,
        onClose,
        onDequeue,
      });
    });

    it('returns null when queue is empty', () => {
      onDequeue.mockReturnValue({ message: null, messageCount: 0 });
      const result = channelWithGet.get('q1');
      expect(result).toBeNull();
      expect(onDequeue).toHaveBeenCalledWith('q1');
    });

    it('returns delivered message with correct fields', () => {
      const msg = makeMessage('hello');
      onDequeue.mockReturnValue({ message: msg, messageCount: 5 });

      const result = channelWithGet.get('q1');

      expect(result).not.toBeNull();
      expect(result?.body).toBe(msg.body);
      expect(result?.properties).toBe(msg.properties);
      expect(result?.exchange).toBe('test-exchange');
      expect(result?.routingKey).toBe('test');
      expect(result?.messageCount).toBe(5);
    });

    it('assigns delivery tag from channel sequence', () => {
      onDequeue.mockReturnValue({
        message: makeMessage(),
        messageCount: 0,
      });

      const r1 = channelWithGet.get('q1');
      const r2 = channelWithGet.get('q1');

      expect(r1?.deliveryTag).toBe(1);
      expect(r2?.deliveryTag).toBe(2);
    });

    it('tracks message in unacked map when noAck is false (default)', () => {
      const msg = makeMessage();
      onDequeue.mockReturnValue({ message: msg, messageCount: 0 });

      channelWithGet.get('q1');

      expect(channelWithGet.unackedCount).toBe(1);
      const entry = channelWithGet.getUnacked(1);
      expect(entry).toBeDefined();
      expect(entry?.message).toBe(msg);
      expect(entry?.queueName).toBe('q1');
    });

    it('does not track in unacked map when noAck is true', () => {
      onDequeue.mockReturnValue({
        message: makeMessage(),
        messageCount: 0,
      });

      channelWithGet.get('q1', { noAck: true });

      expect(channelWithGet.unackedCount).toBe(0);
    });

    it('is not affected by prefetch count', () => {
      const msg = makeMessage();
      onDequeue.mockReturnValue({ message: msg, messageCount: 10 });

      // Track many unacked messages to simulate high load
      for (let i = 1; i <= 100; i++) {
        channelWithGet.trackUnacked(i, makeMessage(), 'q1', 'ctag-1');
      }

      // get() should still work regardless of unacked count
      const result = channelWithGet.get('q1');
      expect(result).not.toBeNull();
    });

    it('returns redelivered=false for fresh message (deliveryCount=0)', () => {
      const msg = makeMessage('fresh', 0);
      onDequeue.mockReturnValue({ message: msg, messageCount: 0 });

      const result = channelWithGet.get('q1');
      expect(result?.redelivered).toBe(false);
    });

    it('returns redelivered=true for redelivered message (deliveryCount>0)', () => {
      const msg = makeMessage('redelivered', 1);
      onDequeue.mockReturnValue({ message: msg, messageCount: 0 });

      const result = channelWithGet.get('q1');
      expect(result?.redelivered).toBe(true);
    });

    it('returns messageCount (remaining messages after get)', () => {
      onDequeue.mockReturnValue({
        message: makeMessage(),
        messageCount: 42,
      });

      const result = channelWithGet.get('q1');
      expect(result?.messageCount).toBe(42);
    });

    it('throws on closed channel', () => {
      channelWithGet.close();
      expect(() => channelWithGet.get('q1')).toThrow(ConnectionError);
    });

    it('propagates errors from onDequeue (e.g. queue not found)', () => {
      onDequeue.mockImplementation(() => {
        throw channelError.notFound(
          "no queue 'nonexistent' in vhost '/'",
          60,
          70
        );
      });

      expect(() => channelWithGet.get('nonexistent')).toThrow(ChannelError);
    });

    it('does not have consumerTag in result (get-ok has no consumer)', () => {
      onDequeue.mockReturnValue({
        message: makeMessage(),
        messageCount: 0,
      });

      const result = channelWithGet.get('q1');
      expect(result?.consumerTag).toBeUndefined();
    });

    it('throws when onDequeue dependency is not provided', () => {
      // channel (from beforeEach) has no onDequeue
      expect(() => channel.get('q1')).toThrow(
        'onDequeue dependency not provided'
      );
    });
  });

  // ── recover (basic.recover) ───────────────────────────────────────

  describe('recover', () => {
    it('requeues all unacked messages', () => {
      const msg1 = makeMessage('a');
      const msg2 = makeMessage('b');
      channel.trackUnacked(1, msg1, 'q1', 'ctag-1');
      channel.trackUnacked(2, msg2, 'q2', 'ctag-2');

      channel.recover();

      expect(onRequeue).toHaveBeenCalledTimes(2);
      expect(channel.unackedCount).toBe(0);
    });

    it('always requeues regardless of requeue parameter (matches RabbitMQ)', () => {
      const msg = makeMessage('test');
      channel.trackUnacked(1, msg, 'q1', 'ctag-1');

      // Even with requeue=false, RabbitMQ always requeues
      channel.recover(false);

      expect(onRequeue).toHaveBeenCalledTimes(1);
      expect(channel.unackedCount).toBe(0);
    });

    it('requeued messages have incremented deliveryCount for redelivered flag', () => {
      const msg = makeMessage('test', 0);
      channel.trackUnacked(1, msg, 'q1', 'ctag-1');

      channel.recover();

      expect(onRequeue).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ deliveryCount: 1 })
      );
    });

    it('increments deliveryCount cumulatively across multiple recovers', () => {
      const msg = makeMessage('test', 2); // already recovered twice
      channel.trackUnacked(1, msg, 'q1', 'ctag-1');

      channel.recover();

      expect(onRequeue).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ deliveryCount: 3 })
      );
    });

    it('is a no-op when there are no unacked messages', () => {
      channel.recover();
      expect(onRequeue).not.toHaveBeenCalled();
    });

    it('clears unacked map after recover', () => {
      channel.trackUnacked(1, makeMessage(), 'q1', 'ctag-1');
      channel.trackUnacked(2, makeMessage(), 'q1', 'ctag-1');

      channel.recover();

      expect(channel.unackedCount).toBe(0);
      expect(channel.getUnacked(1)).toBeUndefined();
      expect(channel.getUnacked(2)).toBeUndefined();
    });

    it('throws on closed channel', () => {
      channel.close();
      expect(() => channel.recover()).toThrow(ConnectionError);
    });

    it('requeues messages to their original queues', () => {
      channel.trackUnacked(1, makeMessage('a'), 'queue-alpha', 'ctag-1');
      channel.trackUnacked(2, makeMessage('b'), 'queue-beta', 'ctag-2');

      channel.recover();

      expect(onRequeue).toHaveBeenCalledWith(
        'queue-alpha',
        expect.objectContaining({ deliveryCount: 1 })
      );
      expect(onRequeue).toHaveBeenCalledWith(
        'queue-beta',
        expect.objectContaining({ deliveryCount: 1 })
      );
    });
  });

  // ── checkExchange (passive declare) ───────────────────────────────

  describe('checkExchange', () => {
    type CheckExchangeFn = (name: string) => void;
    let onCheckExchange: ReturnType<typeof vi.fn<CheckExchangeFn>>;
    let channelWithChecks: Channel;

    beforeEach(() => {
      onCheckExchange = vi.fn<CheckExchangeFn>();
      channelWithChecks = new Channel(1, {
        onRequeue,
        onClose,
        onCheckExchange,
      });
    });

    it('delegates to onCheckExchange callback', () => {
      onCheckExchange.mockReturnValue(undefined);
      channelWithChecks.checkExchange('amq.direct');
      expect(onCheckExchange).toHaveBeenCalledWith('amq.direct');
    });

    it('throws channel error for non-existent exchange (NOT_FOUND)', () => {
      onCheckExchange.mockImplementation(() => {
        throw channelError.notFound(
          "no exchange 'nonexistent' in vhost '/'",
          40,
          10
        );
      });

      expect(() => channelWithChecks.checkExchange('nonexistent')).toThrow(
        ChannelError
      );
      try {
        channelWithChecks.checkExchange('nonexistent');
      } catch (err) {
        expect((err as ChannelError).replyCode).toBe(NOT_FOUND);
      }
    });

    it('throws on closed channel', () => {
      channelWithChecks.close();
      expect(() => channelWithChecks.checkExchange('amq.direct')).toThrow(
        ConnectionError
      );
    });

    it('throws when onCheckExchange dependency is not provided', () => {
      expect(() => channel.checkExchange('amq.direct')).toThrow(
        'onCheckExchange dependency not provided'
      );
    });
  });

  // ── checkQueue (passive declare) ──────────────────────────────────

  describe('checkQueue', () => {
    type CheckQueueFn = (name: string) => CheckQueueResult;
    let onCheckQueue: ReturnType<typeof vi.fn<CheckQueueFn>>;
    let channelWithChecks: Channel;

    beforeEach(() => {
      onCheckQueue = vi.fn<CheckQueueFn>();
      channelWithChecks = new Channel(1, {
        onRequeue,
        onClose,
        onCheckQueue,
      });
    });

    it('returns queue info from onCheckQueue callback', () => {
      onCheckQueue.mockReturnValue({
        queue: 'my-queue',
        messageCount: 10,
        consumerCount: 2,
      });

      const result = channelWithChecks.checkQueue('my-queue');

      expect(result).toEqual({
        queue: 'my-queue',
        messageCount: 10,
        consumerCount: 2,
      });
      expect(onCheckQueue).toHaveBeenCalledWith('my-queue');
    });

    it('throws channel error for non-existent queue (NOT_FOUND)', () => {
      onCheckQueue.mockImplementation(() => {
        throw channelError.notFound(
          "no queue 'nonexistent' in vhost '/'",
          50,
          10
        );
      });

      expect(() => channelWithChecks.checkQueue('nonexistent')).toThrow(
        ChannelError
      );
      try {
        channelWithChecks.checkQueue('nonexistent');
      } catch (err) {
        expect((err as ChannelError).replyCode).toBe(NOT_FOUND);
      }
    });

    it('throws on closed channel', () => {
      channelWithChecks.close();
      expect(() => channelWithChecks.checkQueue('my-queue')).toThrow(
        ConnectionError
      );
    });

    it('throws when onCheckQueue dependency is not provided', () => {
      expect(() => channel.checkQueue('my-queue')).toThrow(
        'onCheckQueue dependency not provided'
      );
    });
  });

  // ── confirmSelect ─────────────────────────────────────────────────

  describe('confirmSelect', () => {
    it('enables confirm mode', () => {
      expect(channel.confirmMode).toBe(false);
      channel.confirmSelect();
      expect(channel.confirmMode).toBe(true);
    });

    it('is idempotent — calling again on already-confirmed channel is fine', () => {
      channel.confirmSelect();
      channel.confirmSelect();
      expect(channel.confirmMode).toBe(true);
    });

    it('is irreversible — no way to disable once enabled', () => {
      channel.confirmSelect();
      // There's no disableConfirm method; confirmMode stays true
      expect(channel.confirmMode).toBe(true);
    });

    it('throws PRECONDITION_FAILED if tx mode is active', () => {
      channel.txSelect();
      expect(() => channel.confirmSelect()).toThrow(ChannelError);
      try {
        channel.confirmSelect();
      } catch (err) {
        expect((err as ChannelError).replyCode).toBe(PRECONDITION_FAILED);
      }
    });

    it('throws on closed channel', () => {
      channel.close();
      expect(() => channel.confirmSelect()).toThrow(ConnectionError);
    });
  });

  // ── txSelect ──────────────────────────────────────────────────────

  describe('txSelect', () => {
    it('enables tx mode', () => {
      expect(channel.txMode).toBe(false);
      channel.txSelect();
      expect(channel.txMode).toBe(true);
    });

    it('throws PRECONDITION_FAILED if confirm mode is active', () => {
      channel.confirmSelect();
      expect(() => channel.txSelect()).toThrow(ChannelError);
      try {
        channel.txSelect();
      } catch (err) {
        expect((err as ChannelError).replyCode).toBe(PRECONDITION_FAILED);
      }
    });

    it('throws on closed channel', () => {
      channel.close();
      expect(() => channel.txSelect()).toThrow(ConnectionError);
    });
  });

  // ── Publisher delivery tag sequence ───────────────────────────────

  describe('publisher delivery tag sequence', () => {
    it('starts at 1', () => {
      expect(channel.nextPublisherDeliveryTag()).toBe(1);
    });

    it('increments sequentially', () => {
      expect(channel.nextPublisherDeliveryTag()).toBe(1);
      expect(channel.nextPublisherDeliveryTag()).toBe(2);
      expect(channel.nextPublisherDeliveryTag()).toBe(3);
    });

    it('is independent from consumer delivery tag sequence', () => {
      const consumerTag1 = channel.nextDeliveryTag();
      const publisherTag1 = channel.nextPublisherDeliveryTag();
      const consumerTag2 = channel.nextDeliveryTag();
      const publisherTag2 = channel.nextPublisherDeliveryTag();

      expect(consumerTag1).toBe(1);
      expect(publisherTag1).toBe(1);
      expect(consumerTag2).toBe(2);
      expect(publisherTag2).toBe(2);
    });

    it('is per-channel (independent across channels)', () => {
      const ch2 = new Channel(2, deps);
      expect(channel.nextPublisherDeliveryTag()).toBe(1);
      expect(ch2.nextPublisherDeliveryTag()).toBe(1);
      expect(channel.nextPublisherDeliveryTag()).toBe(2);
      expect(ch2.nextPublisherDeliveryTag()).toBe(2);
    });

    it('throws on closed channel', () => {
      channel.close();
      expect(() => channel.nextPublisherDeliveryTag()).toThrow(ConnectionError);
    });
  });
});
