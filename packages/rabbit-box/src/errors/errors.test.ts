import { describe, expect, it } from 'vitest';
import { AmqpError, ChannelError, ConnectionError } from './amqp-error.ts';
import {
  REPLY_SUCCESS,
  CONTENT_TOO_LARGE,
  NO_ROUTE,
  NO_CONSUMERS,
  ACCESS_REFUSED,
  NOT_FOUND,
  RESOURCE_LOCKED,
  PRECONDITION_FAILED,
  CONNECTION_FORCED,
  INVALID_PATH,
  FRAME_ERROR,
  SYNTAX_ERROR,
  COMMAND_INVALID,
  CHANNEL_ERROR,
  UNEXPECTED_FRAME,
  RESOURCE_ERROR,
  NOT_ALLOWED,
  NOT_IMPLEMENTED,
  INTERNAL_ERROR,
} from './reply-codes.ts';
import { channelError, connectionError } from './factories.ts';

// ── Reply code values ────────────────────────────────────────────────

describe('reply codes', () => {
  it('has correct values per AMQP 0-9-1 spec', () => {
    expect(REPLY_SUCCESS).toBe(200);

    // channel-level (soft)
    expect(CONTENT_TOO_LARGE).toBe(311);
    expect(NO_ROUTE).toBe(312);
    expect(NO_CONSUMERS).toBe(313);
    expect(ACCESS_REFUSED).toBe(403);
    expect(NOT_FOUND).toBe(404);
    expect(RESOURCE_LOCKED).toBe(405);
    expect(PRECONDITION_FAILED).toBe(406);

    // connection-level (hard)
    expect(CONNECTION_FORCED).toBe(320);
    expect(INVALID_PATH).toBe(402);
    expect(FRAME_ERROR).toBe(501);
    expect(SYNTAX_ERROR).toBe(502);
    expect(COMMAND_INVALID).toBe(503);
    expect(CHANNEL_ERROR).toBe(504);
    expect(UNEXPECTED_FRAME).toBe(505);
    expect(RESOURCE_ERROR).toBe(506);
    expect(NOT_ALLOWED).toBe(530);
    expect(NOT_IMPLEMENTED).toBe(540);
    expect(INTERNAL_ERROR).toBe(541);
  });
});

// ── Base class ───────────────────────────────────────────────────────

describe('AmqpError', () => {
  it('sets all fields', () => {
    const err = new AmqpError(
      404,
      "NOT_FOUND - no queue 'q' in vhost '/'",
      50,
      10
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AmqpError);
    expect(err.name).toBe('AmqpError');
    expect(err.replyCode).toBe(404);
    expect(err.replyText).toBe("NOT_FOUND - no queue 'q' in vhost '/'");
    expect(err.classId).toBe(50);
    expect(err.methodId).toBe(10);
    expect(err.message).toBe("NOT_FOUND - no queue 'q' in vhost '/'");
  });

  it('defaults classId and methodId to 0', () => {
    const err = new AmqpError(541, 'INTERNAL_ERROR - test');
    expect(err.classId).toBe(0);
    expect(err.methodId).toBe(0);
  });
});

// ── ChannelError ─────────────────────────────────────────────────────

describe('ChannelError', () => {
  it('is an AmqpError', () => {
    const err = new ChannelError(404, 'NOT_FOUND - test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AmqpError);
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.name).toBe('ChannelError');
  });

  it('is not a ConnectionError', () => {
    const err = new ChannelError(404, 'NOT_FOUND - test');
    expect(err).not.toBeInstanceOf(ConnectionError);
  });
});

// ── ConnectionError ──────────────────────────────────────────────────

