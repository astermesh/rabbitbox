import { describe, expect, it, vi } from 'vitest';
import type {
  Hook,
  PublishCtx,
  PublishResult as SbiPublishResult,
  AckCtx,
  AckResult,
  NackCtx,
  NackResult,
  RejectCtx,
  RejectResult,
  ExchangeDeclareCtx,
  ExchangeDeclareResult,
  ExchangeDeleteCtx,
  ExchangeDeleteResult,
  QueueDeclareCtx,
  QueueDeclareResult,
  QueueDeleteCtx,
  QueueDeleteResult,
  QueueBindCtx,
  QueueBindResult,
  QueueUnbindCtx,
  QueueUnbindResult,
  PurgeCtx,
  PurgeResult,
  ConsumeCtx,
  ConsumeResult,
  CancelCtx,
  CancelResult,
  PrefetchCtx,
  PrefetchResult,
  ConfirmSelectCtx,
  ConfirmSelectResult,
  GetCtx,
  GetResult,
  RecoverCtx,
  RecoverResult,
  ExchangeBindCtx,
  ExchangeBindResult,
  ExchangeUnbindCtx,
  ExchangeUnbindResult,
} from '@rabbitbox/sbi';
import { publish, type PublishOptions } from './publish.ts';
import { ack, nack, reject } from './acknowledgment.ts';
import { ExchangeRegistry } from './exchange-registry.ts';
import { QueueRegistry } from './queue-registry.ts';
import { BindingStore } from './binding-store.ts';
import { MessageStore } from './message-store.ts';
import { ConsumerRegistry } from './consumer-registry.ts';
import { Channel } from './channel.ts';
import type { BrokerMessage } from './types/message.ts';

