import { describe, expect, it, beforeEach } from 'vitest';
import { ExchangeRegistry } from './exchange-registry.ts';
import { ChannelError } from './errors/amqp-error.ts';
import {
  NOT_FOUND,
  PRECONDITION_FAILED,
  ACCESS_REFUSED,
} from './errors/reply-codes.ts';

const EXCHANGE_CLASS_ID = 40;
const EXCHANGE_DECLARE_METHOD_ID = 10;
const EXCHANGE_DELETE_METHOD_ID = 20;

describe('ExchangeRegistry', () => {
  let registry: ExchangeRegistry;

  beforeEach(() => {
    registry = new ExchangeRegistry();
  });

  // ── Default exchanges ───────────────────────────────────────────────

  describe('default exchanges', () => {
    it('pre-declares six default exchanges', () => {
      const names = registry.exchangeNames();
      expect(names).toContain('');
      expect(names).toContain('amq.direct');
      expect(names).toContain('amq.fanout');
      expect(names).toContain('amq.topic');
      expect(names).toContain('amq.headers');
      expect(names).toContain('amq.match');
    });

    it('default exchange "" is direct', () => {
      const ex = registry.checkExchange('');
      expect(ex.type).toBe('direct');
      expect(ex.durable).toBe(true);
      expect(ex.autoDelete).toBe(false);
      expect(ex.internal).toBe(false);
    });

    it('amq.direct is direct', () => {
      expect(registry.checkExchange('amq.direct').type).toBe('direct');
    });

    it('amq.fanout is fanout', () => {
      expect(registry.checkExchange('amq.fanout').type).toBe('fanout');
    });

    it('amq.topic is topic', () => {
      expect(registry.checkExchange('amq.topic').type).toBe('topic');
    });

    it('amq.headers is headers', () => {
      expect(registry.checkExchange('amq.headers').type).toBe('headers');
    });

    it('amq.match is headers (alias)', () => {
      expect(registry.checkExchange('amq.match').type).toBe('headers');
    });
  });

  // ── declareExchange ─────────────────────────────────────────────────

  describe('declareExchange', () => {
    it('creates a new exchange with defaults', () => {
      const ex = registry.declareExchange('logs', 'fanout');
      expect(ex.name).toBe('logs');
      expect(ex.type).toBe('fanout');
      expect(ex.durable).toBe(true);
      expect(ex.autoDelete).toBe(false);
      expect(ex.internal).toBe(false);
      expect(ex.arguments).toEqual({});
    });

    it('creates a new exchange with custom options', () => {
      const ex = registry.declareExchange('events', 'topic', {
        durable: false,
        autoDelete: true,
        internal: true,
        arguments: { 'x-delayed-type': 'direct' },
      });
      expect(ex.durable).toBe(false);
      expect(ex.autoDelete).toBe(true);
      expect(ex.internal).toBe(true);
      expect(ex.arguments).toEqual({ 'x-delayed-type': 'direct' });
    });

    it('is idempotent when re-declaring with same type and options', () => {
      const ex1 = registry.declareExchange('logs', 'fanout');
      const ex2 = registry.declareExchange('logs', 'fanout');
      expect(ex2).toBe(ex1);
    });

    it('is idempotent for default exchanges with matching type', () => {
      const ex = registry.declareExchange('amq.direct', 'direct');
      expect(ex.name).toBe('amq.direct');
      expect(ex.type).toBe('direct');
    });

    it('throws PRECONDITION_FAILED on type mismatch re-declare', () => {
      registry.declareExchange('logs', 'fanout');

      try {
        registry.declareExchange('logs', 'direct');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(PRECONDITION_FAILED);
        expect(e.replyText).toBe(
          "PRECONDITION_FAILED - inequivalent arg 'type' for exchange 'logs' in vhost '/': received 'direct' but current is 'fanout'"
        );
        expect(e.classId).toBe(EXCHANGE_CLASS_ID);
        expect(e.methodId).toBe(EXCHANGE_DECLARE_METHOD_ID);
      }
    });

    it('throws PRECONDITION_FAILED on durable mismatch with correct field name', () => {
      registry.declareExchange('logs', 'fanout', { durable: true });

      try {
        registry.declareExchange('logs', 'fanout', { durable: false });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(PRECONDITION_FAILED);
        expect(e.replyText).toBe(
          "PRECONDITION_FAILED - inequivalent arg 'durable' for exchange 'logs' in vhost '/': received 'false' but current is 'true'"
        );
      }
    });

    it('throws PRECONDITION_FAILED on autoDelete mismatch with auto_delete field name', () => {
      registry.declareExchange('logs', 'fanout', { autoDelete: false });

      try {
        registry.declareExchange('logs', 'fanout', { autoDelete: true });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(PRECONDITION_FAILED);
        expect(e.replyText).toBe(
          "PRECONDITION_FAILED - inequivalent arg 'auto_delete' for exchange 'logs' in vhost '/': received 'true' but current is 'false'"
        );
      }
    });

    it('throws PRECONDITION_FAILED on internal mismatch with correct field name', () => {
      registry.declareExchange('logs', 'fanout', { internal: false });

      try {
        registry.declareExchange('logs', 'fanout', { internal: true });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(PRECONDITION_FAILED);
        expect(e.replyText).toBe(
          "PRECONDITION_FAILED - inequivalent arg 'internal' for exchange 'logs' in vhost '/': received 'true' but current is 'false'"
        );
      }
    });

    it('throws PRECONDITION_FAILED on arguments mismatch', () => {
      registry.declareExchange('logs', 'fanout', {
        arguments: { 'x-foo': 'bar' },
      });

      try {
        registry.declareExchange('logs', 'fanout', {
          arguments: { 'x-foo': 'baz' },
        });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(PRECONDITION_FAILED);
        expect(e.replyText).toContain("inequivalent arg 'arguments'");
      }
    });

    it('throws PRECONDITION_FAILED when re-declaring default exchange with wrong type', () => {
      try {
        registry.declareExchange('amq.direct', 'fanout');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(PRECONDITION_FAILED);
        expect(e.replyText).toContain("inequivalent arg 'type'");
        expect(e.replyText).toContain('amq.direct');
      }
    });

    it('throws ACCESS_REFUSED for new exchange with amq. prefix', () => {
      try {
        registry.declareExchange('amq.custom', 'direct');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(ACCESS_REFUSED);
        expect(e.replyText).toContain('amq.*');
        expect(e.classId).toBe(EXCHANGE_CLASS_ID);
        expect(e.methodId).toBe(EXCHANGE_DECLARE_METHOD_ID);
      }
    });
  });

  // ── deleteExchange ──────────────────────────────────────────────────

  describe('deleteExchange', () => {
    it('deletes an existing exchange', () => {
      registry.declareExchange('logs', 'fanout');
      registry.deleteExchange('logs');
      expect(registry.hasExchange('logs')).toBe(false);
    });

    it('silently succeeds when deleting non-existent exchange (RabbitMQ 3.0+ behavior)', () => {
      expect(() => registry.deleteExchange('nope')).not.toThrow();
    });

    it('throws ACCESS_REFUSED when deleting default exchange ""', () => {
      try {
        registry.deleteExchange('');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(ACCESS_REFUSED);
        expect(e.replyText).toContain('pre-declared');
      }
    });

    it('throws ACCESS_REFUSED when deleting amq.direct', () => {
      expect(() => registry.deleteExchange('amq.direct')).toThrow(ChannelError);
    });

    it('throws ACCESS_REFUSED when deleting amq.fanout', () => {
      expect(() => registry.deleteExchange('amq.fanout')).toThrow(ChannelError);
    });

    it('throws ACCESS_REFUSED when deleting amq.topic', () => {
      expect(() => registry.deleteExchange('amq.topic')).toThrow(ChannelError);
    });

    it('throws ACCESS_REFUSED when deleting amq.headers', () => {
      expect(() => registry.deleteExchange('amq.headers')).toThrow(
        ChannelError
      );
    });

    it('throws ACCESS_REFUSED when deleting amq.match', () => {
      expect(() => registry.deleteExchange('amq.match')).toThrow(ChannelError);
    });

    it('deletes unused exchange when ifUnused=true', () => {
      registry.declareExchange('logs', 'fanout');
      registry.deleteExchange('logs', true);
      expect(registry.hasExchange('logs')).toBe(false);
    });

    it('throws PRECONDITION_FAILED when ifUnused=true and exchange has bindings', () => {
      const bindingRegistry = new ExchangeRegistry({
        bindingCount: (name) => (name === 'logs' ? 3 : 0),
      });

      bindingRegistry.declareExchange('logs', 'fanout');

      try {
        bindingRegistry.deleteExchange('logs', true);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(PRECONDITION_FAILED);
        expect(e.replyText).toContain('3 binding(s)');
        expect(e.classId).toBe(EXCHANGE_CLASS_ID);
        expect(e.methodId).toBe(EXCHANGE_DELETE_METHOD_ID);
      }
    });
  });

  // ── checkExchange ───────────────────────────────────────────────────

  describe('checkExchange', () => {
    it('returns exchange when it exists', () => {
      registry.declareExchange('logs', 'fanout');
      const ex = registry.checkExchange('logs');
      expect(ex.name).toBe('logs');
      expect(ex.type).toBe('fanout');
    });

    it('returns default exchange on check', () => {
      const ex = registry.checkExchange('amq.direct');
      expect(ex.type).toBe('direct');
    });

    it('throws NOT_FOUND for non-existent exchange', () => {
      try {
        registry.checkExchange('nope');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(NOT_FOUND);
        expect(e.replyText).toBe("NOT_FOUND - no exchange 'nope' in vhost '/'");
        expect(e.classId).toBe(EXCHANGE_CLASS_ID);
        expect(e.methodId).toBe(EXCHANGE_DECLARE_METHOD_ID);
      }
    });
  });

  // ── getExchange / hasExchange ───────────────────────────────────────

  describe('getExchange', () => {
    it('returns undefined for non-existent exchange', () => {
      expect(registry.getExchange('nope')).toBeUndefined();
    });

    it('returns exchange for existing one', () => {
      registry.declareExchange('logs', 'fanout');
      expect(registry.getExchange('logs')).toBeDefined();
    });
  });

  describe('hasExchange', () => {
    it('returns false for non-existent exchange', () => {
      expect(registry.hasExchange('nope')).toBe(false);
    });

    it('returns true for existing exchange', () => {
      registry.declareExchange('logs', 'fanout');
      expect(registry.hasExchange('logs')).toBe(true);
    });

    it('returns true for default exchanges', () => {
      expect(registry.hasExchange('')).toBe(true);
      expect(registry.hasExchange('amq.direct')).toBe(true);
    });
  });
});
