import type { Binding } from './types/binding.ts';
import { channelError } from './errors/factories.ts';

/** AMQP class/method IDs for queue.bind / queue.unbind. */
const QUEUE_CLASS_ID = 50;
const QUEUE_BIND_METHOD_ID = 20;

/** Options for constructing a BindingStore. */
export interface BindingStoreOptions {
  /** Returns true if the named exchange exists. */
  readonly hasExchange?: (name: string) => boolean;
  /** Returns true if the named queue exists. */
  readonly hasQueue?: (name: string) => boolean;
}

/**
 * Deep-equality comparison for binding arguments tables.
 */
function argsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
    }
  }
  return true;
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
  private readonly hasExchangeFn:
    | ((name: string) => boolean)
    | undefined;
  private readonly hasQueueFn:
    | ((name: string) => boolean)
    | undefined;

  constructor(options?: BindingStoreOptions) {
    this.hasExchangeFn = options?.hasExchange;
    this.hasQueueFn = options?.hasQueue;
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
    args: Record<string, unknown>,
  ): void {
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
  }

  /**
   * Remove a binding. Idempotent — no error if binding doesn't exist.
   * Matches by deep equality on (exchange, queue, routingKey, arguments).
   */
  removeBinding(
    exchange: string,
    queue: string,
    routingKey: string,
    args: Record<string, unknown>,
  ): void {
    const list = this.byExchange.get(exchange);
    if (!list) return;

    const target: Binding = { exchange, queue, routingKey, arguments: args };
    const idx = list.findIndex((b) => bindingsMatch(b, target));
    if (idx === -1) return;

    list.splice(idx, 1);
    if (list.length === 0) {
      this.byExchange.delete(exchange);
    }
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
