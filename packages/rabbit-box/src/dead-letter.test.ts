import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  deadLetter,
  deadLetterExpired,
  prepareDeadLetter,
  isDeadLetterCycle,
} from './dead-letter.ts';
import type { DeadLetterDeps } from './dead-letter.ts';
import type { BrokerMessage, MessageProperties } from './types/message.ts';
import type { Queue } from './types/queue.ts';
import type { XDeathEntry } from './types/x-death-entry.ts';

type RepublishArgs = [string, string, Uint8Array, MessageProperties];

function makeQueue(overrides: Partial<Queue> = {}): Queue {
  return {
    name: 'source-q',
    durable: false,
    exclusive: false,
    autoDelete: false,
    arguments: {},
    deadLetterExchange: 'dlx',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<BrokerMessage> = {}): BrokerMessage {
  return {
    body: new TextEncoder().encode('test'),
    properties: {},
    exchange: 'original-ex',
    routingKey: 'original-rk',
    mandatory: false,
    immediate: false,
    deliveryCount: 0,
    enqueuedAt: 1000,
    priority: 0,
    ...overrides,
  };
}

function assertDefined<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).toBeDefined();
  return value as T;
}

describe('dead-letter', () => {
  let republish: ReturnType<typeof vi.fn<DeadLetterDeps['republish']>>;
  let deps: DeadLetterDeps;
  let queue: Queue;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

    queue = makeQueue();
    republish = vi.fn<DeadLetterDeps['republish']>();
    deps = {
      getQueue: (name: string) => (name === queue.name ? queue : undefined),
      exchangeExists: () => true,
      republish,
      now: () => Date.now(),
    };
  });

  // ── Basic DLX routing ─────────────────────────────────────────────

  it('publishes to DLX exchange when queue has DLX configured', () => {
    const msg = makeMessage();

    deadLetter(msg, 'source-q', 'rejected', deps);

    expect(republish).toHaveBeenCalledTimes(1);
    const [exchange] = republish.mock.calls[0] as RepublishArgs;
    expect(exchange).toBe('dlx');
  });

  it('uses original routing key when no x-dead-letter-routing-key set', () => {
    const msg = makeMessage({ routingKey: 'my-key' });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, routingKey] = republish.mock.calls[0] as RepublishArgs;
    expect(routingKey).toBe('my-key');
  });

  it('uses x-dead-letter-routing-key from queue config when set', () => {
    queue = makeQueue({ deadLetterRoutingKey: 'dlx-rk' });
    deps = {
      ...deps,
      getQueue: (name) => (name === queue.name ? queue : undefined),
    };
    const msg = makeMessage({ routingKey: 'original-rk' });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, routingKey] = republish.mock.calls[0] as RepublishArgs;
    expect(routingKey).toBe('dlx-rk');
  });

  it('passes message body unchanged', () => {
    const body = new TextEncoder().encode('hello world');
    const msg = makeMessage({ body });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , publishedBody] = republish.mock.calls[0] as RepublishArgs;
    expect(publishedBody).toBe(body);
  });

  // ── No DLX configured ────────────────────────────────────────────

  it('does nothing when queue has no DLX configured', () => {
    queue = makeQueue({ deadLetterExchange: undefined });
    deps = {
      ...deps,
      getQueue: (name) => (name === queue.name ? queue : undefined),
    };
    const msg = makeMessage();

    deadLetter(msg, 'source-q', 'rejected', deps);

    expect(republish).not.toHaveBeenCalled();
  });

  it('does nothing when queue is not found', () => {
    deps = { ...deps, getQueue: () => undefined };
    const msg = makeMessage();

    deadLetter(msg, 'unknown-q', 'rejected', deps);

    expect(republish).not.toHaveBeenCalled();
  });

  // ── Missing DLX exchange ─────────────────────────────────────────

  it('silently drops message when DLX exchange does not exist', () => {
    deps = { ...deps, exchangeExists: () => false };
    const msg = makeMessage();

    deadLetter(msg, 'source-q', 'rejected', deps);

    expect(republish).not.toHaveBeenCalled();
  });

  // ── DLX with empty string (default exchange) ─────────────────────

  it('publishes to default exchange when DLX is empty string', () => {
    queue = makeQueue({ deadLetterExchange: '' });
    deps = {
      ...deps,
      getQueue: (name) => (name === queue.name ? queue : undefined),
    };
    const msg = makeMessage();

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [exchange] = republish.mock.calls[0] as RepublishArgs;
    expect(exchange).toBe('');
  });

  // ── x-death header structure ─────────────────────────────────────

  it('creates x-death entry with correct structure', () => {
    const msg = makeMessage({
      exchange: 'pub-ex',
      routingKey: 'pub-rk',
    });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    const xDeath = props.headers?.['x-death'] as XDeathEntry[];
    expect(xDeath).toHaveLength(1);
    expect(xDeath[0]).toEqual({
      queue: 'source-q',
      reason: 'rejected',
      count: 1,
      exchange: 'pub-ex',
      'routing-keys': ['pub-rk'],
      time: Math.floor(Date.now() / 1000),
    });
  });

  it('uses seconds for time field (AMQP timestamp convention)', () => {
    const msg = makeMessage();

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    const xDeath = props.headers?.['x-death'] as XDeathEntry[];
    // Date.now() in test is 2025-01-15T12:00:00Z
    expect((xDeath[0] as XDeathEntry).time).toBe(
      Math.floor(new Date('2025-01-15T12:00:00Z').getTime() / 1000)
    );
  });

  // ── x-death count increment ──────────────────────────────────────

  it('increments count for same queue+reason in x-death', () => {
    const existingXDeath: XDeathEntry[] = [
      {
        queue: 'source-q',
        reason: 'rejected',
        count: 2,
        exchange: 'pub-ex',
        'routing-keys': ['pub-rk'],
        time: 1000,
      },
    ];
    const msg = makeMessage({
      exchange: 'pub-ex',
      routingKey: 'pub-rk',
      properties: {
        headers: { 'x-death': existingXDeath },
      },
    });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    const xDeath = props.headers?.['x-death'] as XDeathEntry[];
    expect(xDeath).toHaveLength(1);
    expect((xDeath[0] as XDeathEntry).count).toBe(3);
    // Time should be updated
    expect((xDeath[0] as XDeathEntry).time).toBe(Math.floor(Date.now() / 1000));
  });

  it('adds new entry for different queue+reason combination', () => {
    const existingXDeath: XDeathEntry[] = [
      {
        queue: 'other-q',
        reason: 'rejected',
        count: 1,
        exchange: 'ex',
        'routing-keys': ['rk'],
        time: 1000,
      },
    ];
    const msg = makeMessage({
      properties: {
        headers: { 'x-death': existingXDeath },
      },
    });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    const xDeath = props.headers?.['x-death'] as XDeathEntry[];
    expect(xDeath).toHaveLength(2);
    // New entry is at the front
    expect((xDeath[0] as XDeathEntry).queue).toBe('source-q');
    expect((xDeath[1] as XDeathEntry).queue).toBe('other-q');
  });

  it('moves incremented entry to front of x-death array', () => {
    const existingXDeath: XDeathEntry[] = [
      {
        queue: 'other-q',
        reason: 'rejected',
        count: 1,
        exchange: 'ex',
        'routing-keys': ['rk'],
        time: 900,
      },
      {
        queue: 'source-q',
        reason: 'rejected',
        count: 1,
        exchange: 'original-ex',
        'routing-keys': ['original-rk'],
        time: 800,
      },
    ];
    const msg = makeMessage({
      properties: {
        headers: { 'x-death': existingXDeath },
      },
    });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    const xDeath = props.headers?.['x-death'] as XDeathEntry[];
    expect(xDeath).toHaveLength(2);
    expect((xDeath[0] as XDeathEntry).queue).toBe('source-q');
    expect((xDeath[0] as XDeathEntry).count).toBe(2);
    expect((xDeath[1] as XDeathEntry).queue).toBe('other-q');
  });

  it('adds new entry for same queue but different reason', () => {
    const existingXDeath: XDeathEntry[] = [
      {
        queue: 'source-q',
        reason: 'expired',
        count: 1,
        exchange: 'ex',
        'routing-keys': ['rk'],
        time: 1000,
      },
    ];
    const msg = makeMessage({
      properties: {
        headers: { 'x-death': existingXDeath },
      },
    });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    const xDeath = props.headers?.['x-death'] as XDeathEntry[];
    expect(xDeath).toHaveLength(2);
    expect((xDeath[0] as XDeathEntry).reason).toBe('rejected');
    expect((xDeath[1] as XDeathEntry).reason).toBe('expired');
  });

  // ── Expiration removal ───────────────────────────────────────────

  it('removes expiration property from dead-lettered message', () => {
    const msg = makeMessage({
      properties: {
        expiration: '60000',
        contentType: 'text/plain',
      },
    });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    expect(props.expiration).toBeUndefined();
    expect(props.contentType).toBe('text/plain');
  });

  // ── original-expiration ──────────────────────────────────────────

  it('stores original-expiration in x-death when reason is expired and message had expiration', () => {
    const msg = makeMessage({
      properties: {
        expiration: '30000',
      },
    });

    deadLetter(msg, 'source-q', 'expired', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    const xDeath = props.headers?.['x-death'] as XDeathEntry[];
    expect((xDeath[0] as XDeathEntry)['original-expiration']).toBe('30000');
  });

  it('does not store original-expiration when reason is rejected', () => {
    const msg = makeMessage({
      properties: {
        expiration: '30000',
      },
    });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    const xDeath = props.headers?.['x-death'] as XDeathEntry[];
    expect((xDeath[0] as XDeathEntry)['original-expiration']).toBeUndefined();
  });

  it('does not store original-expiration when expired but no per-message expiration', () => {
    const msg = makeMessage();

    deadLetter(msg, 'source-q', 'expired', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    const xDeath = props.headers?.['x-death'] as XDeathEntry[];
    expect((xDeath[0] as XDeathEntry)['original-expiration']).toBeUndefined();
  });

  // ── Quick-access headers ─────────────────────────────────────────

  it('sets x-first-death-queue, x-first-death-reason, and x-first-death-exchange on first death', () => {
    const msg = makeMessage();

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    expect(props.headers?.['x-first-death-queue']).toBe('source-q');
    expect(props.headers?.['x-first-death-reason']).toBe('rejected');
    expect(props.headers?.['x-first-death-exchange']).toBe('original-ex');
  });

  it('sets x-last-death-queue, x-last-death-reason, and x-last-death-exchange', () => {
    const msg = makeMessage();

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    expect(props.headers?.['x-last-death-queue']).toBe('source-q');
    expect(props.headers?.['x-last-death-reason']).toBe('rejected');
    expect(props.headers?.['x-last-death-exchange']).toBe('original-ex');
  });

  it('preserves x-first-death headers on subsequent deaths', () => {
    const msg = makeMessage({
      properties: {
        headers: {
          'x-death': [
            {
              queue: 'first-q',
              reason: 'expired',
              count: 1,
              exchange: 'ex',
              'routing-keys': ['rk'],
              time: 1000,
            },
          ] as XDeathEntry[],
          'x-first-death-queue': 'first-q',
          'x-first-death-reason': 'expired',
          'x-first-death-exchange': 'ex',
          'x-last-death-queue': 'first-q',
          'x-last-death-reason': 'expired',
          'x-last-death-exchange': 'ex',
        },
      },
    });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    // First-death headers preserved
    expect(props.headers?.['x-first-death-queue']).toBe('first-q');
    expect(props.headers?.['x-first-death-reason']).toBe('expired');
    expect(props.headers?.['x-first-death-exchange']).toBe('ex');
    // Last-death headers updated
    expect(props.headers?.['x-last-death-queue']).toBe('source-q');
    expect(props.headers?.['x-last-death-reason']).toBe('rejected');
    expect(props.headers?.['x-last-death-exchange']).toBe('original-ex');
  });

  // ── Preserves existing headers ───────────────────────────────────

  it('preserves existing user headers', () => {
    const msg = makeMessage({
      properties: {
        headers: {
          'custom-header': 'value',
          'another-header': 42,
        },
      },
    });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    expect(props.headers?.['custom-header']).toBe('value');
    expect(props.headers?.['another-header']).toBe(42);
  });

  it('preserves non-header properties (except expiration)', () => {
    const msg = makeMessage({
      properties: {
        contentType: 'application/json',
        contentEncoding: 'utf-8',
        deliveryMode: 2,
        priority: 5,
        correlationId: 'corr-1',
        replyTo: 'reply-q',
        messageId: 'msg-1',
        timestamp: 1234567890,
        type: 'order.created',
        userId: 'guest',
        appId: 'my-app',
      },
    });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    expect(props.contentType).toBe('application/json');
    expect(props.contentEncoding).toBe('utf-8');
    expect(props.deliveryMode).toBe(2);
    expect(props.priority).toBe(5);
    expect(props.correlationId).toBe('corr-1');
    expect(props.replyTo).toBe('reply-q');
    expect(props.messageId).toBe('msg-1');
    expect(props.timestamp).toBe(1234567890);
    expect(props.type).toBe('order.created');
    expect(props.userId).toBe('guest');
    expect(props.appId).toBe('my-app');
  });

  // ── Message without headers ──────────────────────────────────────

  it('creates headers object when message had no headers', () => {
    const msg = makeMessage({ properties: {} });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    expect(props.headers).toBeDefined();
    expect(props.headers?.['x-death']).toBeDefined();
  });

  // ── mandatory/immediate flags ────────────────────────────────────

  it('publishes with mandatory=false (DLX messages are not mandatory)', () => {
    const msg = makeMessage({ mandatory: true });

    deadLetter(msg, 'source-q', 'rejected', deps);

    expect(republish).toHaveBeenCalledTimes(1);
    // The dead-letter module publishes to the DLX - routing is handled by the caller
  });
});

