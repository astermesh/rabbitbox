/** Parsed AMQP connection parameters. */
export interface AmqpUrlParams {
  readonly username: string;
  readonly password: string;
  readonly vhost: string;
}

/**
 * Parse an AMQP URL into connection parameters.
 *
 * Handles common formats:
 *   amqp://user:pass@host:port/vhost
 *   amqp://host
 *   amqp://user:pass@host/vhost
 *   amqp://host/vhost
 *
 * Host and port are ignored (in-process).
 */
export function parseAmqpUrl(url: string): AmqpUrlParams {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid AMQP URL: ${url}`);
  }

  const protocol = parsed.protocol;
  if (protocol !== 'amqp:' && protocol !== 'amqps:') {
    throw new Error(
      `Invalid AMQP URL protocol: ${protocol} (expected amqp: or amqps:)`
    );
  }

  const username = parsed.username
    ? decodeURIComponent(parsed.username)
    : 'guest';
  const password = parsed.password
    ? decodeURIComponent(parsed.password)
    : 'guest';

  // Vhost is the pathname minus the leading slash.
  // Empty or "/" means default vhost "/".
  const rawPath = decodeURIComponent(parsed.pathname);
  const vhost = rawPath === '/' || rawPath === '' ? '/' : rawPath.slice(1);

  return { username, password, vhost };
}
