/** Connection event map matching amqplib. */
export interface ConnectionEvents {
  error: (err: Error) => void;
  close: () => void;
  blocked: (reason: string) => void;
  unblocked: () => void;
}

/** Channel event map matching amqplib. */
export interface AmqplibChannelEvents {
  error: (err: Error) => void;
  close: () => void;
  return: (msg: AmqplibReturnedMessage) => void;
  drain: () => void;
}

/** A message returned via basic.return, matching amqplib format. */
export interface AmqplibReturnedMessage {
  readonly fields: {
    readonly replyCode: number;
    readonly replyText: string;
    readonly exchange: string;
    readonly routingKey: string;
  };
  readonly properties: AmqplibMessageProperties;
  readonly content: Buffer;
}

/** A delivered message matching amqplib format. */
export interface AmqplibMessage {
  readonly fields: {
    readonly deliveryTag: number;
    readonly redelivered: boolean;
    readonly exchange: string;
    readonly routingKey: string;
    readonly consumerTag: string;
    readonly messageCount?: number;
  };
  readonly properties: AmqplibMessageProperties;
  readonly content: Buffer;
}

/** Message properties matching amqplib format. */
export interface AmqplibMessageProperties {
  readonly contentType?: string;
  readonly contentEncoding?: string;
  readonly headers?: Record<string, unknown>;
  readonly deliveryMode?: 1 | 2;
  readonly priority?: number;
  readonly correlationId?: string;
  readonly replyTo?: string;
  readonly expiration?: string;
  readonly messageId?: string;
  readonly timestamp?: number;
  readonly type?: string;
  readonly userId?: string;
  readonly appId?: string;
}
