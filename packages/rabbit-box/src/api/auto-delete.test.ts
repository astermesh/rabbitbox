import { describe, expect, it } from 'vitest';
import { RabbitBox } from './rabbit-box.ts';
import type { ApiConnection } from './connection.ts';
import type { ApiChannel } from './channel.ts';
import { ChannelError } from '../errors/amqp-error.ts';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

describe('auto-delete queues', () => {
  let conn: ApiConnection;
  let ch: ApiChannel;

  async function setup(): Promise<void> {
    conn = RabbitBox.create();
    ch = await conn.createChannel();
  }

  it('queue with autoDelete is deleted when last consumer cancels', async () => {
    await setup();
    await ch.assertQueue('ad-q', { autoDelete: true });
    const { consumerTag } = await ch.consume('ad-q', noop, { noAck: true });
    await ch.cancel(consumerTag);
    // Queue should be gone
    await expect(ch.checkQueue('ad-q')).rejects.toThrow(ChannelError);
  });

  it('auto-delete queue is NOT deleted on creation with zero consumers', async () => {
    await setup();
    await ch.assertQueue('ad-q', { autoDelete: true });
    // Queue should still exist
    const result = await ch.checkQueue('ad-q');
    expect(result.queue).toBe('ad-q');
  });

  it('auto-delete queue is NOT deleted when consumers remain', async () => {
    await setup();
    await ch.assertQueue('ad-q', { autoDelete: true });
    const { consumerTag: tag1 } = await ch.consume('ad-q', noop, {
      noAck: true,
    });
    await ch.consume('ad-q', noop, { noAck: true });
    await ch.cancel(tag1);
    // Queue should still exist (one consumer remains)
    const result = await ch.checkQueue('ad-q');
    expect(result.queue).toBe('ad-q');
  });

  it('auto-delete queue is deleted when second consumer also cancels', async () => {
    await setup();
    await ch.assertQueue('ad-q', { autoDelete: true });
    const { consumerTag: tag1 } = await ch.consume('ad-q', noop, {
      noAck: true,
    });
    const { consumerTag: tag2 } = await ch.consume('ad-q', noop, {
      noAck: true,
    });
    await ch.cancel(tag1);
    await ch.cancel(tag2);
    await expect(ch.checkQueue('ad-q')).rejects.toThrow(ChannelError);
  });

  it('auto-delete queue is deleted on channel close', async () => {
    await setup();
    await ch.assertQueue('ad-q', { autoDelete: true });
    await ch.consume('ad-q', noop, { noAck: true });
    await ch.close();

    // Use new channel to check
    const ch2 = await conn.createChannel();
    await expect(ch2.checkQueue('ad-q')).rejects.toThrow(ChannelError);
  });

  it('auto-delete queue discards messages (no DLX)', async () => {
    await setup();
    // Set up DLX to verify messages are NOT dead-lettered
    await ch.assertExchange('dlx', 'direct');
    await ch.assertQueue('dlq');
    await ch.bindQueue('dlq', 'dlx', 'ad-q');

    await ch.assertQueue('ad-q', {
      autoDelete: true,
      arguments: {
        'x-dead-letter-exchange': 'dlx',
      },
    });

    // Publish a message
    ch.sendToQueue('ad-q', new Uint8Array([1, 2, 3]));

    // Add consumer then cancel to trigger auto-delete
    const { consumerTag } = await ch.consume('ad-q', noop, { noAck: true });
    await ch.cancel(consumerTag);

    // DLQ should be empty — messages are discarded on auto-delete
    const dlqMsg = await ch.get('dlq', { noAck: true });
    expect(dlqMsg).toBe(false);
  });

  it('auto-delete queue removes its bindings on deletion', async () => {
    await setup();
    await ch.assertExchange('test-ex', 'direct');
    await ch.assertQueue('ad-q', { autoDelete: true });
    await ch.bindQueue('ad-q', 'test-ex', 'rk');

    const { consumerTag } = await ch.consume('ad-q', noop, { noAck: true });
    await ch.cancel(consumerTag);

    // Queue should be gone
    await expect(ch.checkQueue('ad-q')).rejects.toThrow(ChannelError);

    // Re-create queue and exchange to verify binding is also gone
    await ch.assertQueue('ad-q2', { autoDelete: false });
    await ch.bindQueue('ad-q2', 'test-ex', 'rk');
    ch.publish('test-ex', 'rk', new Uint8Array([99]));

    await new Promise((r) => setTimeout(r, 10));
    const msg = await ch.get('ad-q2', { noAck: true });
    expect(msg).not.toBe(false);
  });

  it('non-autoDelete queue is NOT deleted when last consumer cancels', async () => {
    await setup();
    await ch.assertQueue('normal-q', { autoDelete: false });
    const { consumerTag } = await ch.consume('normal-q', noop, {
      noAck: true,
    });
    await ch.cancel(consumerTag);
    // Queue should still exist
    const result = await ch.checkQueue('normal-q');
    expect(result.queue).toBe('normal-q');
  });

  it('auto-delete queue with connection close triggers deletion for consumers on that connection', async () => {
    await setup();
    const conn2 = conn.createConnection();
    const ch2 = await conn2.createChannel();

    // Declare on conn, consume on conn2
    await ch.assertQueue('ad-q', { autoDelete: true });
    await ch2.consume('ad-q', noop, { noAck: true });

    // Close conn2 — last consumer goes away → auto-delete
    await conn2.close();

    // Queue should be gone
    await expect(ch.checkQueue('ad-q')).rejects.toThrow(ChannelError);
  });
});

