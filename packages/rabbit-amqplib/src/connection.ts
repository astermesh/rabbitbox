import { RabbitBox, type ApiConnection } from '@rabbitbox/box';
import { EventEmitter } from '@rabbitbox/box';
import { parseAmqpUrl } from './url.ts';
import { AmqplibChannel } from './channel.ts';
import type { ConnectionEvents } from './types.ts';

/**
 * amqplib-compatible Connection wrapper around RabbitBox.
 *
 * Matches the amqplib Connection interface:
 * - createChannel() → Promise<Channel>
 * - createConfirmChannel() → Promise<ConfirmChannel>
 * - close() → Promise<void>
 * - Events: error, close, blocked, unblocked
 */
export class AmqplibConnection extends EventEmitter<ConnectionEvents> {
  /** @internal */
  readonly inner: ApiConnection;
  private closed = false;

  constructor(inner: ApiConnection) {
    super();
    // Forward close event from the inner connection
    inner.on('close', () => {
      this.emitClose();
    });
    inner.on('error', (err: Error) => {
      this.emitError(err);
    });
    this.inner = inner;
  }

  async createChannel(): Promise<AmqplibChannel> {
    this.assertOpen();
    const apiChannel = await this.inner.createChannel();
    return new AmqplibChannel(apiChannel, false);
  }

  async createConfirmChannel(): Promise<AmqplibChannel> {
    this.assertOpen();
    const apiChannel = await this.inner.createChannel();
    await apiChannel.confirmSelect();
    return new AmqplibChannel(apiChannel, true);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.inner.close();
  }

  /** @internal */
  emitClose(): void {
    this.emit('close');
  }

  /** @internal */
  emitError(err: Error): void {
    this.emit('error', err);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Connection closed');
    }
  }
}

/**
 * Connect to an in-memory RabbitBox instance.
 *
 * Drop-in replacement for `amqplib.connect()`.
 * URL is parsed for credentials and vhost; host/port are ignored.
 */
export function connect(
  url: string | Record<string, unknown>
): Promise<AmqplibConnection> {
  let username = 'guest';
  let vhost = '/';

  if (typeof url === 'string') {
    const params = parseAmqpUrl(url);
    username = params.username;
    vhost = params.vhost;
  } else {
    // Support object-based config like amqplib
    if (typeof url['username'] === 'string') username = url['username'];
    if (typeof url['vhost'] === 'string') vhost = url['vhost'];
  }

  const inner = RabbitBox.create({ username, vhost });
  const connection = new AmqplibConnection(inner);
  return Promise.resolve(connection);
}
