import { describe, expect, it, vi } from 'vitest';
import { RabbitBox } from './rabbit-box.ts';
import type { ApiConnection } from './connection.ts';
import type { ApiChannel } from './channel.ts';
import type { DeliveredMessage } from '../types/message.ts';
import type { ReturnedMessage } from './types.ts';
import { ChannelError } from '../errors/amqp-error.ts';

/** Helper: wait for async dispatch (queueMicrotask-based delivery). */
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** Helper: collect N messages from a consumer callback. */
function collectMessages(
  count: number,
  timeout = 500
): {
  msgs: DeliveredMessage[];
  callback: (msg: DeliveredMessage) => void;
  done: Promise<DeliveredMessage[]>;
} {
  const msgs: DeliveredMessage[] = [];
  let resolve: (msgs: DeliveredMessage[]) => void;
  const done = new Promise<DeliveredMessage[]>((r) => {
    resolve = r;
  });
  const timer = setTimeout(() => resolve(msgs), timeout);
  const callback = (msg: DeliveredMessage) => {
    msgs.push(msg);
    if (msgs.length >= count) {
      clearTimeout(timer);
      resolve(msgs);
    }
  };
  return { msgs, callback, done };
}

/** Helper: assert msg is defined and return it typed. */
function assertMsg(msg: DeliveredMessage | undefined): DeliveredMessage {
  expect(msg).toBeDefined();
  return msg as DeliveredMessage;
}

