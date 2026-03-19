import type { Binding } from './types/binding.ts';
import type {
  Hook,
  QueueBindCtx,
  QueueBindResult,
  QueueUnbindCtx,
  QueueUnbindResult,
  ExchangeBindCtx,
  ExchangeBindResult,
  ExchangeUnbindCtx,
  ExchangeUnbindResult,
} from '@rabbitbox/sbi';
import { channelError } from './errors/factories.ts';
import { runHooked } from './hook-runner.ts';

/** AMQP class/method IDs for queue.bind / queue.unbind. */
const QUEUE_CLASS_ID = 50;
const QUEUE_BIND_METHOD_ID = 20;
const QUEUE_UNBIND_METHOD_ID = 50;

/** Optional hooks for binding operations. */
export interface BindingStoreHooks {
  readonly queueBind?: Hook<QueueBindCtx, QueueBindResult>;
  readonly queueUnbind?: Hook<QueueUnbindCtx, QueueUnbindResult>;
  readonly exchangeBind?: Hook<ExchangeBindCtx, ExchangeBindResult>;
  readonly exchangeUnbind?: Hook<ExchangeUnbindCtx, ExchangeUnbindResult>;
}

/** Options for constructing a BindingStore. */
export interface BindingStoreOptions {
  /** Returns true if the named exchange exists. */
  readonly hasExchange?: (name: string) => boolean;
  /** Returns true if the named queue exists. */
  readonly hasQueue?: (name: string) => boolean;
  /** Optional hooks for SBI integration. */
  readonly hooks?: BindingStoreHooks;
}

/**
 * Recursive deep-equality comparison for AMQP field-table values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
  }
  if (Array.isArray(b)) return false;

  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keysA = Object.keys(ra);
  const keysB = Object.keys(rb);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(rb, k) && deepEqual(ra[k], rb[k])
  );
}

/**
 * Deep-equality comparison for binding arguments tables.
 */
function argsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  return deepEqual(a, b);
}

/**
 * Checks whether two bindings have the same identity.
 * Binding identity: (exchange, queue, routingKey, arguments) tuple.
 */
function bindingsMatch(a: Binding, b: Binding): boolean {
  return (
    a.exchange === b.exchange &&
    a.queue === b.queue &&
    a.routingKey === b.routingKey &&
    argsEqual(a.arguments, b.arguments)
  );
}

/**
 * Binding store — manages queue-to-exchange bindings.
 *
 * Implicit bindings on the default exchange (every queue bound with
 * routingKey = queue name) are virtual and NOT stored here.
 */
export class BindingStore {
  /** Bindings indexed by exchange name. */
  private readonly byExchange = new Map<string, Binding[]>();
  private readonly hasExchangeFn: ((name: string) => boolean) | undefined;
  private readonly hasQueueFn: ((name: string) => boolean) | undefined;
  private readonly hooks: BindingStoreHooks;

  constructor(options?: BindingStoreOptions) {
    this.hasExchangeFn = options?.hasExchange;
    this.hasQueueFn = options?.hasQueue;
    this.hooks = options?.hooks ?? {};
  }

  /**
   * Add a binding. Idempotent — duplicate binding is a no-op.
   * Binding identity is (exchange, queue, routingKey, arguments) with
   * arguments compared by deep equality.
   *
   * Validates that both exchange and queue exist (NOT_FOUND if missing).
   */
  addBinding(
    exchange: string,
    queue: string,
    routingKey: string,
    args: Record<string, unknown>
  ): void {
    const ctx: QueueBindCtx = {
      queue,
      exchange,
      routingKey,
      arguments: args,
      meta: {
        queueExists: this.hasQueueFn ? this.hasQueueFn(queue) : true,
        exchangeExists: this.hasExchangeFn
          ? this.hasExchangeFn(exchange)
          : true,
      },
    };

    runHooked(this.hooks.queueBind, ctx, () => {
      if (this.hasExchangeFn && !this.hasExchangeFn(exchange)) {
        throw channelError.notFound(
          `no exchange '${exchange}' in vhost '/'`,
          QUEUE_CLASS_ID,
          QUEUE_BIND_METHOD_ID
        );
      }
      if (this.hasQueueFn && !this.hasQueueFn(queue)) {
        throw channelError.notFound(
          `no queue '${queue}' in vhost '/'`,
          QUEUE_CLASS_ID,
          QUEUE_BIND_METHOD_ID
        );
      }

      const binding: Binding = {
        exchange,
        queue,
        routingKey,
        arguments: { ...args },
      };

      let list = this.byExchange.get(exchange);
      if (!list) {
        list = [];
        this.byExchange.set(exchange, list);
      }

      // Idempotent: check for duplicate
      const duplicate = list.some((b) => bindingsMatch(b, binding));
      if (duplicate) return;

      list.push(binding);
    });
  }

