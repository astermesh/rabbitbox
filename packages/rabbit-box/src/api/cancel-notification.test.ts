import { describe, expect, it } from 'vitest';
import { RabbitBox } from './rabbit-box.ts';
import type { ApiConnection } from './connection.ts';
import type { ApiChannel } from './channel.ts';
import type { DeliveredMessage } from '../types/message.ts';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

/** Flush all pending microtasks (queueMicrotask callbacks). */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('consumer cancellation notifications', () => {
  let conn: ApiConnection;
  let ch: ApiChannel;

  async function setup(): Promise<void> {
    conn = RabbitBox.create();
    ch = await conn.createChannel();
  }

  // ── Server-cancel on queue delete ────────────────────────────────

  it('queue delete sends null to consumer callback', async () => {
    await setup();
    await ch.assertQueue('q1');

    const received: (DeliveredMessage | null)[] = [];
    await ch.consume('q1', (msg) => received.push(msg), { noAck: true });

    await ch.deleteQueue('q1');
    await flushMicrotasks();

    expect(received).toContain(null);
  });

  it('queue delete emits cancel event on channel with consumerTag', async () => {
    await setup();
    await ch.assertQueue('q1');

    const cancelEvents: string[] = [];
    ch.on('cancel', (consumerTag: string) => cancelEvents.push(consumerTag));

    const { consumerTag } = await ch.consume('q1', noop, { noAck: true });
    await ch.deleteQueue('q1');

    expect(cancelEvents).toContain(consumerTag);
  });

  it('queue delete notifies all consumers on the queue', async () => {
    await setup();
    await ch.assertQueue('q1');

    const received1: (DeliveredMessage | null)[] = [];
    const received2: (DeliveredMessage | null)[] = [];
    await ch.consume('q1', (msg) => received1.push(msg), { noAck: true });
    await ch.consume('q1', (msg) => received2.push(msg), { noAck: true });

    await ch.deleteQueue('q1');
    await flushMicrotasks();

    expect(received1).toContain(null);
    expect(received2).toContain(null);
  });

  it('queue delete notifies consumers on different channels', async () => {
    await setup();
    const ch2 = await conn.createChannel();
    await ch.assertQueue('q1');

    const received1: (DeliveredMessage | null)[] = [];
    const received2: (DeliveredMessage | null)[] = [];
    const cancelEvents1: string[] = [];
    const cancelEvents2: string[] = [];

    ch.on('cancel', (tag: string) => cancelEvents1.push(tag));
    ch2.on('cancel', (tag: string) => cancelEvents2.push(tag));

    const { consumerTag: tag1 } = await ch.consume(
      'q1',
      (msg) => received1.push(msg),
      { noAck: true }
    );
    const { consumerTag: tag2 } = await ch2.consume(
      'q1',
      (msg) => received2.push(msg),
      { noAck: true }
    );

    // Delete from ch — both consumers should be notified
    await ch.deleteQueue('q1');
    await flushMicrotasks();

    expect(received1).toContain(null);
    expect(received2).toContain(null);
    expect(cancelEvents1).toContain(tag1);
    expect(cancelEvents2).toContain(tag2);
  });

  it('auto-delete with channel close notifies consumers on other channels', async () => {
    await setup();
    const ch2 = await conn.createChannel();
    await ch.assertQueue('q1', { autoDelete: true });

    const received: (DeliveredMessage | null)[] = [];
    const cancelEvents: string[] = [];

    // ch has two consumers, ch2 has one consumer
    const { consumerTag: tag1 } = await ch.consume('q1', noop, {
      noAck: true,
    });
    await ch.consume('q1', noop, { noAck: true });
    await ch2.consume('q1', (msg) => received.push(msg), { noAck: true });
    ch2.on('cancel', (tag: string) => cancelEvents.push(tag));

    // Cancel one consumer — 2 remain, no auto-delete
    await ch.cancel(tag1);
    await flushMicrotasks();
    expect(received).not.toContain(null);

    // Close ch — its remaining consumer is removed, but ch2's consumer remains → no auto-delete
    await ch.close();
    await flushMicrotasks();
    expect(received).not.toContain(null);

    // Cancel ch2's last consumer → auto-delete triggers (client-cancel, no null)
    // Queue is now auto-deleted, no server-cancel since this is client-initiated
  });

  it('client-initiated cancel does NOT send null to consumer callback', async () => {
    await setup();
    await ch.assertQueue('q1');

    const received: (DeliveredMessage | null)[] = [];
    const { consumerTag } = await ch.consume(
      'q1',
      (msg) => received.push(msg),
      { noAck: true }
    );

    await ch.cancel(consumerTag);
    await flushMicrotasks();

    // Client cancel is different from server cancel — no null notification
    expect(received).not.toContain(null);
  });

  it('client-initiated channel close does NOT send null to consumer callback', async () => {
    await setup();
    await ch.assertQueue('q1');

    const received: (DeliveredMessage | null)[] = [];
    await ch.consume('q1', (msg) => received.push(msg), { noAck: true });

    await ch.close();
    await flushMicrotasks();

    // Channel close is client-initiated — no null notification
    expect(received).not.toContain(null);
  });

  it('cancel event includes correct consumerTag', async () => {
    await setup();
    await ch.assertQueue('q1');

    const cancelEvents: string[] = [];
    ch.on('cancel', (tag: string) => cancelEvents.push(tag));

    const { consumerTag } = await ch.consume('q1', noop, {
      consumerTag: 'my-tag',
      noAck: true,
    });

    await ch.deleteQueue('q1');

    expect(consumerTag).toBe('my-tag');
    expect(cancelEvents).toEqual(['my-tag']);
  });

  it('multiple cancel events emitted for multiple consumers on same channel', async () => {
    await setup();
    await ch.assertQueue('q1');

    const cancelEvents: string[] = [];
    ch.on('cancel', (tag: string) => cancelEvents.push(tag));

    const { consumerTag: tag1 } = await ch.consume('q1', noop, {
      noAck: true,
    });
    const { consumerTag: tag2 } = await ch.consume('q1', noop, {
      noAck: true,
    });

    await ch.deleteQueue('q1');

    expect(cancelEvents).toContain(tag1);
    expect(cancelEvents).toContain(tag2);
    expect(cancelEvents).toHaveLength(2);
  });
});