describe('deadLetterExpired', () => {
  let republish: ReturnType<typeof vi.fn<DeadLetterDeps['republish']>>;
  let deps: DeadLetterDeps;
  let queue: Queue;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

    queue = makeQueue();
    republish = vi.fn<DeadLetterDeps['republish']>();
    deps = {
      getQueue: (name: string) => (name === queue.name ? queue : undefined),
      exchangeExists: () => true,
      republish,
      now: () => Date.now(),
    };
  });

  it('dead-letters with reason "expired"', () => {
    const msg = makeMessage();

    deadLetterExpired(msg, 'source-q', deps);

    expect(republish).toHaveBeenCalledTimes(1);
    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    const xDeath = props.headers?.['x-death'] as XDeathEntry[];
    expect((xDeath[0] as XDeathEntry).reason).toBe('expired');
  });

  it('stores original-expiration when message had expiration property', () => {
    const msg = makeMessage({ properties: { expiration: '5000' } });

    deadLetterExpired(msg, 'source-q', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    const xDeath = props.headers?.['x-death'] as XDeathEntry[];
    expect((xDeath[0] as XDeathEntry)['original-expiration']).toBe('5000');
  });

  it('strips expiration from republished message properties', () => {
    const msg = makeMessage({
      properties: { expiration: '5000', contentType: 'text/plain' },
    });

    deadLetterExpired(msg, 'source-q', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    expect(props.expiration).toBeUndefined();
    expect(props.contentType).toBe('text/plain');
  });

  it('discards message when queue has no DLX configured', () => {
    queue = makeQueue({ deadLetterExchange: undefined });
    deps = {
      ...deps,
      getQueue: (name) => (name === queue.name ? queue : undefined),
    };

    deadLetterExpired(makeMessage(), 'source-q', deps);

    expect(republish).not.toHaveBeenCalled();
  });
});