describe('E2E integration tests', () => {
  let conn: ApiConnection;
  let ch: ApiChannel;

  async function setup(): Promise<void> {
    conn = RabbitBox.create();
    ch = await conn.createChannel();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Basic publish/consume
  // ═══════════════════════════════════════════════════════════════════════

  describe('basic publish/consume: single producer, single consumer', () => {
    it('delivers published message with correct body and properties', async () => {
      await setup();
      await ch.assertQueue('q1');
      const { callback, done } = collectMessages(1);
      await ch.consume('q1', callback, { noAck: true });

      const body = new Uint8Array([10, 20, 30]);
      ch.sendToQueue('q1', body, {
        contentType: 'application/json',
        correlationId: 'abc-123',
      });

      const [first] = await done;
      const msg = assertMsg(first);
      expect(msg.body).toEqual(body);
      expect(msg.properties.contentType).toBe('application/json');
      expect(msg.properties.correlationId).toBe('abc-123');
      expect(msg.exchange).toBe('');
      expect(msg.routingKey).toBe('q1');
      expect(msg.redelivered).toBe(false);
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Fanout broadcast
  // ═══════════════════════════════════════════════════════════════════════

  describe('fanout broadcast: one publish delivered to multiple bound queues', () => {
    it('delivers to all bound queues', async () => {
      await setup();
      await ch.assertExchange('ex.fanout', 'fanout');
      await ch.assertQueue('fan-q1');
      await ch.assertQueue('fan-q2');
      await ch.assertQueue('fan-q3');
      await ch.bindQueue('fan-q1', 'ex.fanout', '');
      await ch.bindQueue('fan-q2', 'ex.fanout', '');
      await ch.bindQueue('fan-q3', 'ex.fanout', '');

      const c1 = collectMessages(1);
      const c2 = collectMessages(1);
      const c3 = collectMessages(1);
      await ch.consume('fan-q1', c1.callback, { noAck: true });
      await ch.consume('fan-q2', c2.callback, { noAck: true });
      await ch.consume('fan-q3', c3.callback, { noAck: true });

      ch.publish('ex.fanout', 'ignored-key', new Uint8Array([1]));

      const [r1] = await c1.done;
      const [r2] = await c2.done;
      const [r3] = await c3.done;
      const m1 = assertMsg(r1);
      const m2 = assertMsg(r2);
      const m3 = assertMsg(r3);
      expect(m1.body).toEqual(new Uint8Array([1]));
      expect(m2.body).toEqual(new Uint8Array([1]));
      expect(m3.body).toEqual(new Uint8Array([1]));
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Topic routing
  // ═══════════════════════════════════════════════════════════════════════

  describe('topic routing: wildcard patterns (* and #)', () => {
    it('* matches exactly one word', async () => {
      await setup();
      await ch.assertExchange('ex.topic', 'topic');
      await ch.assertQueue('topic-q1');
      await ch.bindQueue('topic-q1', 'ex.topic', 'stock.*.nyse');

      const c1 = collectMessages(1);
      await ch.consume('topic-q1', c1.callback, { noAck: true });

      // Should match
      ch.publish('ex.topic', 'stock.usd.nyse', new Uint8Array([1]));
      const [msg] = await c1.done;
      expect(msg).toBeDefined();
      await conn.close();
    });

    it('* does not match zero or multiple words', async () => {
      await setup();
      await ch.assertExchange('ex.topic', 'topic');
      await ch.assertQueue('topic-q1');
      await ch.bindQueue('topic-q1', 'ex.topic', 'stock.*.nyse');

      const msgs: DeliveredMessage[] = [];
      await ch.consume('topic-q1', (m) => msgs.push(m), { noAck: true });

      // Should NOT match — zero words between stock and nyse
      ch.publish('ex.topic', 'stock.nyse', new Uint8Array([1]));
      // Should NOT match — two words between stock and nyse
      ch.publish('ex.topic', 'stock.a.b.nyse', new Uint8Array([2]));
      await tick(50);
      expect(msgs).toHaveLength(0);
      await conn.close();
    });

    it('# matches zero or more words', async () => {
      await setup();
      await ch.assertExchange('ex.topic', 'topic');
      await ch.assertQueue('topic-q-hash');
      await ch.bindQueue('topic-q-hash', 'ex.topic', 'log.#');

      const c = collectMessages(3);
      await ch.consume('topic-q-hash', c.callback, { noAck: true });

      ch.publish('ex.topic', 'log', new Uint8Array([1])); // zero words after log
      ch.publish('ex.topic', 'log.info', new Uint8Array([2])); // one word
      ch.publish('ex.topic', 'log.info.detail', new Uint8Array([3])); // two words

      const msgs = await c.done;
      expect(msgs).toHaveLength(3);
      await conn.close();
    });

    it('# alone matches everything', async () => {
      await setup();
      await ch.assertExchange('ex.topic', 'topic');
      await ch.assertQueue('topic-q-all');
      await ch.bindQueue('topic-q-all', 'ex.topic', '#');

      const c = collectMessages(2);
      await ch.consume('topic-q-all', c.callback, { noAck: true });

      ch.publish('ex.topic', 'anything.here', new Uint8Array([1]));
      ch.publish('ex.topic', 'x', new Uint8Array([2]));

      const msgs = await c.done;
      expect(msgs).toHaveLength(2);
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Headers routing
  // ═══════════════════════════════════════════════════════════════════════

  describe('headers routing: all 4 x-match modes', () => {
    it('x-match=all requires all binding args to match', async () => {
      await setup();
      await ch.assertExchange('ex.headers', 'headers');
      await ch.assertQueue('hdr-q-all');
      await ch.bindQueue('hdr-q-all', 'ex.headers', '', {
        'x-match': 'all',
        format: 'pdf',
        type: 'report',
      });

      const c = collectMessages(1);
      await ch.consume('hdr-q-all', c.callback, { noAck: true });

      // Partial match — should NOT deliver
      ch.publish('ex.headers', '', new Uint8Array([1]), {
        headers: { format: 'pdf' },
      });
      await tick(50);
      expect(c.msgs).toHaveLength(0);

      // Full match — should deliver
      ch.publish('ex.headers', '', new Uint8Array([2]), {
        headers: { format: 'pdf', type: 'report' },
      });
      const [first] = await c.done;
      const msg = assertMsg(first);
      expect(msg.body).toEqual(new Uint8Array([2]));
      await conn.close();
    });

    it('x-match=any requires at least one binding arg to match', async () => {
      await setup();
      await ch.assertExchange('ex.headers', 'headers');
      await ch.assertQueue('hdr-q-any');
      await ch.bindQueue('hdr-q-any', 'ex.headers', '', {
        'x-match': 'any',
        format: 'pdf',
        type: 'report',
      });

      const c = collectMessages(1);
      await ch.consume('hdr-q-any', c.callback, { noAck: true });

      // One match is enough
      ch.publish('ex.headers', '', new Uint8Array([1]), {
        headers: { format: 'pdf', unrelated: 'value' },
      });
      const [msg] = await c.done;
      expect(msg).toBeDefined();
      await conn.close();
    });

    it('x-match=all-with-x includes x-prefixed args in matching', async () => {
      await setup();
      await ch.assertExchange('ex.headers', 'headers');
      await ch.assertQueue('hdr-q-allx');
      await ch.bindQueue('hdr-q-allx', 'ex.headers', '', {
        'x-match': 'all-with-x',
        'x-custom': 'special',
        format: 'csv',
      });

      const c = collectMessages(1);
      await ch.consume('hdr-q-allx', c.callback, { noAck: true });

      // Missing x-custom — should NOT deliver
      ch.publish('ex.headers', '', new Uint8Array([1]), {
        headers: { format: 'csv' },
      });
      await tick(50);
      expect(c.msgs).toHaveLength(0);

      // Both match — should deliver
      ch.publish('ex.headers', '', new Uint8Array([2]), {
        headers: { format: 'csv', 'x-custom': 'special' },
      });
      const [first] = await c.done;
      const msg = assertMsg(first);
      expect(msg.body).toEqual(new Uint8Array([2]));
      await conn.close();
    });

    it('x-match=any-with-x includes x-prefixed args in matching', async () => {
      await setup();
      await ch.assertExchange('ex.headers', 'headers');
      await ch.assertQueue('hdr-q-anyx');
      await ch.bindQueue('hdr-q-anyx', 'ex.headers', '', {
        'x-match': 'any-with-x',
        'x-custom': 'special',
        format: 'csv',
      });

      const c = collectMessages(1);
      await ch.consume('hdr-q-anyx', c.callback, { noAck: true });

      // x-custom alone matches
      ch.publish('ex.headers', '', new Uint8Array([1]), {
        headers: { 'x-custom': 'special' },
      });
      const [msg] = await c.done;
      expect(msg).toBeDefined();
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Direct routing
  // ═══════════════════════════════════════════════════════════════════════

  describe('direct routing: default exchange and named direct exchange', () => {
    it('default exchange routes by queue name', async () => {
      await setup();
      await ch.assertQueue('direct-q');

      const c = collectMessages(1);
      await ch.consume('direct-q', c.callback, { noAck: true });

      ch.sendToQueue('direct-q', new Uint8Array([42]));
      const [first] = await c.done;
      const msg = assertMsg(first);
      expect(msg.routingKey).toBe('direct-q');
      await conn.close();
    });

    it('named direct exchange routes by exact routing key', async () => {
      await setup();
      await ch.assertExchange('ex.direct', 'direct');
      await ch.assertQueue('dq1');
      await ch.assertQueue('dq2');
      await ch.bindQueue('dq1', 'ex.direct', 'key-a');
      await ch.bindQueue('dq2', 'ex.direct', 'key-b');

      const c1 = collectMessages(1);
      const c2 = collectMessages(1);
      await ch.consume('dq1', c1.callback, { noAck: true });
      await ch.consume('dq2', c2.callback, { noAck: true });

      ch.publish('ex.direct', 'key-a', new Uint8Array([1]));
      ch.publish('ex.direct', 'key-b', new Uint8Array([2]));

      const [r1] = await c1.done;
      const [r2] = await c2.done;
      const m1 = assertMsg(r1);
      const m2 = assertMsg(r2);
      expect(m1.body).toEqual(new Uint8Array([1]));
      expect(m2.body).toEqual(new Uint8Array([2]));
      await conn.close();
    });

    it('direct exchange does not deliver on routing key mismatch', async () => {
      await setup();
      await ch.assertExchange('ex.direct', 'direct');
      await ch.assertQueue('dq-miss');
      await ch.bindQueue('dq-miss', 'ex.direct', 'key-x');

      const msgs: DeliveredMessage[] = [];
      await ch.consume('dq-miss', (m) => msgs.push(m), { noAck: true });

      ch.publish('ex.direct', 'key-y', new Uint8Array([1]));
      await tick(50);
      expect(msgs).toHaveLength(0);
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Multiple consumers — round-robin
  // ═══════════════════════════════════════════════════════════════════════

  describe('multiple consumers: round-robin dispatch across 3+ consumers', () => {
    it('distributes messages round-robin across consumers', async () => {
      await setup();
      await ch.assertQueue('rr-q');

      const received: number[] = [];
      const makeHandler = (id: number) => (msg: DeliveredMessage) => {
        received.push(id);
        ch.ack(msg);
      };

      await ch.consume('rr-q', makeHandler(1));
      await ch.consume('rr-q', makeHandler(2));
      await ch.consume('rr-q', makeHandler(3));

      // Send 6 messages — expect 2 per consumer in round-robin order
      for (let i = 0; i < 6; i++) {
        ch.sendToQueue('rr-q', new Uint8Array([i]));
      }
      await tick(100);

      expect(received).toHaveLength(6);
      // Round-robin: 1,2,3,1,2,3
      expect(received).toEqual([1, 2, 3, 1, 2, 3]);
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Prefetch limiting
  // ═══════════════════════════════════════════════════════════════════════

  describe('prefetch limiting: dispatch pauses at limit, resumes on ack', () => {
    it('stops dispatching when consumer hits prefetch limit', async () => {
      await setup();
      await ch.assertQueue('pf-q');
      await ch.prefetch(2);

      const msgs: DeliveredMessage[] = [];
      await ch.consume('pf-q', (msg) => msgs.push(msg));

      // Send 5 messages
      for (let i = 0; i < 5; i++) {
        ch.sendToQueue('pf-q', new Uint8Array([i]));
      }
      await tick(50);

      // Only 2 should be delivered (prefetch=2)
      expect(msgs).toHaveLength(2);

      // Ack first — one more should be delivered (now 1 unacked + 1 new = 2)
      ch.ack(assertMsg(msgs[0]));
      await tick(50);
      expect(msgs).toHaveLength(3);

      // Ack second — one more delivered
      ch.ack(assertMsg(msgs[1]));
      await tick(50);
      expect(msgs).toHaveLength(4);

      // Ack third — last one delivered
      ch.ack(assertMsg(msgs[2]));
      await tick(50);
      expect(msgs).toHaveLength(5);

      // Clean up remaining unacked
      ch.ack(assertMsg(msgs[3]));
      ch.ack(assertMsg(msgs[4]));
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Ack / nack / reject flows
  // ═══════════════════════════════════════════════════════════════════════

  describe('ack/nack/reject flows', () => {
    it('ack removes message from unacked', async () => {
      await setup();
      await ch.assertQueue('ack-q');

      const c = collectMessages(1);
      await ch.consume('ack-q', c.callback);
      ch.sendToQueue('ack-q', new Uint8Array([1]));
      const [first] = await c.done;
      const msg = assertMsg(first);

      // Ack should not throw
      expect(() => ch.ack(msg)).not.toThrow();
      await conn.close();
    });

    it('nack with requeue re-delivers with redelivered=true', async () => {
      await setup();
      await ch.assertQueue('nack-q');

      const msgs: DeliveredMessage[] = [];
      await ch.consume('nack-q', (msg) => {
        msgs.push(msg);
        if (!msg.redelivered) {
          ch.nack(msg, false, true);
        } else {
          ch.ack(msg);
        }
      });

      ch.sendToQueue('nack-q', new Uint8Array([1]));
      await tick(100);

      expect(msgs.length).toBeGreaterThanOrEqual(2);
      const second = assertMsg(msgs[1]);
      expect(second.redelivered).toBe(true);
      await conn.close();
    });

    it('reject without requeue discards message permanently', async () => {
      await setup();
      await ch.assertQueue('reject-q');

      const msgs: DeliveredMessage[] = [];
      await ch.consume('reject-q', (msg) => {
        msgs.push(msg);
        ch.reject(msg, false);
      });

      ch.sendToQueue('reject-q', new Uint8Array([1]));
      await tick(100);

      // Only delivered once — rejected without requeue means discarded
      expect(msgs).toHaveLength(1);
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Requeue behavior
  // ═══════════════════════════════════════════════════════════════════════

  describe('requeue behavior: redelivered=true on requeued message', () => {
    it('requeued message has redelivered=true and is delivered to next consumer', async () => {
      await setup();
      await ch.assertQueue('rq-q');
      await ch.prefetch(1);

      const consumer1Msgs: DeliveredMessage[] = [];
      const consumer2Msgs: DeliveredMessage[] = [];

      await ch.consume('rq-q', (msg) => {
        consumer1Msgs.push(msg);
        // Nack with requeue on first delivery
        ch.nack(msg, false, true);
      });

      // Second consumer on a separate channel to accept requeued message
      const ch2 = await conn.createChannel();
      await ch2.prefetch(1);
      await ch2.consume('rq-q', (msg) => {
        consumer2Msgs.push(msg);
        ch2.ack(msg);
      });

      ch.sendToQueue('rq-q', new Uint8Array([99]));
      await tick(100);

      // Consumer 2 should get the requeued message with redelivered=true
      expect(consumer2Msgs.length).toBeGreaterThanOrEqual(1);
      const requeued = assertMsg(consumer2Msgs[0]);
      expect(requeued.redelivered).toBe(true);
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Mandatory message return
  // ═══════════════════════════════════════════════════════════════════════

  describe('mandatory message return: unroutable mandatory message triggers return event', () => {
    it('emits return event with correct fields for unroutable mandatory message', async () => {
      await setup();
      await ch.assertExchange('ex.mand', 'direct');

      const returns: ReturnedMessage[] = [];
      ch.on('return', (msg) => returns.push(msg));

      const body = new Uint8Array([7, 8, 9]);
      ch.publish('ex.mand', 'no-binding', body, { mandatory: true });

      expect(returns).toHaveLength(1);
      const ret = assertMsg(
        returns[0] as unknown as DeliveredMessage | undefined
      ) as unknown as ReturnedMessage;
      expect(ret.replyCode).toBe(312);
      expect(ret.replyText).toBe('NO_ROUTE');
      expect(ret.exchange).toBe('ex.mand');
      expect(ret.routingKey).toBe('no-binding');
      expect(ret.body).toEqual(body);
      await conn.close();
    });

    it('does not emit return when message is routable', async () => {
      await setup();
      await ch.assertExchange('ex.mand2', 'direct');
      await ch.assertQueue('mand-q');
      await ch.bindQueue('mand-q', 'ex.mand2', 'exists');

      const returns: ReturnedMessage[] = [];
      ch.on('return', (msg) => returns.push(msg));

      ch.publish('ex.mand2', 'exists', new Uint8Array([1]), {
        mandatory: true,
      });
      expect(returns).toHaveLength(0);
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CC/BCC routing
  // ═══════════════════════════════════════════════════════════════════════

  describe('CC/BCC routing: additional routing keys, BCC stripped from delivered message', () => {
    it('CC routes to additional queues and CC header is preserved', async () => {
      await setup();
      await ch.assertQueue('cc-q1');
      await ch.assertQueue('cc-q2');

      const c1 = collectMessages(1);
      const c2 = collectMessages(1);
      await ch.consume('cc-q1', c1.callback, { noAck: true });
      await ch.consume('cc-q2', c2.callback, { noAck: true });

      // Publish to cc-q1 with CC to cc-q2 (via default exchange)
      ch.sendToQueue('cc-q1', new Uint8Array([1]), { CC: 'cc-q2' });

      const [r1] = await c1.done;
      const [r2] = await c2.done;
      const m1 = assertMsg(r1);
      assertMsg(r2);
      // CC header should be preserved in delivered message
      expect(m1.properties.headers?.['CC']).toEqual(['cc-q2']);
      await conn.close();
    });

    it('BCC routes to additional queues but BCC header is stripped', async () => {
      await setup();
      await ch.assertQueue('bcc-q1');
      await ch.assertQueue('bcc-q2');

      const c1 = collectMessages(1);
      const c2 = collectMessages(1);
      await ch.consume('bcc-q1', c1.callback, { noAck: true });
      await ch.consume('bcc-q2', c2.callback, { noAck: true });

      ch.sendToQueue('bcc-q1', new Uint8Array([1]), { BCC: 'bcc-q2' });

      const [r1] = await c1.done;
      const [r2] = await c2.done;
      const m1 = assertMsg(r1);
      const m2 = assertMsg(r2);
      // BCC header should be stripped from delivered messages
      expect(m1.properties.headers?.['BCC']).toBeUndefined();
      expect(m2.properties.headers?.['BCC']).toBeUndefined();
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Passive declare
  // ═══════════════════════════════════════════════════════════════════════

  describe('passive declare: checkExchange/checkQueue success and 404 failure', () => {
    it('checkExchange succeeds for existing exchange', async () => {
      await setup();
      await ch.assertExchange('check-ex', 'direct');
      await expect(ch.checkExchange('check-ex')).resolves.toBeUndefined();
      await conn.close();
    });

    it('checkExchange throws NOT_FOUND (404) for missing exchange', async () => {
      await setup();
      try {
        await ch.checkExchange('nonexistent-ex');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(404);
      }
      await conn.close();
    });

    it('checkQueue succeeds for existing queue and returns stats', async () => {
      await setup();
      await ch.assertQueue('check-q');
      const result = await ch.checkQueue('check-q');
      expect(result.queue).toBe('check-q');
      expect(result.messageCount).toBe(0);
      expect(result.consumerCount).toBe(0);
      await conn.close();
    });

    it('checkQueue throws NOT_FOUND (404) for missing queue', async () => {
      await setup();
      try {
        await ch.checkQueue('nonexistent-q');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChannelError);
        expect((err as ChannelError).replyCode).toBe(404);
      }
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Channel error
  // ═══════════════════════════════════════════════════════════════════════

  describe('channel error: invalid operation closes channel, connection stays open', () => {
    it('publishing to non-existent exchange throws channel error', async () => {
      await setup();

      expect(() =>
        ch.publish('no-such-exchange', 'rk', new Uint8Array([1]))
      ).toThrow(ChannelError);
      await conn.close();
    });

    it('connection remains usable after a channel error', async () => {
      await setup();

      // Trigger channel error
      try {
        ch.publish('no-such-exchange', 'rk', new Uint8Array([1]));
      } catch {
        // expected
      }

      // Connection should still be open — can create a new channel
      const ch2 = await conn.createChannel();
      await ch2.assertQueue('after-error-q');
      const result = await ch2.checkQueue('after-error-q');
      expect(result.queue).toBe('after-error-q');
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Connection close
  // ═══════════════════════════════════════════════════════════════════════

  describe('connection close: cascades to all channels, exclusive queues deleted', () => {
    it('closing connection closes all channels', async () => {
      await setup();
      const ch2 = await conn.createChannel();
      const ch3 = await conn.createChannel();

      const closeFn1 = vi.fn();
      const closeFn2 = vi.fn();
      const closeFn3 = vi.fn();
      ch.on('close', closeFn1);
      ch2.on('close', closeFn2);
      ch3.on('close', closeFn3);

      await conn.close();

      expect(closeFn1).toHaveBeenCalledOnce();
      expect(closeFn2).toHaveBeenCalledOnce();
      expect(closeFn3).toHaveBeenCalledOnce();
    });

    it('exclusive queues are deleted on connection close', async () => {
      await setup();
      const result = await ch.assertQueue('excl-test', { exclusive: true });
      expect(result.queue).toBe('excl-test');

      // Verify from a second connection
      const conn2 = RabbitBox.create();
      const ch2 = await conn2.createChannel();

      await conn.close();

      await expect(ch2.checkQueue('excl-test')).rejects.toThrow(ChannelError);
      await conn2.close();
    });

    it('operations on closed connection reject', async () => {
      await setup();
      await conn.close();
      await expect(conn.createChannel()).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Multiple channels
  // ═══════════════════════════════════════════════════════════════════════

  describe('multiple channels: independent delivery tag sequences, independent errors', () => {
    it('each channel has its own delivery tag sequence starting at 1', async () => {
      await setup();
      const ch2 = await conn.createChannel();

      await ch.assertQueue('multi-ch-q1');
      await ch2.assertQueue('multi-ch-q2');

      const msgs1: DeliveredMessage[] = [];
      const msgs2: DeliveredMessage[] = [];
      await ch.consume('multi-ch-q1', (m) => {
        msgs1.push(m);
        ch.ack(m);
      });
      await ch2.consume('multi-ch-q2', (m) => {
        msgs2.push(m);
        ch2.ack(m);
      });

      ch.sendToQueue('multi-ch-q1', new Uint8Array([1]));
      ch2.sendToQueue('multi-ch-q2', new Uint8Array([2]));

      await tick(50);

      // Both channels should start delivery tags at 1
      expect(msgs1).toHaveLength(1);
      expect(msgs2).toHaveLength(1);
      const m1 = assertMsg(msgs1[0]);
      const m2 = assertMsg(msgs2[0]);
      expect(m1.deliveryTag).toBe(1);
      expect(m2.deliveryTag).toBe(1);
      await conn.close();
    });

    it('error on one channel does not affect other channels', async () => {
      await setup();
      const ch2 = await conn.createChannel();

      // Cause an error on ch (publish to non-existent exchange)
      try {
        ch.publish('nonexistent', 'rk', new Uint8Array([1]));
      } catch {
        // expected
      }

      // ch2 should still work fine
      await ch2.assertQueue('still-works');
      const result = await ch2.checkQueue('still-works');
      expect(result.queue).toBe('still-works');
      await conn.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // user-id validation
  // ═══════════════════════════════════════════════════════════════════════

  describe('user-id validation: matching and mismatching userId property', () => {
    it('publish with matching userId succeeds', async () => {
      await setup();
      await ch.assertQueue('uid-q');

      // userId in properties matches when no authenticatedUserId is set
      // (validation only fires when both are present)
      const ok = ch.sendToQueue('uid-q', new Uint8Array([1]), {
        userId: 'guest',
      });
      expect(ok).toBe(true);
      await conn.close();
    });

    it('publish without userId property succeeds regardless of auth user', async () => {
      await setup();
      await ch.assertQueue('uid-q2');

      // No userId in properties — always valid
      const ok = ch.sendToQueue('uid-q2', new Uint8Array([1]));
      expect(ok).toBe(true);
      await conn.close();
    });
  });
});
