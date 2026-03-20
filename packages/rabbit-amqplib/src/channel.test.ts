import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connect, AmqplibConnection } from './connection.ts';
import { AmqplibChannel } from './channel.ts';
import type { AmqplibMessage } from './types.ts';

let conn: AmqplibConnection;
let ch: AmqplibChannel;

describe('AmqplibChannel', () => {
  beforeEach(async () => {
    conn = await connect('amqp://localhost');
    ch = await conn.createChannel();
  });

  afterEach(async () => {
    await ch.close();
    await conn.close();
  });

  // ── Topology ──────────────────────────────────────────────────────

  describe('exchanges', () => {
    it('assertExchange creates an exchange', async () => {
      const result = await ch.assertExchange('test-ex', 'direct');
      expect(result).toEqual({ exchange: 'test-ex' });
    });

    it('deleteExchange removes an exchange', async () => {
      await ch.assertExchange('test-ex', 'direct');
      await expect(ch.deleteExchange('test-ex')).resolves.toBeUndefined();
    });

    it('checkExchange verifies an exchange exists', async () => {
      await ch.assertExchange('test-ex', 'direct');
      await expect(ch.checkExchange('test-ex')).resolves.toBeUndefined();
    });
  });

  describe('queues', () => {
    it('assertQueue creates a queue', async () => {
      const result = await ch.assertQueue('test-q');
      expect(result).toEqual({
        queue: 'test-q',
        messageCount: 0,
        consumerCount: 0,
      });
    });

    it('assertQueue with empty name creates server-named queue', async () => {
      const result = await ch.assertQueue('');
      expect(result.queue).toMatch(/^amq\.gen-/);
    });

    it('assertQueue with no name argument creates server-named queue', async () => {
      const result = await ch.assertQueue();
      expect(result.queue).toMatch(/^amq\.gen-/);
    });

    it('deleteQueue removes a queue', async () => {
      await ch.assertQueue('test-q');
      const result = await ch.deleteQueue('test-q');
      expect(result).toEqual({ messageCount: 0 });
    });

    it('checkQueue verifies a queue exists', async () => {
      await ch.assertQueue('test-q');
      const result = await ch.checkQueue('test-q');
      expect(result.queue).toBe('test-q');
    });

    it('purgeQueue removes all messages', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]));
      const result = await ch.purgeQueue('test-q');
      expect(result.messageCount).toBe(1);
    });
  });

  describe('bindings', () => {
    it('bindQueue and unbindQueue', async () => {
      await ch.assertExchange('test-ex', 'direct');
      await ch.assertQueue('test-q');
      await expect(
        ch.bindQueue('test-q', 'test-ex', 'key')
      ).resolves.toBeUndefined();
      await expect(
        ch.unbindQueue('test-q', 'test-ex', 'key')
      ).resolves.toBeUndefined();
    });

    it('bindExchange and unbindExchange', async () => {
      await ch.assertExchange('src-ex', 'direct');
      await ch.assertExchange('dst-ex', 'direct');
      await expect(
        ch.bindExchange('dst-ex', 'src-ex', 'key')
      ).resolves.toBeUndefined();
      await expect(
        ch.unbindExchange('dst-ex', 'src-ex', 'key')
      ).resolves.toBeUndefined();
    });
  });

  // ── Publishing & Consuming ────────────────────────────────────────

  describe('publish and consume', () => {
    it('publish returns true', async () => {
      await ch.assertExchange('test-ex', 'direct');
      const ok = ch.publish('test-ex', 'key', new Uint8Array([1, 2, 3]));
      expect(ok).toBe(true);
    });

    it('sendToQueue delivers a message', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1, 2, 3]));
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(msg.content).toEqual(new Uint8Array([1, 2, 3]));
      }
    });

    it('consume delivers messages in amqplib format', async () => {
      await ch.assertQueue('test-q');
      const messages: AmqplibMessage[] = [];
      await ch.consume(
        'test-q',
        (msg) => {
          if (msg) messages.push(msg);
        },
        { noAck: true }
      );
      ch.sendToQueue('test-q', new Uint8Array([42]));
      // Allow microtask to process
      await new Promise((r) => setTimeout(r, 50));
      expect(messages).toHaveLength(1);
      const msg = messages[0];
      expect(msg).toBeDefined();
      expect(msg?.content).toEqual(new Uint8Array([42]));
      expect(msg?.fields.exchange).toBe('');
      expect(msg?.fields.routingKey).toBe('test-q');
      expect(msg?.fields.consumerTag).toBeTruthy();
    });

    it('consume callback receives null on server cancel', async () => {
      await ch.assertQueue('test-q', { autoDelete: true });
      const received: (AmqplibMessage | null)[] = [];
      await ch.consume('test-q', (msg) => {
        received.push(msg);
      });
      // Delete the queue to trigger server-cancel
      await ch.deleteQueue('test-q');
      await new Promise((r) => setTimeout(r, 50));
      expect(received).toContain(null);
    });

    it('cancel stops consuming', async () => {
      await ch.assertQueue('test-q');
      const messages: AmqplibMessage[] = [];
      const { consumerTag } = await ch.consume(
        'test-q',
        (msg) => {
          if (msg) messages.push(msg);
        },
        { noAck: true }
      );
      await ch.cancel(consumerTag);
      ch.sendToQueue('test-q', new Uint8Array([1]));
      await new Promise((r) => setTimeout(r, 50));
      expect(messages).toHaveLength(0);
    });
  });

  // ── Message format ────────────────────────────────────────────────

  describe('message format', () => {
    it('get returns amqplib-format message', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]), {
        contentType: 'application/json',
        correlationId: 'abc',
        headers: { foo: 'bar' },
      });
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(msg.fields).toBeDefined();
        expect(msg.fields.deliveryTag).toBeGreaterThan(0);
        expect(msg.fields.exchange).toBe('');
        expect(msg.fields.routingKey).toBe('test-q');
        expect(msg.properties).toBeDefined();
        expect(msg.properties.contentType).toBe('application/json');
        expect(msg.properties.correlationId).toBe('abc');
        expect(msg.properties.headers).toEqual({ foo: 'bar' });
        expect(msg.content).toEqual(new Uint8Array([1]));
      }
    });

    it('get returns false when queue is empty', async () => {
      await ch.assertQueue('test-q');
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).toBe(false);
    });
  });

  // ── Acknowledgment ────────────────────────────────────────────────

  describe('acknowledgment', () => {
    it('ack acknowledges a message', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]));
      const msg = await ch.get('test-q');
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(() => ch.ack(msg)).not.toThrow();
      }
    });

    it('nack requeues a message by default', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]));
      const msg = await ch.get('test-q');
      expect(msg).not.toBe(false);
      if (msg !== false) {
        ch.nack(msg);
        const redelivered = await ch.get('test-q', { noAck: true });
        expect(redelivered).not.toBe(false);
        if (redelivered !== false) {
          expect(redelivered.fields.redelivered).toBe(true);
        }
      }
    });

    it('reject with requeue=false discards message', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]));
      const msg = await ch.get('test-q');
      expect(msg).not.toBe(false);
      if (msg !== false) {
        ch.reject(msg, false);
        const next = await ch.get('test-q', { noAck: true });
        expect(next).toBe(false);
      }
    });
  });

  // ── QoS ───────────────────────────────────────────────────────────

  describe('prefetch', () => {
    it('sets prefetch count', async () => {
      await expect(ch.prefetch(10)).resolves.toBeUndefined();
    });

    it('sets global prefetch', async () => {
      await expect(ch.prefetch(5, true)).resolves.toBeUndefined();
    });
  });

  // ── Recovery ──────────────────────────────────────────────────────

  describe('recover', () => {
    it('recovers channel', async () => {
      await expect(ch.recover()).resolves.toBeUndefined();
    });
  });

  // ── Events ────────────────────────────────────────────────────────

  describe('events', () => {
    it('emits close event when channel is closed', async () => {
      const onClose = vi.fn();
      ch.on('close', onClose);
      await ch.close();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('close is idempotent', async () => {
      const onClose = vi.fn();
      ch.on('close', onClose);
      await ch.close();
      await ch.close();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('supports return event listener', async () => {
      const onReturn = vi.fn();
      ch.on('return', onReturn);
      expect(ch.listenerCount('return')).toBe(1);
    });

    it('supports drain event listener', async () => {
      const onDrain = vi.fn();
      ch.on('drain', onDrain);
      expect(ch.listenerCount('drain')).toBe(1);
    });

    it('supports error event listener', async () => {
      const onError = vi.fn();
      ch.on('error', onError);
      expect(ch.listenerCount('error')).toBe(1);
    });
  });

  // ── Closed channel ────────────────────────────────────────────────

  describe('closed channel throws', () => {
    it('throws on assertQueue after close', async () => {
      await ch.close();
      await expect(ch.assertQueue('q')).rejects.toThrow('Channel closed');
    });

    it('throws on publish after close', async () => {
      await ch.close();
      expect(() => ch.publish('ex', 'key', new Uint8Array([1]))).toThrow(
        'Channel closed'
      );
    });

    it('throws on consume after close', async () => {
      await ch.close();
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await expect(ch.consume('q', () => {})).rejects.toThrow('Channel closed');
    });

    it('throws on get after close', async () => {
      await ch.close();
      await expect(ch.get('q')).rejects.toThrow('Channel closed');
    });
  });
});

describe('ConfirmChannel', () => {
  beforeEach(async () => {
    conn = await connect('amqp://localhost');
    ch = await conn.createConfirmChannel();
  });

  afterEach(async () => {
    await ch.close();
    await conn.close();
  });

  it('waitForConfirms resolves immediately when no pending', async () => {
    await expect(ch.waitForConfirms()).resolves.toBeUndefined();
  });

  it('receives ack events on publish', async () => {
    await ch.assertQueue('confirm-q');
    const acks: number[] = [];
    ch.inner.on('ack', (e) => acks.push(e.deliveryTag));
    ch.sendToQueue('confirm-q', new Uint8Array([1]));
    expect(acks).toHaveLength(1);
  });
});
