import type { ExchangeRegistry } from './exchange-registry.ts';
import type { BindingStore } from './binding-store.ts';
import type { QueueRegistry } from './queue-registry.ts';
import type { MessageStore } from './message-store.ts';
import type { MessageProperties, BrokerMessage } from './types/message.ts';
import type {
  Hook,
  PublishCtx,
  PublishResult as SbiPublishResult,
} from '@rabbitbox/sbi';
import { channelError } from './errors/factories.ts';
import { route } from './routing.ts';
import { runHooked } from './hook-runner.ts';

/** AMQP class/method IDs for basic.publish. */
const BASIC_CLASS_ID = 60;
const BASIC_PUBLISH_METHOD_ID = 40;

/** Result of a publish operation. */
export interface PublishResult {
  readonly routed: boolean;
}

/** Options for the publish function. */
export interface PublishOptions {
  readonly exchange: string;
  readonly routingKey: string;
  readonly body: Uint8Array;
  readonly properties: MessageProperties;
  readonly mandatory: boolean;
  readonly immediate: boolean;

  readonly exchangeRegistry: ExchangeRegistry;
  readonly bindingStore: BindingStore;
  readonly queueRegistry: QueueRegistry;
  readonly getMessageStore: (queue: string) => MessageStore;

  /** Callback for basic.return (mandatory unroutable messages). */
  readonly onReturn: (
    replyCode: number,
    replyText: string,
    exchange: string,
    routingKey: string,
    body: Uint8Array,
    properties: MessageProperties
  ) => void;

  /** Callback to trigger consumer dispatch for a queue. */
  readonly onDispatch: (queue: string) => void;

  /** Authenticated user for user-id validation. */
  readonly authenticatedUserId?: string;

  /** Optional publish hook for SBI integration. */
  readonly hook?: Hook<PublishCtx, SbiPublishResult>;
}

/**
 * Extract CC/BCC routing keys from message headers.
 * Returns them as arrays of strings, normalizing single-string values.
 */
function extractSenderSelectedKeys(
  headers: Record<string, unknown> | undefined,
  headerName: string
): string[] {
  if (!headers) return [];
  const value = headers[headerName];
  if (value === undefined) return [];
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string') return [value];
  return [];
}

/**
 * Strip BCC header from properties, returning new properties.
 * CC header is preserved (visible to consumers).
 */
function stripBccHeader(properties: MessageProperties): MessageProperties {
  if (!properties.headers || !('BCC' in properties.headers)) {
    return properties;
  }

  const headers: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties.headers)) {
    if (key !== 'BCC') {
      headers[key] = value;
    }
  }
  return { ...properties, headers };
}

/**
 * Full publish pipeline: exchange lookup → routing → queue enqueue → consumer dispatch trigger.
 *
 * Steps:
 * 1. Validate exchange exists (NOT_FOUND for non-default)
 * 2. Check internal flag (ACCESS_REFUSED)
 * 3. Validate user-id (PRECONDITION_FAILED)
 * 4. Route via exchange type → matched bindings
 * 5. Process CC/BCC headers for additional routing
 * 6. Deduplicate target queues
 * 7. Enqueue message copy to each queue
 * 8. If no queues matched and mandatory: emit basic.return
 * 9. Trigger consumer dispatch for each affected queue
 * 10. Return {routed: boolean}
 */
export function publish(opts: PublishOptions): PublishResult {
  const {
    exchange: exchangeName,
    routingKey,
    body,
    properties,
    mandatory,
    immediate,
    exchangeRegistry,
    bindingStore,
    queueRegistry,
    getMessageStore,
    onReturn,
    onDispatch,
    authenticatedUserId,
    hook,
  } = opts;

  // Build hook context with meta populated from current state
  const resolvedExchange = exchangeRegistry.getExchange(exchangeName);
  const ctx: PublishCtx = {
    exchange: exchangeName,
    routingKey,
    body,
    properties,
    mandatory,
    meta: {
      exchangeExists: exchangeName === '' || resolvedExchange !== undefined,
      exchangeType: resolvedExchange?.type ?? null,
    },
  };

  return runHooked(hook, ctx, () => {
    // 1. Validate exchange exists
    if (!resolvedExchange && exchangeName !== '') {
      throw channelError.notFound(
        `no exchange '${exchangeName}' in vhost '/'`,
        BASIC_CLASS_ID,
        BASIC_PUBLISH_METHOD_ID
      );
    }
    // Default exchange is always pre-declared by ExchangeRegistry
    const exchange = resolvedExchange as NonNullable<typeof resolvedExchange>;

    // 2. Check internal flag
    if (exchange.internal) {
      throw channelError.accessRefused(
        `cannot publish to internal exchange '${exchangeName}'`,
        BASIC_CLASS_ID,
        BASIC_PUBLISH_METHOD_ID
      );
    }

    // 3. Validate user-id
    if (
      properties.userId !== undefined &&
      authenticatedUserId !== undefined &&
      properties.userId !== authenticatedUserId
    ) {
      throw channelError.preconditionFailed(
        `user_id property set to '${properties.userId}' but authenticated user was '${authenticatedUserId}'`,
        BASIC_CLASS_ID,
        BASIC_PUBLISH_METHOD_ID
      );
    }

    // 4. Route via exchange type
    const targetQueues = new Set<string>();

    // 5. Process CC/BCC headers for additional routing keys
    const ccKeys = extractSenderSelectedKeys(properties.headers, 'CC');
    const bccKeys = extractSenderSelectedKeys(properties.headers, 'BCC');
    const allRoutingKeys = [routingKey, ...ccKeys, ...bccKeys];

    if (exchangeName === '') {
      for (const key of allRoutingKeys) {
        const queue = queueRegistry.getQueue(key);
        if (queue) {
          targetQueues.add(key);
        }
      }
    } else {
      const bindings = bindingStore.getBindings(exchangeName);
      for (const key of allRoutingKeys) {
        const matchedBindings = route(
          exchange,
          bindings,
          key,
          properties.headers
        );
        for (const binding of matchedBindings) {
          targetQueues.add(binding.queue);
        }
      }
    }

    // 6. Strip BCC header before enqueue
    const cleanProperties = stripBccHeader(properties);

    // 7. Enqueue message copy to each queue
    for (const queueName of targetQueues) {
      const store = getMessageStore(queueName);
      const message: BrokerMessage = {
        body: new Uint8Array(body),
        properties: { ...cleanProperties },
        exchange: exchangeName,
        routingKey,
        mandatory,
        immediate,
        deliveryCount: 0,
        enqueuedAt: Date.now(),
        priority: cleanProperties.priority ?? 0,
      };
      store.enqueue(message);
    }

    const routed = targetQueues.size > 0;

    // 8. Mandatory return if unroutable
    if (!routed && mandatory) {
      onReturn(
        312, // NO_ROUTE
        'NO_ROUTE',
        exchangeName,
        routingKey,
        body,
        properties
      );
    }

    // 9. Trigger consumer dispatch for each affected queue
    for (const queueName of targetQueues) {
      onDispatch(queueName);
    }

    // 10. Return result
    return { routed };
  });
}
