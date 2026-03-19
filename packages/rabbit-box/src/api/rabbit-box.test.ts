import { describe, expect, it, vi } from 'vitest';
import { RabbitBox } from './rabbit-box.ts';
import type { ApiConnection } from './connection.ts';
import type { ApiChannel } from './channel.ts';
import type { DeliveredMessage } from '../types/message.ts';
import { ChannelError } from '../errors/amqp-error.ts';

describe('RabbitBox', () => {
  describe('create', () => {
    it('returns a connection', () => {
      const conn = RabbitBox.create();
      expect(conn).toBeDefined();
    });

    it('accepts empty options', () => {
      const conn = RabbitBox.create({});
      expect(conn).toBeDefined();
    });
  });
});

describe('ApiConnection', () => {
  let conn: ApiConnection;

  it('createChannel returns a channel', async () => {
    conn = RabbitBox.create();
    const ch = await conn.createChannel();
    expect(ch).toBeDefined();
  });

  it('close resolves without error', async () => {
    conn = RabbitBox.create();
    await expect(conn.close()).resolves.toBeUndefined();
  });

  it('close is idempotent', async () => {
    conn = RabbitBox.create();
    await conn.close();
    await expect(conn.close()).resolves.toBeUndefined();
  });

  it('createChannel after close rejects', async () => {
    conn = RabbitBox.create();
    await conn.close();
    await expect(conn.createChannel()).rejects.toThrow();
  });

  it('emits close event on close', async () => {
    conn = RabbitBox.create();
    const closeFn = vi.fn();
    conn.on('close', closeFn);
    await conn.close();
    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('emits close event only once for multiple close calls', async () => {
    conn = RabbitBox.create();
    const closeFn = vi.fn();
    conn.on('close', closeFn);
    await conn.close();
    await conn.close();
    expect(closeFn).toHaveBeenCalledOnce();
  });
});

describe('ApiChannel', () => {
  let conn: ApiConnection;
  let ch: ApiChannel;

  async function setup(): Promise<void> {
    conn = RabbitBox.create();
    ch = await conn.createChannel();
  }

  describe('topology — exchanges', () => {
    it('assertExchange creates an exchange', async () => {
      await setup();
      const result = await ch.assertExchange('test-ex', 'direct');
      expect(result).toEqual({ exchange: 'test-ex' });
    });

    it('assertExchange is idempotent for equivalent params', async () => {
      await setup();
      await ch.assertExchange('test-ex', 'fanout');
      const result = await ch.assertExchange('test-ex', 'fanout');
      expect(result).toEqual({ exchange: 'test-ex' });
    });

    it('assertExchange rejects on type mismatch', async () => {
      await setup();
      await ch.assertExchange('test-ex', 'direct');
      await expect(ch.assertExchange('test-ex', 'fanout')).rejects.toThrow(
        ChannelError
      );
    });

    it('checkExchange succeeds for existing exchange', async () => {
      await setup();
      await ch.assertExchange('test-ex', 'topic');
      await expect(ch.checkExchange('test-ex')).resolves.toBeUndefined();
    });

    it('checkExchange rejects for missing exchange', async () => {
      await setup();
      await expect(ch.checkExchange('nonexistent')).rejects.toThrow(
        ChannelError
      );
    });

    it('checkExchange succeeds for pre-declared exchanges', async () => {
      await setup();
      await expect(ch.checkExchange('amq.direct')).resolves.toBeUndefined();
      await expect(ch.checkExchange('amq.fanout')).resolves.toBeUndefined();
      await expect(ch.checkExchange('amq.topic')).resolves.toBeUndefined();
      await expect(ch.checkExchange('amq.headers')).resolves.toBeUndefined();
    });

    it('deleteExchange removes exchange', async () => {
      await setup();
      await ch.assertExchange('test-ex', 'direct');
      await ch.deleteExchange('test-ex');
      await expect(ch.checkExchange('test-ex')).rejects.toThrow(ChannelError);
    });

    it('deleteExchange is silent for non-existent exchange', async () => {
      await setup();
      await expect(ch.deleteExchange('nonexistent')).resolves.toBeUndefined();
    });

    it('deleteExchange rejects for pre-declared exchange', async () => {
      await setup();
      await expect(ch.deleteExchange('amq.direct')).rejects.toThrow(
        ChannelError
      );
    });
  });

  describe('topology — queues', () => {
    it('assertQueue creates a queue', async () => {
      await setup();
      const result = await ch.assertQueue('test-q');
      expect(result).toEqual({
        queue: 'test-q',
        messageCount: 0,
        consumerCount: 0,
      });
    });

    it('assertQueue with empty name generates a name', async () => {
      await setup();
      const result = await ch.assertQueue('');
      expect(result.queue).toBeTruthy();
      expect(result.queue).toMatch(/^amq\.gen-/);
    });

    it('assertQueue is idempotent for equivalent params', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const result = await ch.assertQueue('test-q');
      expect(result.queue).toBe('test-q');
    });

    it('assertQueue rejects on durable mismatch', async () => {
      await setup();
      await ch.assertQueue('test-q', { durable: true });
      await expect(
        ch.assertQueue('test-q', { durable: false })
      ).rejects.toThrow(ChannelError);
    });

    it('checkQueue succeeds for existing queue', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const result = await ch.checkQueue('test-q');
      expect(result.queue).toBe('test-q');
    });

    it('checkQueue rejects for missing queue', async () => {
      await setup();
      await expect(ch.checkQueue('nonexistent')).rejects.toThrow(ChannelError);
    });

    it('deleteQueue removes queue', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const result = await ch.deleteQueue('test-q');
      expect(result).toEqual({ messageCount: 0 });
      await expect(ch.checkQueue('test-q')).rejects.toThrow(ChannelError);
    });

    it('purgeQueue removes all messages', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const result = await ch.purgeQueue('test-q');
      expect(result).toEqual({ messageCount: 0 });
    });
  });

  describe('topology — bindings', () => {
    it('bindQueue and unbindQueue work', async () => {
      await setup();
      await ch.assertExchange('test-ex', 'direct');
      await ch.assertQueue('test-q');
      await expect(
        ch.bindQueue('test-q', 'test-ex', 'rk')
      ).resolves.toBeUndefined();
      await expect(
        ch.unbindQueue('test-q', 'test-ex', 'rk')
      ).resolves.toBeUndefined();
    });

    it('bindQueue rejects for non-existent exchange', async () => {
      await setup();
      await ch.assertQueue('test-q');
      await expect(ch.bindQueue('test-q', 'nonexistent', 'rk')).rejects.toThrow(
        ChannelError
      );
    });

    it('bindQueue rejects for non-existent queue', async () => {
      await setup();
      await ch.assertExchange('test-ex', 'direct');
      await expect(
        ch.bindQueue('nonexistent', 'test-ex', 'rk')
      ).rejects.toThrow(ChannelError);
    });
  });

  describe('publishing', () => {
    it('publish to default exchange returns true when queue exists', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const ok = ch.publish('', 'test-q', new Uint8Array([1, 2, 3]));
      expect(ok).toBe(true);
    });

    it('sendToQueue is shorthand for publish to default exchange', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const ok = ch.sendToQueue('test-q', new Uint8Array([1, 2, 3]));
      expect(ok).toBe(true);
    });

    it('publish to non-existent exchange throws', async () => {
      await setup();
      expect(() =>
        ch.publish('nonexistent', 'rk', new Uint8Array([1]))
      ).toThrow(ChannelError);
    });

    it('publish with mandatory emits return for unroutable message', async () => {
      await setup();
      await ch.assertExchange('test-ex', 'direct');
      const returnFn = vi.fn();
      ch.on('return', returnFn);
      ch.publish('test-ex', 'no-binding', new Uint8Array([1]), {
        mandatory: true,
      });
      // return is emitted synchronously in our in-memory impl
      expect(returnFn).toHaveBeenCalledOnce();
      const returned = returnFn.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(returned).toMatchObject({
        replyCode: 312,
        replyText: 'NO_ROUTE',
        exchange: 'test-ex',
        routingKey: 'no-binding',
      });
    });
  });

  describe('consuming', () => {
    it('consume returns a consumerTag', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const result = await ch.consume('test-q', () => {
        /* noop */
      });
      expect(result.consumerTag).toBeTruthy();
    });

    it('consume delivers messages', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const msgs: unknown[] = [];
      await ch.consume('test-q', (msg) => msgs.push(msg), { noAck: true });
      ch.sendToQueue('test-q', new Uint8Array([42]));

      // dispatcher uses queueMicrotask, wait for it
      await new Promise((r) => setTimeout(r, 10));
      expect(msgs).toHaveLength(1);
    });

    it('cancel stops delivery', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const msgs: unknown[] = [];
      const { consumerTag } = await ch.consume(
        'test-q',
        (msg) => msgs.push(msg),
        { noAck: true }
      );
      await ch.cancel(consumerTag);
      ch.sendToQueue('test-q', new Uint8Array([42]));
      await new Promise((r) => setTimeout(r, 10));
      expect(msgs).toHaveLength(0);
    });
  });

  describe('ack / nack / reject', () => {
    it('ack removes message from unacked', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const msgs: DeliveredMessage[] = [];
      await ch.consume('test-q', (msg) => msgs.push(msg));
      ch.sendToQueue('test-q', new Uint8Array([1]));
      await new Promise((r) => setTimeout(r, 10));
      expect(msgs).toHaveLength(1);
      // ack should not throw
      const msg = msgs[0];
      expect(msg).toBeDefined();
      ch.ack(msg as DeliveredMessage);
    });

    it('nack with requeue re-delivers', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const msgs: DeliveredMessage[] = [];
      await ch.consume('test-q', (msg) => {
        msgs.push(msg);
        if (!msg.redelivered) {
          ch.nack(msg, false, true);
        } else {
          ch.ack(msg);
        }
      });
      ch.sendToQueue('test-q', new Uint8Array([1]));
      await new Promise((r) => setTimeout(r, 50));
      expect(msgs.length).toBeGreaterThanOrEqual(2);
      expect((msgs[1] as DeliveredMessage).redelivered).toBe(true);
    });

    it('reject without requeue discards message', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const msgs: DeliveredMessage[] = [];
      await ch.consume('test-q', (msg) => {
        msgs.push(msg);
        ch.reject(msg, false);
      });
      ch.sendToQueue('test-q', new Uint8Array([1]));
      await new Promise((r) => setTimeout(r, 50));
      expect(msgs).toHaveLength(1);
    });
  });

  describe('get (polling)', () => {
    it('get returns false for empty queue', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const result = await ch.get('test-q');
      expect(result).toBe(false);
    });

    it('get returns message when available', async () => {
      await setup();
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([99]));
      const result = await ch.get('test-q', { noAck: true });
      expect(result).not.toBe(false);
      if (result !== false) {
        expect(result.body).toEqual(new Uint8Array([99]));
      }
    });
  });

  describe('prefetch', () => {
    it('prefetch sets per-consumer limit', async () => {
      await setup();
      await expect(ch.prefetch(10)).resolves.toBeUndefined();
    });

    it('prefetch with global sets per-channel limit', async () => {
      await setup();
      await expect(ch.prefetch(5, true)).resolves.toBeUndefined();
    });
  });

  describe('recover', () => {
    it('recover requeues unacked messages', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const msgs: DeliveredMessage[] = [];
      let recovered = false;
      await ch.consume('test-q', (msg) => {
        msgs.push(msg);
        if (!recovered) {
          recovered = true;
          ch.recover();
        } else {
          ch.ack(msg);
        }
      });
      ch.sendToQueue('test-q', new Uint8Array([1]));
      await new Promise((r) => setTimeout(r, 50));
      expect(msgs.length).toBeGreaterThanOrEqual(2);
      expect((msgs[1] as DeliveredMessage).redelivered).toBe(true);
    });
  });

  describe('flow', () => {
    it('flow returns active state', async () => {
      await setup();
      const result = await ch.flow(false);
      expect(result).toEqual({ active: false });
    });

    it('flow(false) pauses delivery', async () => {
      await setup();
      await ch.assertQueue('test-q');
      const msgs: unknown[] = [];
      await ch.consume('test-q', (msg) => msgs.push(msg), { noAck: true });
      await ch.flow(false);
      ch.sendToQueue('test-q', new Uint8Array([1]));
      await new Promise((r) => setTimeout(r, 20));
      expect(msgs).toHaveLength(0);

      // Resume flow
      await ch.flow(true);
      // Trigger dispatch after resuming
      await new Promise((r) => setTimeout(r, 20));
      // Message should eventually be delivered after flow resumes
    });
  });

  describe('close', () => {
    it('close resolves without error', async () => {
      await setup();
      await expect(ch.close()).resolves.toBeUndefined();
    });

    it('close is idempotent', async () => {
      await setup();
      await ch.close();
      await expect(ch.close()).resolves.toBeUndefined();
    });

    it('emits close event', async () => {
      await setup();
      const closeFn = vi.fn();
      ch.on('close', closeFn);
      await ch.close();
      expect(closeFn).toHaveBeenCalledOnce();
    });

    it('operations after close reject', async () => {
      await setup();
      await ch.close();
      await expect(ch.assertQueue('test-q')).rejects.toThrow();
    });
  });
});
