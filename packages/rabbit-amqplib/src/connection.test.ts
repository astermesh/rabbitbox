import { describe, it, expect, vi } from 'vitest';
import { connect, AmqplibConnection } from './connection.ts';
import { AmqplibChannel } from './channel.ts';

describe('connect', () => {
  it('returns a connection from a URL string', async () => {
    const conn = await connect('amqp://localhost');
    expect(conn).toBeInstanceOf(AmqplibConnection);
    await conn.close();
  });

  it('parses username from URL', async () => {
    const conn = await connect('amqp://admin:secret@localhost');
    expect(conn.inner.username).toBe('admin');
    await conn.close();
  });

  it('defaults username to guest', async () => {
    const conn = await connect('amqp://localhost');
    expect(conn.inner.username).toBe('guest');
    await conn.close();
  });

  it('accepts object-based config', async () => {
    const conn = await connect({ username: 'admin', vhost: '/test' });
    expect(conn.inner.username).toBe('admin');
    await conn.close();
  });

  it('defaults to guest for object config without username', async () => {
    const conn = await connect({});
    expect(conn.inner.username).toBe('guest');
    await conn.close();
  });
});

describe('AmqplibConnection', () => {
  it('createChannel returns an AmqplibChannel', async () => {
    const conn = await connect('amqp://localhost');
    const ch = await conn.createChannel();
    expect(ch).toBeInstanceOf(AmqplibChannel);
    expect(ch.isConfirmChannel).toBe(false);
    await ch.close();
    await conn.close();
  });

  it('createConfirmChannel returns a channel in confirm mode', async () => {
    const conn = await connect('amqp://localhost');
    const ch = await conn.createConfirmChannel();
    expect(ch).toBeInstanceOf(AmqplibChannel);
    expect(ch.isConfirmChannel).toBe(true);
    await ch.close();
    await conn.close();
  });

  it('close emits close event', async () => {
    const conn = await connect('amqp://localhost');
    const onClose = vi.fn();
    conn.on('close', onClose);
    await conn.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('close is idempotent', async () => {
    const conn = await connect('amqp://localhost');
    const onClose = vi.fn();
    conn.on('close', onClose);
    await conn.close();
    await conn.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('throws when creating channel on closed connection', async () => {
    const conn = await connect('amqp://localhost');
    await conn.close();
    await expect(conn.createChannel()).rejects.toThrow('Connection closed');
  });

  it('throws when creating confirm channel on closed connection', async () => {
    const conn = await connect('amqp://localhost');
    await conn.close();
    await expect(conn.createConfirmChannel()).rejects.toThrow(
      'Connection closed'
    );
  });

  it('supports blocked and unblocked event listeners', async () => {
    const conn = await connect('amqp://localhost');
    const onBlocked = vi.fn();
    const onUnblocked = vi.fn();
    conn.on('blocked', onBlocked);
    conn.on('unblocked', onUnblocked);
    // These events are supported but RabbitBox never triggers them
    // (no real flow control) — verify they can be registered
    expect(conn.listenerCount('blocked')).toBe(1);
    expect(conn.listenerCount('unblocked')).toBe(1);
    await conn.close();
  });

  it('supports error event', async () => {
    const conn = await connect('amqp://localhost');
    const onError = vi.fn();
    conn.on('error', onError);
    expect(conn.listenerCount('error')).toBe(1);
    await conn.close();
  });
});
