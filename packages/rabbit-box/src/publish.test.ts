import { describe, expect, it, beforeEach, vi } from 'vitest';
import { publish, type PublishOptions } from './publish.ts';
import { ExchangeRegistry } from './exchange-registry.ts';
import { BindingStore } from './binding-store.ts';
import { QueueRegistry } from './queue-registry.ts';
import { MessageStore } from './message-store.ts';
import { ChannelError } from './errors/amqp-error.ts';
import {
  NOT_FOUND,
  ACCESS_REFUSED,
  PRECONDITION_FAILED,
} from './errors/reply-codes.ts';
import type { MessageProperties } from './types/message.ts';

const BASIC_CLASS_ID = 60;
const BASIC_PUBLISH_METHOD_ID = 40;

function assertDefined<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).toBeDefined();
  return value as T;
}

function body(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

type OnReturnFn = PublishOptions['onReturn'];
type OnDispatchFn = PublishOptions['onDispatch'];

interface TestContext {
  exchanges: ExchangeRegistry;
  bindings: BindingStore;
  queues: QueueRegistry;
  stores: Map<string, MessageStore>;
  dispatchedQueues: string[];
  getStore: (queue: string) => MessageStore;
  onReturn: ReturnType<typeof vi.fn<OnReturnFn>>;
  onDispatch: ReturnType<typeof vi.fn<OnDispatchFn>>;
}

function setup(): TestContext {
  const exchanges = new ExchangeRegistry();
  const bindings = new BindingStore({
    hasExchange: (name) => exchanges.hasExchange(name),
  });
  const queues = new QueueRegistry();
  const stores = new Map<string, MessageStore>();

  const getStore = (queue: string): MessageStore => {
    let store = stores.get(queue);
    if (!store) {
      store = new MessageStore();
      stores.set(queue, store);
    }
    return store;
  };

  const dispatchedQueues: string[] = [];
  const onDispatch = vi.fn<OnDispatchFn>((queue: string) => {
    dispatchedQueues.push(queue);
  });
  const onReturn = vi.fn<OnReturnFn>();

  return {
    exchanges,
    bindings,
    queues,
    stores,
    dispatchedQueues,
    getStore,
    onReturn,
    onDispatch,
  };
}

function doPublish(
  ctx: TestContext,
  exchange: string,
  routingKey: string,
  bodyContent: Uint8Array,
  properties: MessageProperties = {},
  options: {
    mandatory?: boolean;
    immediate?: boolean;
    userId?: string;
  } = {}
) {
  return publish({
    exchange,
    routingKey,
    body: bodyContent,
    properties,
    mandatory: options.mandatory ?? false,
    immediate: options.immediate ?? false,
    exchangeRegistry: ctx.exchanges,
    bindingStore: ctx.bindings,
    queueRegistry: ctx.queues,
    getMessageStore: ctx.getStore,
    onReturn: ctx.onReturn,
    onDispatch: ctx.onDispatch,
    authenticatedUserId: options.userId,
  });
}

describe('publish', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setup();
  });

  // ── Exchange validation ─────────────────────────────────────────────

  describe('exchange validation', () => {
    it('throws NOT_FOUND for non-existent exchange (non-default)', () => {
      try {
        doPublish(ctx, 'no-such-exchange', 'key', body('hello'));
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(NOT_FOUND);
        expect(e.replyText).toContain("no exchange 'no-such-exchange'");
        expect(e.classId).toBe(BASIC_CLASS_ID);
        expect(e.methodId).toBe(BASIC_PUBLISH_METHOD_ID);
      }
    });

    it('does not throw NOT_FOUND for default exchange ""', () => {
      ctx.queues.declareQueue('my-queue', {});
      const result = doPublish(ctx, '', 'my-queue', body('hello'));
      expect(result.routed).toBe(true);
    });

    it('throws ACCESS_REFUSED when publishing to internal exchange', () => {
      ctx.exchanges.declareExchange('internal-ex', 'direct', {
        internal: true,
      });

      try {
        doPublish(ctx, 'internal-ex', 'key', body('hello'));
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(ACCESS_REFUSED);
        expect(e.replyText).toContain('internal-ex');
        expect(e.classId).toBe(BASIC_CLASS_ID);
        expect(e.methodId).toBe(BASIC_PUBLISH_METHOD_ID);
      }
    });
  });

  // ── Default exchange routing ────────────────────────────────────────

  describe('default exchange routing', () => {
    it('routes to queue named by routing key', () => {
      ctx.queues.declareQueue('orders', {});
      const result = doPublish(ctx, '', 'orders', body('order-1'));

      expect(result.routed).toBe(true);
      const store = ctx.getStore('orders');
      expect(store.count()).toBe(1);
      const msg = assertDefined(store.dequeue());
      expect(msg.exchange).toBe('');
      expect(msg.routingKey).toBe('orders');
    });

    it('returns routed=false when queue does not exist for default exchange', () => {
      const result = doPublish(ctx, '', 'no-such-queue', body('hello'));
      expect(result.routed).toBe(false);
    });

    it('emits basic.return for mandatory message when queue does not exist on default exchange', () => {
      const result = doPublish(
        ctx,
        '',
        'no-such-queue',
        body('hello'),
        {},
        { mandatory: true }
      );

      expect(result.routed).toBe(false);
      expect(ctx.onReturn).toHaveBeenCalledOnce();
      const returnCall = assertDefined(ctx.onReturn.mock.calls[0]);
      expect(returnCall[0]).toBe(312);
      expect(returnCall[1]).toBe('NO_ROUTE');
    });
  });

  // ── Direct exchange routing ─────────────────────────────────────────

  describe('direct exchange routing', () => {
    it('routes to single queue with matching binding', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'key1', {});

      const result = doPublish(ctx, 'my-direct', 'key1', body('hello'));

      expect(result.routed).toBe(true);
      expect(ctx.getStore('q1').count()).toBe(1);
    });

    it('does not route when no binding matches', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'key1', {});

      const result = doPublish(ctx, 'my-direct', 'key-other', body('hello'));

      expect(result.routed).toBe(false);
      expect(ctx.getStore('q1').count()).toBe(0);
    });

    it('routes to multiple queues with same binding key', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.queues.declareQueue('q2', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'shared', {});
      ctx.bindings.addBinding('my-direct', 'q2', 'shared', {});

      const result = doPublish(ctx, 'my-direct', 'shared', body('hello'));

      expect(result.routed).toBe(true);
      expect(ctx.getStore('q1').count()).toBe(1);
      expect(ctx.getStore('q2').count()).toBe(1);
    });
  });

  // ── Fanout exchange routing ─────────────────────────────────────────

  describe('fanout exchange routing', () => {
    it('routes to all bound queues regardless of routing key', () => {
      ctx.exchanges.declareExchange('my-fanout', 'fanout');
      ctx.queues.declareQueue('q1', {});
      ctx.queues.declareQueue('q2', {});
      ctx.queues.declareQueue('q3', {});
      ctx.bindings.addBinding('my-fanout', 'q1', '', {});
      ctx.bindings.addBinding('my-fanout', 'q2', '', {});
      ctx.bindings.addBinding('my-fanout', 'q3', '', {});

      const result = doPublish(ctx, 'my-fanout', 'any-key', body('hello'));

      expect(result.routed).toBe(true);
      expect(ctx.getStore('q1').count()).toBe(1);
      expect(ctx.getStore('q2').count()).toBe(1);
      expect(ctx.getStore('q3').count()).toBe(1);
    });
  });

  // ── Topic exchange routing ──────────────────────────────────────────

  describe('topic exchange routing', () => {
    it('routes with wildcard pattern matching', () => {
      ctx.exchanges.declareExchange('my-topic', 'topic');
      ctx.queues.declareQueue('q1', {});
      ctx.queues.declareQueue('q2', {});
      ctx.bindings.addBinding('my-topic', 'q1', 'log.*', {});
      ctx.bindings.addBinding('my-topic', 'q2', 'log.error', {});

      const result = doPublish(ctx, 'my-topic', 'log.error', body('err'));

      expect(result.routed).toBe(true);
      expect(ctx.getStore('q1').count()).toBe(1);
      expect(ctx.getStore('q2').count()).toBe(1);
    });
  });

  // ── Message copy isolation ──────────────────────────────────────────

  describe('message copy isolation', () => {
    it('each queue gets its own copy of the message', () => {
      ctx.exchanges.declareExchange('my-fanout', 'fanout');
      ctx.queues.declareQueue('q1', {});
      ctx.queues.declareQueue('q2', {});
      ctx.bindings.addBinding('my-fanout', 'q1', '', {});
      ctx.bindings.addBinding('my-fanout', 'q2', '', {});

      doPublish(ctx, 'my-fanout', '', body('hello'));

      const msg1 = assertDefined(ctx.getStore('q1').dequeue());
      const msg2 = assertDefined(ctx.getStore('q2').dequeue());

      expect(msg1).not.toBe(msg2);
      expect(msg1.body).toEqual(msg2.body);
      expect(msg1.properties).toEqual(msg2.properties);
    });
  });

  // ── Mandatory messages ──────────────────────────────────────────────

  describe('mandatory messages', () => {
    it('emits basic.return when no queues matched and mandatory=true', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');

      const result = doPublish(
        ctx,
        'my-direct',
        'unmatched-key',
        body('important'),
        { contentType: 'text/plain' },
        { mandatory: true }
      );

      expect(result.routed).toBe(false);
      expect(ctx.onReturn).toHaveBeenCalledOnce();
      const [
        replyCode,
        replyText,
        returnedExchange,
        returnedRk,
        returnedBody,
        returnedProps,
      ] = assertDefined(ctx.onReturn.mock.calls[0]);
      expect(replyCode).toBe(312);
      expect(replyText).toBe('NO_ROUTE');
      expect(returnedExchange).toBe('my-direct');
      expect(returnedRk).toBe('unmatched-key');
      expect(returnedBody).toEqual(body('important'));
      expect(returnedProps.contentType).toBe('text/plain');
    });

    it('does not emit basic.return when mandatory=false and no queues matched', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');

      const result = doPublish(
        ctx,
        'my-direct',
        'unmatched-key',
        body('hello')
      );

      expect(result.routed).toBe(false);
      expect(ctx.onReturn).not.toHaveBeenCalled();
    });

    it('basic.return includes original properties with BCC header intact', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');

      const result = doPublish(
        ctx,
        'my-direct',
        'unmatched-key',
        body('hello'),
        { headers: { BCC: ['some-key'], 'x-custom': 'val' } },
        { mandatory: true }
      );

      expect(result.routed).toBe(false);
      expect(ctx.onReturn).toHaveBeenCalledOnce();
      const [, , , , , returnedProps] = assertDefined(
        ctx.onReturn.mock.calls[0]
      );
      expect(returnedProps.headers?.['BCC']).toEqual(['some-key']);
      expect(returnedProps.headers?.['x-custom']).toBe('val');
    });

    it('does not emit basic.return when mandatory=true but message was routed', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'key', {});

      const result = doPublish(
        ctx,
        'my-direct',
        'key',
        body('hello'),
        {},
        { mandatory: true }
      );

      expect(result.routed).toBe(true);
      expect(ctx.onReturn).not.toHaveBeenCalled();
    });
  });

  // ── Consumer dispatch trigger ───────────────────────────────────────

  describe('consumer dispatch trigger', () => {
    it('triggers dispatch for each affected queue', () => {
      ctx.exchanges.declareExchange('my-fanout', 'fanout');
      ctx.queues.declareQueue('q1', {});
      ctx.queues.declareQueue('q2', {});
      ctx.bindings.addBinding('my-fanout', 'q1', '', {});
      ctx.bindings.addBinding('my-fanout', 'q2', '', {});

      doPublish(ctx, 'my-fanout', '', body('hello'));

      expect(ctx.onDispatch).toHaveBeenCalledTimes(2);
      expect(ctx.dispatchedQueues).toContain('q1');
      expect(ctx.dispatchedQueues).toContain('q2');
    });

    it('does not trigger dispatch when no queues matched', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');

      doPublish(ctx, 'my-direct', 'unmatched', body('hello'));

      expect(ctx.onDispatch).not.toHaveBeenCalled();
    });

    it('triggers dispatch only once per queue even with multiple matching bindings', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'key', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'key', {
        'x-extra': true,
      });

      doPublish(ctx, 'my-direct', 'key', body('hello'));

      expect(ctx.getStore('q1').count()).toBe(1);
      expect(ctx.onDispatch).toHaveBeenCalledTimes(1);
    });
  });

  // ── CC/BCC header support ───────────────────────────────────────────

  describe('CC/BCC header support', () => {
    it('routes additionally using CC routing keys', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q-main', {});
      ctx.queues.declareQueue('q-cc', {});
      ctx.bindings.addBinding('my-direct', 'q-main', 'main-key', {});
      ctx.bindings.addBinding('my-direct', 'q-cc', 'cc-key', {});

      const result = doPublish(ctx, 'my-direct', 'main-key', body('hello'), {
        headers: { CC: ['cc-key'] },
      });

      expect(result.routed).toBe(true);
      expect(ctx.getStore('q-main').count()).toBe(1);
      expect(ctx.getStore('q-cc').count()).toBe(1);
    });

    it('routes additionally using BCC routing keys', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q-main', {});
      ctx.queues.declareQueue('q-bcc', {});
      ctx.bindings.addBinding('my-direct', 'q-main', 'main-key', {});
      ctx.bindings.addBinding('my-direct', 'q-bcc', 'bcc-key', {});

      const result = doPublish(ctx, 'my-direct', 'main-key', body('hello'), {
        headers: { BCC: ['bcc-key'] },
      });

      expect(result.routed).toBe(true);
      expect(ctx.getStore('q-main').count()).toBe(1);
      expect(ctx.getStore('q-bcc').count()).toBe(1);
    });

    it('strips BCC header from delivered messages', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q-main', {});
      ctx.queues.declareQueue('q-bcc', {});
      ctx.bindings.addBinding('my-direct', 'q-main', 'main-key', {});
      ctx.bindings.addBinding('my-direct', 'q-bcc', 'bcc-key', {});

      doPublish(ctx, 'my-direct', 'main-key', body('hello'), {
        headers: { BCC: ['bcc-key'], 'x-custom': 'value' },
      });

      const msg1 = assertDefined(ctx.getStore('q-main').dequeue());
      const msg2 = assertDefined(ctx.getStore('q-bcc').dequeue());

      expect(msg1.properties.headers).not.toHaveProperty('BCC');
      expect(msg2.properties.headers).not.toHaveProperty('BCC');
      expect(msg1.properties.headers?.['x-custom']).toBe('value');
      expect(msg2.properties.headers?.['x-custom']).toBe('value');
    });

    it('preserves CC header in delivered messages', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q-main', {});
      ctx.bindings.addBinding('my-direct', 'q-main', 'main-key', {});

      doPublish(ctx, 'my-direct', 'main-key', body('hello'), {
        headers: { CC: ['other-key'] },
      });

      const msg = assertDefined(ctx.getStore('q-main').dequeue());
      expect(msg.properties.headers?.['CC']).toEqual(['other-key']);
    });

    it('handles CC as a single string (non-array)', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q-main', {});
      ctx.queues.declareQueue('q-cc', {});
      ctx.bindings.addBinding('my-direct', 'q-main', 'main-key', {});
      ctx.bindings.addBinding('my-direct', 'q-cc', 'cc-key', {});

      const result = doPublish(ctx, 'my-direct', 'main-key', body('hello'), {
        headers: { CC: 'cc-key' },
      });

      expect(result.routed).toBe(true);
      expect(ctx.getStore('q-cc').count()).toBe(1);
    });

    it('routes using CC keys on the default exchange', () => {
      ctx.queues.declareQueue('q-main', {});
      ctx.queues.declareQueue('q-cc', {});

      const result = doPublish(ctx, '', 'q-main', body('hello'), {
        headers: { CC: ['q-cc'] },
      });

      expect(result.routed).toBe(true);
      expect(ctx.getStore('q-main').count()).toBe(1);
      expect(ctx.getStore('q-cc').count()).toBe(1);
    });

    it('routes using BCC keys on the default exchange', () => {
      ctx.queues.declareQueue('q-main', {});
      ctx.queues.declareQueue('q-bcc', {});

      const result = doPublish(ctx, '', 'q-main', body('hello'), {
        headers: { BCC: ['q-bcc'] },
      });

      expect(result.routed).toBe(true);
      expect(ctx.getStore('q-main').count()).toBe(1);
      expect(ctx.getStore('q-bcc').count()).toBe(1);
    });

    it('deduplicates queues across main routing and CC/BCC routing', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'key', {});

      doPublish(ctx, 'my-direct', 'key', body('hello'), {
        headers: { CC: ['key'] },
      });

      expect(ctx.getStore('q1').count()).toBe(1);
    });
  });

  // ── user-id validation ──────────────────────────────────────────────

  describe('user-id validation', () => {
    it('allows message when userId matches authenticated user', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'key', {});

      const result = doPublish(
        ctx,
        'my-direct',
        'key',
        body('hello'),
        { userId: 'guest' },
        { userId: 'guest' }
      );

      expect(result.routed).toBe(true);
    });

    it('throws PRECONDITION_FAILED when userId does not match authenticated user', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');

      try {
        doPublish(
          ctx,
          'my-direct',
          'key',
          body('hello'),
          { userId: 'imposter' },
          { userId: 'guest' }
        );
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(PRECONDITION_FAILED);
        expect(e.replyText).toContain('user_id');
        expect(e.classId).toBe(BASIC_CLASS_ID);
        expect(e.methodId).toBe(BASIC_PUBLISH_METHOD_ID);
      }
    });

    it('allows message without userId property regardless of authenticated user', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'key', {});

      const result = doPublish(
        ctx,
        'my-direct',
        'key',
        body('hello'),
        {},
        { userId: 'guest' }
      );

      expect(result.routed).toBe(true);
    });

    it('allows message with userId when no authenticated user is set', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'key', {});

      const result = doPublish(ctx, 'my-direct', 'key', body('hello'), {
        userId: 'anyone',
      });

      expect(result.routed).toBe(true);
    });
  });

  // ── Message properties ──────────────────────────────────────────────

  describe('message properties', () => {
    it('enqueued message has correct exchange and routingKey', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'rk', {});

      doPublish(ctx, 'my-direct', 'rk', body('hello'), {
        contentType: 'text/plain',
        correlationId: 'abc',
      });

      const msg = assertDefined(ctx.getStore('q1').dequeue());
      expect(msg.exchange).toBe('my-direct');
      expect(msg.routingKey).toBe('rk');
      expect(msg.properties.contentType).toBe('text/plain');
      expect(msg.properties.correlationId).toBe('abc');
      expect(msg.mandatory).toBe(false);
    });

    it('preserves mandatory flag on enqueued message', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'key', {});

      doPublish(
        ctx,
        'my-direct',
        'key',
        body('hello'),
        {},
        { mandatory: true }
      );

      const msg = assertDefined(ctx.getStore('q1').dequeue());
      expect(msg.mandatory).toBe(true);
    });
  });

  // ── Return value ────────────────────────────────────────────────────

  describe('return value', () => {
    it('returns routed=true when at least one queue received the message', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');
      ctx.queues.declareQueue('q1', {});
      ctx.bindings.addBinding('my-direct', 'q1', 'key', {});

      const result = doPublish(ctx, 'my-direct', 'key', body('hello'));
      expect(result.routed).toBe(true);
    });

    it('returns routed=false when no queue received the message', () => {
      ctx.exchanges.declareExchange('my-direct', 'direct');

      const result = doPublish(ctx, 'my-direct', 'no-match', body('hello'));
      expect(result.routed).toBe(false);
    });
  });
});
