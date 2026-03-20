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

    it('assertExchange with durable option', async () => {
      const result = await ch.assertExchange('test-ex', 'direct', {
        durable: true,
      });
      expect(result).toEqual({ exchange: 'test-ex' });
    });

    it('assertExchange with autoDelete option', async () => {
      const result = await ch.assertExchange('test-ex', 'fanout', {
        autoDelete: true,
      });
      expect(result).toEqual({ exchange: 'test-ex' });
    });

    it('assertExchange with internal option', async () => {
      const result = await ch.assertExchange('test-ex', 'direct', {
        internal: true,
      });
      expect(result).toEqual({ exchange: 'test-ex' });
    });

    it('assertExchange with arguments option', async () => {
      const result = await ch.assertExchange('test-ex', 'headers', {
        arguments: { 'x-custom': 'value' },
      });
      expect(result).toEqual({ exchange: 'test-ex' });
    });

    it('assertExchange with all options', async () => {
      const result = await ch.assertExchange('test-ex', 'topic', {
        durable: false,
        autoDelete: true,
        internal: false,
        arguments: { 'x-custom': 123 },
      });
      expect(result).toEqual({ exchange: 'test-ex' });
    });

    it('assertExchange supports all exchange types', async () => {
      const types = ['direct', 'fanout', 'topic', 'headers'] as const;
      for (const type of types) {
        const name = `ex-${type}`;
        const result = await ch.assertExchange(name, type);
        expect(result).toEqual({ exchange: name });
      }
    });

    it('assertExchange is idempotent with same options', async () => {
      await ch.assertExchange('test-ex', 'direct', { durable: true });
      const result = await ch.assertExchange('test-ex', 'direct', {
        durable: true,
      });
      expect(result).toEqual({ exchange: 'test-ex' });
    });

    it('deleteExchange returns empty object', async () => {
      await ch.assertExchange('test-ex', 'direct');
      const result = await ch.deleteExchange('test-ex');
      expect(result).toEqual({});
    });

    it('deleteExchange with ifUnused option', async () => {
      await ch.assertExchange('test-ex', 'direct');
      const result = await ch.deleteExchange('test-ex', { ifUnused: true });
      expect(result).toEqual({});
    });

    it('checkExchange returns object with exchange name', async () => {
      await ch.assertExchange('test-ex', 'direct');
      const result = await ch.checkExchange('test-ex');
      expect(result).toEqual({ exchange: 'test-ex' });
    });

    it('checkExchange throws on non-existent exchange', async () => {
      await expect(ch.checkExchange('no-such-exchange')).rejects.toThrow();
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

    it('assertQueue return type has all required fields', async () => {
      const result = await ch.assertQueue('test-q');
      expect(result).toHaveProperty('queue');
      expect(result).toHaveProperty('messageCount');
      expect(result).toHaveProperty('consumerCount');
      expect(typeof result.queue).toBe('string');
      expect(typeof result.messageCount).toBe('number');
      expect(typeof result.consumerCount).toBe('number');
    });

    it('assertQueue with empty name creates server-named queue', async () => {
      const result = await ch.assertQueue('');
      expect(result.queue).toMatch(/^amq\.gen-/);
      expect(result.messageCount).toBe(0);
      expect(result.consumerCount).toBe(0);
    });

    it('assertQueue with no name argument creates server-named queue', async () => {
      const result = await ch.assertQueue();
      expect(result.queue).toMatch(/^amq\.gen-/);
    });

    it('assertQueue with durable option', async () => {
      const result = await ch.assertQueue('test-q', { durable: true });
      expect(result.queue).toBe('test-q');
    });

    it('assertQueue with exclusive option', async () => {
      const result = await ch.assertQueue('test-q', { exclusive: true });
      expect(result.queue).toBe('test-q');
    });

    it('assertQueue with autoDelete option', async () => {
      const result = await ch.assertQueue('test-q', { autoDelete: true });
      expect(result.queue).toBe('test-q');
    });

    it('assertQueue with arguments option', async () => {
      const result = await ch.assertQueue('test-q', {
        arguments: { 'x-message-ttl': 60000 },
      });
      expect(result.queue).toBe('test-q');
    });

    it('assertQueue with all options', async () => {
      const result = await ch.assertQueue('test-q', {
        durable: false,
        exclusive: false,
        autoDelete: true,
        arguments: { 'x-message-ttl': 60000 },
      });
      expect(result).toEqual({
        queue: 'test-q',
        messageCount: 0,
        consumerCount: 0,
      });
    });

    it('assertQueue is idempotent with same options', async () => {
      await ch.assertQueue('test-q', { durable: true });
      const result = await ch.assertQueue('test-q', { durable: true });
      expect(result.queue).toBe('test-q');
    });

    it('deleteQueue removes a queue', async () => {
      await ch.assertQueue('test-q');
      const result = await ch.deleteQueue('test-q');
      expect(result).toEqual({ messageCount: 0 });
    });

    it('deleteQueue return type has messageCount', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]));
      ch.sendToQueue('test-q', new Uint8Array([2]));
      const result = await ch.deleteQueue('test-q');
      expect(typeof result.messageCount).toBe('number');
      expect(result.messageCount).toBe(2);
    });

    it('deleteQueue with ifUnused option', async () => {
      await ch.assertQueue('test-q');
      const result = await ch.deleteQueue('test-q', { ifUnused: true });
      expect(result).toEqual({ messageCount: 0 });
    });

    it('deleteQueue with ifEmpty option', async () => {
      await ch.assertQueue('test-q');
      const result = await ch.deleteQueue('test-q', { ifEmpty: true });
      expect(result).toEqual({ messageCount: 0 });
    });

    it('checkQueue verifies a queue exists', async () => {
      await ch.assertQueue('test-q');
      const result = await ch.checkQueue('test-q');
      expect(result).toEqual({
        queue: 'test-q',
        messageCount: 0,
        consumerCount: 0,
      });
    });

    it('checkQueue return type matches assertQueue return type', async () => {
      await ch.assertQueue('test-q');
      const result = await ch.checkQueue('test-q');
      expect(result).toHaveProperty('queue');
      expect(result).toHaveProperty('messageCount');
      expect(result).toHaveProperty('consumerCount');
      expect(typeof result.queue).toBe('string');
      expect(typeof result.messageCount).toBe('number');
      expect(typeof result.consumerCount).toBe('number');
    });

    it('checkQueue reflects current message count', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]));
      ch.sendToQueue('test-q', new Uint8Array([2]));
      const result = await ch.checkQueue('test-q');
      expect(result.messageCount).toBe(2);
    });

    it('checkQueue throws on non-existent queue', async () => {
      await expect(ch.checkQueue('no-such-queue')).rejects.toThrow();
    });

    it('purgeQueue removes all messages', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]));
      const result = await ch.purgeQueue('test-q');
      expect(result.messageCount).toBe(1);
    });

    it('purgeQueue returns zero when queue is empty', async () => {
      await ch.assertQueue('test-q');
      const result = await ch.purgeQueue('test-q');
      expect(result).toEqual({ messageCount: 0 });
    });

    it('purgeQueue makes queue empty', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]));
      ch.sendToQueue('test-q', new Uint8Array([2]));
      await ch.purgeQueue('test-q');
      const check = await ch.checkQueue('test-q');
      expect(check.messageCount).toBe(0);
    });
  });

  describe('bindings', () => {
    it('bindQueue returns empty object', async () => {
      await ch.assertExchange('test-ex', 'direct');
      await ch.assertQueue('test-q');
      const result = await ch.bindQueue('test-q', 'test-ex', 'key');
      expect(result).toEqual({});
    });

    it('bindQueue with args returns empty object', async () => {
      await ch.assertExchange('test-ex', 'headers');
      await ch.assertQueue('test-q');
      const result = await ch.bindQueue('test-q', 'test-ex', '', {
        'x-match': 'all',
        foo: 'bar',
      });
      expect(result).toEqual({});
    });

    it('unbindQueue returns empty object', async () => {
      await ch.assertExchange('test-ex', 'direct');
      await ch.assertQueue('test-q');
      await ch.bindQueue('test-q', 'test-ex', 'key');
      const result = await ch.unbindQueue('test-q', 'test-ex', 'key');
      expect(result).toEqual({});
    });

    it('unbindQueue with args returns empty object', async () => {
      await ch.assertExchange('test-ex', 'headers');
      await ch.assertQueue('test-q');
      await ch.bindQueue('test-q', 'test-ex', '', {
        'x-match': 'all',
        foo: 'bar',
      });
      const result = await ch.unbindQueue('test-q', 'test-ex', '', {
        'x-match': 'all',
        foo: 'bar',
      });
      expect(result).toEqual({});
    });

    it('bindExchange returns empty object', async () => {
      await ch.assertExchange('src-ex', 'direct');
      await ch.assertExchange('dst-ex', 'direct');
      const result = await ch.bindExchange('dst-ex', 'src-ex', 'key');
      expect(result).toEqual({});
    });

    it('bindExchange with args returns empty object', async () => {
      await ch.assertExchange('src-ex', 'headers');
      await ch.assertExchange('dst-ex', 'headers');
      const result = await ch.bindExchange('dst-ex', 'src-ex', '', {
        'x-match': 'any',
      });
      expect(result).toEqual({});
    });

    it('unbindExchange returns empty object', async () => {
      await ch.assertExchange('src-ex', 'direct');
      await ch.assertExchange('dst-ex', 'direct');
      await ch.bindExchange('dst-ex', 'src-ex', 'key');
      const result = await ch.unbindExchange('dst-ex', 'src-ex', 'key');
      expect(result).toEqual({});
    });

    it('unbindExchange with args returns empty object', async () => {
      await ch.assertExchange('src-ex', 'headers');
      await ch.assertExchange('dst-ex', 'headers');
      await ch.bindExchange('dst-ex', 'src-ex', '', { 'x-match': 'any' });
      const result = await ch.unbindExchange('dst-ex', 'src-ex', '', {
        'x-match': 'any',
      });
      expect(result).toEqual({});
    });

    it('binding routes messages correctly', async () => {
      await ch.assertExchange('test-ex', 'direct');
      await ch.assertQueue('test-q');
      await ch.bindQueue('test-q', 'test-ex', 'my-key');
      ch.publish('test-ex', 'my-key', new Uint8Array([42]));
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(msg.content).toEqual(new Uint8Array([42]));
        expect(msg.fields.exchange).toBe('test-ex');
        expect(msg.fields.routingKey).toBe('my-key');
      }
    });

    it('unbinding stops message routing', async () => {
      await ch.assertExchange('test-ex', 'direct');
      await ch.assertQueue('test-q');
      await ch.bindQueue('test-q', 'test-ex', 'my-key');
      await ch.unbindQueue('test-q', 'test-ex', 'my-key');
      ch.publish('test-ex', 'my-key', new Uint8Array([42]));
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).toBe(false);
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

    it('cancel stops consuming and returns consumerTag', async () => {
      await ch.assertQueue('test-q');
      const messages: AmqplibMessage[] = [];
      const { consumerTag } = await ch.consume(
        'test-q',
        (msg) => {
          if (msg) messages.push(msg);
        },
        { noAck: true }
      );
      const result = await ch.cancel(consumerTag);
      expect(result).toEqual({ consumerTag });
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

    it('ackAll acknowledges all outstanding messages', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]));
      ch.sendToQueue('test-q', new Uint8Array([2]));
      // Get both messages (without noAck, so they are unacked)
      await ch.get('test-q');
      await ch.get('test-q');
      // ackAll should not throw
      expect(() => ch.ackAll()).not.toThrow();
    });

    it('nackAll requeues all outstanding messages', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]));
      ch.sendToQueue('test-q', new Uint8Array([2]));
      // Get both messages
      await ch.get('test-q');
      await ch.get('test-q');
      // nackAll with requeue=true
      ch.nackAll(true);
      // Both messages should be requeued
      const msg1 = await ch.get('test-q', { noAck: true });
      const msg2 = await ch.get('test-q', { noAck: true });
      expect(msg1).not.toBe(false);
      expect(msg2).not.toBe(false);
    });

    it('nackAll with requeue=false discards all', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1]));
      ch.sendToQueue('test-q', new Uint8Array([2]));
      await ch.get('test-q');
      await ch.get('test-q');
      ch.nackAll(false);
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).toBe(false);
    });
  });

  // ── QoS ───────────────────────────────────────────────────────────

  describe('prefetch', () => {
    it('sets prefetch count and returns empty object', async () => {
      const result = await ch.prefetch(10);
      expect(result).toEqual({});
    });

    it('sets global prefetch', async () => {
      const result = await ch.prefetch(5, true);
      expect(result).toEqual({});
    });
  });

  // ── Recovery ──────────────────────────────────────────────────────

  describe('recover', () => {
    it('recovers channel and returns empty object', async () => {
      const result = await ch.recover();
      expect(result).toEqual({});
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
    it('throws on assertExchange after close', async () => {
      await ch.close();
      await expect(ch.assertExchange('ex', 'direct')).rejects.toThrow();
    });

    it('throws on deleteExchange after close', async () => {
      await ch.close();
      await expect(ch.deleteExchange('ex')).rejects.toThrow();
    });

    it('throws on checkExchange after close', async () => {
      await ch.close();
      await expect(ch.checkExchange('ex')).rejects.toThrow();
    });

    it('throws on bindExchange after close', async () => {
      await ch.close();
      await expect(ch.bindExchange('dst', 'src', 'key')).rejects.toThrow();
    });

    it('throws on unbindExchange after close', async () => {
      await ch.close();
      await expect(ch.unbindExchange('dst', 'src', 'key')).rejects.toThrow();
    });

    it('throws on assertQueue after close', async () => {
      await ch.close();
      await expect(ch.assertQueue('q')).rejects.toThrow();
    });

    it('throws on deleteQueue after close', async () => {
      await ch.close();
      await expect(ch.deleteQueue('q')).rejects.toThrow();
    });

    it('throws on checkQueue after close', async () => {
      await ch.close();
      await expect(ch.checkQueue('q')).rejects.toThrow();
    });

    it('throws on bindQueue after close', async () => {
      await ch.close();
      await expect(ch.bindQueue('q', 'ex', 'key')).rejects.toThrow();
    });

    it('throws on unbindQueue after close', async () => {
      await ch.close();
      await expect(ch.unbindQueue('q', 'ex', 'key')).rejects.toThrow();
    });

    it('throws on purgeQueue after close', async () => {
      await ch.close();
      await expect(ch.purgeQueue('q')).rejects.toThrow();
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
      await expect(ch.consume('q', () => {})).rejects.toThrow();
    });

    it('throws on get after close', async () => {
      await ch.close();
      await expect(ch.get('q')).rejects.toThrow();
    });

    it('throws on ackAll after close', async () => {
      await ch.close();
      expect(() => ch.ackAll()).toThrow('Channel closed');
    });

    it('throws on nackAll after close', async () => {
      await ch.close();
      expect(() => ch.nackAll()).toThrow('Channel closed');
    });

    it('throws on prefetch after close', async () => {
      await ch.close();
      await expect(ch.prefetch(10)).rejects.toThrow();
    });

    it('throws on recover after close', async () => {
      await ch.close();
      await expect(ch.recover()).rejects.toThrow();
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
