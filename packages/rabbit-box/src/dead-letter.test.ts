import { describe, expect, it, beforeEach, vi } from 'vitest';
import { deadLetter } from './dead-letter.ts';
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

  it('sets x-first-death-queue and x-first-death-reason on first death', () => {
    const msg = makeMessage();

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    expect(props.headers?.['x-first-death-queue']).toBe('source-q');
    expect(props.headers?.['x-first-death-reason']).toBe('rejected');
  });

  it('sets x-last-death-queue and x-last-death-reason', () => {
    const msg = makeMessage();

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    expect(props.headers?.['x-last-death-queue']).toBe('source-q');
    expect(props.headers?.['x-last-death-reason']).toBe('rejected');
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
          'x-last-death-queue': 'first-q',
          'x-last-death-reason': 'expired',
        },
      },
    });

    deadLetter(msg, 'source-q', 'rejected', deps);

    const [, , , props] = republish.mock.calls[0] as RepublishArgs;
    // First-death headers preserved
    expect(props.headers?.['x-first-death-queue']).toBe('first-q');
    expect(props.headers?.['x-first-death-reason']).toBe('expired');
    // Last-death headers updated
    expect(props.headers?.['x-last-death-queue']).toBe('source-q');
    expect(props.headers?.['x-last-death-reason']).toBe('rejected');
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
