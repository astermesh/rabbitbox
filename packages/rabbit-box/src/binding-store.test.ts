import { describe, expect, it, beforeEach } from 'vitest';
import { BindingStore } from './binding-store.ts';
import { ExchangeRegistry } from './exchange-registry.ts';
import { QueueRegistry } from './queue-registry.ts';
import { ChannelError } from './errors/amqp-error.ts';

describe('BindingStore', () => {
  let store: BindingStore;
  let exchanges: ExchangeRegistry;
  let queues: QueueRegistry;

  beforeEach(() => {
    store = new BindingStore();
    exchanges = new ExchangeRegistry({ bindingCount: (name) => store.getBindings(name).length });
    queues = new QueueRegistry();
  });

  function declareQueue(name: string): void {
    queues.declareQueue(name, {});
  }

  function declareExchange(name: string, type: 'direct' | 'fanout' | 'topic' | 'headers' = 'direct'): void {
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

    it('stores a defensive copy of arguments', () => {
      declareExchange('logs');
      declareQueue('q1');
      const args = { level: 'info' };

      store.addBinding('logs', 'q1', '', args);
      args.level = 'error';

      const bindings = store.getBindings('logs');
      expect(bindings[0].arguments).toEqual({ level: 'info' });
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
      expect(() => store.removeBinding('logs', 'q1', 'info', {})).not.toThrow();
    });

    it('matches by deep-equal arguments on remove', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', '', { 'x-match': 'all', level: 'info' });
      store.removeBinding('logs', 'q1', '', { 'x-match': 'all', level: 'info' });

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

    it('removes only the matching binding among multiple', () => {
      declareExchange('logs');
      declareQueue('q1');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q1', 'error', {});
      store.removeBinding('logs', 'q1', 'info', {});

      const bindings = store.getBindings('logs');
      expect(bindings).toHaveLength(1);
      expect(bindings[0].routingKey).toBe('error');
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
      expect(bindings.map((b) => b.exchange).sort()).toEqual(['events', 'logs']);
    });

    it('does not return bindings for other queues', () => {
      declareExchange('logs');
      declareQueue('q1');
      declareQueue('q2');

      store.addBinding('logs', 'q1', 'info', {});
      store.addBinding('logs', 'q2', 'error', {});

      expect(store.getBindingsForQueue('q1')).toHaveLength(1);
      expect(store.getBindingsForQueue('q1')[0].routingKey).toBe('info');
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
      expect(store.getBindings('logs')[0].queue).toBe('q2');
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

      expect(() => exchanges.deleteExchange('logs', true)).toThrow(ChannelError);
    });
  });
});