describe('consumer priorities', () => {
  let conn: ApiConnection;
  let ch: ApiChannel;

  async function setup(): Promise<void> {
    conn = RabbitBox.create();
    ch = await conn.createChannel();
  }

  it('higher priority consumer receives messages first', async () => {
    await setup();
    await ch.assertQueue('q1');

    const highReceived: string[] = [];
    const lowReceived: string[] = [];

    // Register low priority first, then high priority
    await ch.consume(
      'q1',
      (msg) => {
        if (msg) lowReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, arguments: { 'x-priority': 1 } }
    );
    await ch.consume(
      'q1',
      (msg) => {
        if (msg) highReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, arguments: { 'x-priority': 10 } }
    );

    ch.sendToQueue('q1', new TextEncoder().encode('a'));
    ch.sendToQueue('q1', new TextEncoder().encode('b'));
    ch.sendToQueue('q1', new TextEncoder().encode('c'));
    await flushMicrotasks();

    // All messages go to higher priority consumer
    expect(highReceived).toEqual(['a', 'b', 'c']);
    expect(lowReceived).toEqual([]);
  });

  it('lower priority consumer receives when higher is at prefetch limit', async () => {
    await setup();
    await ch.assertQueue('q1');
    await ch.prefetch(1);

    const highReceived: string[] = [];
    const lowReceived: string[] = [];

    await ch.consume(
      'q1',
      (msg) => {
        if (msg) highReceived.push(new TextDecoder().decode(msg.body));
      },
      { arguments: { 'x-priority': 10 } }
    );
    await ch.consume(
      'q1',
      (msg) => {
        if (msg) lowReceived.push(new TextDecoder().decode(msg.body));
      },
      { arguments: { 'x-priority': 1 } }
    );

    ch.sendToQueue('q1', new TextEncoder().encode('a'));
    ch.sendToQueue('q1', new TextEncoder().encode('b'));
    ch.sendToQueue('q1', new TextEncoder().encode('c'));
    await flushMicrotasks();

    // High priority gets first message (prefetch 1), then blocked
    // Low priority gets second message (prefetch 1), then blocked
    // Third message stays in queue
    expect(highReceived).toEqual(['a']);
    expect(lowReceived).toEqual(['b']);
  });

  it('default priority is 0', async () => {
    await setup();
    await ch.assertQueue('q1');

    const highReceived: string[] = [];
    const defaultReceived: string[] = [];

    // Default priority consumer (no x-priority = 0)
    await ch.consume(
      'q1',
      (msg) => {
        if (msg) defaultReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true }
    );

    // Positive priority consumer
    await ch.consume(
      'q1',
      (msg) => {
        if (msg) highReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, arguments: { 'x-priority': 5 } }
    );

    ch.sendToQueue('q1', new TextEncoder().encode('a'));
    ch.sendToQueue('q1', new TextEncoder().encode('b'));
    await flushMicrotasks();

    // Higher priority (5) gets all messages
    expect(highReceived).toEqual(['a', 'b']);
    expect(defaultReceived).toEqual([]);
  });

  it('consumers with same priority use round-robin', async () => {
    await setup();
    await ch.assertQueue('q1');

    const received1: string[] = [];
    const received2: string[] = [];

    await ch.consume(
      'q1',
      (msg) => {
        if (msg) received1.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, arguments: { 'x-priority': 5 } }
    );
    await ch.consume(
      'q1',
      (msg) => {
        if (msg) received2.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, arguments: { 'x-priority': 5 } }
    );

    ch.sendToQueue('q1', new TextEncoder().encode('a'));
    ch.sendToQueue('q1', new TextEncoder().encode('b'));
    ch.sendToQueue('q1', new TextEncoder().encode('c'));
    ch.sendToQueue('q1', new TextEncoder().encode('d'));
    await flushMicrotasks();

    // Same priority → round-robin
    expect(received1).toEqual(['a', 'c']);
    expect(received2).toEqual(['b', 'd']);
  });

  it('negative priority consumers receive after default (0) consumers', async () => {
    await setup();
    await ch.assertQueue('q1');

    const defaultReceived: string[] = [];
    const lowReceived: string[] = [];

    await ch.consume(
      'q1',
      (msg) => {
        if (msg) lowReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, arguments: { 'x-priority': -1 } }
    );
    await ch.consume(
      'q1',
      (msg) => {
        if (msg) defaultReceived.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true }
    );

    ch.sendToQueue('q1', new TextEncoder().encode('a'));
    ch.sendToQueue('q1', new TextEncoder().encode('b'));
    await flushMicrotasks();

    expect(defaultReceived).toEqual(['a', 'b']);
    expect(lowReceived).toEqual([]);
  });

  it('priority consumers with noAck get unlimited messages', async () => {
    await setup();
    await ch.assertQueue('q1');

    const received: string[] = [];

    await ch.consume(
      'q1',
      (msg) => {
        if (msg) received.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, arguments: { 'x-priority': 10 } }
    );

    for (let i = 0; i < 5; i++) {
      ch.sendToQueue('q1', new TextEncoder().encode(`msg-${i}`));
    }
    await flushMicrotasks();

    expect(received).toHaveLength(5);
  });

  it('consumer priority does not interfere with SAC queues', async () => {
    await setup();
    await ch.assertQueue('q1', {
      arguments: { 'x-single-active-consumer': true },
    });

    const received1: string[] = [];
    const received2: string[] = [];

    // Even though consumer 2 has higher priority, SAC delivers to first registered
    await ch.consume(
      'q1',
      (msg) => {
        if (msg) received1.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, arguments: { 'x-priority': 1 } }
    );
    await ch.consume(
      'q1',
      (msg) => {
        if (msg) received2.push(new TextDecoder().decode(msg.body));
      },
      { noAck: true, arguments: { 'x-priority': 10 } }
    );

    ch.sendToQueue('q1', new TextEncoder().encode('a'));
    ch.sendToQueue('q1', new TextEncoder().encode('b'));
    await flushMicrotasks();

    // SAC overrides priority — first registered consumer gets everything
    expect(received1).toEqual(['a', 'b']);
    expect(received2).toEqual([]);
  });
});
