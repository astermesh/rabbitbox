import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  // Core infrastructure
  SimDecision,
  ProceedDecision,
  DelayDecision,
  FailDecision,
  ShortCircuitDecision,
  TransformDecision,
  Hook,
  PreHandler,
  PostHandler,

  // Domain types
  MessageProperties,
  XDeathReason,
  XDeathEntry,
  BrokerMessage,
  DeliveredMessage,

  // IBI — Message ops
  PublishMeta,
  PublishCtx,
  PublishResult,
  ConsumeMeta,
  ConsumeCtx,
  ConsumeResult,
  GetMeta,
  GetCtx,
  GetResult,
  CancelMeta,
  CancelCtx,
  CancelResult,

  // IBI — Ack ops
  AckMeta,
  AckCtx,
  AckResult,
  NackMeta,
  NackCtx,
  NackResult,
  RejectMeta,
  RejectCtx,
  RejectResult,
  RecoverMeta,
  RecoverCtx,
  RecoverResult,

  // IBI — Topology
  ExchangeDeclareMeta,
  ExchangeDeclareCtx,
  ExchangeDeclareResult,
  CheckExchangeMeta,
  CheckExchangeCtx,
  CheckExchangeResult,
  ExchangeDeleteMeta,
  ExchangeDeleteCtx,
  ExchangeDeleteResult,
  ExchangeBindMeta,
  ExchangeBindCtx,
  ExchangeBindResult,
  ExchangeUnbindMeta,
  ExchangeUnbindCtx,
  ExchangeUnbindResult,
  QueueDeclareMeta,
  QueueDeclareCtx,
  QueueDeclareResult,
  CheckQueueMeta,
  CheckQueueCtx,
  CheckQueueResult,
  QueueDeleteMeta,
  QueueDeleteCtx,
  QueueDeleteResult,
  QueueBindMeta,
  QueueBindCtx,
  QueueBindResult,
  QueueUnbindMeta,
  QueueUnbindCtx,
  QueueUnbindResult,
  PurgeMeta,
  PurgeCtx,
  PurgeResult,

  // IBI — Channel
  PrefetchMeta,
  PrefetchCtx,
  PrefetchResult,
  ConfirmSelectMeta,
  ConfirmSelectCtx,
  ConfirmSelectResult,

  // OBI
  TimeMeta,
  TimeCtx,
  TimeResult,
  TimerSetMeta,
  TimerSetCtx,
  TimerHandle,
  TimerSetResult,
  RandomMeta,
  RandomCtx,
  RandomResult,
  DeliveryMeta,
  DeliveryCtx,
  DeliveryResult,
  ReturnMeta,
  ReturnCtx,
  ReturnResult,
  PersistMeta,
  PersistCtx,
  PersistResult,

  // Aggregate interfaces
  RabbitInboundHooks,
  RabbitOutboundHooks,
  RabbitHooks,
} from './index.ts';

// =============================================================================
// SimDecision
// =============================================================================

describe('SimDecision', () => {
  it('covers all 5 decision types', () => {
    const proceed: SimDecision<number> = { type: 'proceed' };
    const delay: SimDecision<number> = { type: 'delay', ms: 100 };
    const fail: SimDecision<number> = {
      type: 'fail',
      error: new Error('boom'),
    };
    const shortCircuit: SimDecision<number> = {
      type: 'short_circuit',
      result: 42,
    };
    const transform: SimDecision<number> = {
      type: 'transform',
      result: 99,
    };

    expect(proceed.type).toBe('proceed');
    expect(delay.type).toBe('delay');
    expect(fail.type).toBe('fail');
    expect(shortCircuit.type).toBe('short_circuit');
    expect(transform.type).toBe('transform');
  });

  it('delay decision carries ms', () => {
    const d: DelayDecision = { type: 'delay', ms: 500 };
    expect(d.ms).toBe(500);
  });

  it('fail decision carries error', () => {
    const err = new Error('channel closed');
    const d: FailDecision = { type: 'fail', error: err };
    expect(d.error.message).toBe('channel closed');
  });

  it('short_circuit decision carries typed result', () => {
    const d: ShortCircuitDecision<{ routed: boolean }> = {
      type: 'short_circuit',
      result: { routed: false },
    };
    expect(d.result.routed).toBe(false);
  });

  it('transform decision carries typed result', () => {
    const d: TransformDecision<string> = {
      type: 'transform',
      result: 'modified',
    };
    expect(d.result).toBe('modified');
  });

  it('proceed decision has no extra fields', () => {
    const d: ProceedDecision = { type: 'proceed' };
    expect(Object.keys(d)).toEqual(['type']);
  });

  it('discriminates via type field', () => {
    const decision: SimDecision<number> = { type: 'delay', ms: 100 };
    if (decision.type === 'delay') {
      expectTypeOf(decision).toEqualTypeOf<DelayDecision>();
    }
  });
});

