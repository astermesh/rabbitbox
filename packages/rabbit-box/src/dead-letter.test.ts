import { describe, expect, it, vi } from 'vitest';
import { deadLetterExpired, deadLetter } from './dead-letter.ts';
import type { BrokerMessage } from './types/message.ts';
import type { Queue } from './types/queue.ts';
import type { DeadLetterDeps } from './dead-letter.ts';
import type { XDeathEntry } from './types/x-death-entry.ts';

// ── Helpers ─────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<BrokerMessage> = {}): BrokerMessage {
  return {
    body: new Uint8Array([1, 2, 3]),
    properties: {},
    exchange: 'amq.direct',
    routingKey: 'test-key',
    mandatory: false,
    immediate: false,
    deliveryCount: 0,
    enqueuedAt: 10000,
    priority: 0,
    ...overrides,
  };
}

function makeQueue(overrides: Partial<Queue> = {}): Queue {
  return {
    name: 'source-queue',
    durable: false,
    exclusive: false,
    autoDelete: false,
    arguments: {},
    ...overrides,
  };
}

function makeDeps(queue: Queue | undefined) {
  const republish = vi.fn<DeadLetterDeps['republish']>();
  return {
    getQueue: (_name: string) => queue,
    republish,
    now: () => 50000,
  };
}

/** Extract the call args from the first republish invocation. */
function getRepublishCall(deps: ReturnType<typeof makeDeps>): {
  exchange: string;
  routingKey: string;
  message: BrokerMessage;
} {
  const call = deps.republish.mock.calls[0] as [string, string, BrokerMessage];
  return { exchange: call[0], routingKey: call[1], message: call[2] };
}

/** Get the x-death array from a dead-lettered message. */
function getXDeath(msg: BrokerMessage): XDeathEntry[] {
  expect(msg.xDeath).toBeDefined();
  return msg.xDeath as XDeathEntry[];
}

