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
      ch.sendToQueue('test-q', Buffer.from('a'));
      ch.sendToQueue('test-q', Buffer.from('b'));
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
      ch.sendToQueue('test-q', Buffer.from('a'));
      ch.sendToQueue('test-q', Buffer.from('b'));
      const result = await ch.checkQueue('test-q');
      expect(result.messageCount).toBe(2);
    });

    it('checkQueue throws on non-existent queue', async () => {
      await expect(ch.checkQueue('no-such-queue')).rejects.toThrow();
    });

    it('purgeQueue removes all messages', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('purge'));
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
      ch.sendToQueue('test-q', Buffer.from('a'));
      ch.sendToQueue('test-q', Buffer.from('b'));
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
      ch.publish('test-ex', 'my-key', Buffer.from([42]));
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(msg.content).toEqual(Buffer.from([42]));
        expect(msg.fields.exchange).toBe('test-ex');
        expect(msg.fields.routingKey).toBe('my-key');
      }
    });

    it('unbinding stops message routing', async () => {
      await ch.assertExchange('test-ex', 'direct');
      await ch.assertQueue('test-q');
      await ch.bindQueue('test-q', 'test-ex', 'my-key');
      await ch.unbindQueue('test-q', 'test-ex', 'my-key');
      ch.publish('test-ex', 'my-key', Buffer.from([42]));
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

    it('publish accepts Buffer content', async () => {
      await ch.assertQueue('test-q');
      const ok = ch.sendToQueue('test-q', Buffer.from('hello'));
      expect(ok).toBe(true);
    });

    it('sendToQueue delivers a message', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1, 2, 3]));
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(msg.content).toEqual(Buffer.from([1, 2, 3]));
      }
    });

    it('sendToQueue is shorthand for publish to default exchange', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('via-sendToQueue'));
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(msg.fields.exchange).toBe('');
        expect(msg.fields.routingKey).toBe('test-q');
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
      expect(msg?.content).toEqual(Buffer.from([42]));
      expect(msg?.fields.exchange).toBe('');
      expect(msg?.fields.routingKey).toBe('test-q');
      expect(msg?.fields.consumerTag).toBeTruthy();
    });

    it('consume with custom consumerTag', async () => {
      await ch.assertQueue('test-q');
      const { consumerTag } = await ch.consume(
        'test-q',
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        () => {},
        {
          consumerTag: 'my-tag',
          noAck: true,
        }
      );
      expect(consumerTag).toBe('my-tag');
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

    it('publish with options passes message properties', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('test'), {
        contentType: 'text/plain',
        contentEncoding: 'utf-8',
        headers: { 'x-custom': 'value' },
        deliveryMode: 2,
        priority: 5,
        correlationId: 'corr-123',
        replyTo: 'reply-q',
        expiration: '60000',
        messageId: 'msg-456',
        timestamp: 1000000,
        type: 'test.event',
        userId: 'guest',
        appId: 'test-app',
      });
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(msg.properties.contentType).toBe('text/plain');
        expect(msg.properties.contentEncoding).toBe('utf-8');
        expect(msg.properties.headers).toEqual({ 'x-custom': 'value' });
        expect(msg.properties.deliveryMode).toBe(2);
        expect(msg.properties.priority).toBe(5);
        expect(msg.properties.correlationId).toBe('corr-123');
        expect(msg.properties.replyTo).toBe('reply-q');
        expect(msg.properties.expiration).toBe('60000');
        expect(msg.properties.messageId).toBe('msg-456');
        expect(msg.properties.timestamp).toBe(1000000);
        expect(msg.properties.type).toBe('test.event');
        expect(msg.properties.userId).toBe('guest');
        expect(msg.properties.appId).toBe('test-app');
      }
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
        expect(msg.content).toEqual(Buffer.from([1]));
      }
    });

    it('get returns false when queue is empty', async () => {
      await ch.assertQueue('test-q');
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).toBe(false);
    });

    it('get returns false (not null) on empty queue', async () => {
      await ch.assertQueue('test-q');
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).toBe(false);
      expect(msg).not.toBe(null);
      expect(msg).not.toBeUndefined();
    });

    it('get message fields include messageCount', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('a'));
      ch.sendToQueue('test-q', Buffer.from('b'));
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(typeof msg.fields.messageCount).toBe('number');
      }
    });
  });

  // ── Buffer conversion ──────────────────────────────────────────────

  describe('Buffer conversion', () => {
    it('content from get is a Buffer instance', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', new Uint8Array([1, 2, 3]));
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(Buffer.isBuffer(msg.content)).toBe(true);
      }
    });

    it('content from consume is a Buffer instance', async () => {
      await ch.assertQueue('test-q');
      const messages: AmqplibMessage[] = [];
      await ch.consume(
        'test-q',
        (msg) => {
          if (msg) messages.push(msg);
        },
        { noAck: true }
      );
      ch.sendToQueue('test-q', new Uint8Array([10, 20]));
      await new Promise((r) => setTimeout(r, 50));
      expect(messages).toHaveLength(1);
      const msg = messages[0];
      expect(msg).toBeDefined();
      expect(Buffer.isBuffer(msg?.content)).toBe(true);
    });

    it('publish with Buffer, get returns Buffer with same data', async () => {
      await ch.assertQueue('test-q');
      const input = Buffer.from('hello world');
      ch.sendToQueue('test-q', input);
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(Buffer.isBuffer(msg.content)).toBe(true);
        expect(msg.content.toString()).toBe('hello world');
      }
    });

    it('publish with Uint8Array, get returns Buffer with same data', async () => {
      await ch.assertQueue('test-q');
      const input = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      ch.sendToQueue('test-q', input);
      const msg = await ch.get('test-q', { noAck: true });
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(Buffer.isBuffer(msg.content)).toBe(true);
        expect(msg.content.toString()).toBe('Hello');
      }
    });

    it('publish with Buffer, consume receives Buffer', async () => {
      await ch.assertQueue('test-q');
      const messages: AmqplibMessage[] = [];
      await ch.consume(
        'test-q',
        (msg) => {
          if (msg) messages.push(msg);
        },
        { noAck: true }
      );
      ch.sendToQueue('test-q', Buffer.from('consumed'));
      await new Promise((r) => setTimeout(r, 50));
      expect(messages).toHaveLength(1);
      const msg = messages[0];
      expect(msg).toBeDefined();
      expect(Buffer.isBuffer(msg?.content)).toBe(true);
      expect(msg?.content.toString()).toBe('consumed');
    });
  });

  // ── Acknowledgment ────────────────────────────────────────────────

  describe('acknowledgment', () => {
    it('ack acknowledges a message', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('ack-me'));
      const msg = await ch.get('test-q');
      expect(msg).not.toBe(false);
      if (msg !== false) {
        expect(() => ch.ack(msg)).not.toThrow();
      }
    });

    it('ack with allUpTo=true acks multiple messages', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('a'));
      ch.sendToQueue('test-q', Buffer.from('b'));
      ch.sendToQueue('test-q', Buffer.from('c'));
      await ch.get('test-q');
      await ch.get('test-q');
      const msg3 = await ch.get('test-q');
      expect(msg3).not.toBe(false);
      if (msg3 !== false) {
        // ack all up to and including msg3
        expect(() => ch.ack(msg3, true)).not.toThrow();
      }
    });

    it('nack requeues a message by default', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('nack-me'));
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

    it('nack with requeue=false discards message', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('discard'));
      const msg = await ch.get('test-q');
      expect(msg).not.toBe(false);
      if (msg !== false) {
        ch.nack(msg, false, false);
        const next = await ch.get('test-q', { noAck: true });
        expect(next).toBe(false);
      }
    });

    it('nack with allUpTo=true requeues multiple messages', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('a'));
      ch.sendToQueue('test-q', Buffer.from('b'));
      await ch.get('test-q');
      const msg2 = await ch.get('test-q');
      expect(msg2).not.toBe(false);
      if (msg2 !== false) {
        ch.nack(msg2, true, true);
        const r1 = await ch.get('test-q', { noAck: true });
        const r2 = await ch.get('test-q', { noAck: true });
        expect(r1).not.toBe(false);
        expect(r2).not.toBe(false);
      }
    });

    it('reject with requeue=false discards message', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('reject-me'));
      const msg = await ch.get('test-q');
      expect(msg).not.toBe(false);
      if (msg !== false) {
        ch.reject(msg, false);
        const next = await ch.get('test-q', { noAck: true });
        expect(next).toBe(false);
      }
    });

    it('reject with requeue=true requeues message', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('requeue-me'));
      const msg = await ch.get('test-q');
      expect(msg).not.toBe(false);
      if (msg !== false) {
        ch.reject(msg, true);
        const redelivered = await ch.get('test-q', { noAck: true });
        expect(redelivered).not.toBe(false);
        if (redelivered !== false) {
          expect(redelivered.fields.redelivered).toBe(true);
        }
      }
    });

    it('ackAll acknowledges all outstanding messages', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('a'));
      ch.sendToQueue('test-q', Buffer.from('b'));
      await ch.get('test-q');
      await ch.get('test-q');
      expect(() => ch.ackAll()).not.toThrow();
    });

    it('nackAll requeues all outstanding messages', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('a'));
      ch.sendToQueue('test-q', Buffer.from('b'));
      await ch.get('test-q');
      await ch.get('test-q');
      ch.nackAll(true);
      const msg1 = await ch.get('test-q', { noAck: true });
      const msg2 = await ch.get('test-q', { noAck: true });
      expect(msg1).not.toBe(false);
      expect(msg2).not.toBe(false);
    });

    it('nackAll with requeue=false discards all', async () => {
      await ch.assertQueue('test-q');
      ch.sendToQueue('test-q', Buffer.from('a'));
      ch.sendToQueue('test-q', Buffer.from('b'));
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
      expect(() => ch.publish('ex', 'key', Buffer.from('x'))).toThrow(
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

    it('throws on cancel after close', async () => {
      await ch.close();
      await expect(ch.cancel('tag')).rejects.toThrow();
    });

    it('throws on waitForConfirms after close', async () => {
      await ch.close();
      await expect(ch.waitForConfirms()).rejects.toThrow('Channel closed');
    });

    it('throws on sendToQueue after close', async () => {
      await ch.close();
      expect(() => ch.sendToQueue('q', Buffer.from('x'))).toThrow(
        'Channel closed'
      );
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
    ch.sendToQueue('confirm-q', Buffer.from('confirmed'));
    expect(acks).toHaveLength(1);
  });

  // ── publish with callback ───────────────────────────────────────────

  it('publish calls callback with (null, ok) on successful ack', async () => {
    await ch.assertQueue('cb-q');
    const result = await new Promise<{ err: Error | null; ok: unknown }>(
      (resolve) => {
        ch.publish('', 'cb-q', Buffer.from('hello'), undefined, (err, ok) => {
          resolve({ err, ok });
        });
      }
    );
    expect(result.err).toBeNull();
    expect(result.ok).toEqual({});
  });

  it('sendToQueue calls callback with (null, ok) on successful ack', async () => {
    await ch.assertQueue('cb-q2');
    const result = await new Promise<{ err: Error | null; ok: unknown }>(
      (resolve) => {
        ch.sendToQueue('cb-q2', Buffer.from('hello'), undefined, (err, ok) => {
          resolve({ err, ok });
        });
      }
    );
    expect(result.err).toBeNull();
    expect(result.ok).toEqual({});
  });

  it('publish callbacks are called in order for multiple messages', async () => {
    await ch.assertQueue('order-q');
    const tags: number[] = [];
    for (let i = 0; i < 5; i++) {
      ch.sendToQueue('order-q', Buffer.from(`msg-${i}`), undefined, () => {
        tags.push(i);
      });
    }
    expect(tags).toEqual([0, 1, 2, 3, 4]);
  });

  it('waitForConfirms resolves after all published messages are confirmed', async () => {
    await ch.assertQueue('wfc-q');
    ch.sendToQueue('wfc-q', Buffer.from('a'));
    ch.sendToQueue('wfc-q', Buffer.from('b'));
    await expect(ch.waitForConfirms()).resolves.toBeUndefined();
  });

  it('publish works without callback in confirm mode', async () => {
    await ch.assertQueue('no-cb-q');
    const result = ch.publish('', 'no-cb-q', Buffer.from('data'));
    expect(result).toBe(true);
    await ch.waitForConfirms();
  });

  it('sendToQueue works without callback in confirm mode', async () => {
    await ch.assertQueue('no-cb-q2');
    const result = ch.sendToQueue('no-cb-q2', Buffer.from('data'));
    expect(result).toBe(true);
    await ch.waitForConfirms();
  });

  // ── return event ────────────────────────────────────────────────────

  it('emits return event for mandatory unroutable messages', async () => {
    await ch.assertExchange('ret-ex', 'direct');
    const returned: unknown[] = [];
    ch.on('return', (msg) => {
      returned.push(msg);
    });
    ch.publish('ret-ex', 'no-such-key', Buffer.from('unroutable'), {
      mandatory: true,
    });
    expect(returned).toHaveLength(1);
    const msg = returned[0] as {
      fields: { replyCode: number; exchange: string; routingKey: string };
      content: Buffer;
    };
    expect(msg.fields.replyCode).toBe(312);
    expect(msg.fields.exchange).toBe('ret-ex');
    expect(msg.fields.routingKey).toBe('no-such-key');
    expect(msg.content.toString()).toBe('unroutable');
  });

  it('return event fires BEFORE confirm callback for mandatory unroutable messages', async () => {
    await ch.assertExchange('order-ex', 'direct');
    const events: string[] = [];
    ch.on('return', () => {
      events.push('return');
    });
    ch.publish(
      'order-ex',
      'no-route',
      Buffer.from('test'),
      { mandatory: true },
      () => {
        events.push('callback');
      }
    );
    expect(events).toEqual(['return', 'callback']);
  });

  // ── drain event ─────────────────────────────────────────────────────

  it('does not emit drain when publish returns true (no backpressure)', async () => {
    await ch.assertQueue('drain-q');
    const drains: number[] = [];
    ch.on('drain', () => {
      drains.push(drains.length);
    });
    const result = ch.sendToQueue('drain-q', Buffer.from('data'));
    expect(result).toBe(true);
    expect(drains).toHaveLength(0);
  });

  // ── callback ignored on regular channel ─────────────────────────────

  it('callback parameter is ignored on regular (non-confirm) channel', async () => {
    const regularConn = await connect('amqp://localhost');
    const regularCh = await regularConn.createChannel();
    await regularCh.assertQueue('reg-q');
    const cb = vi.fn();
    regularCh.publish('', 'reg-q', Buffer.from('data'), undefined, cb);
    expect(cb).not.toHaveBeenCalled();
    await regularCh.close();
    await regularConn.close();
  });
});