describe('auto-delete exchanges', () => {
  let conn: ApiConnection;
  let ch: ApiChannel;

  async function setup(): Promise<void> {
    conn = RabbitBox.create();
    ch = await conn.createChannel();
  }

  it('exchange with autoDelete is deleted when last binding is removed', async () => {
    await setup();
    await ch.assertExchange('ad-ex', 'direct', { autoDelete: true });
    await ch.assertQueue('test-q');
    await ch.bindQueue('test-q', 'ad-ex', 'rk');
    await ch.unbindQueue('test-q', 'ad-ex', 'rk');
    // Exchange should be gone
    await expect(ch.checkExchange('ad-ex')).rejects.toThrow(ChannelError);
  });

  it('auto-delete exchange is NOT deleted on creation with zero bindings', async () => {
    await setup();
    await ch.assertExchange('ad-ex', 'direct', { autoDelete: true });
    // Exchange should still exist
    await expect(ch.checkExchange('ad-ex')).resolves.toBeUndefined();
  });

  it('auto-delete exchange is NOT deleted when bindings remain', async () => {
    await setup();
    await ch.assertExchange('ad-ex', 'direct', { autoDelete: true });
    await ch.assertQueue('q1');
    await ch.assertQueue('q2');
    await ch.bindQueue('q1', 'ad-ex', 'rk1');
    await ch.bindQueue('q2', 'ad-ex', 'rk2');
    await ch.unbindQueue('q1', 'ad-ex', 'rk1');
    // Exchange should still exist (one binding remains)
    await expect(ch.checkExchange('ad-ex')).resolves.toBeUndefined();
  });

  it('auto-delete exchange is deleted when all bindings are removed', async () => {
    await setup();
    await ch.assertExchange('ad-ex', 'direct', { autoDelete: true });
    await ch.assertQueue('q1');
    await ch.assertQueue('q2');
    await ch.bindQueue('q1', 'ad-ex', 'rk1');
    await ch.bindQueue('q2', 'ad-ex', 'rk2');
    await ch.unbindQueue('q1', 'ad-ex', 'rk1');
    await ch.unbindQueue('q2', 'ad-ex', 'rk2');
    await expect(ch.checkExchange('ad-ex')).rejects.toThrow(ChannelError);
  });

  it('auto-delete exchange is deleted when bound queue is deleted', async () => {
    await setup();
    await ch.assertExchange('ad-ex', 'direct', { autoDelete: true });
    await ch.assertQueue('test-q');
    await ch.bindQueue('test-q', 'ad-ex', 'rk');
    await ch.deleteQueue('test-q');
    // Exchange should be gone — its only binding was removed
    await expect(ch.checkExchange('ad-ex')).rejects.toThrow(ChannelError);
  });

  it('non-autoDelete exchange is NOT deleted when last binding is removed', async () => {
    await setup();
    await ch.assertExchange('normal-ex', 'direct', { autoDelete: false });
    await ch.assertQueue('test-q');
    await ch.bindQueue('test-q', 'normal-ex', 'rk');
    await ch.unbindQueue('test-q', 'normal-ex', 'rk');
    // Exchange should still exist
    await expect(ch.checkExchange('normal-ex')).resolves.toBeUndefined();
  });

  it('auto-delete exchange is deleted when last binding removed via queue delete', async () => {
    await setup();
    await ch.assertExchange('ad-ex', 'direct', { autoDelete: true });
    await ch.assertQueue('q1');
    await ch.assertQueue('q2');
    await ch.bindQueue('q1', 'ad-ex', 'rk1');
    await ch.bindQueue('q2', 'ad-ex', 'rk2');
    // Delete both queues — should remove all bindings and trigger auto-delete
    await ch.deleteQueue('q1');
    await ch.deleteQueue('q2');
    await expect(ch.checkExchange('ad-ex')).rejects.toThrow(ChannelError);
  });
});