// =============================================================================
// Hook, PreHandler, PostHandler
// =============================================================================

describe('Hook', () => {
  it('accepts pre and post handlers', () => {
    const hook: Hook<{ readonly x: number }, string> = {
      pre: (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<{ readonly x: number }>();
        return { type: 'proceed' };
      },
      post: (ctx, result) => {
        expectTypeOf(ctx).toEqualTypeOf<{ readonly x: number }>();
        expectTypeOf(result).toEqualTypeOf<string>();
        return 'transformed';
      },
    };
    expect(hook.pre).toBeDefined();
    expect(hook.post).toBeDefined();
  });

  it('allows empty hook (no handlers)', () => {
    const hook: Hook<unknown, unknown> = {};
    expect(hook.pre).toBeUndefined();
    expect(hook.post).toBeUndefined();
  });

  it('pre handler returns SimDecision or undefined', () => {
    expectTypeOf<PreHandler<{ readonly x: number }, string>>().toEqualTypeOf<
      (ctx: { readonly x: number }) => SimDecision<string> | undefined
    >();
  });

  it('post handler returns Result or undefined', () => {
    expectTypeOf<PostHandler<{ readonly x: number }, string>>().toEqualTypeOf<
      (ctx: { readonly x: number }, result: string) => string | undefined
    >();
  });

  it('pre handler can return undefined (proceed implicitly)', () => {
    const pre: PreHandler<unknown, unknown> = () => {
      // no return = proceed
      return undefined;
    };
    expect(pre({})).toBeUndefined();
  });

  it('post handler can return undefined (keep original result)', () => {
    const post: PostHandler<unknown, number> = () => {
      // no return = keep original
      return undefined;
    };
    expect(post({}, 42)).toBeUndefined();
  });
});

