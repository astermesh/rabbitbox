import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Channel } from './channel.ts';
import type { ChannelDeps } from './channel.ts';
import type { BrokerMessage } from './types/message.ts';
import { ChannelError } from './errors/amqp-error.ts';
import { PRECONDITION_FAILED } from './errors/reply-codes.ts';
import { ack, nack, reject, ackAll, nackAll } from './acknowledgment.ts';
import type { AcknowledgmentDeps } from './acknowledgment.ts';

function firstRequeuedMessage(
  mock: ReturnType<typeof vi.fn<AcknowledgmentDeps['onRequeue']>>
): BrokerMessage {
  const first = mock.mock.calls[0];
  if (first === undefined) throw new Error('onRequeue was never called');
  return first[1] as BrokerMessage;
}

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

describe('acknowledgment', () => {
  let channelOnRequeue: ReturnType<typeof vi.fn<ChannelDeps['onRequeue']>>;
  let channelOnClose: ReturnType<typeof vi.fn<ChannelDeps['onClose']>>;
  let channel: Channel;
  let onRequeue: ReturnType<typeof vi.fn<AcknowledgmentDeps['onRequeue']>>;
  let onDispatch: ReturnType<typeof vi.fn<AcknowledgmentDeps['onDispatch']>>;
  let deps: AcknowledgmentDeps;

  beforeEach(() => {
    channelOnRequeue = vi.fn<ChannelDeps['onRequeue']>();
    channelOnClose = vi.fn<ChannelDeps['onClose']>();
    channel = new Channel(1, {
      onRequeue: channelOnRequeue,
      onClose: channelOnClose,
    });
    onRequeue = vi.fn<AcknowledgmentDeps['onRequeue']>();
    onDispatch = vi.fn<AcknowledgmentDeps['onDispatch']>();
    deps = { onRequeue, onDispatch };
  });

  // ── ack ─────────────────────────────────────────────────────────────

  describe('ack', () => {
    it('acks a single delivery tag', () => {
      const msg = makeMessage();
      channel.trackUnacked(1, msg, 'q1');

      ack(channel, 1, false, deps);

      expect(channel.unackedCount).toBe(0);
    });

    it('triggers dispatch for the acked queue', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');

      ack(channel, 1, false, deps);

      expect(onDispatch).toHaveBeenCalledWith('q1');
    });

    it('throws PRECONDITION_FAILED for unknown delivery tag', () => {
      try {
        ack(channel, 999, false, deps);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(PRECONDITION_FAILED);
      }
    });

    it('throws PRECONDITION_FAILED for already-acked delivery tag', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');
      ack(channel, 1, false, deps);

      try {
        ack(channel, 1, false, deps);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(PRECONDITION_FAILED);
      }
    });

    it('acks multiple tags with multiple=true', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q1');
      channel.trackUnacked(3, makeMessage('c'), 'q1');
      channel.trackUnacked(4, makeMessage('d'), 'q1');

      ack(channel, 3, true, deps);

      expect(channel.unackedCount).toBe(1);
      expect(channel.getUnacked(4)).toBeDefined();
      expect(channel.getUnacked(1)).toBeUndefined();
      expect(channel.getUnacked(2)).toBeUndefined();
      expect(channel.getUnacked(3)).toBeUndefined();
    });

    it('triggers dispatch for all affected queues with multiple=true', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q2');
      channel.trackUnacked(3, makeMessage('c'), 'q1');

      ack(channel, 3, true, deps);

      expect(onDispatch).toHaveBeenCalledWith('q1');
      expect(onDispatch).toHaveBeenCalledWith('q2');
    });

    it('dispatches each queue only once with multiple=true', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q1');
      channel.trackUnacked(3, makeMessage('c'), 'q1');

      ack(channel, 3, true, deps);

      expect(onDispatch).toHaveBeenCalledTimes(1);
      expect(onDispatch).toHaveBeenCalledWith('q1');
    });

    it('multiple=true with no matching tags throws PRECONDITION_FAILED', () => {
      channel.trackUnacked(5, makeMessage(), 'q1');

      try {
        ack(channel, 3, true, deps);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(PRECONDITION_FAILED);
      }
    });

    it('does not call onRequeue', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');
      ack(channel, 1, false, deps);
      expect(onRequeue).not.toHaveBeenCalled();
    });
  });

  // ── nack ────────────────────────────────────────────────────────────

  describe('nack', () => {
    it('nacks a single delivery tag with requeue=true', () => {
      const msg = makeMessage();
      channel.trackUnacked(1, msg, 'q1');

      nack(channel, 1, false, true, deps);

      expect(channel.unackedCount).toBe(0);
      expect(onRequeue).toHaveBeenCalledTimes(1);
    });

    it('requeued message has incremented deliveryCount', () => {
      const msg = makeMessage();
      channel.trackUnacked(1, msg, 'q1');

      nack(channel, 1, false, true, deps);

      const requeuedMsg = firstRequeuedMessage(onRequeue);
      expect(requeuedMsg.deliveryCount).toBe(1);
    });

    it('requeues to the original queue', () => {
      channel.trackUnacked(1, makeMessage(), 'orders');

      nack(channel, 1, false, true, deps);

      expect(onRequeue).toHaveBeenCalledWith('orders', expect.anything());
    });

    it('nack with requeue=false discards the message', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');

      nack(channel, 1, false, false, deps);

      expect(channel.unackedCount).toBe(0);
      expect(onRequeue).not.toHaveBeenCalled();
    });

    it('triggers dispatch after nack with requeue=true', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');

      nack(channel, 1, false, true, deps);

      expect(onDispatch).toHaveBeenCalledWith('q1');
    });

    it('triggers dispatch after nack with requeue=false (frees prefetch)', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');

      nack(channel, 1, false, false, deps);

      expect(onDispatch).toHaveBeenCalledWith('q1');
    });

    it('nacks multiple tags with multiple=true and requeue=true', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q2');
      channel.trackUnacked(3, makeMessage('c'), 'q1');

      nack(channel, 3, true, true, deps);

      expect(channel.unackedCount).toBe(0);
      expect(onRequeue).toHaveBeenCalledTimes(3);
    });

    it('nacks multiple tags with multiple=true and requeue=false', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q1');
      channel.trackUnacked(3, makeMessage('c'), 'q1');

      nack(channel, 3, true, false, deps);

      expect(channel.unackedCount).toBe(0);
      expect(onRequeue).not.toHaveBeenCalled();
    });

    it('throws PRECONDITION_FAILED for unknown delivery tag', () => {
      try {
        nack(channel, 999, false, true, deps);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(PRECONDITION_FAILED);
      }
    });

    it('throws PRECONDITION_FAILED for already-nacked delivery tag', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');
      nack(channel, 1, false, true, deps);

      try {
        nack(channel, 1, false, true, deps);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(PRECONDITION_FAILED);
      }
    });

    it('multiple=true with no matching tags throws PRECONDITION_FAILED', () => {
      channel.trackUnacked(5, makeMessage(), 'q1');

      try {
        nack(channel, 3, true, true, deps);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(PRECONDITION_FAILED);
      }
    });

    it('preserves all message fields except deliveryCount on requeue', () => {
      const msg: BrokerMessage = {
        body: new TextEncoder().encode('hello'),
        properties: { contentType: 'text/plain', messageId: 'msg-1' },
        exchange: 'ex1',
        routingKey: 'rk1',
        mandatory: true,
        immediate: false,
        deliveryCount: 2,
        enqueuedAt: 1000,
        priority: 5,
      };
      channel.trackUnacked(1, msg, 'q1');

      nack(channel, 1, false, true, deps);

      const requeued = firstRequeuedMessage(onRequeue);
      expect(requeued.body).toBe(msg.body);
      expect(requeued.properties).toBe(msg.properties);
      expect(requeued.exchange).toBe('ex1');
      expect(requeued.routingKey).toBe('rk1');
      expect(requeued.mandatory).toBe(true);
      expect(requeued.priority).toBe(5);
      expect(requeued.deliveryCount).toBe(3);
    });
  });

  // ── reject ──────────────────────────────────────────────────────────

  describe('reject', () => {
    it('rejects a single delivery tag with requeue=true', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');

      reject(channel, 1, true, deps);

      expect(channel.unackedCount).toBe(0);
      expect(onRequeue).toHaveBeenCalledTimes(1);
    });

    it('rejects with requeue=false discards the message', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');

      reject(channel, 1, false, deps);

      expect(channel.unackedCount).toBe(0);
      expect(onRequeue).not.toHaveBeenCalled();
    });

    it('requeued message has incremented deliveryCount', () => {
      const msg = makeMessage();
      channel.trackUnacked(1, msg, 'q1');

      reject(channel, 1, true, deps);

      const requeued = firstRequeuedMessage(onRequeue);
      expect(requeued.deliveryCount).toBe(1);
    });

    it('throws PRECONDITION_FAILED for unknown delivery tag', () => {
      try {
        reject(channel, 999, true, deps);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(PRECONDITION_FAILED);
      }
    });

    it('throws PRECONDITION_FAILED for already-rejected delivery tag', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');
      reject(channel, 1, false, deps);

      try {
        reject(channel, 1, false, deps);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(PRECONDITION_FAILED);
      }
    });

    it('triggers dispatch after reject', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');

      reject(channel, 1, true, deps);

      expect(onDispatch).toHaveBeenCalledWith('q1');
    });
  });

  // ── ackAll ──────────────────────────────────────────────────────────

  describe('ackAll', () => {
    it('acks all outstanding messages on the channel', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q2');
      channel.trackUnacked(3, makeMessage('c'), 'q1');

      ackAll(channel, deps);

      expect(channel.unackedCount).toBe(0);
    });

    it('triggers dispatch for all affected queues', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q2');

      ackAll(channel, deps);

      expect(onDispatch).toHaveBeenCalledWith('q1');
      expect(onDispatch).toHaveBeenCalledWith('q2');
    });

    it('is a no-op when no unacked messages', () => {
      ackAll(channel, deps);

      expect(onDispatch).not.toHaveBeenCalled();
      expect(onRequeue).not.toHaveBeenCalled();
    });

    it('does not requeue any messages', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');
      ackAll(channel, deps);
      expect(onRequeue).not.toHaveBeenCalled();
    });
  });

  // ── nackAll ─────────────────────────────────────────────────────────

  describe('nackAll', () => {
    it('nacks all outstanding messages with requeue=true', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q2');

      nackAll(channel, true, deps);

      expect(channel.unackedCount).toBe(0);
      expect(onRequeue).toHaveBeenCalledTimes(2);
    });

    it('nacks all outstanding messages with requeue=false', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q2');

      nackAll(channel, false, deps);

      expect(channel.unackedCount).toBe(0);
      expect(onRequeue).not.toHaveBeenCalled();
    });

    it('requeued messages have incremented deliveryCount', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');

      nackAll(channel, true, deps);

      const requeued = firstRequeuedMessage(onRequeue);
      expect(requeued.deliveryCount).toBe(1);
    });

    it('triggers dispatch for all affected queues', () => {
      channel.trackUnacked(1, makeMessage('a'), 'q1');
      channel.trackUnacked(2, makeMessage('b'), 'q2');

      nackAll(channel, true, deps);

      expect(onDispatch).toHaveBeenCalledWith('q1');
      expect(onDispatch).toHaveBeenCalledWith('q2');
    });

    it('is a no-op when no unacked messages', () => {
      nackAll(channel, true, deps);

      expect(onDispatch).not.toHaveBeenCalled();
      expect(onRequeue).not.toHaveBeenCalled();
    });

    it('defaults requeue to true', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');

      nackAll(channel, undefined as unknown as boolean, deps);

      expect(onRequeue).toHaveBeenCalledTimes(1);
    });
  });

  // ── Cross-channel error ─────────────────────────────────────────────

  describe('cross-channel validation', () => {
    it('ack on closed channel throws', () => {
      channel.trackUnacked(1, makeMessage(), 'q1');
      channel.close();

      expect(() => ack(channel, 1, false, deps)).toThrow();
    });
  });
});
