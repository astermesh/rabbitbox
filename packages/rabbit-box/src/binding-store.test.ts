import { describe, expect, it, beforeEach } from 'vitest';
import { BindingStore } from './binding-store.ts';
import { ExchangeRegistry } from './exchange-registry.ts';
import { ChannelError } from './errors/amqp-error.ts';

describe('BindingStore', () => {
  let store: BindingStore;
  let exchanges: ExchangeRegistry;

  /** Simple set-based queue tracker (avoids importing QueueRegistry + node:crypto). */
  const queueNames = new Set<string>();

  beforeEach(() => {
    queueNames.clear();
    exchanges = new ExchangeRegistry();
    store = new BindingStore({
      hasExchange: (name) => exchanges.hasExchange(name),
      hasQueue: (name) => queueNames.has(name),
    });
    // Re-create ExchangeRegistry with binding count wired up
    exchanges = new ExchangeRegistry({
      bindingCount: (name) => store.bindingCount(name),
    });
    // Re-wire store to use updated registry
    store = new BindingStore({
      hasExchange: (name) => exchanges.hasExchange(name),
      hasQueue: (name) => queueNames.has(name),
    });
  });

  function declareQueue(name: string): void {
    queueNames.add(name);
  }

  function declareExchange(
    name: string,
    type: 'direct' | 'fanout' | 'topic' | 'headers' = 'direct'
  ): void {
    exchanges.declareExchange(name, type);
  }

  // ── addBinding ──────────────────────────────────────────────────────

  describe('addBinding', () => {
    it('adds a binding between an exchange and a queue', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'info', {});

      const bindings = store.getBindings('logs');
      expect(bindings).toHaveLength(1);
      expect(bindings[0]).toEqual({
        exchange: 'logs',
        queue: 'q1',
        routingKey: 'info',
        arguments: {},
      });
    });

    it('adds multiple bindings to the same exchange', () => {
      declareExchange('logs');
      declareQueue('q1');
      declareQueue('q2');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q2', 'error', {});

      expect(store.getBindings('logs')).toHaveLength(2);
    });

    it('adds multiple bindings with different routing keys', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q1', 'error', {});

      expect(store.getBindings('logs')).toHaveLength(2);
    });

    it('adds multiple bindings with different arguments (same routing key)', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', '', { 'x-match': 'all', type: 'a' });
      store.addBinding('logs', 'q1', '', { 'x-match': 'all', type: 'b' });

      expect(store.getBindings('logs')).toHaveLength(2);
    });

    it('is idempotent — duplicate binding is a no-op', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q1', 'info', {});

      expect(store.getBindings('logs')).toHaveLength(1);
    });

    it('is idempotent with deep-equal arguments', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', '', { 'x-match': 'all', level: 'info' });
      store.addBinding('logs', 'q1', '', { 'x-match': 'all', level: 'info' });

      expect(store.getBindings('logs')).toHaveLength(1);
    });

    it('treats different argument values as different bindings', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', '', { 'x-match': 'all' });
      store.addBinding('logs', 'q1', '', { 'x-match': 'any' });

      expect(store.getBindings('logs')).toHaveLength(2);
    });

    it('treats different argument keys as different bindings', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'rk', { a: 1 });
      store.addBinding('logs', 'q1', 'rk', { b: 1 });

      expect(store.getBindings('logs')).toHaveLength(2);
    });

    it('is idempotent regardless of argument key insertion order', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', '', { x: 1, y: 2 });
      store.addBinding('logs', 'q1', '', { y: 2, x: 1 });

      expect(store.getBindings('logs')).toHaveLength(1);
    });

    it('is idempotent with nested object arguments', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', '', { headers: { env: 'prod' } });
      store.addBinding('logs', 'q1', '', { headers: { env: 'prod' } });

      expect(store.getBindings('logs')).toHaveLength(1);
    });

    it('treats arguments with different keys but same count as different', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'rk', { a: 1 });
      store.addBinding('logs', 'q1', 'rk', { b: 1 });

      expect(store.getBindings('logs')).toHaveLength(2);
    });

    it('stores a defensive copy of arguments', () => {
      declareExchange('logs');
      declareQueue('q1');
      const args = { level: 'info' };

      store.addBinding('logs', 'q1', '', args);
      args.level = 'error';

      const bindings = store.getBindings('logs');
      expect(bindings[0]?.arguments).toEqual({ level: 'info' });
    });

    it('throws NOT_FOUND when exchange does not exist', () => {
      declareQueue('q1');

      expect(() =>
        store.addBinding('no-such-exchange', 'q1', 'rk', {})
      ).toThrow(ChannelError);
      expect(() =>
        store.addBinding('no-such-exchange', 'q1', 'rk', {})
      ).toThrow(/no exchange/);
    });

    it('throws NOT_FOUND when queue does not exist', () => {
      declareExchange('logs');

      expect(() => store.addBinding('logs', 'no-such-queue', 'rk', {})).toThrow(
        ChannelError
      );
      expect(() => store.addBinding('logs', 'no-such-queue', 'rk', {})).toThrow(
        /no queue/
      );
    });

    it('validates exchange before queue — exchange error takes priority', () => {
      // Neither exchange nor queue exist
      expect(() => store.addBinding('no-ex', 'no-q', 'rk', {})).toThrow(
        /no exchange/
      );
    });

    it('allows binding to default exchange', () => {
      declareQueue('q1');
      // Default exchange '' is pre-declared
      store.addBinding('', 'q1', 'q1', {});

      expect(store.getBindings('')).toHaveLength(1);
    });

    it('allows binding to amq.* pre-declared exchanges', () => {
      declareQueue('q1');

      store.addBinding('amq.direct', 'q1', 'rk', {});
      store.addBinding('amq.fanout', 'q1', '', {});
      store.addBinding('amq.topic', 'q1', 'a.b', {});
      store.addBinding('amq.headers', 'q1', '', { 'x-match': 'all' });

      expect(store.getBindings('amq.direct')).toHaveLength(1);
      expect(store.getBindings('amq.fanout')).toHaveLength(1);
      expect(store.getBindings('amq.topic')).toHaveLength(1);
      expect(store.getBindings('amq.headers')).toHaveLength(1);
    });
  });

  // ── removeBinding ───────────────────────────────────────────────────

  describe('removeBinding', () => {
    it('removes an existing binding', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'info', {});
      store.removeBinding('logs', 'q1', 'info', {});

      expect(store.getBindings('logs')).toHaveLength(0);
    });

    it('is idempotent — removing non-existent binding is a no-op', () => {
      declareExchange('logs');
      declareQueue('q1');

      expect(() => store.removeBinding('logs', 'q1', 'info', {})).not.toThrow();
    });

    it('matches by deep-equal arguments on remove', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', '', { 'x-match': 'all', level: 'info' });
      store.removeBinding('logs', 'q1', '', {
        'x-match': 'all',
        level: 'info',
      });

      expect(store.getBindings('logs')).toHaveLength(0);
    });

    it('does not remove binding with different arguments', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', '', { 'x-match': 'all' });
      store.removeBinding('logs', 'q1', '', { 'x-match': 'any' });

      expect(store.getBindings('logs')).toHaveLength(1);
    });

    it('does not remove binding with different routing key', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'info', {});
      store.removeBinding('logs', 'q1', 'error', {});

      expect(store.getBindings('logs')).toHaveLength(1);
    });

    it('throws NOT_FOUND when exchange does not exist', () => {
      declareQueue('q1');

      expect(() =>
        store.removeBinding('no-such-exchange', 'q1', 'rk', {})
      ).toThrow(ChannelError);
      expect(() =>
        store.removeBinding('no-such-exchange', 'q1', 'rk', {})
      ).toThrow(/no exchange/);
    });

    it('throws NOT_FOUND when queue does not exist', () => {
      declareExchange('logs');

      expect(() =>
        store.removeBinding('logs', 'no-such-queue', 'rk', {})
      ).toThrow(ChannelError);
      expect(() =>
        store.removeBinding('logs', 'no-such-queue', 'rk', {})
      ).toThrow(/no queue/);
    });

    it('validates exchange before queue — exchange error takes priority', () => {
      expect(() => store.removeBinding('no-ex', 'no-q', 'rk', {})).toThrow(
        /no exchange/
      );
    });

    it('removes only the matching binding among multiple', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q1', 'error', {});
      store.removeBinding('logs', 'q1', 'info', {});

      const bindings = store.getBindings('logs');
      expect(bindings).toHaveLength(1);
      expect(bindings[0]?.routingKey).toBe('error');
    });
  });

  // ── getBindings ─────────────────────────────────────────────────────

  describe('getBindings', () => {
    it('returns empty array for exchange with no bindings', () => {
      expect(store.getBindings('logs')).toEqual([]);
    });

    it('returns all bindings for an exchange', () => {
      declareExchange('logs');
      declareQueue('q1');
      declareQueue('q2');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q2', 'error', {});

      const bindings = store.getBindings('logs');
      expect(bindings).toHaveLength(2);
    });

    it('returns a defensive copy — mutations do not affect store', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'info', {});

      const bindings = store.getBindings('logs');
      bindings.length = 0;

      expect(store.getBindings('logs')).toHaveLength(1);
    });
  });

  // ── getBindingsForQueue ─────────────────────────────────────────────

  describe('getBindingsForQueue', () => {
    it('returns empty array for queue with no bindings', () => {
      expect(store.getBindingsForQueue('q1')).toEqual([]);
    });

    it('returns all bindings for a queue across multiple exchanges', () => {
      declareExchange('logs');
      declareExchange('events');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('events', 'q1', 'created', {});

      const bindings = store.getBindingsForQueue('q1');
      expect(bindings).toHaveLength(2);
      expect(bindings.map((b) => b.exchange).sort()).toEqual([
        'events',
        'logs',
      ]);
    });

    it('does not return bindings for other queues', () => {
      declareExchange('logs');
      declareQueue('q1');
      declareQueue('q2');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q2', 'error', {});

      expect(store.getBindingsForQueue('q1')).toHaveLength(1);
      expect(store.getBindingsForQueue('q1')[0]?.routingKey).toBe('info');
    });
  });

  // ── Default exchange implicit bindings ──────────────────────────────

  describe('default exchange implicit bindings', () => {
    it('getBindingsForQueue does not include implicit default-exchange binding', () => {
      declareQueue('q1');
      // Implicit bindings are virtual — not stored
      expect(store.getBindingsForQueue('q1')).toHaveLength(0);
    });

    it('getBindings for default exchange returns only explicit bindings', () => {
      expect(store.getBindings('')).toEqual([]);
    });
  });

  // ── removeBindingsForQueue (cleanup on queue delete) ────────────────

  describe('removeBindingsForQueue', () => {
    it('removes all bindings for a deleted queue', () => {
      declareExchange('logs');
      declareExchange('events');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('events', 'q1', 'created', {});

      store.removeBindingsForQueue('q1');

      expect(store.getBindings('logs')).toHaveLength(0);
      expect(store.getBindings('events')).toHaveLength(0);
      expect(store.getBindingsForQueue('q1')).toHaveLength(0);
    });

    it('does not affect bindings for other queues', () => {
      declareExchange('logs');
      declareQueue('q1');
      declareQueue('q2');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q2', 'error', {});

      store.removeBindingsForQueue('q1');

      expect(store.getBindings('logs')).toHaveLength(1);
      expect(store.getBindings('logs')[0]?.queue).toBe('q2');
    });

    it('is safe to call for queue with no bindings', () => {
      expect(() => store.removeBindingsForQueue('nope')).not.toThrow();
    });
  });

  // ── removeBindingsForExchange (cleanup on exchange delete) ──────────

  describe('removeBindingsForExchange', () => {
    it('removes all bindings for a deleted exchange', () => {
      declareExchange('logs');
      declareQueue('q1');
      declareQueue('q2');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q2', 'error', {});

      store.removeBindingsForExchange('logs');

      expect(store.getBindings('logs')).toHaveLength(0);
      expect(store.getBindingsForQueue('q1')).toHaveLength(0);
      expect(store.getBindingsForQueue('q2')).toHaveLength(0);
    });

    it('does not affect bindings on other exchanges', () => {
      declareExchange('logs');
      declareExchange('events');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('events', 'q1', 'created', {});

      store.removeBindingsForExchange('logs');

      expect(store.getBindings('events')).toHaveLength(1);
      expect(store.getBindingsForQueue('q1')).toHaveLength(1);
    });

    it('is safe to call for exchange with no bindings', () => {
      expect(() => store.removeBindingsForExchange('nope')).not.toThrow();
    });
  });

  // ── bindingCount ────────────────────────────────────────────────────

  describe('bindingCount', () => {
    it('returns 0 for exchange with no bindings', () => {
      expect(store.bindingCount('logs')).toBe(0);
    });

    it('returns the number of bindings for an exchange', () => {
      declareExchange('logs');
      declareQueue('q1');
      declareQueue('q2');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q2', 'error', {});

      expect(store.bindingCount('logs')).toBe(2);
    });

    it('decreases after removal', () => {
      declareExchange('logs');
      declareQueue('q1');
      declareQueue('q2');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q2', 'error', {});
      store.removeBinding('logs', 'q1', 'info', {});

      expect(store.bindingCount('logs')).toBe(1);
    });
  });

  // ── addExchangeBinding ─────────────────────────────────────────────

  describe('addExchangeBinding', () => {
    it('adds an E2E binding between two exchanges', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', 'rk', {});

      const bindings = store.getExchangeBindings('source');
      expect(bindings).toHaveLength(1);
      expect(bindings[0]).toEqual({
        exchange: 'source',
        queue: 'dest',
        routingKey: 'rk',
        arguments: {},
      });
    });

    it('is idempotent — duplicate E2E binding is a no-op', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', 'rk', {});
      store.addExchangeBinding('dest', 'source', 'rk', {});

      expect(store.getExchangeBindings('source')).toHaveLength(1);
    });

    it('is idempotent with deep-equal arguments', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', '', {
        'x-match': 'all',
        level: 'info',
      });
      store.addExchangeBinding('dest', 'source', '', {
        'x-match': 'all',
        level: 'info',
      });

      expect(store.getExchangeBindings('source')).toHaveLength(1);
    });

    it('adds multiple E2E bindings with different routing keys', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', 'rk1', {});
      store.addExchangeBinding('dest', 'source', 'rk2', {});

      expect(store.getExchangeBindings('source')).toHaveLength(2);
    });

    it('adds multiple E2E bindings to different destinations', () => {
      declareExchange('source');
      declareExchange('dest1');
      declareExchange('dest2');

      store.addExchangeBinding('dest1', 'source', 'rk', {});
      store.addExchangeBinding('dest2', 'source', 'rk', {});

      expect(store.getExchangeBindings('source')).toHaveLength(2);
    });

    it('treats different arguments as different bindings', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', '', { 'x-match': 'all' });
      store.addExchangeBinding('dest', 'source', '', { 'x-match': 'any' });

      expect(store.getExchangeBindings('source')).toHaveLength(2);
    });

    it('stores a defensive copy of arguments', () => {
      declareExchange('source');
      declareExchange('dest');
      const args = { level: 'info' };

      store.addExchangeBinding('dest', 'source', '', args);
      args.level = 'error';

      const bindings = store.getExchangeBindings('source');
      expect(bindings[0]?.arguments).toEqual({ level: 'info' });
    });

    it('throws NOT_FOUND when source exchange does not exist', () => {
      declareExchange('dest');

      expect(() =>
        store.addExchangeBinding('dest', 'no-such-source', 'rk', {})
      ).toThrow(ChannelError);
      expect(() =>
        store.addExchangeBinding('dest', 'no-such-source', 'rk', {})
      ).toThrow(/no exchange 'no-such-source'/);
    });

    it('throws NOT_FOUND when destination exchange does not exist', () => {
      declareExchange('source');

      expect(() =>
        store.addExchangeBinding('no-such-dest', 'source', 'rk', {})
      ).toThrow(ChannelError);
      expect(() =>
        store.addExchangeBinding('no-such-dest', 'source', 'rk', {})
      ).toThrow(/no exchange 'no-such-dest'/);
    });

    it('validates source before destination — source error takes priority', () => {
      expect(() =>
        store.addExchangeBinding('no-dest', 'no-source', 'rk', {})
      ).toThrow(/no exchange 'no-source'/);
    });
  });

  // ── removeExchangeBinding ──────────────────────────────────────────

  describe('removeExchangeBinding', () => {
    it('removes an existing E2E binding', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', 'rk', {});
      store.removeExchangeBinding('dest', 'source', 'rk', {});

      expect(store.getExchangeBindings('source')).toHaveLength(0);
    });

    it('is idempotent — removing non-existent E2E binding is a no-op', () => {
      declareExchange('source');
      declareExchange('dest');

      expect(() =>
        store.removeExchangeBinding('dest', 'source', 'rk', {})
      ).not.toThrow();
    });

    it('matches by deep-equal arguments on remove', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', '', {
        'x-match': 'all',
        level: 'info',
      });
      store.removeExchangeBinding('dest', 'source', '', {
        'x-match': 'all',
        level: 'info',
      });

      expect(store.getExchangeBindings('source')).toHaveLength(0);
    });

    it('does not remove E2E binding with different arguments', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', '', { 'x-match': 'all' });
      store.removeExchangeBinding('dest', 'source', '', { 'x-match': 'any' });

      expect(store.getExchangeBindings('source')).toHaveLength(1);
    });

    it('does not remove E2E binding with different routing key', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', 'rk1', {});
      store.removeExchangeBinding('dest', 'source', 'rk2', {});

      expect(store.getExchangeBindings('source')).toHaveLength(1);
    });

    it('removes only the matching E2E binding among multiple', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', 'rk1', {});
      store.addExchangeBinding('dest', 'source', 'rk2', {});
      store.removeExchangeBinding('dest', 'source', 'rk1', {});

      const bindings = store.getExchangeBindings('source');
      expect(bindings).toHaveLength(1);
      expect(bindings[0]?.routingKey).toBe('rk2');
    });

    it('throws NOT_FOUND when source exchange does not exist', () => {
      declareExchange('dest');

      expect(() =>
        store.removeExchangeBinding('dest', 'no-such-source', 'rk', {})
      ).toThrow(ChannelError);
      expect(() =>
        store.removeExchangeBinding('dest', 'no-such-source', 'rk', {})
      ).toThrow(/no exchange 'no-such-source'/);
    });

    it('throws NOT_FOUND when destination exchange does not exist', () => {
      declareExchange('source');

      expect(() =>
        store.removeExchangeBinding('no-such-dest', 'source', 'rk', {})
      ).toThrow(ChannelError);
      expect(() =>
        store.removeExchangeBinding('no-such-dest', 'source', 'rk', {})
      ).toThrow(/no exchange 'no-such-dest'/);
    });
  });

  // ── getExchangeBindings ───────────────────────────────────────────

  describe('getExchangeBindings', () => {
    it('returns empty array for exchange with no E2E bindings', () => {
      expect(store.getExchangeBindings('source')).toEqual([]);
    });

    it('returns all E2E bindings for a source exchange', () => {
      declareExchange('source');
      declareExchange('dest1');
      declareExchange('dest2');

      store.addExchangeBinding('dest1', 'source', 'rk1', {});
      store.addExchangeBinding('dest2', 'source', 'rk2', {});

      expect(store.getExchangeBindings('source')).toHaveLength(2);
    });

    it('returns a defensive copy — mutations do not affect store', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', 'rk', {});

      const bindings = store.getExchangeBindings('source');
      bindings.length = 0;

      expect(store.getExchangeBindings('source')).toHaveLength(1);
    });

    it('does not include queue bindings', () => {
      declareExchange('ex');
      declareExchange('dest');
      declareQueue('q1');

      store.addBinding('ex', 'q1', 'rk', {});
      store.addExchangeBinding('dest', 'ex', 'rk', {});

      expect(store.getExchangeBindings('ex')).toHaveLength(1);
      expect(store.getExchangeBindings('ex')[0]?.queue).toBe('dest');
    });
  });

  // ── removeBindingsForExchange with E2E bindings ────────────────────

  describe('removeBindingsForExchange with E2E bindings', () => {
    it('removes E2E bindings where exchange is source', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', 'rk', {});
      store.removeBindingsForExchange('source');

      expect(store.getExchangeBindings('source')).toHaveLength(0);
    });

    it('removes E2E bindings where exchange is destination', () => {
      declareExchange('source');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'source', 'rk', {});
      store.removeBindingsForExchange('dest');

      expect(store.getExchangeBindings('source')).toHaveLength(0);
    });

    it('removes both queue and E2E bindings on exchange delete', () => {
      declareExchange('ex');
      declareExchange('dest');
      declareQueue('q1');

      store.addBinding('ex', 'q1', 'rk', {});
      store.addExchangeBinding('dest', 'ex', 'rk', {});

      store.removeBindingsForExchange('ex');

      expect(store.getBindings('ex')).toHaveLength(0);
      expect(store.getExchangeBindings('ex')).toHaveLength(0);
    });
  });

  // ── bindingCount with E2E bindings ─────────────────────────────────

  describe('bindingCount with E2E bindings', () => {
    it('includes E2E bindings in count', () => {
      declareExchange('ex');
      declareExchange('dest');
      declareQueue('q1');

      store.addBinding('ex', 'q1', 'rk', {});
      store.addExchangeBinding('dest', 'ex', 'rk', {});

      expect(store.bindingCount('ex')).toBe(2);
    });

    it('counts only E2E bindings when no queue bindings exist', () => {
      declareExchange('ex');
      declareExchange('dest');

      store.addExchangeBinding('dest', 'ex', 'rk', {});

      expect(store.bindingCount('ex')).toBe(1);
    });
  });

  // ── Integration: ExchangeRegistry ifUnused with binding count ──────

  describe('integration with ExchangeRegistry ifUnused', () => {
    it('allows delete when exchange has no bindings', () => {
      declareExchange('logs');
      expect(() => exchanges.deleteExchange('logs', true)).not.toThrow();
    });

    it('prevents delete when exchange has bindings', () => {
      declareExchange('logs');
      declareQueue('q1');
      store.addBinding('logs', 'q1', 'info', {});

      expect(() => exchanges.deleteExchange('logs', true)).toThrow(
        ChannelError
      );
    });
  });
});