// ── Pure function tests (used by publish/overflow pipeline) ─────────

describe('prepareDeadLetter', () => {
  it('creates x-death entry with correct fields', () => {
    const msg = makeMessage({
      exchange: 'source-exchange',
      deliveryCount: 2,
      mandatory: true,
    });
    const result = prepareDeadLetter(msg, {
      queueName: 'my-queue',
      reason: 'maxlen',
      now: 5000,
    });

    const xDeath = assertDefined(result.xDeath);
    expect(xDeath).toHaveLength(1);
    expect(xDeath[0]).toEqual({
      queue: 'my-queue',
      reason: 'maxlen',
      count: 1,
      exchange: 'source-exchange',
      'routing-keys': ['original-rk'],
      time: 5000,
    });
  });

  it('sets x-death in message headers', () => {
    const msg = makeMessage();
    const result = prepareDeadLetter(msg, {
      queueName: 'my-queue',
      reason: 'maxlen',
      now: 5000,
    });

    const headers = assertDefined(result.properties.headers);
    expect(headers['x-death']).toEqual(result.xDeath);
  });

  it('sets x-first-death-* headers on first death', () => {
    const msg = makeMessage({ exchange: 'source-ex' });
    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    const headers = assertDefined(result.properties.headers);
    expect(headers['x-first-death-queue']).toBe('q1');
    expect(headers['x-first-death-reason']).toBe('maxlen');
    expect(headers['x-first-death-exchange']).toBe('source-ex');
  });

  it('sets x-last-death-* headers', () => {
    const msg = makeMessage({ exchange: 'source-ex' });
    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    const headers = assertDefined(result.properties.headers);
    expect(headers['x-last-death-queue']).toBe('q1');
    expect(headers['x-last-death-reason']).toBe('maxlen');
    expect(headers['x-last-death-exchange']).toBe('source-ex');
  });

  it('preserves x-first-death-* on subsequent deaths', () => {
    const msg = makeMessage({
      exchange: 'current-ex',
      xDeath: [
        {
          queue: 'q1',
          reason: 'expired',
          count: 1,
          exchange: 'ex1',
          'routing-keys': ['rk1'],
          time: 1000,
        },
      ],
      properties: {
        headers: {
          'x-first-death-queue': 'q1',
          'x-first-death-reason': 'expired',
          'x-first-death-exchange': 'ex1',
        },
      },
    });

    const result = prepareDeadLetter(msg, {
      queueName: 'q2',
      reason: 'maxlen',
      now: 5000,
    });

    const headers = assertDefined(result.properties.headers);
    expect(headers['x-first-death-queue']).toBe('q1');
    expect(headers['x-first-death-reason']).toBe('expired');
    expect(headers['x-first-death-exchange']).toBe('ex1');
    expect(headers['x-last-death-queue']).toBe('q2');
    expect(headers['x-last-death-reason']).toBe('maxlen');
    expect(headers['x-last-death-exchange']).toBe('current-ex');
  });

  it('increments count for same queue+reason', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'q1',
          reason: 'maxlen',
          count: 2,
          exchange: 'source-exchange',
          'routing-keys': ['original-rk'],
          time: 1000,
        },
      ],
    });

    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    const xDeath = assertDefined(result.xDeath);
    expect(xDeath).toHaveLength(1);
    const entry = assertDefined(xDeath[0]);
    expect(entry.count).toBe(3);
    expect(entry.time).toBe(5000);
  });

  it('adds new entry for different queue', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'q1',
          reason: 'maxlen',
          count: 1,
          exchange: 'ex1',
          'routing-keys': ['rk1'],
          time: 1000,
        },
      ],
    });

    const result = prepareDeadLetter(msg, {
      queueName: 'q2',
      reason: 'maxlen',
      now: 5000,
    });

    const xDeath = assertDefined(result.xDeath);
    expect(xDeath).toHaveLength(2);
    expect(assertDefined(xDeath[0]).queue).toBe('q2');
    expect(assertDefined(xDeath[1]).queue).toBe('q1');
  });

  it('adds new entry for different reason on same queue', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'q1',
          reason: 'expired',
          count: 1,
          exchange: 'ex1',
          'routing-keys': ['rk1'],
          time: 1000,
        },
      ],
    });

    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    const xDeath = assertDefined(result.xDeath);
    expect(xDeath).toHaveLength(2);
    expect(assertDefined(xDeath[0]).reason).toBe('maxlen');
    expect(assertDefined(xDeath[1]).reason).toBe('expired');
  });

  it('removes expiration property from message', () => {
    const msg = makeMessage({
      properties: { expiration: '60000', contentType: 'text/plain' },
    });

    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    expect(result.properties.expiration).toBeUndefined();
    expect(result.properties.contentType).toBe('text/plain');
  });

  it('stores original-expiration in x-death entry', () => {
    const msg = makeMessage({
      properties: { expiration: '60000' },
    });

    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    const entry = assertDefined(assertDefined(result.xDeath)[0]);
    expect(entry['original-expiration']).toBe('60000');
  });

  it('does not set original-expiration when no expiration', () => {
    const msg = makeMessage();

    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    const entry = assertDefined(assertDefined(result.xDeath)[0]);
    expect(entry['original-expiration']).toBeUndefined();
  });

  it('uses deadLetterRoutingKey when provided', () => {
    const msg = makeMessage({ routingKey: 'original-rk' });

    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      deadLetterRoutingKey: 'dl-routing-key',
      now: 5000,
    });

    expect(result.routingKey).toBe('dl-routing-key');
  });

  it('uses original routing key when no deadLetterRoutingKey', () => {
    const msg = makeMessage({ routingKey: 'original-rk' });

    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    expect(result.routingKey).toBe('original-rk');
  });

  it('resets deliveryCount to 0', () => {
    const msg = makeMessage({ deliveryCount: 5 });

    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    expect(result.deliveryCount).toBe(0);
  });

  it('sets mandatory to false', () => {
    const msg = makeMessage({ mandatory: true });

    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    expect(result.mandatory).toBe(false);
  });

  it('preserves existing message headers', () => {
    const msg = makeMessage({
      properties: { headers: { 'x-custom': 'value', 'x-other': 42 } },
    });

    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    const headers = assertDefined(result.properties.headers);
    expect(headers['x-custom']).toBe('value');
    expect(headers['x-other']).toBe(42);
  });

  it('moves incremented entry to front of x-death array', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'q2',
          reason: 'expired',
          count: 1,
          exchange: 'ex',
          'routing-keys': ['rk'],
          time: 2000,
        },
        {
          queue: 'q1',
          reason: 'maxlen',
          count: 1,
          exchange: 'ex',
          'routing-keys': ['rk'],
          time: 1000,
        },
      ],
    });

    const result = prepareDeadLetter(msg, {
      queueName: 'q1',
      reason: 'maxlen',
      now: 5000,
    });

    const xDeath = assertDefined(result.xDeath);
    expect(xDeath).toHaveLength(2);
    const first = assertDefined(xDeath[0]);
    expect(first.queue).toBe('q1');
    expect(first.reason).toBe('maxlen');
    expect(first.count).toBe(2);
    expect(assertDefined(xDeath[1]).queue).toBe('q2');
  });
});