/** Get message headers as a record. */
function getHeaders(msg: BrokerMessage): Record<string, unknown> {
  expect(msg.properties.headers).toBeDefined();
  return msg.properties.headers as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('deadLetterExpired', () => {
  it('discards message when queue has no DLX configured', () => {
    const queue = makeQueue(); // no deadLetterExchange
    const deps = makeDeps(queue);

    deadLetterExpired('source-queue', makeMessage(), deps);

    expect(deps.republish).not.toHaveBeenCalled();
  });

  it('discards message when queue not found', () => {
    const deps = makeDeps(undefined);

    deadLetterExpired('source-queue', makeMessage(), deps);

    expect(deps.republish).not.toHaveBeenCalled();
  });

  it('republishes to DLX when configured', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx-exchange' });
    const deps = makeDeps(queue);

    deadLetterExpired('source-queue', makeMessage(), deps);

    expect(deps.republish).toHaveBeenCalledTimes(1);
    const { exchange, routingKey } = getRepublishCall(deps);
    expect(exchange).toBe('dlx-exchange');
    expect(routingKey).toBe('test-key'); // original routing key
  });

  it('uses dead-letter routing key override when configured', () => {
    const queue = makeQueue({
      deadLetterExchange: 'dlx-exchange',
      deadLetterRoutingKey: 'dl-key',
    });
    const deps = makeDeps(queue);

    deadLetterExpired('source-queue', makeMessage(), deps);

    const { routingKey } = getRepublishCall(deps);
    expect(routingKey).toBe('dl-key');
  });

  it('supports empty string as DLX (default exchange)', () => {
    const queue = makeQueue({ deadLetterExchange: '' });
    const deps = makeDeps(queue);

    deadLetterExpired('source-queue', makeMessage(), deps);

    expect(deps.republish).toHaveBeenCalledTimes(1);
    const { exchange } = getRepublishCall(deps);
    expect(exchange).toBe('');
  });

  it('creates x-death entry with correct fields', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);

    deadLetterExpired('source-queue', makeMessage(), deps);

    const { message } = getRepublishCall(deps);
    const xDeath = getXDeath(message);
    expect(xDeath).toHaveLength(1);

    const entry = xDeath[0] as XDeathEntry;
    expect(entry.queue).toBe('source-queue');
    expect(entry.reason).toBe('expired');
    expect(entry.count).toBe(1);
    expect(entry.exchange).toBe('amq.direct');
    expect(entry['routing-keys']).toEqual(['test-key']);
    expect(entry.time).toBe(50000);
  });

  it('stores original-expiration in x-death when message had expiration', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);
    const msg = makeMessage({ properties: { expiration: '5000' } });

    deadLetterExpired('source-queue', msg, deps);

    const { message } = getRepublishCall(deps);
    const xDeath = getXDeath(message);
    expect((xDeath[0] as XDeathEntry)['original-expiration']).toBe('5000');
  });

  it('does not include original-expiration when message had no expiration', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);

    deadLetterExpired('source-queue', makeMessage(), deps);

    const { message } = getRepublishCall(deps);
    const xDeath = getXDeath(message);
    expect((xDeath[0] as XDeathEntry)['original-expiration']).toBeUndefined();
  });

  it('strips expiration property from dead-lettered message', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);
    const msg = makeMessage({
      properties: { expiration: '5000', contentType: 'text/plain' },
    });

    deadLetterExpired('source-queue', msg, deps);

    const { message } = getRepublishCall(deps);
    expect(message.properties.expiration).toBeUndefined();
    expect(message.properties.contentType).toBe('text/plain');
  });

  it('sets x-death array in message headers', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);

    deadLetterExpired('source-queue', makeMessage(), deps);

    const { message } = getRepublishCall(deps);
    const headers = getHeaders(message);
    expect(headers['x-death']).toBeDefined();
    expect(headers['x-death']).toHaveLength(1);
  });

  it('sets x-first-death-* and x-last-death-* headers', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);

    deadLetterExpired('source-queue', makeMessage(), deps);

    const { message } = getRepublishCall(deps);
    const headers = getHeaders(message);
    expect(headers['x-first-death-queue']).toBe('source-queue');
    expect(headers['x-first-death-reason']).toBe('expired');
    expect(headers['x-first-death-exchange']).toBe('amq.direct');
    expect(headers['x-last-death-queue']).toBe('source-queue');
    expect(headers['x-last-death-reason']).toBe('expired');
    expect(headers['x-last-death-exchange']).toBe('amq.direct');
  });

  it('increments count for existing x-death entry with same queue+reason', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'source-queue',
          reason: 'expired',
          count: 2,
          exchange: 'amq.direct',
          'routing-keys': ['test-key'],
          time: 40000,
        },
      ],
    });

    deadLetterExpired('source-queue', msg, deps);

    const { message } = getRepublishCall(deps);
    const xDeath = getXDeath(message);
    expect(xDeath).toHaveLength(1);
    expect((xDeath[0] as XDeathEntry).count).toBe(3);
    expect((xDeath[0] as XDeathEntry).time).toBe(50000);
  });

  it('prepends new x-death entry when queue+reason differs', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);
    const msg = makeMessage({
      xDeath: [
        {
          queue: 'other-queue',
          reason: 'rejected',
          count: 1,
          exchange: 'other-ex',
          'routing-keys': ['other-key'],
          time: 30000,
        },
      ],
    });

    deadLetterExpired('source-queue', msg, deps);

    const { message } = getRepublishCall(deps);
    const xDeath = getXDeath(message);
    expect(xDeath).toHaveLength(2);
    // New entry is first (most recent)
    expect((xDeath[0] as XDeathEntry).queue).toBe('source-queue');
    expect((xDeath[0] as XDeathEntry).reason).toBe('expired');
    // Old entry preserved
    expect((xDeath[1] as XDeathEntry).queue).toBe('other-queue');
    expect((xDeath[1] as XDeathEntry).reason).toBe('rejected');
  });

  it('preserves existing message headers alongside x-death', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);
    const msg = makeMessage({
      properties: { headers: { 'x-custom': 'value', priority: 5 } },
    });

    deadLetterExpired('source-queue', msg, deps);

    const { message } = getRepublishCall(deps);
    const headers = getHeaders(message);
    expect(headers['x-custom']).toBe('value');
    expect(headers['priority']).toBe(5);
    expect(headers['x-death']).toBeDefined();
  });

  it('resets deliveryCount and enqueuedAt for dead-lettered message', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);
    const msg = makeMessage({ deliveryCount: 3, enqueuedAt: 10000 });

    deadLetterExpired('source-queue', msg, deps);

    const { message } = getRepublishCall(deps);
    expect(message.deliveryCount).toBe(0);
    expect(message.enqueuedAt).toBe(0);
  });
});

describe('deadLetter (generic)', () => {
  it('works with rejected reason', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);

    deadLetter('source-queue', makeMessage(), 'rejected', deps);

    const { message } = getRepublishCall(deps);
    const xDeath = getXDeath(message);
    expect((xDeath[0] as XDeathEntry).reason).toBe('rejected');
  });

  it('works with maxlen reason', () => {
    const queue = makeQueue({ deadLetterExchange: 'dlx' });
    const deps = makeDeps(queue);

    deadLetter('source-queue', makeMessage(), 'maxlen', deps);

    const { message } = getRepublishCall(deps);
    const xDeath = getXDeath(message);
    expect((xDeath[0] as XDeathEntry).reason).toBe('maxlen');
  });
});
