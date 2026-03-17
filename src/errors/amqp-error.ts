/**
 * Base AMQP error matching RabbitMQ's connection.close / channel.close semantics.
 *
 * Every AMQP error carries:
 * - replyCode  — numeric AMQP reply code (e.g. 404, 406, 541)
 * - replyText  — human-readable description in RabbitMQ format
 * - classId    — AMQP class that caused the error (0 when unknown)
 * - methodId   — AMQP method that caused the error (0 when unknown)
 */
export class AmqpError extends Error {
  readonly replyCode: number;
  readonly replyText: string;
  readonly classId: number;
  readonly methodId: number;

  constructor(replyCode: number, replyText: string, classId = 0, methodId = 0) {
    super(replyText);
    this.name = 'AmqpError';
    this.replyCode = replyCode;
    this.replyText = replyText;
    this.classId = classId;
    this.methodId = methodId;
  }
}

/** Channel-level (soft) error — closes only the affected channel. */
export class ChannelError extends AmqpError {
  constructor(replyCode: number, replyText: string, classId = 0, methodId = 0) {
    super(replyCode, replyText, classId, methodId);
    this.name = 'ChannelError';
  }
}

/** Connection-level (hard) error — closes the connection and all its channels. */
export class ConnectionError extends AmqpError {
  constructor(replyCode: number, replyText: string, classId = 0, methodId = 0) {
    super(replyCode, replyText, classId, methodId);
    this.name = 'ConnectionError';
  }
}
