import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  Exchange,
  ExchangeType,
  Queue,
  OverflowBehavior,
  MessageProperties,
  BrokerMessage,
  DeliveredMessage,
  Consumer,
  UnackedMessage,
  Binding,
  XDeathEntry,
  XDeathReason,
} from './index.ts';

describe('core domain types', () => {
  describe('Exchange', () => {
    it('accepts valid exchange definitions', () => {
      const exchange: Exchange = {
        name: 'my-exchange',
        type: 'direct',
        durable: true,
        autoDelete: false,
        internal: false,
        arguments: {},
      };
      expect(exchange.name).toBe('my-exchange');
      expect(exchange.type).toBe('direct');
    });

    it('accepts alternate exchange', () => {
      const exchange: Exchange = {
        name: 'primary',
        type: 'topic',
        durable: true,
        autoDelete: false,
        internal: false,
        arguments: {},
        alternateExchange: 'fallback',
      };
      expect(exchange.alternateExchange).toBe('fallback');
    });

    it('covers all exchange types', () => {
      expectTypeOf<ExchangeType>().toEqualTypeOf<
        'direct' | 'fanout' | 'topic' | 'headers'
      >();
    });
  });

  describe('Queue', () => {
    it('accepts minimal queue definition', () => {
      const queue: Queue = {
        name: 'my-queue',
        durable: true,
        exclusive: false,
        autoDelete: false,
        arguments: {},
      };
      expect(queue.name).toBe('my-queue');
    });

    it('accepts all derived fields', () => {
      const queue: Queue = {
        name: 'full-queue',
        durable: true,
        exclusive: false,
        autoDelete: false,
        arguments: {
          'x-message-ttl': 60000,
          'x-max-length': 1000,
        },
        messageTtl: 60000,
        expires: 300000,
        maxLength: 1000,
        maxLengthBytes: 1048576,
        overflowBehavior: 'drop-head',
        deadLetterExchange: 'dlx',
        deadLetterRoutingKey: 'dlq',
        maxPriority: 10,
        singleActiveConsumer: true,
      };
      expect(queue.messageTtl).toBe(60000);
      expect(queue.maxPriority).toBe(10);
    });

    it('covers all overflow behaviors', () => {
      expectTypeOf<OverflowBehavior>().toEqualTypeOf<
        'drop-head' | 'reject-publish' | 'reject-publish-dlx'
      >();
    });
  });

  describe('MessageProperties', () => {
    it('accepts all 13 standard AMQP basic properties', () => {
      const props: MessageProperties = {
        contentType: 'application/json',
        contentEncoding: 'utf-8',
        headers: { 'x-custom': 'value' },
        deliveryMode: 2,
        priority: 5,
        correlationId: 'corr-123',
        replyTo: 'reply-queue',
        expiration: '60000',
        messageId: 'msg-456',
        timestamp: 1700000000,
        type: 'order.created',
        userId: 'guest',
        appId: 'my-app',
      };
      expect(props.contentType).toBe('application/json');
      expect(props.deliveryMode).toBe(2);
    });

    it('accepts empty properties', () => {
      const props: MessageProperties = {};
      expect(props.contentType).toBeUndefined();
    });
  });

  describe('BrokerMessage', () => {
    it('accepts a complete broker message', () => {
      const msg: BrokerMessage = {
        body: new Uint8Array([1, 2, 3]),
        properties: {},
        exchange: 'my-exchange',
        routingKey: 'my-key',
        mandatory: false,
        immediate: false,
        deliveryCount: 0,
        enqueuedAt: Date.now(),
        priority: 0,
      };
      expect(msg.body).toBeInstanceOf(Uint8Array);
      expect(msg.deliveryCount).toBe(0);
    });

    it('uses Uint8Array for body, not Buffer', () => {
      expectTypeOf<BrokerMessage['body']>().toEqualTypeOf<Uint8Array>();
    });

    it('accepts optional tracking fields', () => {
      const msg: BrokerMessage = {
        body: new Uint8Array(),
        properties: {},
        exchange: '',
        routingKey: '',
        mandatory: false,
        immediate: false,
        deliveryCount: 1,
        enqueuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        priority: 5,
        xDeath: [
          {
            queue: 'original-queue',
            reason: 'expired',
            count: 1,
            exchange: '',
            'routing-keys': ['my-key'],
            time: Date.now(),
          },
        ],
      };
      expect(msg.expiresAt).toBeDefined();
      expect(msg.xDeath).toHaveLength(1);
    });
  });

  describe('DeliveredMessage', () => {
    it('contains delivery fields and message content', () => {
      const msg: DeliveredMessage = {
        deliveryTag: 1,
        redelivered: false,
        exchange: 'my-exchange',
        routingKey: 'my-key',
        consumerTag: 'ctag-1',
        body: new Uint8Array([72, 101, 108, 108, 111]),
        properties: { contentType: 'text/plain' },
      };
      expect(msg.deliveryTag).toBe(1);
      expect(msg.redelivered).toBe(false);
      expect(msg.consumerTag).toBe('ctag-1');
    });

    it('accepts optional messageCount for basic.get-ok', () => {
      const msg: DeliveredMessage = {
        deliveryTag: 1,
        redelivered: false,
        exchange: '',
        routingKey: '',
        messageCount: 42,
        body: new Uint8Array(),
        properties: {},
      };
      expect(msg.messageCount).toBe(42);
    });
  });

  describe('Consumer', () => {
    it('accepts a valid consumer', () => {
      const consumer: Consumer = {
        consumerTag: 'ctag-1',
        queueName: 'my-queue',
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        callback: () => {},
        noAck: false,
        exclusive: false,
        priority: 0,
      };
      expect(consumer.consumerTag).toBe('ctag-1');
      expect(consumer.noAck).toBe(false);
    });

    it('tracks unacked messages by delivery tag', () => {
      const unacked: UnackedMessage = {
        deliveryTag: 1,
        message: {
          body: new Uint8Array(),
          properties: {},
          exchange: '',
          routingKey: '',
          mandatory: false,
          immediate: false,
          deliveryCount: 1,
          enqueuedAt: Date.now(),
          priority: 0,
        },
        queueName: 'my-queue',
        consumerTag: 'ctag-1',
      };
      expect(unacked.deliveryTag).toBe(1);
      expect(unacked.consumerTag).toBe('ctag-1');
    });
  });

  describe('Binding', () => {
    it('accepts a valid binding', () => {
      const binding: Binding = {
        exchange: 'my-exchange',
        queue: 'my-queue',
        routingKey: 'my-key',
        arguments: {},
      };
      expect(binding.exchange).toBe('my-exchange');
      expect(binding.routingKey).toBe('my-key');
    });

    it('accepts headers binding arguments', () => {
      const binding: Binding = {
        exchange: 'headers-exchange',
        queue: 'my-queue',
        routingKey: '',
        arguments: { 'x-match': 'all', format: 'pdf', type: 'report' },
      };
      expect(binding.arguments['x-match']).toBe('all');
    });
  });

  describe('XDeathEntry', () => {
    it('accepts a complete x-death entry', () => {
      const entry: XDeathEntry = {
        queue: 'original-queue',
        reason: 'rejected',
        count: 3,
        exchange: 'my-exchange',
        'routing-keys': ['key1', 'key2'],
        time: 1700000000,
        'original-expiration': '60000',
      };
      expect(entry.queue).toBe('original-queue');
      expect(entry.count).toBe(3);
      expect(entry['routing-keys']).toEqual(['key1', 'key2']);
      expect(entry['original-expiration']).toBe('60000');
    });

    it('covers all death reasons', () => {
      expectTypeOf<XDeathReason>().toEqualTypeOf<
        'rejected' | 'expired' | 'maxlen' | 'delivery_limit'
      >();
    });

    it('makes original-expiration optional', () => {
      const entry: XDeathEntry = {
        queue: 'q1',
        reason: 'maxlen',
        count: 1,
        exchange: '',
        'routing-keys': ['key'],
        time: Date.now(),
      };
      expect(entry['original-expiration']).toBeUndefined();
    });
  });
});