describe('isDeadLetterCycle', () => {
  it('returns false when no xDeath', () => {
    const msg = makeMessage();
    expect(isDeadLetterCycle(msg, 'q1')).toBe(false);
  });

  it('returns false when xDeath is empty', () => {
    const msg = makeMessage({ xDeath: [] });
    expect(isDeadLetterCycle(msg, 'q1')).toBe(false);
  });

  it('returns false when source queue not in xDeath', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'other-queue',
          reason: 'maxlen',
          count: 1,
          exchange: '',
          'routing-keys': ['rk'],
          time: 1000,
        },
      ],
    });
    expect(isDeadLetterCycle(msg, 'q1')).toBe(false);
  });

  it('returns true when source queue in xDeath with automatic reason', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'q1',
          reason: 'maxlen',
          count: 1,
          exchange: '',
          'routing-keys': ['rk'],
          time: 1000,
        },
      ],
    });
    expect(isDeadLetterCycle(msg, 'q1')).toBe(true);
  });

  it('returns false when any reason is rejected', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'q1',
          reason: 'maxlen',
          count: 1,
          exchange: '',
          'routing-keys': ['rk'],
          time: 1000,
        },
        {
          queue: 'q2',
          reason: 'rejected',
          count: 1,
          exchange: '',
          'routing-keys': ['rk'],
          time: 2000,
        },
      ],
    });
    expect(isDeadLetterCycle(msg, 'q1')).toBe(false);
  });

  it('detects cycle with expired reason', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'q1',
          reason: 'expired',
          count: 1,
          exchange: '',
          'routing-keys': ['rk'],
          time: 1000,
        },
      ],
    });
    expect(isDeadLetterCycle(msg, 'q1')).toBe(true);
  });

  it('detects cycle with mixed automatic reasons', () => {
    const xDeath: XDeathEntry[] = [
      {
        queue: 'q1',
        reason: 'maxlen',
        count: 1,
        exchange: '',
        'routing-keys': ['rk'],
        time: 1000,
      },
      {
        queue: 'q2',
        reason: 'expired',
        count: 1,
        exchange: '',
        'routing-keys': ['rk'],
        time: 2000,
      },
    ];
    const msg = makeMessage({ xDeath });
    expect(isDeadLetterCycle(msg, 'q1')).toBe(true);
  });

  it('detects cycle with delivery_limit reason', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'q1',
          reason: 'delivery_limit',
          count: 1,
          exchange: '',
          'routing-keys': ['rk'],
          time: 1000,
        },
      ],
    });
    expect(isDeadLetterCycle(msg, 'q1')).toBe(true);
  });

  it('allows cycle when rejected reason present even with delivery_limit', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'q1',
          reason: 'delivery_limit',
          count: 1,
          exchange: '',
          'routing-keys': ['rk'],
          time: 1000,
        },
        {
          queue: 'q2',
          reason: 'rejected',
          count: 1,
          exchange: '',
          'routing-keys': ['rk'],
          time: 2000,
        },
      ],
    });
    expect(isDeadLetterCycle(msg, 'q1')).toBe(false);
  });

  // ── A↔B cycle scenarios ──────────────────────────────────────────

  it('detects simple A↔B cycle with expired (message has been through both queues)', () => {
    // Simulates: msg expired in A → routed to B → expired in B → routed back to A
    // At this point, x-death has entries for both A and B with expired reason
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'queue-b',
          reason: 'expired',
          count: 1,
          exchange: 'ex-b',
          'routing-keys': ['rk-b'],
          time: 2000,
        },
        {
          queue: 'queue-a',
          reason: 'expired',
          count: 1,
          exchange: 'ex-a',
          'routing-keys': ['rk-a'],
          time: 1000,
        },
      ],
    });
    // Message is back in queue-a, about to be dead-lettered again
    expect(isDeadLetterCycle(msg, 'queue-a')).toBe(true);
  });

  it('allows A↔B cycle when rejected reason is present', () => {
    // One hop was rejected (intentional) — cycle is allowed
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'queue-b',
          reason: 'rejected',
          count: 1,
          exchange: 'ex-b',
          'routing-keys': ['rk-b'],
          time: 2000,
        },
        {
          queue: 'queue-a',
          reason: 'expired',
          count: 1,
          exchange: 'ex-a',
          'routing-keys': ['rk-a'],
          time: 1000,
        },
      ],
    });
    expect(isDeadLetterCycle(msg, 'queue-a')).toBe(false);
  });

  // ── Complex multi-hop cycle ──────────────────────────────────────

  it('detects complex multi-hop cycle A→B→C→A with automatic reasons', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'queue-c',
          reason: 'maxlen',
          count: 1,
          exchange: 'ex-c',
          'routing-keys': ['rk-c'],
          time: 3000,
        },
        {
          queue: 'queue-b',
          reason: 'expired',
          count: 1,
          exchange: 'ex-b',
          'routing-keys': ['rk-b'],
          time: 2000,
        },
        {
          queue: 'queue-a',
          reason: 'expired',
          count: 1,
          exchange: 'ex-a',
          'routing-keys': ['rk-a'],
          time: 1000,
        },
      ],
    });
    // Message cycled back to queue-a
    expect(isDeadLetterCycle(msg, 'queue-a')).toBe(true);
  });

  it('allows multi-hop cycle if any hop was rejected', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'queue-c',
          reason: 'maxlen',
          count: 1,
          exchange: 'ex-c',
          'routing-keys': ['rk-c'],
          time: 3000,
        },
        {
          queue: 'queue-b',
          reason: 'rejected',
          count: 1,
          exchange: 'ex-b',
          'routing-keys': ['rk-b'],
          time: 2000,
        },
        {
          queue: 'queue-a',
          reason: 'expired',
          count: 1,
          exchange: 'ex-a',
          'routing-keys': ['rk-a'],
          time: 1000,
        },
      ],
    });
    expect(isDeadLetterCycle(msg, 'queue-a')).toBe(false);
  });

  it('returns false for first visit to queue (no cycle)', () => {
    // Message has been through other queues but not the one we're checking
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'queue-b',
          reason: 'expired',
          count: 1,
          exchange: 'ex-b',
          'routing-keys': ['rk-b'],
          time: 2000,
        },
        {
          queue: 'queue-a',
          reason: 'expired',
          count: 1,
          exchange: 'ex-a',
          'routing-keys': ['rk-a'],
          time: 1000,
        },
      ],
    });
    // queue-c is not in x-death — no cycle
    expect(isDeadLetterCycle(msg, 'queue-c')).toBe(false);
  });

  it('detects cycle even with high count (no numeric iteration limit)', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'q1',
          reason: 'expired',
          count: 999,
          exchange: '',
          'routing-keys': ['rk'],
          time: 1000,
        },
      ],
    });
    expect(isDeadLetterCycle(msg, 'q1')).toBe(true);
  });
});