// =============================================================================
// Domain types (MessageProperties, BrokerMessage, DeliveredMessage)
// =============================================================================

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
      mandatory: true,
      immediate: false,
      deliveryCount: 0,
      enqueuedAt: Date.now(),
      priority: 0,
    };
    expect(msg.exchange).toBe('my-exchange');
  });

  it('accepts optional xDeath and expiresAt', () => {
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
      priority: 0,
      xDeath: [
        {
          queue: 'q1',
          reason: 'expired',
          count: 1,
          exchange: '',
          'routing-keys': ['key'],
          time: Date.now(),
        },
      ],
    };
    expect(msg.xDeath).toHaveLength(1);
  });

  it('uses Uint8Array for body', () => {
    expectTypeOf<BrokerMessage['body']>().toEqualTypeOf<Uint8Array>();
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
      body: new Uint8Array([72, 101]),
      properties: { contentType: 'text/plain' },
    };
    expect(msg.deliveryTag).toBe(1);
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

describe('XDeathEntry', () => {
  it('covers all death reasons', () => {
    expectTypeOf<XDeathReason>().toEqualTypeOf<
      'rejected' | 'expired' | 'maxlen' | 'delivery_limit'
    >();
  });

  it('accepts a complete entry', () => {
    const entry: XDeathEntry = {
      queue: 'q1',
      reason: 'rejected',
      count: 3,
      exchange: 'ex1',
      'routing-keys': ['key1', 'key2'],
      time: 1700000000,
      'original-expiration': '60000',
    };
    expect(entry.count).toBe(3);
    expect(entry['routing-keys']).toEqual(['key1', 'key2']);
  });
});

// =============================================================================
// IBI — Message operations
// =============================================================================

describe('IBI: message operations', () => {
  describe('publish', () => {
    it('accepts a valid publish context', () => {
      const ctx: PublishCtx = {
        exchange: 'my-exchange',
        routingKey: 'my-key',
        body: new Uint8Array([1, 2, 3]),
        properties: { contentType: 'application/json' },
        mandatory: true,
        meta: {
          exchangeExists: true,
          exchangeType: 'direct',
        },
      };
      expect(ctx.exchange).toBe('my-exchange');
      expect(ctx.meta.exchangeExists).toBe(true);
    });

    it('meta has optional matchedQueues (post-phase)', () => {
      const meta: PublishMeta = {
        exchangeExists: true,
        exchangeType: 'fanout',
        matchedQueues: 3,
      };
      expect(meta.matchedQueues).toBe(3);
    });

    it('meta has mutable realDurationMs', () => {
      const meta: PublishMeta = {
        exchangeExists: true,
        exchangeType: null,
      };
      meta.realDurationMs = 5;
      expect(meta.realDurationMs).toBe(5);
    });

    it('result carries routed and optional deliveryTag', () => {
      const result: PublishResult = { routed: true, deliveryTag: 1 };
      expect(result.routed).toBe(true);
      expect(result.deliveryTag).toBe(1);
    });
  });

  describe('consume', () => {
    it('accepts a valid consume context', () => {
      const ctx: ConsumeCtx = {
        queue: 'my-queue',
        consumerTag: 'ctag-1',
        noAck: false,
        exclusive: false,
        meta: {
          queueExists: true,
          queueMessageCount: 10,
          existingConsumerCount: 0,
        },
      };
      expect(ctx.queue).toBe('my-queue');
      expect(ctx.meta.queueMessageCount).toBe(10);
    });

    it('result carries consumerTag', () => {
      const result: ConsumeResult = { consumerTag: 'ctag-1' };
      expect(result.consumerTag).toBe('ctag-1');
    });
  });

  describe('get', () => {
    it('accepts a valid get context', () => {
      const ctx: GetCtx = {
        queue: 'my-queue',
        noAck: true,
        meta: {
          queueExists: true,
          messageCount: 5,
          consumerCount: 2,
        },
      };
      expect(ctx.noAck).toBe(true);
    });

    it('result is DeliveredMessage or null', () => {
      const empty: GetResult = null;
      expect(empty).toBeNull();

      const msg: GetResult = {
        deliveryTag: 1,
        redelivered: false,
        exchange: '',
        routingKey: 'key',
        body: new Uint8Array(),
        properties: {},
      };
      expect(msg).not.toBeNull();
    });
  });

  describe('cancel', () => {
    it('accepts a valid cancel context', () => {
      const ctx: CancelCtx = {
        consumerTag: 'ctag-1',
        meta: {
          consumerExists: true,
          queue: 'my-queue',
        },
      };
      expect(ctx.consumerTag).toBe('ctag-1');
      expect(ctx.meta.queue).toBe('my-queue');
    });

    it('result is undefined', () => {
      expectTypeOf<CancelResult>().toEqualTypeOf<undefined>();
    });
  });
});

// =============================================================================
// IBI — Acknowledgment operations
// =============================================================================

describe('IBI: acknowledgment operations', () => {
  describe('ack', () => {
    it('accepts a valid ack context', () => {
      const ctx: AckCtx = {
        deliveryTag: 5,
        multiple: false,
        meta: {
          messageExists: true,
          consumerTag: 'ctag-1',
          queue: 'my-queue',
        },
      };
      expect(ctx.deliveryTag).toBe(5);
      expect(ctx.multiple).toBe(false);
    });

    it('result is undefined', () => {
      expectTypeOf<AckResult>().toEqualTypeOf<undefined>();
    });
  });

  describe('nack', () => {
    it('accepts a valid nack context', () => {
      const ctx: NackCtx = {
        deliveryTag: 3,
        multiple: true,
        requeue: false,
        meta: {
          messageExists: true,
          willDeadLetter: true,
          consumerTag: 'ctag-1',
          queue: 'my-queue',
        },
      };
      expect(ctx.requeue).toBe(false);
      expect(ctx.meta.willDeadLetter).toBe(true);
    });

    it('result is undefined', () => {
      expectTypeOf<NackResult>().toEqualTypeOf<undefined>();
    });
  });

  describe('reject', () => {
    it('has no multiple flag (single message only)', () => {
      const ctx: RejectCtx = {
        deliveryTag: 1,
        requeue: true,
        meta: {
          messageExists: true,
          willDeadLetter: false,
          consumerTag: 'ctag-1',
          queue: 'q1',
        },
      };
      // reject should not have 'multiple' — verify at type level
      expectTypeOf<RejectCtx>().not.toHaveProperty('multiple');
      expect(ctx.requeue).toBe(true);
    });

    it('result is undefined', () => {
      expectTypeOf<RejectResult>().toEqualTypeOf<undefined>();
    });
  });

  describe('recover', () => {
    it('accepts a valid recover context', () => {
      const ctx: RecoverCtx = {
        requeue: true,
        meta: { unackedCount: 5 },
      };
      expect(ctx.requeue).toBe(true);
      expect(ctx.meta.unackedCount).toBe(5);
    });

    it('result is undefined', () => {
      expectTypeOf<RecoverResult>().toEqualTypeOf<undefined>();
    });
  });
});

// =============================================================================
// IBI — Topology operations
// =============================================================================

describe('IBI: topology operations', () => {
  describe('exchangeDeclare', () => {
    it('accepts all exchange types', () => {
      const types = ['direct', 'fanout', 'topic', 'headers'] as const;
      for (const type of types) {
        const ctx: ExchangeDeclareCtx = {
          name: `ex-${type}`,
          type,
          durable: true,
          autoDelete: false,
          internal: false,
          arguments: {},
          meta: { alreadyExists: false },
        };
        expect(ctx.type).toBe(type);
      }
    });

    it('result carries exchange name', () => {
      const result: ExchangeDeclareResult = { exchange: 'my-exchange' };
      expect(result.exchange).toBe('my-exchange');
    });
  });

  describe('checkExchange', () => {
    it('meta indicates existence', () => {
      const ctx: CheckExchangeCtx = {
        name: 'my-exchange',
        meta: { exists: true },
      };
      expect(ctx.meta.exists).toBe(true);
    });

    it('result is undefined', () => {
      expectTypeOf<CheckExchangeResult>().toEqualTypeOf<undefined>();
    });
  });

  describe('exchangeDelete', () => {
    it('accepts ifUnused flag', () => {
      const ctx: ExchangeDeleteCtx = {
        name: 'my-exchange',
        ifUnused: true,
        meta: { exists: true, hasBindings: false },
      };
      expect(ctx.ifUnused).toBe(true);
    });

    it('result is undefined', () => {
      expectTypeOf<ExchangeDeleteResult>().toEqualTypeOf<undefined>();
    });
  });

  describe('exchangeBind / exchangeUnbind', () => {
    it('exchangeBind has destination and source', () => {
      const ctx: ExchangeBindCtx = {
        destination: 'dest-ex',
        source: 'src-ex',
        routingKey: 'key',
        arguments: {},
        meta: { destinationExists: true, sourceExists: true },
      };
      expect(ctx.destination).toBe('dest-ex');
      expect(ctx.source).toBe('src-ex');
    });

    it('exchangeBind result is undefined', () => {
      expectTypeOf<ExchangeBindResult>().toEqualTypeOf<undefined>();
    });

    it('exchangeUnbind has same shape', () => {
      const ctx: ExchangeUnbindCtx = {
        destination: 'dest-ex',
        source: 'src-ex',
        routingKey: 'key',
        arguments: {},
        meta: { destinationExists: true, sourceExists: true },
      };
      expect(ctx.destination).toBe('dest-ex');
    });

    it('exchangeUnbind result is undefined', () => {
      expectTypeOf<ExchangeUnbindResult>().toEqualTypeOf<undefined>();
    });
  });

  describe('queueDeclare', () => {
    it('accepts full queue declaration', () => {
      const ctx: QueueDeclareCtx = {
        name: 'my-queue',
        durable: true,
        exclusive: false,
        autoDelete: false,
        arguments: { 'x-message-ttl': 60000 },
        meta: {
          alreadyExists: false,
          messageCount: 0,
          consumerCount: 0,
        },
      };
      expect(ctx.name).toBe('my-queue');
    });

    it('result carries queue info', () => {
      const result: QueueDeclareResult = {
        queue: 'my-queue',
        messageCount: 0,
        consumerCount: 0,
      };
      expect(result.queue).toBe('my-queue');
    });
  });

  describe('checkQueue', () => {
    it('context has name and meta', () => {
      const ctx: CheckQueueCtx = {
        name: 'my-queue',
        meta: { exists: true, messageCount: 42, consumerCount: 3 },
      };
      expect(ctx.meta.exists).toBe(true);
    });

    it('result carries queue stats', () => {
      const result: CheckQueueResult = {
        queue: 'my-queue',
        messageCount: 42,
        consumerCount: 3,
      };
      expect(result.messageCount).toBe(42);
    });
  });

  describe('queueDelete', () => {
    it('accepts ifUnused and ifEmpty flags', () => {
      const ctx: QueueDeleteCtx = {
        name: 'my-queue',
        ifUnused: true,
        ifEmpty: true,
        meta: { exists: true, messageCount: 0, consumerCount: 0 },
      };
      expect(ctx.ifUnused).toBe(true);
      expect(ctx.ifEmpty).toBe(true);
    });

    it('result carries deleted message count', () => {
      const result: QueueDeleteResult = { messageCount: 10 };
      expect(result.messageCount).toBe(10);
    });
  });

  describe('queueBind / queueUnbind', () => {
    it('queueBind has queue, exchange, routingKey', () => {
      const ctx: QueueBindCtx = {
        queue: 'my-queue',
        exchange: 'my-exchange',
        routingKey: 'my-key',
        arguments: {},
        meta: { queueExists: true, exchangeExists: true },
      };
      expect(ctx.routingKey).toBe('my-key');
    });

    it('queueBind result is undefined', () => {
      expectTypeOf<QueueBindResult>().toEqualTypeOf<undefined>();
    });

    it('queueUnbind meta has bindingExists', () => {
      const ctx: QueueUnbindCtx = {
        queue: 'my-queue',
        exchange: 'my-exchange',
        routingKey: 'my-key',
        arguments: {},
        meta: { bindingExists: true },
      };
      expect(ctx.meta.bindingExists).toBe(true);
    });

    it('queueUnbind result is undefined', () => {
      expectTypeOf<QueueUnbindResult>().toEqualTypeOf<undefined>();
    });
  });

  describe('purge', () => {
    it('context has queue and meta', () => {
      const ctx: PurgeCtx = {
        queue: 'my-queue',
        meta: { queueExists: true, messageCount: 100 },
      };
      expect(ctx.queue).toBe('my-queue');
    });

    it('result carries purged message count', () => {
      const result: PurgeResult = { messageCount: 100 };
      expect(result.messageCount).toBe(100);
    });
  });
});

// =============================================================================
// IBI — Channel operations
// =============================================================================

describe('IBI: channel operations', () => {
  describe('prefetch', () => {
    it('accepts count and global flag', () => {
      const ctx: PrefetchCtx = {
        count: 10,
        global: false,
        meta: { previousCount: 0, channelConsumerCount: 2 },
      };
      expect(ctx.count).toBe(10);
      expect(ctx.meta.previousCount).toBe(0);
    });

    it('result is undefined', () => {
      expectTypeOf<PrefetchResult>().toEqualTypeOf<undefined>();
    });
  });

  describe('confirmSelect', () => {
    it('meta tracks confirm and transactional state', () => {
      const ctx: ConfirmSelectCtx = {
        meta: {
          alreadyInConfirmMode: false,
          channelIsTransactional: false,
        },
      };
      expect(ctx.meta.alreadyInConfirmMode).toBe(false);
      expect(ctx.meta.channelIsTransactional).toBe(false);
    });

    it('result is undefined', () => {
      expectTypeOf<ConfirmSelectResult>().toEqualTypeOf<undefined>();
    });
  });
});

// =============================================================================
// OBI — Outbound hook types
// =============================================================================

describe('OBI: outbound hooks', () => {
  describe('time', () => {
    it('covers all time sources', () => {
      const sources: TimeCtx['source'][] = [
        'message-timestamp',
        'ttl-check',
        'queue-expiry',
        'heartbeat',
        'now',
      ];
      expect(sources).toHaveLength(5);
    });

    it('result is a number (ms timestamp)', () => {
      expectTypeOf<TimeResult>().toEqualTypeOf<number>();
    });
  });

  describe('timers', () => {
    it('covers all timer sources', () => {
      const sources: TimerSetCtx['source'][] = [
        'ttl-expiry',
        'queue-expiry',
        'delayed-delivery',
        'heartbeat',
      ];
      expect(sources).toHaveLength(4);
    });

    it('carries delayMs', () => {
      const ctx: TimerSetCtx = {
        source: 'ttl-expiry',
        delayMs: 5000,
        meta: {},
      };
      expect(ctx.delayMs).toBe(5000);
    });

    it('result is TimerHandle (opaque)', () => {
      expectTypeOf<TimerSetResult>().toEqualTypeOf<TimerHandle>();
    });
  });

  describe('random', () => {
    it('covers all random sources', () => {
      const sources: RandomCtx['source'][] = [
        'consumer-tag',
        'message-id',
        'queue-name',
      ];
      expect(sources).toHaveLength(3);
    });

    it('result is string', () => {
      expectTypeOf<RandomResult>().toEqualTypeOf<string>();
    });
  });

  describe('delivery', () => {
    it('accepts a valid delivery context', () => {
      const ctx: DeliveryCtx = {
        queue: 'my-queue',
        consumerTag: 'ctag-1',
        deliveryTag: 1,
        message: {
          deliveryTag: 1,
          redelivered: false,
          exchange: 'ex',
          routingKey: 'key',
          consumerTag: 'ctag-1',
          body: new Uint8Array(),
          properties: {},
        },
        meta: {
          queueDepth: 10,
          consumerUnacked: 0,
          redelivered: false,
        },
      };
      expect(ctx.queue).toBe('my-queue');
      expect(ctx.meta.queueDepth).toBe(10);
    });

    it('result is undefined', () => {
      expectTypeOf<DeliveryResult>().toEqualTypeOf<undefined>();
    });
  });

  describe('return', () => {
    it('accepts a valid return context', () => {
      const ctx: ReturnCtx = {
        exchange: 'my-exchange',
        routingKey: 'my-key',
        replyCode: 312,
        replyText: 'NO_ROUTE',
        message: {
          body: new Uint8Array(),
          properties: {},
          exchange: 'my-exchange',
          routingKey: 'my-key',
          mandatory: true,
          immediate: false,
          deliveryCount: 0,
          enqueuedAt: Date.now(),
          priority: 0,
        },
        meta: {
          mandatory: true,
          publisherChannelId: 'ch-1',
        },
      };
      expect(ctx.replyCode).toBe(312);
      expect(ctx.meta.publisherChannelId).toBe('ch-1');
    });

    it('result is undefined', () => {
      expectTypeOf<ReturnResult>().toEqualTypeOf<undefined>();
    });
  });

  describe('persist', () => {
    it('covers all persist operations', () => {
      const ops: PersistCtx['operation'][] = [
        'write-message',
        'write-topology',
        'fsync',
      ];
      expect(ops).toHaveLength(3);
    });

    it('meta has optional counts', () => {
      const meta: PersistMeta = {
        messageCount: 10,
        sizeBytes: 1024,
      };
      expect(meta.messageCount).toBe(10);
    });

    it('result is undefined', () => {
      expectTypeOf<PersistResult>().toEqualTypeOf<undefined>();
    });
  });
});

// =============================================================================
// Aggregate hook interfaces
// =============================================================================

describe('RabbitInboundHooks', () => {
  it('has exactly 21 hook keys', () => {
    type InboundKeys = keyof RabbitInboundHooks;
    expectTypeOf<InboundKeys>().toEqualTypeOf<
      | 'publish'
      | 'consume'
      | 'get'
      | 'cancel'
      | 'ack'
      | 'nack'
      | 'reject'
      | 'recover'
      | 'exchangeDeclare'
      | 'checkExchange'
      | 'exchangeDelete'
      | 'exchangeBind'
      | 'exchangeUnbind'
      | 'queueDeclare'
      | 'checkQueue'
      | 'queueDelete'
      | 'queueBind'
      | 'queueUnbind'
      | 'purge'
      | 'prefetch'
      | 'confirmSelect'
    >();
  });

  it('each hook is a Hook<Ctx, Result>', () => {
    expectTypeOf<RabbitInboundHooks['publish']>().toEqualTypeOf<
      Hook<PublishCtx, PublishResult>
    >();
    expectTypeOf<RabbitInboundHooks['ack']>().toEqualTypeOf<
      Hook<AckCtx, AckResult>
    >();
    expectTypeOf<RabbitInboundHooks['queueDeclare']>().toEqualTypeOf<
      Hook<QueueDeclareCtx, QueueDeclareResult>
    >();
    expectTypeOf<RabbitInboundHooks['prefetch']>().toEqualTypeOf<
      Hook<PrefetchCtx, PrefetchResult>
    >();
    expectTypeOf<RabbitInboundHooks['confirmSelect']>().toEqualTypeOf<
      Hook<ConfirmSelectCtx, ConfirmSelectResult>
    >();
  });
});

describe('RabbitOutboundHooks', () => {
  it('has exactly 6 hook keys', () => {
    type OutboundKeys = keyof RabbitOutboundHooks;
    expectTypeOf<OutboundKeys>().toEqualTypeOf<
      'time' | 'timers' | 'random' | 'delivery' | 'return' | 'persist'
    >();
  });

  it('each hook is a Hook<Ctx, Result>', () => {
    expectTypeOf<RabbitOutboundHooks['time']>().toEqualTypeOf<
      Hook<TimeCtx, TimeResult>
    >();
    expectTypeOf<RabbitOutboundHooks['delivery']>().toEqualTypeOf<
      Hook<DeliveryCtx, DeliveryResult>
    >();
    expectTypeOf<RabbitOutboundHooks['return']>().toEqualTypeOf<
      Hook<ReturnCtx, ReturnResult>
    >();
  });
});

describe('RabbitHooks', () => {
  it('is the intersection of inbound and outbound', () => {
    type AllKeys = keyof RabbitHooks;

    // Verify it includes both inbound and outbound
    expectTypeOf<RabbitHooks>().toMatchTypeOf<RabbitInboundHooks>();
    expectTypeOf<RabbitHooks>().toMatchTypeOf<RabbitOutboundHooks>();

    // Total should be 21 + 6 = 27
    const allKeys: AllKeys[] = [
      // IBI (21)
      'publish',
      'consume',
      'get',
      'cancel',
      'ack',
      'nack',
      'reject',
      'recover',
      'exchangeDeclare',
      'checkExchange',
      'exchangeDelete',
      'exchangeBind',
      'exchangeUnbind',
      'queueDeclare',
      'checkQueue',
      'queueDelete',
      'queueBind',
      'queueUnbind',
      'purge',
      'prefetch',
      'confirmSelect',
      // OBI (6)
      'time',
      'timers',
      'random',
      'delivery',
      'return',
      'persist',
    ];
    expect(allKeys).toHaveLength(27);
  });
});

// =============================================================================
// Meta field mutability
// =============================================================================

describe('meta fields', () => {
  it('realDurationMs is mutable on all meta types', () => {
    const metas: { realDurationMs?: number }[] = [
      { realDurationMs: undefined } satisfies Partial<PublishMeta>,
      { realDurationMs: undefined } satisfies Partial<ConsumeMeta>,
      { realDurationMs: undefined } satisfies Partial<GetMeta>,
      { realDurationMs: undefined } satisfies Partial<CancelMeta>,
      { realDurationMs: undefined } satisfies Partial<AckMeta>,
      { realDurationMs: undefined } satisfies Partial<NackMeta>,
      { realDurationMs: undefined } satisfies Partial<RejectMeta>,
      { realDurationMs: undefined } satisfies Partial<RecoverMeta>,
      { realDurationMs: undefined } satisfies Partial<ExchangeDeclareMeta>,
      { realDurationMs: undefined } satisfies Partial<CheckExchangeMeta>,
      { realDurationMs: undefined } satisfies Partial<ExchangeDeleteMeta>,
      { realDurationMs: undefined } satisfies Partial<ExchangeBindMeta>,
      { realDurationMs: undefined } satisfies Partial<ExchangeUnbindMeta>,
      { realDurationMs: undefined } satisfies Partial<QueueDeclareMeta>,
      { realDurationMs: undefined } satisfies Partial<CheckQueueMeta>,
      { realDurationMs: undefined } satisfies Partial<QueueDeleteMeta>,
      { realDurationMs: undefined } satisfies Partial<QueueBindMeta>,
      { realDurationMs: undefined } satisfies Partial<QueueUnbindMeta>,
      { realDurationMs: undefined } satisfies Partial<PurgeMeta>,
      { realDurationMs: undefined } satisfies Partial<PrefetchMeta>,
      { realDurationMs: undefined } satisfies Partial<ConfirmSelectMeta>,
      { realDurationMs: undefined } satisfies Partial<TimeMeta>,
      { realDurationMs: undefined } satisfies Partial<TimerSetMeta>,
      { realDurationMs: undefined } satisfies Partial<RandomMeta>,
      { realDurationMs: undefined } satisfies Partial<DeliveryMeta>,
      { realDurationMs: undefined } satisfies Partial<ReturnMeta>,
      { realDurationMs: undefined } satisfies Partial<PersistMeta>,
    ];

    // All 27 hook metas should have realDurationMs
    expect(metas).toHaveLength(27);

    // Verify mutability: assignment should work
    for (const meta of metas) {
      meta.realDurationMs = 42;
      expect(meta.realDurationMs).toBe(42);
    }
  });
});

// =============================================================================
// Hook composition example
// =============================================================================

describe('hook composition', () => {
  it('pre handler can short-circuit publish', () => {
    const hook: Hook<PublishCtx, PublishResult> = {
      pre: () => ({
        type: 'short_circuit',
        result: { routed: false },
      }),
    };

    const ctx: PublishCtx = {
      exchange: 'ex',
      routingKey: 'key',
      body: new Uint8Array(),
      properties: {},
      mandatory: false,
      meta: { exchangeExists: true, exchangeType: 'direct' },
    };

    const decision = hook.pre?.(ctx);
    expect(decision).toEqual({
      type: 'short_circuit',
      result: { routed: false },
    });
  });

  it('post handler can transform get result', () => {
    const hook: Hook<GetCtx, GetResult> = {
      post: (_ctx, result) => {
        if (result === null) return null;
        return { ...result, redelivered: true };
      },
    };

    const ctx: GetCtx = {
      queue: 'q',
      noAck: false,
      meta: { queueExists: true, messageCount: 1, consumerCount: 0 },
    };

    const original: GetResult = {
      deliveryTag: 1,
      redelivered: false,
      exchange: '',
      routingKey: '',
      body: new Uint8Array(),
      properties: {},
    };

    const transformed = hook.post?.(ctx, original);
    expect(transformed).toEqual(expect.objectContaining({ redelivered: true }));
  });
});
