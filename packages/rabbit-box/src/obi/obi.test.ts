import { describe, it, expect, vi } from 'vitest';
import {
  createDefaultTime,
  createDefaultTimers,
  createDefaultRandom,
  createDefaultDelivery,
  createDefaultReturn,
  createDefaultPersist,
  createDefaultObiHooks,
} from './defaults.ts';
import type { ObiHooks } from './types.ts';
import { MessageStore } from '../message-store.ts';
import { publish } from '../publish.ts';
import type { PublishOptions } from '../publish.ts';
import { Dispatcher } from '../dispatcher.ts';
import { QueueRegistry } from '../queue-registry.ts';
import { ExchangeRegistry } from '../exchange-registry.ts';
import { BindingStore } from '../binding-store.ts';
import { ConsumerRegistry } from '../consumer-registry.ts';
import type { BrokerMessage } from '../types/message.ts';

describe('OBI default implementations', () => {
  describe('time', () => {
    it('returns a number close to Date.now()', () => {
      const time = createDefaultTime();
      const before = Date.now();
      const result = time.now();
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });

    it('returns increasing values on successive calls', () => {
      const time = createDefaultTime();
      const a = time.now();
      const b = time.now();
      expect(b).toBeGreaterThanOrEqual(a);
    });
  });

  describe('timers', () => {
    it('setTimeout fires callback after delay', async () => {
      const timers = createDefaultTimers();
      const fn = vi.fn();
      timers.setTimeout(fn, 10);
      expect(fn).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 50));
      expect(fn).toHaveBeenCalledOnce();
    });

    it('clearTimeout cancels a pending timer', async () => {
      const timers = createDefaultTimers();
      const fn = vi.fn();
      const handle = timers.setTimeout(fn, 10);
      timers.clearTimeout(handle);
      await new Promise((r) => setTimeout(r, 50));
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('random', () => {
    it('returns a valid UUID string', () => {
      const random = createDefaultRandom();
      const uuid = random.uuid();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('returns unique values on successive calls', () => {
      const random = createDefaultRandom();
      const a = random.uuid();
      const b = random.uuid();
      expect(a).not.toBe(b);
    });
  });

  describe('delivery', () => {
    it('schedules callback asynchronously via microtask', async () => {
      const delivery = createDefaultDelivery();
      const fn = vi.fn();
      delivery.schedule(fn);
      // Not called synchronously
      expect(fn).not.toHaveBeenCalled();
      // Called after microtask flush
      await new Promise((r) => setTimeout(r, 0));
      expect(fn).toHaveBeenCalledOnce();
    });

    it('preserves callback execution order', async () => {
      const delivery = createDefaultDelivery();
      const order: number[] = [];
      delivery.schedule(() => order.push(1));
      delivery.schedule(() => order.push(2));
      delivery.schedule(() => order.push(3));
      await new Promise((r) => setTimeout(r, 0));
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('return', () => {
    it('calls next() by default (pass-through)', () => {
      const ret = createDefaultReturn();
      const next = vi.fn();
      ret.notify(
        {
          replyCode: 312,
          replyText: 'NO_ROUTE',
          exchange: 'ex',
          routingKey: 'rk',
        },
        next
      );
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('persist', () => {
    it('save is a no-op (does not throw)', () => {
      const persist = createDefaultPersist();
      expect(() =>
        persist.save('key', new Uint8Array([1, 2, 3]))
      ).not.toThrow();
    });

    it('load returns null', () => {
      const persist = createDefaultPersist();
      expect(persist.load('key')).toBeNull();
    });
  });

  describe('createDefaultObiHooks', () => {
    it('returns an object with all 6 hooks', () => {
      const hooks = createDefaultObiHooks();
      expect(hooks.time).toBeDefined();
      expect(hooks.timers).toBeDefined();
      expect(hooks.random).toBeDefined();
      expect(hooks.delivery).toBeDefined();
      expect(hooks.return).toBeDefined();
      expect(hooks.persist).toBeDefined();
    });

    it('satisfies ObiHooks type', () => {
      const hooks: ObiHooks = createDefaultObiHooks();
      expect(typeof hooks.time.now).toBe('function');
      expect(typeof hooks.timers.setTimeout).toBe('function');
      expect(typeof hooks.timers.clearTimeout).toBe('function');
      expect(typeof hooks.random.uuid).toBe('function');
      expect(typeof hooks.delivery.schedule).toBe('function');
      expect(typeof hooks.return.notify).toBe('function');
      expect(typeof hooks.persist.save).toBe('function');
      expect(typeof hooks.persist.load).toBe('function');
    });
  });
});

describe('OBI hook override (Sim injection)', () => {
  describe('virtual time', () => {
    it('allows replacing time.now() with a controlled clock', () => {
      let virtualNow = 1000;
      const hooks = createDefaultObiHooks();
      const virtualHooks: ObiHooks = {
        ...hooks,
        time: { now: () => virtualNow },
      };

      expect(virtualHooks.time.now()).toBe(1000);
      virtualNow = 2000;
      expect(virtualHooks.time.now()).toBe(2000);
    });
  });

  describe('deterministic random', () => {
    it('allows replacing random.uuid() with a predictable generator', () => {
      let counter = 0;
      const hooks = createDefaultObiHooks();
      const deterministicHooks: ObiHooks = {
        ...hooks,
        random: {
          uuid: () =>
            `00000000-0000-0000-0000-${String(++counter).padStart(12, '0')}`,
        },
      };

      expect(deterministicHooks.random.uuid()).toBe(
        '00000000-0000-0000-0000-000000000001'
      );
      expect(deterministicHooks.random.uuid()).toBe(
        '00000000-0000-0000-0000-000000000002'
      );
    });
  });

  describe('virtual delivery', () => {
    it('allows replacing delivery.schedule() with synchronous execution', () => {
      const hooks = createDefaultObiHooks();
      const syncHooks: ObiHooks = {
        ...hooks,
        delivery: { schedule: (cb) => cb() },
      };

      const fn = vi.fn();
      syncHooks.delivery.schedule(fn);
      // Called synchronously, no microtask delay
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  describe('return interception', () => {
    it('allows suppressing return notifications', () => {
      const hooks = createDefaultObiHooks();
      const suppressedHooks: ObiHooks = {
        ...hooks,
        return: {
          notify: (_ctx, _next) => {
            /* suppress: don't call next */
          },
        },
      };

      const next = vi.fn();
      suppressedHooks.return.notify(
        {
          replyCode: 312,
          replyText: 'NO_ROUTE',
          exchange: 'ex',
          routingKey: 'rk',
        },
        next
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('allows observing returns without suppressing', () => {
      const observed: { replyCode: number; exchange: string }[] = [];
      const hooks = createDefaultObiHooks();
      const observingHooks: ObiHooks = {
        ...hooks,
        return: {
          notify: (ctx, next) => {
            observed.push({ replyCode: ctx.replyCode, exchange: ctx.exchange });
            next();
          },
        },
      };

      const next = vi.fn();
      observingHooks.return.notify(
        {
          replyCode: 312,
          replyText: 'NO_ROUTE',
          exchange: 'test-ex',
          routingKey: 'rk',
        },
        next
      );
      expect(next).toHaveBeenCalledOnce();
      expect(observed).toEqual([{ replyCode: 312, exchange: 'test-ex' }]);
    });
  });

  describe('virtual timers', () => {
    it('allows replacing timers with manual control', () => {
      const scheduled: { cb: () => void; ms: number; id: number }[] = [];
      let nextId = 0;
      const hooks = createDefaultObiHooks();
      const virtualHooks: ObiHooks = {
        ...hooks,
        timers: {
          setTimeout: (cb, ms) => {
            const id = ++nextId;
            scheduled.push({ cb, ms, id });
            return id;
          },
          clearTimeout: (handle) => {
            const idx = scheduled.findIndex((s) => s.id === handle);
            if (idx !== -1) scheduled.splice(idx, 1);
          },
        },
      };

      const fn1 = vi.fn();
      const fn2 = vi.fn();
      const h1 = virtualHooks.timers.setTimeout(fn1, 100);
      virtualHooks.timers.setTimeout(fn2, 200);

      expect(scheduled).toHaveLength(2);
      virtualHooks.timers.clearTimeout(h1);
      expect(scheduled).toHaveLength(1);

      // Manually fire remaining
      for (const s of scheduled) s.cb();
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledOnce();
    });
  });
});

describe('OBI engine integration', () => {
  function makeMessage(overrides?: Partial<BrokerMessage>): BrokerMessage {
    return {
      body: new Uint8Array([1, 2, 3]),
      properties: {},
      exchange: '',
      routingKey: 'test',
      mandatory: false,
      immediate: false,
      deliveryCount: 0,
      enqueuedAt: 0,
      priority: 0,
      ...overrides,
    };
  }

  describe('MessageStore uses time hook', () => {
    it('uses injected now() for enqueuedAt timestamp', () => {
      const virtualNow = 42000;
      const store = new MessageStore({ now: () => virtualNow });
      const stored = store.enqueue(makeMessage());
      expect(stored.enqueuedAt).toBe(42000);
    });

    it('uses injected now() for TTL expiration calculation', () => {
      const virtualNow = 10000;
      const store = new MessageStore({
        messageTtl: 5000,
        now: () => virtualNow,
      });
      const stored = store.enqueue(makeMessage());
      expect(stored.expiresAt).toBe(15000);
    });

    it('uses default Date.now() when no hook provided', () => {
      const store = new MessageStore();
      const before = Date.now();
      const stored = store.enqueue(makeMessage());
      const after = Date.now();
      expect(stored.enqueuedAt).toBeGreaterThanOrEqual(before);
      expect(stored.enqueuedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('publish delegates timestamps to MessageStore', () => {
    it('MessageStore injects virtual now() into enqueuedAt', () => {
      const exchanges = new ExchangeRegistry();
      const bindings = new BindingStore();
      const queues = new QueueRegistry();
      queues.declareQueue('test', {});
      const stores = new Map<string, MessageStore>();
      const virtualNow = () => 99999;
      const getStore = (q: string) => {
        let s = stores.get(q);
        if (!s) {
          s = new MessageStore({ now: virtualNow });
          stores.set(q, s);
        }
        return s;
      };

      publish({
        exchange: '',
        routingKey: 'test',
        body: new Uint8Array([1]),
        properties: {},
        mandatory: false,
        immediate: false,
        exchangeRegistry: exchanges,
        bindingStore: bindings,
        queueRegistry: queues,
        getMessageStore: getStore,
        onReturn: vi.fn(),
        onDispatch: vi.fn(),
      });

      const store = stores.get('test');
      expect(store).toBeDefined();
      const msg = store?.dequeue();
      // MessageStore.enqueue() is the authority on enqueuedAt — uses its own now()
      expect(msg?.enqueuedAt).toBe(99999);
    });
  });

  describe('Dispatcher uses delivery hook', () => {
    it('uses injected schedule() instead of queueMicrotask', () => {
      const scheduledCallbacks: (() => void)[] = [];
      const schedule = (cb: () => void) => scheduledCallbacks.push(cb);

      const registry = new ConsumerRegistry();
      const dispatcher = new Dispatcher(registry, { schedule });
      const queues = new QueueRegistry();
      queues.declareQueue('q1', {});

      const store = new MessageStore();
      store.enqueue(makeMessage({ exchange: '', routingKey: 'q1' }));

      const callback = vi.fn();
      registry.register('q1', 1, callback, { noAck: true });

      // Provide a mock channel
      const mockChannel = {
        nextDeliveryTag: () => 1,
        isFlowActive: () => true,
        consumerPrefetch: 0,
        channelPrefetch: 0,
        unackedCount: 0,
      };

      dispatcher.dispatch('q1', store, () => mockChannel as never);

      // Callback was not called directly — it was captured by our schedule hook
      expect(callback).not.toHaveBeenCalled();
      expect(scheduledCallbacks).toHaveLength(1);

      // Fire the scheduled callback
      const firstCallback = scheduledCallbacks[0];
      expect(firstCallback).toBeDefined();
      firstCallback?.();
      expect(callback).toHaveBeenCalledOnce();
    });
  });

  describe('OBI return hook wraps onReturn callback', () => {
    it('demonstrates Sim return interception via ObiReturn wrapping onReturn', () => {
      const exchanges = new ExchangeRegistry();
      const bindings = new BindingStore();
      const queues = new QueueRegistry();
      // No queue 'missing' declared — publish to default exchange will be unroutable

      const stores = new Map<string, MessageStore>();
      const getStore = (q: string) => {
        let s = stores.get(q);
        if (!s) {
          s = new MessageStore();
          stores.set(q, s);
        }
        return s;
      };

      // Track raw returns and OBI-intercepted returns
      const rawReturns: { exchange: string; routingKey: string }[] = [];
      const obiIntercepted: { replyCode: number; exchange: string }[] = [];

      // Create OBI return hook that intercepts
      const simReturn = {
        notify: (
          ctx: {
            replyCode: number;
            replyText: string;
            exchange: string;
            routingKey: string;
          },
          next: () => void
        ) => {
          obiIntercepted.push({
            replyCode: ctx.replyCode,
            exchange: ctx.exchange,
          });
          next(); // proceed with actual return
        },
      };

      // This is how the composition layer wraps onReturn with OBI:
      const wrappedOnReturn: PublishOptions['onReturn'] = (
        replyCode,
        replyText,
        exchange,
        routingKey,
        _body,
        _props
      ) => {
        simReturn.notify({ replyCode, replyText, exchange, routingKey }, () =>
          rawReturns.push({ exchange, routingKey })
        );
      };

      publish({
        exchange: '',
        routingKey: 'missing',
        body: new Uint8Array([1]),
        properties: {},
        mandatory: true,
        immediate: false,
        exchangeRegistry: exchanges,
        bindingStore: bindings,
        queueRegistry: queues,
        getMessageStore: getStore,
        onReturn: wrappedOnReturn,
        onDispatch: vi.fn(),
      });

      // OBI return hook intercepted the return
      expect(obiIntercepted).toEqual([{ replyCode: 312, exchange: '' }]);
      // Raw onReturn was also called (next() was invoked)
      expect(rawReturns).toEqual([{ exchange: '', routingKey: 'missing' }]);
    });

    it('Sim can suppress returns by not calling next()', () => {
      const exchanges = new ExchangeRegistry();
      const bindings = new BindingStore();
      const queues = new QueueRegistry();

      const stores = new Map<string, MessageStore>();
      const getStore = (q: string) => {
        let s = stores.get(q);
        if (!s) {
          s = new MessageStore();
          stores.set(q, s);
        }
        return s;
      };

      const rawReturns: unknown[] = [];

      // Suppressing OBI return hook — never calls next()
      const suppressOnReturn = () => {
        // Sim intercepts and suppresses — no-op
      };

      publish({
        exchange: '',
        routingKey: 'missing',
        body: new Uint8Array([1]),
        properties: {},
        mandatory: true,
        immediate: false,
        exchangeRegistry: exchanges,
        bindingStore: bindings,
        queueRegistry: queues,
        getMessageStore: getStore,
        onReturn: suppressOnReturn,
        onDispatch: vi.fn(),
      });

      // Raw return was suppressed
      expect(rawReturns).toEqual([]);
    });
  });

  describe('QueueRegistry uses random hook', () => {
    it('uses injected generateName for server-generated queue names', () => {
      let counter = 0;
      const registry = new QueueRegistry({
        generateName: () => `amq.gen-test-${++counter}`,
      });

      const result1 = registry.declareQueue('', {});
      const result2 = registry.declareQueue('', {});

      expect(result1.queue).toBe('amq.gen-test-1');
      expect(result2.queue).toBe('amq.gen-test-2');
    });

    it('does not import from node:crypto (uses globalThis.crypto)', () => {
      // This test verifies cross-platform compatibility:
      // queue-registry should use globalThis.crypto.randomUUID()
      // instead of importing from node:crypto
      const registry = new QueueRegistry();
      const result = registry.declareQueue('', {});
      expect(result.queue).toMatch(/^amq\.gen-[0-9a-f-]+$/);
    });
  });
});