describe('ConnectionError', () => {
  it('is an AmqpError', () => {
    const err = new ConnectionError(501, 'FRAME_ERROR - test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AmqpError);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.name).toBe('ConnectionError');
  });

  it('is not a ChannelError', () => {
    const err = new ConnectionError(501, 'FRAME_ERROR - test');
    expect(err).not.toBeInstanceOf(ChannelError);
  });
});

// ── Channel error factories ──────────────────────────────────────────

describe('channelError factories', () => {
  it('contentTooLarge', () => {
    const err = channelError.contentTooLarge(
      'content body too large (131072 > 65536)',
      60,
      40
    );
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.replyCode).toBe(311);
    expect(err.replyText).toBe(
      'CONTENT_TOO_LARGE - content body too large (131072 > 65536)'
    );
    expect(err.classId).toBe(60);
    expect(err.methodId).toBe(40);
  });

  it('noRoute', () => {
    const err = channelError.noRoute(
      "no route for message with routing key 'test' in exchange 'amq.direct'",
      60,
      40
    );
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.replyCode).toBe(312);
    expect(err.replyText).toMatch(/^NO_ROUTE - /);
  });

  it('noConsumers', () => {
    const err = channelError.noConsumers('immediate flag is not supported');
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.replyCode).toBe(313);
    expect(err.replyText).toMatch(/^NO_CONSUMERS - /);
  });

  it('accessRefused', () => {
    const err = channelError.accessRefused(
      "access to queue 'test' in vhost '/' refused for user 'guest'",
      50,
      10
    );
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.replyCode).toBe(403);
    expect(err.replyText).toBe(
      "ACCESS_REFUSED - access to queue 'test' in vhost '/' refused for user 'guest'"
    );
  });

  it('notFound', () => {
    const err = channelError.notFound("no queue 'orders' in vhost '/'", 50, 10);
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.replyCode).toBe(404);
    expect(err.replyText).toBe("NOT_FOUND - no queue 'orders' in vhost '/'");
    expect(err.classId).toBe(50);
    expect(err.methodId).toBe(10);
  });

  it('resourceLocked', () => {
    const err = channelError.resourceLocked(
      "cannot obtain exclusive access to locked queue 'q1' in vhost '/'",
      50,
      10
    );
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.replyCode).toBe(405);
    expect(err.replyText).toMatch(/^RESOURCE_LOCKED - /);
  });

  it('preconditionFailed', () => {
    const err = channelError.preconditionFailed(
      "inequivalent arg 'durable' for queue 'test' in vhost '/': received 'false' but current is 'true'",
      50,
      10
    );
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.replyCode).toBe(406);
    expect(err.replyText).toBe(
      "PRECONDITION_FAILED - inequivalent arg 'durable' for queue 'test' in vhost '/': received 'false' but current is 'true'"
    );
  });

  it('defaults classId/methodId to 0', () => {
    const err = channelError.notFound("no queue 'q' in vhost '/'");
    expect(err.classId).toBe(0);
    expect(err.methodId).toBe(0);
  });
});

// ── Connection error factories ───────────────────────────────────────

