import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Dispatcher } from './dispatcher.ts';
import { ConsumerRegistry } from './consumer-registry.ts';
import { Channel } from './channel.ts';
import type { ChannelDeps } from './channel.ts';
import { MessageStore } from './message-store.ts';
import type { BrokerMessage } from './types/message.ts';

function makeMessage(body = 'test'): BrokerMessage {
  return {
    body: new TextEncoder().encode(body),
    properties: {},
    exchange: '',
    routingKey: 'test',
    mandatory: false,
    immediate: false,
    deliveryCount: 0,
    enqueuedAt: Date.now(),
    priority: 0,
  };
}

function makeDeps(): ChannelDeps {
  return {
    onRequeue: vi.fn(),
    onClose: vi.fn(),
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Dispatcher — consumer priorities', () => {
  let registry: ConsumerRegistry;
  let dispatcher: Dispatcher;

  beforeEach(() => {
    registry = new ConsumerRegistry();
    dispatcher = new Dispatcher(registry);
  });

  it('delivers to highest priority consumer first', async () => {
    const ch1 = new Channel(1, makeDeps());
    const ch2 = new Channel(2, makeDeps());
    const highReceived: string[] = [];
    const lowReceived: string[] = [];
    const store = new MessageStore();

    registry.register(
      'q1',
      1,
      (msg) => {
        if (msg) lowReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: 1 }
    );
    registry.register(
      'q1',
      2,
      (msg) => {
        if (msg) highReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: 10 }
    );

    store.enqueue(makeMessage('a'));
    store.enqueue(makeMessage('b'));
    store.enqueue(makeMessage('c'));

    dispatcher.dispatch('q1', store, (ch) => {
      if (ch === 1) return ch1;
      if (ch === 2) return ch2;
      return undefined;
    });
    await flushMicrotasks();

    expect(highReceived).toEqual(['a', 'b', 'c']);
    expect(lowReceived).toEqual([]);
  });

  it('falls through to lower priority when higher is at prefetch limit', async () => {
    const ch1 = new Channel(1, makeDeps());
    const ch2 = new Channel(2, makeDeps());
    ch1.setPrefetch(1, false);
    ch2.setPrefetch(1, false);
    const highReceived: string[] = [];
    const lowReceived: string[] = [];
    const store = new MessageStore();

    // High priority on channel 1
    registry.register(
      'q1',
      1,
      (msg) => {
        if (msg) highReceived.push(new TextDecoder().decode(msg.body));
      },
      { priority: 10 }
    );
    // Low priority on channel 2
    registry.register(
      'q1',
      2,
      (msg) => {
        if (msg) lowReceived.push(new TextDecoder().decode(msg.body));
      },
      { priority: 1 }
    );

    store.enqueue(makeMessage('a'));
    store.enqueue(makeMessage('b'));
    store.enqueue(makeMessage('c'));

    dispatcher.dispatch('q1', store, (ch) => {
      if (ch === 1) return ch1;
      if (ch === 2) return ch2;
      return undefined;
    });
    await flushMicrotasks();

    // a → high (now at prefetch), b → low (now at prefetch), c stays
    expect(highReceived).toEqual(['a']);
    expect(lowReceived).toEqual(['b']);
    expect(store.count()).toBe(1);
  });

  it('round-robin within same priority level', async () => {
    const ch1 = new Channel(1, makeDeps());
    const ch2 = new Channel(2, makeDeps());
    const received1: string[] = [];
    const received2: string[] = [];
    const store = new MessageStore();

    registry.register(
      'q1',
      1,
      (msg) => {
        if (msg) received1.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: 5 }
    );
    registry.register(
      'q1',
      2,
      (msg) => {
        if (msg) received2.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: 5 }
    );

    store.enqueue(makeMessage('a'));
    store.enqueue(makeMessage('b'));
    store.enqueue(makeMessage('c'));
    store.enqueue(makeMessage('d'));

    dispatcher.dispatch('q1', store, (ch) => {
      if (ch === 1) return ch1;
      if (ch === 2) return ch2;
      return undefined;
    });
    await flushMicrotasks();

    expect(received1).toEqual(['a', 'c']);
    expect(received2).toEqual(['b', 'd']);
  });

  it('default priority (0) consumers are lower than positive priority', async () => {
    const ch1 = new Channel(1, makeDeps());
    const ch2 = new Channel(2, makeDeps());
    const defaultReceived: string[] = [];
    const highReceived: string[] = [];
    const store = new MessageStore();

    // Default priority (no priority option = 0)
    registry.register(
      'q1',
      1,
      (msg) => {
        if (msg) defaultReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true }
    );
    // Higher priority
    registry.register(
      'q1',
      2,
      (msg) => {
        if (msg) highReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: 5 }
    );

    store.enqueue(makeMessage('a'));
    store.enqueue(makeMessage('b'));

    dispatcher.dispatch('q1', store, (ch) => {
      if (ch === 1) return ch1;
      if (ch === 2) return ch2;
      return undefined;
    });
    await flushMicrotasks();

    expect(highReceived).toEqual(['a', 'b']);
    expect(defaultReceived).toEqual([]);
  });

  it('negative priority consumers receive after default (0)', async () => {
    const ch1 = new Channel(1, makeDeps());
    const ch2 = new Channel(2, makeDeps());
    const negReceived: string[] = [];
    const defaultReceived: string[] = [];
    const store = new MessageStore();

    registry.register(
      'q1',
      1,
      (msg) => {
        if (msg) negReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: -1 }
    );
    registry.register(
      'q1',
      2,
      (msg) => {
        if (msg) defaultReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true }
    );

    store.enqueue(makeMessage('a'));
    store.enqueue(makeMessage('b'));

    dispatcher.dispatch('q1', store, (ch) => {
      if (ch === 1) return ch1;
      if (ch === 2) return ch2;
      return undefined;
    });
    await flushMicrotasks();

    expect(defaultReceived).toEqual(['a', 'b']);
    expect(negReceived).toEqual([]);
  });

  it('three priority levels dispatch correctly', async () => {
    const ch1 = new Channel(1, makeDeps());
    const ch2 = new Channel(2, makeDeps());
    const ch3 = new Channel(3, makeDeps());
    ch1.setPrefetch(1, false);
    ch2.setPrefetch(1, false);
    ch3.setPrefetch(1, false);
    const highReceived: string[] = [];
    const midReceived: string[] = [];
    const lowReceived: string[] = [];
    const store = new MessageStore();

    registry.register(
      'q1',
      3,
      (msg) => {
        if (msg) lowReceived.push(new TextDecoder().decode(msg.body));
      },
      { priority: 1 }
    );
    registry.register(
      'q1',
      1,
      (msg) => {
        if (msg) highReceived.push(new TextDecoder().decode(msg.body));
      },
      { priority: 10 }
    );
    registry.register(
      'q1',
      2,
      (msg) => {
        if (msg) midReceived.push(new TextDecoder().decode(msg.body));
      },
      { priority: 5 }
    );

    store.enqueue(makeMessage('a'));
    store.enqueue(makeMessage('b'));
    store.enqueue(makeMessage('c'));
    store.enqueue(makeMessage('d'));

    dispatcher.dispatch('q1', store, (ch) => {
      if (ch === 1) return ch1;
      if (ch === 2) return ch2;
      if (ch === 3) return ch3;
      return undefined;
    });
    await flushMicrotasks();

    // a → high (prefetch 1, now full), b → mid (prefetch 1, now full),
    // c → low (prefetch 1, now full), d stays
    expect(highReceived).toEqual(['a']);
    expect(midReceived).toEqual(['b']);
    expect(lowReceived).toEqual(['c']);
    expect(store.count()).toBe(1);
  });

  it('priority dispatch does not interfere with SAC', async () => {
    const ch1 = new Channel(1, makeDeps());
    const ch2 = new Channel(2, makeDeps());
    const received1: string[] = [];
    const received2: string[] = [];
    const store = new MessageStore();

    registry.markSingleActiveConsumer('q1');
    // First registered = active consumer (lower priority)
    registry.register(
      'q1',
      1,
      (msg) => {
        if (msg) received1.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: 1 }
    );
    // Second registered = inactive (higher priority)
    registry.register(
      'q1',
      2,
      (msg) => {
        if (msg) received2.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: 10 }
    );

    store.enqueue(makeMessage('a'));
    store.enqueue(makeMessage('b'));

    dispatcher.dispatch('q1', store, (ch) => {
      if (ch === 1) return ch1;
      if (ch === 2) return ch2;
      return undefined;
    });
    await flushMicrotasks();

    // SAC overrides priority
    expect(received1).toEqual(['a', 'b']);
    expect(received2).toEqual([]);
  });

  it('round-robin persists across dispatch calls within same priority', async () => {
    const ch1 = new Channel(1, makeDeps());
    const ch2 = new Channel(2, makeDeps());
    const received1: string[] = [];
    const received2: string[] = [];
    const store = new MessageStore();

    registry.register(
      'q1',
      1,
      (msg) => {
        if (msg) received1.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: 5 }
    );
    registry.register(
      'q1',
      2,
      (msg) => {
        if (msg) received2.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: 5 }
    );

    const getChannel = (ch: number) => {
      if (ch === 1) return ch1;
      if (ch === 2) return ch2;
      return undefined;
    };

    store.enqueue(makeMessage('a'));
    dispatcher.dispatch('q1', store, getChannel);
    await flushMicrotasks();

    store.enqueue(makeMessage('b'));
    dispatcher.dispatch('q1', store, getChannel);
    await flushMicrotasks();

    store.enqueue(makeMessage('c'));
    dispatcher.dispatch('q1', store, getChannel);
    await flushMicrotasks();

    expect(received1).toEqual(['a', 'c']);
    expect(received2).toEqual(['b']);
  });

  it('skips unavailable channel in priority dispatch', async () => {
    const ch2 = new Channel(2, makeDeps());
    const highReceived: string[] = [];
    const lowReceived: string[] = [];
    const store = new MessageStore();

    // High priority on unavailable channel
    registry.register(
      'q1',
      1,
      (msg) => {
        if (msg) highReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: 10 }
    );
    // Low priority on available channel
    registry.register(
      'q1',
      2,
      (msg) => {
        if (msg) lowReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, priority: 1 }
    );

    store.enqueue(makeMessage('a'));

    // Channel 1 unavailable
    dispatcher.dispatch('q1', store, (ch) => (ch === 2 ? ch2 : undefined));
    await flushMicrotasks();

    expect(highReceived).toEqual([]);
    expect(lowReceived).toEqual(['a']);
  });
});