  /**
   * Remove a binding. Idempotent — no error if binding doesn't exist.
   * Matches by deep equality on (exchange, queue, routingKey, arguments).
   *
   * Validates that both exchange and queue exist (NOT_FOUND if missing),
   * matching real RabbitMQ queue.unbind behavior.
   */
  removeBinding(
    exchange: string,
    queue: string,
    routingKey: string,
    args: Record<string, unknown>
  ): void {
    const ctx: QueueUnbindCtx = {
      queue,
      exchange,
      routingKey,
      arguments: args,
      meta: {
        queueExists: this.hasQueueFn ? this.hasQueueFn(queue) : true,
        exchangeExists: this.hasExchangeFn
          ? this.hasExchangeFn(exchange)
          : true,
      },
    };

    runHooked(this.hooks.queueUnbind, ctx, () => {
      if (this.hasExchangeFn && !this.hasExchangeFn(exchange)) {
        throw channelError.notFound(
          `no exchange '${exchange}' in vhost '/'`,
          QUEUE_CLASS_ID,
          QUEUE_UNBIND_METHOD_ID
        );
      }
      if (this.hasQueueFn && !this.hasQueueFn(queue)) {
        throw channelError.notFound(
          `no queue '${queue}' in vhost '/'`,
          QUEUE_CLASS_ID,
          QUEUE_UNBIND_METHOD_ID
        );
      }

      const list = this.byExchange.get(exchange);
      if (!list) return;

      const target: Binding = { exchange, queue, routingKey, arguments: args };
      const idx = list.findIndex((b) => bindingsMatch(b, target));
      if (idx === -1) return;

      list.splice(idx, 1);
      if (list.length === 0) {
        this.byExchange.delete(exchange);
      }
    });
  }

  /**
   * Add an exchange-to-exchange binding (exchange.bind).
   * Same mechanics as queue binding but both endpoints are exchanges.
   */
  addExchangeBinding(
    destination: string,
    source: string,
    routingKey: string,
    args: Record<string, unknown>
  ): void {
    const ctx: ExchangeBindCtx = {
      destination,
      source,
      routingKey,
      arguments: args,
      meta: {
        destinationExists: this.hasExchangeFn
          ? this.hasExchangeFn(destination)
          : true,
        sourceExists: this.hasExchangeFn ? this.hasExchangeFn(source) : true,
      },
    };

    runHooked(this.hooks.exchangeBind, ctx, () => {
      if (this.hasExchangeFn && !this.hasExchangeFn(source)) {
        throw channelError.notFound(
          `no exchange '${source}' in vhost '/'`,
          QUEUE_CLASS_ID,
          QUEUE_BIND_METHOD_ID
        );
      }
      if (this.hasExchangeFn && !this.hasExchangeFn(destination)) {
        throw channelError.notFound(
          `no exchange '${destination}' in vhost '/'`,
          QUEUE_CLASS_ID,
          QUEUE_BIND_METHOD_ID
        );
      }

      const binding: Binding = {
        exchange: source,
        queue: destination, // reuse Binding shape; "queue" field holds destination exchange
        routingKey,
        arguments: { ...args },
      };

      let list = this.byExchange.get(source);
      if (!list) {
        list = [];
        this.byExchange.set(source, list);
      }

      const duplicate = list.some((b) => bindingsMatch(b, binding));
      if (duplicate) return;

      list.push(binding);
    });
  }

  /**
   * Remove an exchange-to-exchange binding (exchange.unbind).
   */
  removeExchangeBinding(
    destination: string,
    source: string,
    routingKey: string,
    args: Record<string, unknown>
  ): void {
    const ctx: ExchangeUnbindCtx = {
      destination,
      source,
      routingKey,
      arguments: args,
      meta: {
        destinationExists: this.hasExchangeFn
          ? this.hasExchangeFn(destination)
          : true,
        sourceExists: this.hasExchangeFn ? this.hasExchangeFn(source) : true,
      },
    };

    runHooked(this.hooks.exchangeUnbind, ctx, () => {
      if (this.hasExchangeFn && !this.hasExchangeFn(source)) {
        throw channelError.notFound(
          `no exchange '${source}' in vhost '/'`,
          QUEUE_CLASS_ID,
          QUEUE_UNBIND_METHOD_ID
        );
      }
      if (this.hasExchangeFn && !this.hasExchangeFn(destination)) {
        throw channelError.notFound(
          `no exchange '${destination}' in vhost '/'`,
          QUEUE_CLASS_ID,
          QUEUE_UNBIND_METHOD_ID
        );
      }

      const list = this.byExchange.get(source);
      if (!list) return;

      const target: Binding = {
        exchange: source,
        queue: destination,
        routingKey,
        arguments: args,
      };
      const idx = list.findIndex((b) => bindingsMatch(b, target));
      if (idx === -1) return;

      list.splice(idx, 1);
      if (list.length === 0) {
        this.byExchange.delete(source);
      }
    });
  }

  /** Return all bindings for an exchange (defensive copy). */
  getBindings(exchange: string): Binding[] {
    const list = this.byExchange.get(exchange);
    return list ? [...list] : [];
  }

  /** Return all bindings for a queue across all exchanges. */
  getBindingsForQueue(queue: string): Binding[] {
    const result: Binding[] = [];
    for (const list of this.byExchange.values()) {
      for (const binding of list) {
        if (binding.queue === queue) {
          result.push(binding);
        }
      }
    }
    return result;
  }

  /** Remove all bindings for a queue (cleanup on queue delete). */
  removeBindingsForQueue(queue: string): void {
    for (const [exchange, list] of this.byExchange) {
      const filtered = list.filter((b) => b.queue !== queue);
      if (filtered.length === 0) {
        this.byExchange.delete(exchange);
      } else {
        this.byExchange.set(exchange, filtered);
      }
    }
  }

  /** Remove all bindings for an exchange (cleanup on exchange delete). */
  removeBindingsForExchange(exchange: string): void {
    this.byExchange.delete(exchange);
  }

  /** Return the number of bindings for an exchange. */
  bindingCount(exchange: string): number {
    return this.byExchange.get(exchange)?.length ?? 0;
  }
}
