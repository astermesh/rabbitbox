import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Connection, createConnection } from './connection.ts';
import type { ConnectionDeps } from './connection.ts';
import type { BrokerMessage } from './types/message.ts';
import { ConnectionError } from './errors/amqp-error.ts';
import { COMMAND_INVALID } from './errors/reply-codes.ts';

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

describe('Connection', () => {
  type OnRequeueFn = ConnectionDeps['onRequeue'];
  type OnDeleteQueueFn = ConnectionDeps['onDeleteQueue'];

  let onRequeue: ReturnType<typeof vi.fn<OnRequeueFn>>;
  let onDeleteQueue: ReturnType<typeof vi.fn<OnDeleteQueueFn>>;
  let deps: ConnectionDeps;
  let conn: Connection;

  beforeEach(() => {
    onRequeue = vi.fn<OnRequeueFn>();
    onDeleteQueue = vi.fn<OnDeleteQueueFn>();
    deps = { onRequeue, onDeleteQueue };
    conn = new Connection('conn-1', deps);
  });

  // ── Initial state ───────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts in open state', () => {
      expect(conn.getState()).toBe('open');
    });

    it('has the assigned connection id', () => {
      expect(conn.connectionId).toBe('conn-1');
    });

    it('has zero channels', () => {
      expect(conn.channelCount).toBe(0);
    });
  });

  // ── createChannel ───────────────────────────────────────────────────

  describe('createChannel', () => {
    it('creates a channel with sequential numbers starting at 1', () => {
      const ch1 = conn.createChannel();
      const ch2 = conn.createChannel();
      expect(ch1.channelNumber).toBe(1);
      expect(ch2.channelNumber).toBe(2);
    });

    it('adds channel to the connection', () => {
      const ch = conn.createChannel();
      expect(conn.channelCount).toBe(1);
      expect(conn.getChannel(ch.channelNumber)).toBe(ch);
    });

    it('exposes channels via read-only map', () => {
      conn.createChannel();
      conn.createChannel();
      expect(conn.channels.size).toBe(2);
    });

    it('throws ConnectionError on closed connection', () => {
      conn.close();
      expect(() => conn.createChannel()).toThrow(ConnectionError);
    });

    it('error includes COMMAND_INVALID reply code', () => {
      conn.close();
      try {
        conn.createChannel();
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectionError);
        expect((err as ConnectionError).replyCode).toBe(COMMAND_INVALID);
      }
    });
  });

  // ── Channel error isolation ─────────────────────────────────────────

  describe('channel error isolation', () => {
    it('closing one channel does not affect siblings', () => {
      const ch1 = conn.createChannel();
      const ch2 = conn.createChannel();
      ch1.close();

      expect(ch1.getState()).toBe('closed');
      expect(ch2.getState()).toBe('open');
      expect(conn.getState()).toBe('open');
    });

    it('closed channel is removed from connection', () => {
      const ch = conn.createChannel();
      const num = ch.channelNumber;

      ch.close();

      expect(conn.getChannel(num)).toBeUndefined();
      expect(conn.channelCount).toBe(0);
    });

    it('connection stays open after all channels close individually', () => {
      const ch1 = conn.createChannel();
      const ch2 = conn.createChannel();
      ch1.close();
      ch2.close();

      expect(conn.getState()).toBe('open');
      expect(conn.channelCount).toBe(0);
    });
  });

  // ── Delivery tag independence ───────────────────────────────────────

  describe('delivery tag independence', () => {
    it('each channel has its own delivery tag sequence', () => {
      const ch1 = conn.createChannel();
      const ch2 = conn.createChannel();

      expect(ch1.nextDeliveryTag()).toBe(1);
      expect(ch1.nextDeliveryTag()).toBe(2);
      expect(ch2.nextDeliveryTag()).toBe(1);
      expect(ch1.nextDeliveryTag()).toBe(3);
      expect(ch2.nextDeliveryTag()).toBe(2);
    });
  });

  // ── Exclusive queue tracking ────────────────────────────────────────

  describe('exclusive queue tracking', () => {
    it('deletes exclusive queues on close', () => {
      conn.registerExclusiveQueue('q1');
      conn.registerExclusiveQueue('q2');

      conn.close();

      expect(onDeleteQueue).toHaveBeenCalledWith('q1', 'conn-1');
      expect(onDeleteQueue).toHaveBeenCalledWith('q2', 'conn-1');
    });

    it('does not delete unregistered queues', () => {
      conn.registerExclusiveQueue('q1');
      conn.unregisterExclusiveQueue('q1');

      conn.close();

      expect(onDeleteQueue).not.toHaveBeenCalled();
    });

    it('ignores errors when deleting exclusive queues', () => {
      onDeleteQueue.mockImplementation(() => {
        throw new Error('queue already gone');
      });
      conn.registerExclusiveQueue('q1');

      expect(() => conn.close()).not.toThrow();
    });
  });

  // ── Connection close ────────────────────────────────────────────────

  describe('close', () => {
    it('transitions to closed state', () => {
      conn.close();
      expect(conn.getState()).toBe('closed');
    });

    it('closes all channels', () => {
      const ch1 = conn.createChannel();
      const ch2 = conn.createChannel();

      conn.close();

      expect(ch1.getState()).toBe('closed');
      expect(ch2.getState()).toBe('closed');
    });

    it('clears channels map after close', () => {
      conn.createChannel();
      conn.createChannel();

      conn.close();

      expect(conn.channelCount).toBe(0);
    });

    it('requeues unacked messages from all channels', () => {
      const ch1 = conn.createChannel();
      const ch2 = conn.createChannel();
      const msg1 = makeMessage('msg1');
      const msg2 = makeMessage('msg2');
      const msg3 = makeMessage('msg3');

      ch1.trackUnacked(1, msg1, 'q1', 'ctag-1');
      ch1.trackUnacked(2, msg2, 'q1', 'ctag-1');
      ch2.trackUnacked(1, msg3, 'q2', 'ctag-2');

      conn.close();

      expect(onRequeue).toHaveBeenCalledTimes(3);
      expect(onRequeue).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ deliveryCount: 1 })
      );
      expect(onRequeue).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ deliveryCount: 1 })
      );
      expect(onRequeue).toHaveBeenCalledWith(
        'q2',
        expect.objectContaining({ deliveryCount: 1 })
      );
    });

    it('closes channels before deleting exclusive queues', () => {
      const order: string[] = [];
      onRequeue.mockImplementation(() => order.push('requeue'));
      onDeleteQueue.mockImplementation(() => order.push('delete-queue'));

      const ch = conn.createChannel();
      ch.trackUnacked(1, makeMessage(), 'q1', 'ctag-1');
      conn.registerExclusiveQueue('excl-q');

      conn.close();

      expect(order[0]).toBe('requeue');
      expect(order[1]).toBe('delete-queue');
    });

    it('is idempotent — second close is a no-op', () => {
      conn.registerExclusiveQueue('q1');
      conn.createChannel();

      conn.close();
      conn.close();

      expect(onDeleteQueue).toHaveBeenCalledTimes(1);
    });

    it('operations throw after close', () => {
      conn.close();
      expect(() => conn.assertOpen()).toThrow(ConnectionError);
      expect(() => conn.createChannel()).toThrow(ConnectionError);
    });
  });

  // ── createConnection factory ────────────────────────────────────────

  describe('createConnection factory', () => {
    it('creates a connection instance', () => {
      const c = createConnection('test-conn', deps);
      expect(c).toBeInstanceOf(Connection);
      expect(c.connectionId).toBe('test-conn');
      expect(c.getState()).toBe('open');
    });
  });

  // ── Error propagation semantics ─────────────────────────────────────

  describe('error propagation', () => {
    it('channel error: channel closed, connection stays open', () => {
      const ch1 = conn.createChannel();
      const ch2 = conn.createChannel();

      // Simulate a channel error by closing the channel
      ch1.close();

      expect(ch1.getState()).toBe('closed');
      expect(ch2.getState()).toBe('open');
      expect(conn.getState()).toBe('open');
    });

    it('connection error: connection and all channels closed', () => {
      const ch1 = conn.createChannel();
      const ch2 = conn.createChannel();

      // Connection error → close the connection
      conn.close();

      expect(conn.getState()).toBe('closed');
      expect(ch1.getState()).toBe('closed');
      expect(ch2.getState()).toBe('closed');
    });
  });
});