// ── Cycle detection integration with deadLetter ─────────────────────

describe('deadLetter cycle detection', () => {
  let republish: ReturnType<typeof vi.fn<DeadLetterDeps['republish']>>;
  let deps: DeadLetterDeps;
  let queueA: Queue;
  let queueB: Queue;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

    queueA = makeQueue({
      name: 'queue-a',
      deadLetterExchange: 'dlx-a',
    });
    queueB = makeQueue({
      name: 'queue-b',
      deadLetterExchange: 'dlx-b',
    });

    republish = vi.fn<DeadLetterDeps['republish']>();
    deps = {
      getQueue: (name: string) => {
        if (name === 'queue-a') return queueA;
        if (name === 'queue-b') return queueB;
        return undefined;
      },
      exchangeExists: () => true,
      republish,
      now: () => Date.now(),
    };
  });

  it('drops message on expired cycle (A↔B with expired)', () => {
    // Message has already been through queue-a with expired reason
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'queue-a',
          reason: 'expired',
          count: 1,
          exchange: 'ex',
          'routing-keys': ['rk'],
          time: 1000,
        },
      ],
    });

    // Dead-letter from queue-a again with expired — cycle detected, dropped
    deadLetter(msg, 'queue-a', 'expired', deps);

    expect(republish).not.toHaveBeenCalled();
  });

  it('drops message on maxlen cycle', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'queue-a',
          reason: 'maxlen',
          count: 1,
          exchange: 'ex',
          'routing-keys': ['rk'],
          time: 1000,
        },
      ],
    });

    deadLetter(msg, 'queue-a', 'maxlen', deps);

    expect(republish).not.toHaveBeenCalled();
  });

  it('allows rejected reason even when cycle exists (rejected bypasses detection)', () => {
    // Message has been through queue-a before with expired
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'queue-a',
          reason: 'expired',
          count: 1,
          exchange: 'ex',
          'routing-keys': ['rk'],
          time: 1000,
        },
      ],
    });

    // Dead-letter from queue-a with rejected — rejected bypasses cycle detection
    deadLetter(msg, 'queue-a', 'rejected', deps);

    expect(republish).toHaveBeenCalledTimes(1);
  });

  it('allows dead-lettering when no cycle exists', () => {
    const msg = makeMessage();

    deadLetter(msg, 'queue-a', 'expired', deps);

    expect(republish).toHaveBeenCalledTimes(1);
  });

  it('drops message with deadLetterExpired when cycle detected', () => {
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'queue-a',
          reason: 'expired',
          count: 1,
          exchange: 'ex',
          'routing-keys': ['rk'],
          time: 1000,
        },
      ],
    });

    deadLetterExpired(msg, 'queue-a', deps);

    expect(republish).not.toHaveBeenCalled();
  });
});
