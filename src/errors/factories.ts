import { ChannelError, ConnectionError } from './amqp-error.ts';
import * as codes from './reply-codes.ts';

/**
 * Reply text format matches RabbitMQ: `ERROR_NAME - message`
 * e.g. "NOT_FOUND - no queue 'orders' in vhost '/'"
 */
function replyText(name: string, message: string): string {
  return `${name} - ${message}`;
}

// ── Channel error factories ──────────────────────────────────────────

export const channelError = {
  contentTooLarge(message: string, classId = 0, methodId = 0): ChannelError {
    return new ChannelError(
      codes.CONTENT_TOO_LARGE,
      replyText('CONTENT_TOO_LARGE', message),
      classId,
      methodId
    );
  },

  noRoute(message: string, classId = 0, methodId = 0): ChannelError {
    return new ChannelError(
      codes.NO_ROUTE,
      replyText('NO_ROUTE', message),
      classId,
      methodId
    );
  },

  noConsumers(message: string, classId = 0, methodId = 0): ChannelError {
    return new ChannelError(
      codes.NO_CONSUMERS,
      replyText('NO_CONSUMERS', message),
      classId,
      methodId
    );
  },

  accessRefused(message: string, classId = 0, methodId = 0): ChannelError {
    return new ChannelError(
      codes.ACCESS_REFUSED,
      replyText('ACCESS_REFUSED', message),
      classId,
      methodId
    );
  },

  notFound(message: string, classId = 0, methodId = 0): ChannelError {
    return new ChannelError(
      codes.NOT_FOUND,
      replyText('NOT_FOUND', message),
      classId,
      methodId
    );
  },

  resourceLocked(message: string, classId = 0, methodId = 0): ChannelError {
    return new ChannelError(
      codes.RESOURCE_LOCKED,
      replyText('RESOURCE_LOCKED', message),
      classId,
      methodId
    );
  },

  preconditionFailed(message: string, classId = 0, methodId = 0): ChannelError {
    return new ChannelError(
      codes.PRECONDITION_FAILED,
      replyText('PRECONDITION_FAILED', message),
      classId,
      methodId
    );
  },
} as const;

// ── Connection error factories ───────────────────────────────────────

export const connectionError = {
  connectionForced(
    message: string,
    classId = 0,
    methodId = 0
  ): ConnectionError {
    return new ConnectionError(
      codes.CONNECTION_FORCED,
      replyText('CONNECTION_FORCED', message),
      classId,
      methodId
    );
  },

  invalidPath(message: string, classId = 0, methodId = 0): ConnectionError {
    return new ConnectionError(
      codes.INVALID_PATH,
      replyText('INVALID_PATH', message),
      classId,
      methodId
    );
  },

  frameError(message: string, classId = 0, methodId = 0): ConnectionError {
    return new ConnectionError(
      codes.FRAME_ERROR,
      replyText('FRAME_ERROR', message),
      classId,
      methodId
    );
  },

  syntaxError(message: string, classId = 0, methodId = 0): ConnectionError {
    return new ConnectionError(
      codes.SYNTAX_ERROR,
      replyText('SYNTAX_ERROR', message),
      classId,
      methodId
    );
  },

  commandInvalid(message: string, classId = 0, methodId = 0): ConnectionError {
    return new ConnectionError(
      codes.COMMAND_INVALID,
      replyText('COMMAND_INVALID', message),
      classId,
      methodId
    );
  },

  channelError(message: string, classId = 0, methodId = 0): ConnectionError {
    return new ConnectionError(
      codes.CHANNEL_ERROR,
      replyText('CHANNEL_ERROR', message),
      classId,
      methodId
    );
  },

  unexpectedFrame(message: string, classId = 0, methodId = 0): ConnectionError {
    return new ConnectionError(
      codes.UNEXPECTED_FRAME,
      replyText('UNEXPECTED_FRAME', message),
      classId,
      methodId
    );
  },

  resourceError(message: string, classId = 0, methodId = 0): ConnectionError {
    return new ConnectionError(
      codes.RESOURCE_ERROR,
      replyText('RESOURCE_ERROR', message),
      classId,
      methodId
    );
  },

  notAllowed(message: string, classId = 0, methodId = 0): ConnectionError {
    return new ConnectionError(
      codes.NOT_ALLOWED,
      replyText('NOT_ALLOWED', message),
      classId,
      methodId
    );
  },

  notImplemented(message: string, classId = 0, methodId = 0): ConnectionError {
    return new ConnectionError(
      codes.NOT_IMPLEMENTED,
      replyText('NOT_IMPLEMENTED', message),
      classId,
      methodId
    );
  },

  internalError(message: string, classId = 0, methodId = 0): ConnectionError {
    return new ConnectionError(
      codes.INTERNAL_ERROR,
      replyText('INTERNAL_ERROR', message),
      classId,
      methodId
    );
  },
} as const;
