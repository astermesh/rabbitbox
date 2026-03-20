import { describe, it, expect } from 'vitest';
import { parseAmqpUrl } from './url.ts';

describe('parseAmqpUrl', () => {
  it('parses full URL with user, pass, host, port, vhost', () => {
    const result = parseAmqpUrl('amqp://user:pass@host:5672/my-vhost');
    expect(result).toEqual({
      username: 'user',
      password: 'pass',
      vhost: 'my-vhost',
    });
  });

  it('defaults username and password to guest', () => {
    const result = parseAmqpUrl('amqp://localhost');
    expect(result).toEqual({
      username: 'guest',
      password: 'guest',
      vhost: '/',
    });
  });

  it('extracts vhost from path', () => {
    const result = parseAmqpUrl('amqp://localhost/production');
    expect(result).toEqual({
      username: 'guest',
      password: 'guest',
      vhost: 'production',
    });
  });

  it('treats empty path as default vhost "/"', () => {
    const result = parseAmqpUrl('amqp://localhost/');
    expect(result.vhost).toBe('/');
  });

  it('handles URL-encoded vhost (%2f = /)', () => {
    const result = parseAmqpUrl('amqp://localhost/%2f');
    expect(result.vhost).toBe('/');
  });

  it('handles URL-encoded credentials', () => {
    const result = parseAmqpUrl('amqp://us%40er:p%40ss@localhost/');
    expect(result.username).toBe('us@er');
    expect(result.password).toBe('p@ss');
  });

  it('accepts amqps protocol', () => {
    const result = parseAmqpUrl('amqps://user:pass@host/vhost');
    expect(result).toEqual({
      username: 'user',
      password: 'pass',
      vhost: 'vhost',
    });
  });

  it('throws on invalid URL', () => {
    expect(() => parseAmqpUrl('not-a-url')).toThrow('Invalid AMQP URL');
  });

  it('throws on non-amqp protocol', () => {
    expect(() => parseAmqpUrl('http://localhost')).toThrow(
      'Invalid AMQP URL protocol'
    );
  });

  it('handles user with password but no vhost', () => {
    const result = parseAmqpUrl('amqp://admin:secret@rabbitmq:5672');
    expect(result).toEqual({
      username: 'admin',
      password: 'secret',
      vhost: '/',
    });
  });
});