function body(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function assertDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

function makeBrokerMessage(): BrokerMessage {
  return {
    body: body('test'),
    properties: {},
    exchange: 'ex',
    routingKey: 'rk',
    mandatory: false,
    immediate: false,
    deliveryCount: 0,
    enqueuedAt: Date.now(),
    priority: 0,
  };
}

// ── Publish hook integration ──────────────────────────────────────

describe('publish with hooks', () => {
  function setup(hook?: Hook<PublishCtx, SbiPublishResult>) {
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
    const onReturn = vi.fn<PublishOptions['onReturn']>();
    const onDispatch = vi.fn<PublishOptions['onDispatch']>();

    return {
      exchanges,
      bindings,
      queues,
      stores,
      getStore,
      onReturn,
      onDispatch,
      hook,
    };
  }

  it('pre-hook fail prevents publish and throws error', () => {
    const hook: Hook<PublishCtx, SbiPublishResult> = {
      pre: () => ({ type: 'fail', error: new Error('publish blocked') }),
    };
    const ctx = setup(hook);
    ctx.exchanges.declareExchange('test', 'direct');
    ctx.queues.declareQueue('q1', {});
    ctx.bindings.addBinding('test', 'q1', 'key', {});

    expect(() =>
      publish({
        exchange: 'test',
        routingKey: 'key',
        body: body('hello'),
        properties: {},
        mandatory: false,
        immediate: false,
        exchangeRegistry: ctx.exchanges,
        bindingStore: ctx.bindings,
        queueRegistry: ctx.queues,
        getMessageStore: ctx.getStore,
        onReturn: ctx.onReturn,
        onDispatch: ctx.onDispatch,
        hook,
      })
    ).toThrow('publish blocked');

    expect(ctx.getStore('q1').count()).toBe(0);
  });

  it('pre-hook short_circuit skips publish and returns specified value', () => {
    const hook: Hook<PublishCtx, SbiPublishResult> = {
      pre: () => ({
        type: 'short_circuit',
        result: { routed: true },
      }),
    };
    const ctx = setup(hook);
    ctx.exchanges.declareExchange('test', 'direct');

    const result = publish({
      exchange: 'test',
      routingKey: 'key',
      body: body('hello'),
      properties: {},
      mandatory: false,
      immediate: false,
      exchangeRegistry: ctx.exchanges,
      bindingStore: ctx.bindings,
      queueRegistry: ctx.queues,
      getMessageStore: ctx.getStore,
      onReturn: ctx.onReturn,
      onDispatch: ctx.onDispatch,
      hook,
    });

    expect(result.routed).toBe(true);
    expect(ctx.onDispatch).not.toHaveBeenCalled();
  });

  it('post-hook transform modifies publish result', () => {
    const hook: Hook<PublishCtx, SbiPublishResult> = {
      post: (_ctx, result) => ({ routed: !result.routed }),
    };
    const ctx = setup(hook);
    ctx.exchanges.declareExchange('test', 'direct');
    ctx.queues.declareQueue('q1', {});
    ctx.bindings.addBinding('test', 'q1', 'key', {});

    const result = publish({
      exchange: 'test',
      routingKey: 'key',
      body: body('hello'),
      properties: {},
      mandatory: false,
      immediate: false,
      exchangeRegistry: ctx.exchanges,
      bindingStore: ctx.bindings,
      queueRegistry: ctx.queues,
      getMessageStore: ctx.getStore,
      onReturn: ctx.onReturn,
      onDispatch: ctx.onDispatch,
      hook,
    });

    expect(result.routed).toBe(false);
    expect(ctx.getStore('q1').count()).toBe(1);
  });

  it('pre-hook receives correct context meta', () => {
    const preFn = vi.fn<(ctx: PublishCtx) => undefined>();
    const hook: Hook<PublishCtx, SbiPublishResult> = { pre: preFn };
    const ctx = setup(hook);
    ctx.exchanges.declareExchange('test', 'direct');

    publish({
      exchange: 'test',
      routingKey: 'key',
      body: body('hello'),
      properties: {},
      mandatory: true,
      immediate: false,
      exchangeRegistry: ctx.exchanges,
      bindingStore: ctx.bindings,
      queueRegistry: ctx.queues,
      getMessageStore: ctx.getStore,
      onReturn: ctx.onReturn,
      onDispatch: ctx.onDispatch,
      hook,
    });

    expect(preFn).toHaveBeenCalledOnce();
    const passedCtx = assertDefined(preFn.mock.calls[0])[0];
    expect(passedCtx.exchange).toBe('test');
    expect(passedCtx.routingKey).toBe('key');
    expect(passedCtx.mandatory).toBe(true);
    expect(passedCtx.meta.exchangeExists).toBe(true);
    expect(passedCtx.meta.exchangeType).toBe('direct');
  });

  it('no-hook pass-through has identical behavior', () => {
    const ctx = setup();
    ctx.exchanges.declareExchange('test', 'direct');
    ctx.queues.declareQueue('q1', {});
    ctx.bindings.addBinding('test', 'q1', 'key', {});

    const result = publish({
      exchange: 'test',
      routingKey: 'key',
      body: body('hello'),
      properties: {},
      mandatory: false,
      immediate: false,
      exchangeRegistry: ctx.exchanges,
      bindingStore: ctx.bindings,
      queueRegistry: ctx.queues,
      getMessageStore: ctx.getStore,
      onReturn: ctx.onReturn,
      onDispatch: ctx.onDispatch,
    });

    expect(result.routed).toBe(true);
    expect(ctx.getStore('q1').count()).toBe(1);
  });
});

// ── Acknowledgment hook integration ───────────────────────────────

describe('ack/nack/reject with hooks', () => {
  function setupChannel() {
    const requeued: { queue: string; message: BrokerMessage }[] = [];
    const dispatched: string[] = [];
    const ch = new Channel(1, {
      onRequeue: (q, m) => requeued.push({ queue: q, message: m }),
      onClose: noop,
    });
    const deps = {
      onRequeue: (q: string, m: BrokerMessage) =>
        requeued.push({ queue: q, message: m }),
      onDispatch: (q: string) => dispatched.push(q),
    };

    ch.trackUnacked(1, makeBrokerMessage(), 'q1', 'ctag-1');

    return { ch, deps, requeued, dispatched };
  }

  it('ack pre-hook fail prevents acknowledgment', () => {
    const hook: Hook<AckCtx, AckResult> = {
      pre: () => ({ type: 'fail', error: new Error('ack blocked') }),
    };
    const { ch, deps } = setupChannel();

    expect(() => ack(ch, 1, false, deps, hook)).toThrow('ack blocked');
    expect(ch.unackedCount).toBe(1);
  });

  it('ack pre-hook context has correct meta', () => {
    const preFn = vi.fn<(ctx: AckCtx) => undefined>();
    const hook: Hook<AckCtx, AckResult> = { pre: preFn };
    const { ch, deps } = setupChannel();

    ack(ch, 1, false, deps, hook);

    expect(preFn).toHaveBeenCalledOnce();
    const ctx = assertDefined(preFn.mock.calls[0])[0];
    expect(ctx.deliveryTag).toBe(1);
    expect(ctx.multiple).toBe(false);
    expect(ctx.meta.messageExists).toBe(true);
    expect(ctx.meta.consumerTag).toBe('ctag-1');
    expect(ctx.meta.queue).toBe('q1');
  });

  it('nack pre-hook short_circuit skips nack operation', () => {
    const hook: Hook<NackCtx, NackResult> = {
      pre: () => ({ type: 'short_circuit', result: undefined }),
    };
    const { ch, deps, requeued } = setupChannel();

    nack(ch, 1, false, true, deps, hook);

    expect(ch.unackedCount).toBe(1);
    expect(requeued).toHaveLength(0);
  });

  it('reject works with hooks passing through', () => {
    const preFn = vi.fn<(ctx: RejectCtx) => undefined>();
    const hook: Hook<RejectCtx, RejectResult> = { pre: preFn };
    const { ch, deps, requeued } = setupChannel();

    reject(ch, 1, true, deps, hook);

    expect(preFn).toHaveBeenCalledOnce();
    expect(ch.unackedCount).toBe(0);
    expect(requeued).toHaveLength(1);
  });
});

// ── Exchange registry hook integration ────────────────────────────

describe('exchange registry with hooks', () => {
  it('exchangeDeclare pre-hook fail prevents declaration', () => {
    const hook: Hook<ExchangeDeclareCtx, ExchangeDeclareResult> = {
      pre: () => ({ type: 'fail', error: new Error('declare blocked') }),
    };
    const registry = new ExchangeRegistry({
      hooks: { exchangeDeclare: hook },
    });

    expect(() => registry.declareExchange('test', 'direct')).toThrow(
      'declare blocked'
    );
    expect(registry.hasExchange('test')).toBe(false);
  });

  it('exchangeDeclare context has alreadyExists meta', () => {
    const preFn = vi.fn<(ctx: ExchangeDeclareCtx) => undefined>();
    const hook: Hook<ExchangeDeclareCtx, ExchangeDeclareResult> = {
      pre: preFn,
    };
    const registry = new ExchangeRegistry({
      hooks: { exchangeDeclare: hook },
    });

    registry.declareExchange('test', 'direct');
    expect(assertDefined(preFn.mock.calls[0])[0].meta.alreadyExists).toBe(
      false
    );

    registry.declareExchange('test', 'direct');
    expect(assertDefined(preFn.mock.calls[1])[0].meta.alreadyExists).toBe(true);
  });

  it('exchangeDelete pre-hook fail prevents deletion', () => {
    const hook: Hook<ExchangeDeleteCtx, ExchangeDeleteResult> = {
      pre: () => ({ type: 'fail', error: new Error('delete blocked') }),
    };
    const registry = new ExchangeRegistry({
      hooks: { exchangeDelete: hook },
    });
    registry.declareExchange('test', 'direct');

    expect(() => registry.deleteExchange('test')).toThrow('delete blocked');
    expect(registry.hasExchange('test')).toBe(true);
  });
});

// ── Queue registry hook integration ──────────────────────────────

describe('queue registry with hooks', () => {
  it('queueDeclare pre-hook fail prevents declaration', () => {
    const hook: Hook<QueueDeclareCtx, QueueDeclareResult> = {
      pre: () => ({ type: 'fail', error: new Error('declare blocked') }),
    };
    const registry = new QueueRegistry({ hooks: { queueDeclare: hook } });

    expect(() => registry.declareQueue('test', {})).toThrow('declare blocked');
    expect(registry.getQueue('test')).toBeUndefined();
  });

  it('queueDelete pre-hook fail prevents deletion', () => {
    const hook: Hook<QueueDeleteCtx, QueueDeleteResult> = {
      pre: () => ({ type: 'fail', error: new Error('delete blocked') }),
    };
    const registry = new QueueRegistry({ hooks: { queueDelete: hook } });
    registry.declareQueue('test', {});

    expect(() => registry.deleteQueue('test')).toThrow('delete blocked');
    expect(registry.getQueue('test')).toBeDefined();
  });

  it('purge pre-hook fail prevents purge', () => {
    const hook: Hook<PurgeCtx, PurgeResult> = {
      pre: () => ({ type: 'fail', error: new Error('purge blocked') }),
    };
    const registry = new QueueRegistry({ hooks: { purge: hook } });
    registry.declareQueue('test', {});
    registry.setMessageCount('test', 5);

    expect(() => registry.purgeQueue('test')).toThrow('purge blocked');
  });

  it('purge post-hook transform modifies result', () => {
    const hook: Hook<PurgeCtx, PurgeResult> = {
      post: () => ({ messageCount: 999 }),
    };
    const registry = new QueueRegistry({ hooks: { purge: hook } });
    registry.declareQueue('test', {});
    registry.setMessageCount('test', 5);

    const result = registry.purgeQueue('test');
    expect(result.messageCount).toBe(999);
  });
});

// ── Binding store hook integration ───────────────────────────────

describe('binding store with hooks', () => {
  it('queueBind pre-hook fail prevents binding', () => {
    const hook: Hook<QueueBindCtx, QueueBindResult> = {
      pre: () => ({ type: 'fail', error: new Error('bind blocked') }),
    };
    const store = new BindingStore({ hooks: { queueBind: hook } });

    expect(() => store.addBinding('ex', 'q', 'key', {})).toThrow(
      'bind blocked'
    );
    expect(store.getBindings('ex')).toHaveLength(0);
  });

  it('queueUnbind pre-hook fail prevents unbinding', () => {
    const hook: Hook<QueueUnbindCtx, QueueUnbindResult> = {
      pre: () => ({ type: 'fail', error: new Error('unbind blocked') }),
    };
    const store = new BindingStore({ hooks: { queueUnbind: hook } });
    store.addBinding('ex', 'q', 'key', {});

    expect(() => store.removeBinding('ex', 'q', 'key', {})).toThrow(
      'unbind blocked'
    );
    expect(store.getBindings('ex')).toHaveLength(1);
  });

  it('exchangeBind pre-hook fail prevents binding', () => {
    const hook: Hook<ExchangeBindCtx, ExchangeBindResult> = {
      pre: () => ({ type: 'fail', error: new Error('e2e bind blocked') }),
    };
    const store = new BindingStore({ hooks: { exchangeBind: hook } });

    expect(() => store.addExchangeBinding('dest', 'src', 'key', {})).toThrow(
      'e2e bind blocked'
    );
  });

  it('exchangeUnbind pre-hook fail prevents unbinding', () => {
    const hook: Hook<ExchangeUnbindCtx, ExchangeUnbindResult> = {
      pre: () => ({
        type: 'fail',
        error: new Error('e2e unbind blocked'),
      }),
    };
    const store = new BindingStore({ hooks: { exchangeUnbind: hook } });
    store.addExchangeBinding('dest', 'src', 'key', {});

    expect(() => store.removeExchangeBinding('dest', 'src', 'key', {})).toThrow(
      'e2e unbind blocked'
    );
  });
});

// ── Consumer registry hook integration ───────────────────────────

describe('consumer registry with hooks', () => {
  it('consume pre-hook fail prevents registration', () => {
    const hook: Hook<ConsumeCtx, ConsumeResult> = {
      pre: () => ({ type: 'fail', error: new Error('consume blocked') }),
    };
    const registry = new ConsumerRegistry({ hooks: { consume: hook } });

    expect(() => registry.register('q1', 1, noop, {})).toThrow(
      'consume blocked'
    );
    expect(registry.getConsumerCount('q1')).toBe(0);
  });

  it('consume context has correct meta', () => {
    const preFn = vi.fn<(ctx: ConsumeCtx) => undefined>();
    const hook: Hook<ConsumeCtx, ConsumeResult> = { pre: preFn };
    const registry = new ConsumerRegistry({ hooks: { consume: hook } });

    registry.register('q1', 1, noop, { noAck: true, exclusive: false });

    expect(preFn).toHaveBeenCalledOnce();
    const ctx = assertDefined(preFn.mock.calls[0])[0];
    expect(ctx.queue).toBe('q1');
    expect(ctx.noAck).toBe(true);
    expect(ctx.exclusive).toBe(false);
    expect(ctx.meta.existingConsumerCount).toBe(0);
  });

  it('cancel pre-hook fail prevents cancellation', () => {
    const hook: Hook<CancelCtx, CancelResult> = {
      pre: () => ({ type: 'fail', error: new Error('cancel blocked') }),
    };
    const registry = new ConsumerRegistry({ hooks: { cancel: hook } });
    const tag = registry.register('q1', 1, noop, {});

    expect(() => registry.cancel(tag)).toThrow('cancel blocked');
    expect(registry.getConsumer(tag)).toBeDefined();
  });
});

// ── Channel hook integration (prefetch, confirmSelect, get, recover) ──

describe('channel with hooks', () => {
  function makeDeps() {
    return { onRequeue: noop, onClose: noop };
  }

  it('prefetch pre-hook fail prevents setting prefetch', () => {
    const hook: Hook<PrefetchCtx, PrefetchResult> = {
      pre: () => ({ type: 'fail', error: new Error('prefetch blocked') }),
    };
    const ch = new Channel(1, makeDeps(), { prefetch: hook });

    expect(() => ch.setPrefetch(10, false)).toThrow('prefetch blocked');
    expect(ch.consumerPrefetch).toBe(0);
  });

  it('prefetch context has previousCount meta', () => {
    const preFn = vi.fn<(ctx: PrefetchCtx) => undefined>();
    const hook: Hook<PrefetchCtx, PrefetchResult> = { pre: preFn };
    const ch = new Channel(1, makeDeps(), { prefetch: hook });

    ch.setPrefetch(10, false);
    expect(assertDefined(preFn.mock.calls[0])[0].meta.previousCount).toBe(0);

    ch.setPrefetch(20, false);
    expect(assertDefined(preFn.mock.calls[1])[0].meta.previousCount).toBe(10);
  });

  it('confirmSelect activates confirm mode', () => {
    const ch = new Channel(1, makeDeps());
    expect(ch.confirmMode).toBe(false);
    ch.confirmSelect();
    expect(ch.confirmMode).toBe(true);
  });

  it('confirmSelect pre-hook fail prevents activation', () => {
    const hook: Hook<ConfirmSelectCtx, ConfirmSelectResult> = {
      pre: () => ({
        type: 'fail',
        error: new Error('confirm blocked'),
      }),
    };
    const ch = new Channel(1, makeDeps(), { confirmSelect: hook });

    expect(() => ch.confirmSelect()).toThrow('confirm blocked');
    expect(ch.confirmMode).toBe(false);
  });

  it('get pre-hook short_circuit returns specified value', () => {
    const hook: Hook<GetCtx, GetResult> = {
      pre: () => ({ type: 'short_circuit', result: null }),
    };
    const ch = new Channel(
      1,
      {
        ...makeDeps(),
        onDequeue: () => {
          throw new Error('should not dequeue');
        },
      },
      { get: hook }
    );

    const result = ch.get('q1');
    expect(result).toBeNull();
  });

  it('recover pre-hook fail prevents recovery', () => {
    const requeued: string[] = [];
    const hook: Hook<RecoverCtx, RecoverResult> = {
      pre: () => ({ type: 'fail', error: new Error('recover blocked') }),
    };
    const ch = new Channel(
      1,
      {
        onRequeue: (q) => requeued.push(q),
        onClose: noop,
      },
      { recover: hook }
    );

    ch.trackUnacked(1, makeBrokerMessage(), 'q1', 'ctag-1');

    expect(() => ch.recover()).toThrow('recover blocked');
    expect(requeued).toHaveLength(0);
    expect(ch.unackedCount).toBe(1);
  });

  it('recover context has unackedCount meta', () => {
    const preFn = vi.fn<(ctx: RecoverCtx) => undefined>();
    const hook: Hook<RecoverCtx, RecoverResult> = { pre: preFn };
    const ch = new Channel(1, makeDeps(), { recover: hook });

    const msg = makeBrokerMessage();
    ch.trackUnacked(1, msg, 'q1', 'ctag-1');
    ch.trackUnacked(2, msg, 'q1', 'ctag-1');

    ch.recover();

    expect(assertDefined(preFn.mock.calls[0])[0].meta.unackedCount).toBe(2);
  });
});