describe('connectionError factories', () => {
  it('connectionForced', () => {
    const err = connectionError.connectionForced(
      "broker forced connection closure with reason 'shutdown'"
    );
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.replyCode).toBe(320);
    expect(err.replyText).toMatch(/^CONNECTION_FORCED - /);
  });

  it('invalidPath', () => {
    const err = connectionError.invalidPath('no access to this vhost', 10, 40);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.replyCode).toBe(402);
    expect(err.replyText).toBe('INVALID_PATH - no access to this vhost');
  });

  it('frameError', () => {
    const err = connectionError.frameError('type 65, all octets = ...');
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.replyCode).toBe(501);
    expect(err.replyText).toMatch(/^FRAME_ERROR - /);
  });

  it('syntaxError', () => {
    const err = connectionError.syntaxError('unknown field type');
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.replyCode).toBe(502);
    expect(err.replyText).toMatch(/^SYNTAX_ERROR - /);
  });

  it('commandInvalid', () => {
    const err = connectionError.commandInvalid(
      "second 'channel.open' seen",
      20,
      10
    );
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.replyCode).toBe(503);
    expect(err.replyText).toBe("COMMAND_INVALID - second 'channel.open' seen");
  });

  it('channelError', () => {
    const err = connectionError.channelError("expected 'channel.open'");
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.replyCode).toBe(504);
    expect(err.replyText).toMatch(/^CHANNEL_ERROR - /);
  });

  it('unexpectedFrame', () => {
    const err = connectionError.unexpectedFrame('expected method, got header');
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.replyCode).toBe(505);
    expect(err.replyText).toMatch(/^UNEXPECTED_FRAME - /);
  });

  it('resourceError', () => {
    const err = connectionError.resourceError('insufficient resources');
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.replyCode).toBe(506);
    expect(err.replyText).toMatch(/^RESOURCE_ERROR - /);
  });

  it('notAllowed', () => {
    const err = connectionError.notAllowed(
      "access to vhost '/' refused for user 'guest'",
      10,
      40
    );
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.replyCode).toBe(530);
    expect(err.replyText).toBe(
      "NOT_ALLOWED - access to vhost '/' refused for user 'guest'"
    );
  });

  it('notImplemented', () => {
    const err = connectionError.notImplemented('immediate flag not supported');
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.replyCode).toBe(540);
    expect(err.replyText).toMatch(/^NOT_IMPLEMENTED - /);
  });

  it('internalError', () => {
    const err = connectionError.internalError('unexpected exception');
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.replyCode).toBe(541);
    expect(err.replyText).toMatch(/^INTERNAL_ERROR - /);
  });

  it('defaults classId/methodId to 0', () => {
    const err = connectionError.frameError('bad frame');
    expect(err.classId).toBe(0);
    expect(err.methodId).toBe(0);
  });
});

// ── Classification ───────────────────────────────────────────────────

describe('error classification', () => {
  it('channel errors can be distinguished from connection errors via instanceof', () => {
    const ch = channelError.notFound("no queue 'q' in vhost '/'");
    const conn = connectionError.frameError('bad frame');

    expect(ch instanceof ChannelError).toBe(true);
    expect(ch instanceof ConnectionError).toBe(false);
    expect(conn instanceof ConnectionError).toBe(true);
    expect(conn instanceof ChannelError).toBe(false);

    // both are AmqpError
    expect(ch instanceof AmqpError).toBe(true);
    expect(conn instanceof AmqpError).toBe(true);
  });

  const channelCodes = [311, 312, 313, 403, 404, 405, 406];
  const connectionCodes = [
    320, 402, 501, 502, 503, 504, 505, 506, 530, 540, 541,
  ];

  it('all channel error factories produce ChannelError', () => {
    const errors = [
      channelError.contentTooLarge('test'),
      channelError.noRoute('test'),
      channelError.noConsumers('test'),
      channelError.accessRefused('test'),
      channelError.notFound('test'),
      channelError.resourceLocked('test'),
      channelError.preconditionFailed('test'),
    ];

    expect(errors.map((e) => e.replyCode)).toEqual(channelCodes);
    for (const err of errors) {
      expect(err).toBeInstanceOf(ChannelError);
      expect(err).not.toBeInstanceOf(ConnectionError);
    }
  });

  it('all connection error factories produce ConnectionError', () => {
    const errors = [
      connectionError.connectionForced('test'),
      connectionError.invalidPath('test'),
      connectionError.frameError('test'),
      connectionError.syntaxError('test'),
      connectionError.commandInvalid('test'),
      connectionError.channelError('test'),
      connectionError.unexpectedFrame('test'),
      connectionError.resourceError('test'),
      connectionError.notAllowed('test'),
      connectionError.notImplemented('test'),
      connectionError.internalError('test'),
    ];

    expect(errors.map((e) => e.replyCode)).toEqual(connectionCodes);
    for (const err of errors) {
      expect(err).toBeInstanceOf(ConnectionError);
      expect(err).not.toBeInstanceOf(ChannelError);
    }
  });
});
