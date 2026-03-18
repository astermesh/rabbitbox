import { describe, expect, it, beforeEach } from 'vitest';
import {
  directMatch,
  fanoutMatch,
  topicMatch,
  headersMatch,
  route,
} from './routing.ts';
import { ExchangeRegistry } from './exchange-registry.ts';
import type { Binding } from './types/binding.ts';
import { ChannelError } from './errors/amqp-error.ts';
import { PRECONDITION_FAILED } from './errors/reply-codes.ts';

// ── directMatch ─────────────────────────────────────────────────────

describe('directMatch', () => {
  it('returns true for exact string equality', () => {
    expect(directMatch('order.created', 'order.created')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(directMatch('order.created', 'order.shipped')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(directMatch('', '')).toBe(true);
  });

  it('returns false when routing key is empty but binding key is not', () => {
    expect(directMatch('', 'order')).toBe(false);
  });

  it('returns false when binding key is empty but routing key is not', () => {
    expect(directMatch('order', '')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(directMatch('Order', 'order')).toBe(false);
  });
});

// ── fanoutMatch ─────────────────────────────────────────────────────

describe('fanoutMatch', () => {
  it('always returns true', () => {
    expect(fanoutMatch()).toBe(true);
  });
});

// ── topicMatch ──────────────────────────────────────────────────────

describe('topicMatch', () => {
  // ── Exact matches ───────────────────────────────────────────────

  describe('exact matches (no wildcards)', () => {
    it('matches identical single-word keys', () => {
      expect(topicMatch('order', 'order')).toBe(true);
    });

    it('matches identical multi-word keys', () => {
      expect(topicMatch('order.created.us', 'order.created.us')).toBe(true);
    });

    it('does not match different keys', () => {
      expect(topicMatch('order.created', 'order.shipped')).toBe(false);
    });

    it('does not match keys with different word counts', () => {
      expect(topicMatch('order.created', 'order.created.us')).toBe(false);
    });
  });

  // ── Star wildcard (*) ───────────────────────────────────────────

  describe('star wildcard (*)', () => {
    it('matches exactly one word', () => {
      expect(topicMatch('order.created', 'order.*')).toBe(true);
    });

    it('does not match zero words', () => {
      expect(topicMatch('order', 'order.*')).toBe(false);
    });

    it('does not match multiple words', () => {
      expect(topicMatch('order.created.us', 'order.*')).toBe(false);
    });

    it('works at the beginning', () => {
      expect(topicMatch('order.created', '*.created')).toBe(true);
    });

    it('works in the middle', () => {
      expect(topicMatch('a.b.c', 'a.*.c')).toBe(true);
    });

    it('multiple stars', () => {
      expect(topicMatch('a.b.c', '*.*.*')).toBe(true);
    });

    it('multiple stars do not match different word count', () => {
      expect(topicMatch('a.b', '*.*.*')).toBe(false);
    });

    it('star matches any word content', () => {
      expect(topicMatch('x.anything.y', 'x.*.y')).toBe(true);
    });
  });

  // ── Hash wildcard (#) ──────────────────────────────────────────

  describe('hash wildcard (#)', () => {
    it('# alone matches everything', () => {
      expect(topicMatch('a.b.c', '#')).toBe(true);
    });

    it('# alone matches single word', () => {
      expect(topicMatch('order', '#')).toBe(true);
    });

    it('# alone matches empty routing key', () => {
      expect(topicMatch('', '#')).toBe(true);
    });

    it('# at end matches zero trailing words', () => {
      expect(topicMatch('order', 'order.#')).toBe(true);
    });

    it('# at end matches one trailing word', () => {
      expect(topicMatch('order.created', 'order.#')).toBe(true);
    });

    it('# at end matches many trailing words', () => {
      expect(topicMatch('order.created.us.east', 'order.#')).toBe(true);
    });

    it('# at beginning matches zero leading words', () => {
      expect(topicMatch('created', '#.created')).toBe(true);
    });

    it('# at beginning matches one leading word', () => {
      expect(topicMatch('order.created', '#.created')).toBe(true);
    });

    it('# at beginning matches many leading words', () => {
      expect(topicMatch('a.b.c.created', '#.created')).toBe(true);
    });

    it('# in middle matches zero words', () => {
      expect(topicMatch('a.b', 'a.#.b')).toBe(true);
    });

    it('# in middle matches one word', () => {
      expect(topicMatch('a.x.b', 'a.#.b')).toBe(true);
    });

    it('# in middle matches many words', () => {
      expect(topicMatch('a.x.y.z.b', 'a.#.b')).toBe(true);
    });

    it('multiple # wildcards', () => {
      expect(topicMatch('a.b.c.d.e', '#.c.#')).toBe(true);
    });

    it('# does not match when remaining pattern fails', () => {
      expect(topicMatch('a.b.c', 'a.#.d')).toBe(false);
    });
  });

  // ── Combined wildcards ─────────────────────────────────────────

  describe('combined wildcards', () => {
    it('* and # together', () => {
      expect(topicMatch('a.b.c.d', '*.#')).toBe(true);
    });

    it('*.# requires at least one word', () => {
      expect(topicMatch('', '*.#')).toBe(false);
    });

    it('# and * together', () => {
      expect(topicMatch('a.b.c.d', '#.*')).toBe(true);
    });

    it('#.* requires at least one word', () => {
      expect(topicMatch('', '#.*')).toBe(false);
    });

    it('*.b.# matches', () => {
      expect(topicMatch('a.b.c.d', '*.b.#')).toBe(true);
    });

    it('#.b.* matches', () => {
      expect(topicMatch('a.b.c', '#.b.*')).toBe(true);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('empty routing key only matches # or empty pattern', () => {
      expect(topicMatch('', '')).toBe(true);
      expect(topicMatch('', '#')).toBe(true);
      expect(topicMatch('', 'a')).toBe(false);
    });

    it('empty pattern only matches empty routing key', () => {
      expect(topicMatch('', '')).toBe(true);
      expect(topicMatch('a', '')).toBe(false);
    });

    it('trailing dot in routing key creates empty segment', () => {
      // RabbitMQ treats "a." as two words: "a" and ""
      expect(topicMatch('a.', 'a.*')).toBe(true);
    });

    it('leading dot in routing key creates empty segment', () => {
      expect(topicMatch('.a', '*.a')).toBe(true);
    });

    it('multiple consecutive dots create empty segments', () => {
      expect(topicMatch('a..b', 'a.*.b')).toBe(true);
    });

    it('pattern with trailing dot', () => {
      expect(topicMatch('a.', 'a.')).toBe(true);
    });

    it('dot-only routing key', () => {
      expect(topicMatch('.', '*.*')).toBe(true);
    });

    it('# matches dot-only routing key', () => {
      expect(topicMatch('.', '#')).toBe(true);
    });
  });
});

// ── headersMatch ────────────────────────────────────────────────────

describe('headersMatch', () => {
  // ── x-match: all ───────────────────────────────────────────────

  describe('x-match: all (default)', () => {
    it('matches when all binding args are present in message headers', () => {
      expect(
        headersMatch(
          { format: 'pdf', type: 'report' },
          { format: 'pdf', type: 'report', 'x-match': 'all' },
        ),
      ).toBe(true);
    });

    it('matches when message has extra headers', () => {
      expect(
        headersMatch(
          { format: 'pdf', type: 'report', extra: 'value' },
          { format: 'pdf', type: 'report', 'x-match': 'all' },
        ),
      ).toBe(true);
    });

    it('does not match when a binding arg is missing', () => {
      expect(
        headersMatch(
          { format: 'pdf' },
          { format: 'pdf', type: 'report', 'x-match': 'all' },
        ),
      ).toBe(false);
    });

    it('does not match when a binding arg value differs', () => {
      expect(
        headersMatch(
          { format: 'csv', type: 'report' },
          { format: 'pdf', type: 'report', 'x-match': 'all' },
        ),
      ).toBe(false);
    });

    it('excludes x-* keys from comparison', () => {
      expect(
        headersMatch(
          { format: 'pdf' },
          { format: 'pdf', 'x-match': 'all', 'x-custom': 'ignored' },
        ),
      ).toBe(true);
    });

    it('defaults to all when x-match is not specified', () => {
      expect(
        headersMatch(
          { format: 'pdf', type: 'report' },
          { format: 'pdf', type: 'report' },
        ),
      ).toBe(true);
    });

    it('matches with empty binding args (excluding x-match)', () => {
      expect(headersMatch({ format: 'pdf' }, { 'x-match': 'all' })).toBe(
        true,
      );
    });
  });

  // ── x-match: any ───────────────────────────────────────────────

  describe('x-match: any', () => {
    it('matches when at least one binding arg matches', () => {
      expect(
        headersMatch(
          { format: 'pdf', type: 'log' },
          { format: 'pdf', type: 'report', 'x-match': 'any' },
        ),
      ).toBe(true);
    });

    it('does not match when no binding args match', () => {
      expect(
        headersMatch(
          { format: 'csv', type: 'log' },
          { format: 'pdf', type: 'report', 'x-match': 'any' },
        ),
      ).toBe(false);
    });

    it('excludes x-* keys from comparison', () => {
      expect(
        headersMatch(
          { 'x-custom': 'value' },
          { 'x-custom': 'value', 'x-match': 'any' },
        ),
      ).toBe(false);
    });

    it('does not match with empty binding args (excluding x-match)', () => {
      expect(headersMatch({ format: 'pdf' }, { 'x-match': 'any' })).toBe(
        false,
      );
    });
  });

  // ── x-match: all-with-x ───────────────────────────────────────

  describe('x-match: all-with-x', () => {
    it('includes x-* keys in comparison', () => {
      expect(
        headersMatch(
          { format: 'pdf', 'x-custom': 'value' },
          { format: 'pdf', 'x-custom': 'value', 'x-match': 'all-with-x' },
        ),
      ).toBe(true);
    });

    it('fails when x-* key is missing from message', () => {
      expect(
        headersMatch(
          { format: 'pdf' },
          { format: 'pdf', 'x-custom': 'value', 'x-match': 'all-with-x' },
        ),
      ).toBe(false);
    });

    it('still excludes x-match itself from comparison', () => {
      expect(
        headersMatch(
          { format: 'pdf' },
          { format: 'pdf', 'x-match': 'all-with-x' },
        ),
      ).toBe(true);
    });
  });

  // ── x-match: any-with-x ───────────────────────────────────────

  describe('x-match: any-with-x', () => {
    it('includes x-* keys in comparison', () => {
      expect(
        headersMatch(
          { 'x-custom': 'value' },
          { 'x-custom': 'value', 'x-match': 'any-with-x' },
        ),
      ).toBe(true);
    });

    it('matches on x-* key even if non-x key does not match', () => {
      expect(
        headersMatch(
          { format: 'csv', 'x-custom': 'value' },
          { format: 'pdf', 'x-custom': 'value', 'x-match': 'any-with-x' },
        ),
      ).toBe(true);
    });

    it('still excludes x-match itself from comparison', () => {
      expect(
        headersMatch(
          { format: 'csv' },
          { format: 'pdf', 'x-match': 'any-with-x' },
        ),
      ).toBe(false);
    });
  });

  // ── Void-typed binding args ────────────────────────────────────

  describe('void-typed binding args (key presence check)', () => {
    it('matches when key is present regardless of value (all mode)', () => {
      expect(
        headersMatch(
          { format: 'anything' },
          { format: undefined, 'x-match': 'all' },
        ),
      ).toBe(true);
    });

    it('does not match when key is absent (all mode)', () => {
      expect(
        headersMatch(
          { other: 'value' },
          { format: undefined, 'x-match': 'all' },
        ),
      ).toBe(false);
    });

    it('matches when key is present (any mode)', () => {
      expect(
        headersMatch(
          { format: 'anything' },
          { format: undefined, 'x-match': 'any' },
        ),
      ).toBe(true);
    });

    it('mixes void and valued args correctly', () => {
      expect(
        headersMatch(
          { format: 'anything', type: 'report' },
          { format: undefined, type: 'report', 'x-match': 'all' },
        ),
      ).toBe(true);
    });

    it('void arg fails when valued arg also fails in all mode', () => {
      expect(
        headersMatch(
          { format: 'anything', type: 'log' },
          { format: undefined, type: 'report', 'x-match': 'all' },
        ),
      ).toBe(false);
    });
  });

  // ── Invalid x-match ────────────────────────────────────────────

  describe('invalid x-match value', () => {
    it('throws PRECONDITION_FAILED for invalid x-match', () => {
      try {
        headersMatch({ format: 'pdf' }, { 'x-match': 'invalid' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        const e = err as ChannelError;
        expect(e.replyCode).toBe(PRECONDITION_FAILED);
        expect(e.replyText).toContain(
          'expected all, any, all-with-x, or any-with-x',
        );
      }
    });
  });
});

// ── route ───────────────────────────────────────────────────────────

describe('route', () => {
  let exchangeRegistry: ExchangeRegistry;

  beforeEach(() => {
    exchangeRegistry = new ExchangeRegistry();
  });

  function makeBinding(
    exchange: string,
    queue: string,
    routingKey = '',
    args: Record<string, unknown> = {},
  ): Binding {
    return { exchange, queue, routingKey, arguments: args };
  }

  describe('direct exchange routing', () => {
    it('returns bindings with matching routing key', () => {
      const bindings = [
        makeBinding('amq.direct', 'q1', 'order.created'),
        makeBinding('amq.direct', 'q2', 'order.shipped'),
        makeBinding('amq.direct', 'q3', 'order.created'),
      ];

      const result = route(
        exchangeRegistry.checkExchange('amq.direct'),
        bindings,
        'order.created',
      );

      expect(result).toHaveLength(2);
      expect(result.map((b) => b.queue)).toEqual(['q1', 'q3']);
    });

    it('returns empty array when no bindings match', () => {
      const bindings = [makeBinding('amq.direct', 'q1', 'order.shipped')];
      const result = route(
        exchangeRegistry.checkExchange('amq.direct'),
        bindings,
        'order.created',
      );
      expect(result).toEqual([]);
    });
  });

  describe('fanout exchange routing', () => {
    it('returns all bindings regardless of routing key', () => {
      const bindings = [
        makeBinding('amq.fanout', 'q1', 'anything'),
        makeBinding('amq.fanout', 'q2', ''),
        makeBinding('amq.fanout', 'q3', 'other'),
      ];

      const result = route(
        exchangeRegistry.checkExchange('amq.fanout'),
        bindings,
        'ignored',
      );

      expect(result).toHaveLength(3);
    });

    it('returns empty array when no bindings exist', () => {
      const result = route(
        exchangeRegistry.checkExchange('amq.fanout'),
        [],
        'key',
      );
      expect(result).toEqual([]);
    });
  });

  describe('topic exchange routing', () => {
    it('matches using topic patterns', () => {
      const bindings = [
        makeBinding('amq.topic', 'q1', 'order.*'),
        makeBinding('amq.topic', 'q2', 'order.#'),
        makeBinding('amq.topic', 'q3', 'payment.*'),
      ];

      const result = route(
        exchangeRegistry.checkExchange('amq.topic'),
        bindings,
        'order.created',
      );

      expect(result).toHaveLength(2);
      expect(result.map((b) => b.queue)).toEqual(['q1', 'q2']);
    });

    it('# binding matches all messages', () => {
      const bindings = [makeBinding('amq.topic', 'q1', '#')];
      const result = route(
        exchangeRegistry.checkExchange('amq.topic'),
        bindings,
        'any.routing.key',
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('headers exchange routing', () => {
    it('matches using header arguments', () => {
      const bindings = [
        makeBinding('amq.headers', 'q1', '', {
          format: 'pdf',
          type: 'report',
          'x-match': 'all',
        }),
        makeBinding('amq.headers', 'q2', '', {
          format: 'pdf',
          'x-match': 'any',
        }),
        makeBinding('amq.headers', 'q3', '', {
          format: 'csv',
          'x-match': 'all',
        }),
      ];

      const result = route(
        exchangeRegistry.checkExchange('amq.headers'),
        bindings,
        '',
        { format: 'pdf', type: 'report' },
      );

      expect(result).toHaveLength(2);
      expect(result.map((b) => b.queue)).toEqual(['q1', 'q2']);
    });

    it('ignores routing key for headers exchange', () => {
      const bindings = [
        makeBinding('amq.headers', 'q1', 'ignored', {
          format: 'pdf',
          'x-match': 'all',
        }),
      ];

      const result = route(
        exchangeRegistry.checkExchange('amq.headers'),
        bindings,
        'completely.different.key',
        { format: 'pdf' },
      );

      expect(result).toHaveLength(1);
    });
  });

  describe('default exchange routing', () => {
    it('routes as direct exchange', () => {
      const bindings = [
        makeBinding('', 'my-queue', 'my-queue'),
        makeBinding('', 'other-queue', 'other-queue'),
      ];

      const result = route(
        exchangeRegistry.checkExchange(''),
        bindings,
        'my-queue',
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.queue).toBe('my-queue');
    });
  });
});
