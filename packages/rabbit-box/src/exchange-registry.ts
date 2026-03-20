import type { Exchange, ExchangeType } from './types/exchange.ts';
import type {
  Hook,
  ExchangeDeclareCtx,
  ExchangeDeclareResult,
  CheckExchangeCtx,
  CheckExchangeResult,
  ExchangeDeleteCtx,
  ExchangeDeleteResult,
} from '@rabbitbox/sbi';
import { channelError } from './errors/factories.ts';
import { runHooked } from './hook-runner.ts';

/** AMQP class/method IDs for exchange operations. */
const EXCHANGE_CLASS_ID = 40;
const EXCHANGE_DECLARE_METHOD_ID = 10;
const EXCHANGE_DELETE_METHOD_ID = 20;

/** Options for declaring an exchange. */
export interface DeclareExchangeOptions {
  readonly durable?: boolean;
  readonly autoDelete?: boolean;
  readonly internal?: boolean;
  readonly arguments?: Record<string, unknown>;
}

/** Names of pre-declared (built-in) exchanges that cannot be deleted or modified. */
const DEFAULT_EXCHANGE_DEFS: readonly { name: string; type: ExchangeType }[] = [
  { name: '', type: 'direct' },
  { name: 'amq.direct', type: 'direct' },
  { name: 'amq.fanout', type: 'fanout' },
  { name: 'amq.topic', type: 'topic' },
  { name: 'amq.headers', type: 'headers' },
  { name: 'amq.match', type: 'headers' },
];

const DEFAULT_EXCHANGE_NAMES = new Set(
  DEFAULT_EXCHANGE_DEFS.map((d) => d.name)
);

function isReservedPrefix(name: string): boolean {
  return name.startsWith('amq.');
}

/** Result of equivalence check: null if equivalent, or the mismatch details. */
interface EquivalenceMismatch {
  readonly field: string;
  readonly received: string;
  readonly current: string;
}

/**
 * Compares two exchanges for equivalence as RabbitMQ does on re-declare.
 *
 * RabbitMQ checks: type, durable, auto_delete, internal, arguments.
 * Returns null if equivalent, or the first mismatch found.
 * Field names and value formatting match real RabbitMQ error messages.
 */
function findMismatch(
  existing: Exchange,
  type: ExchangeType,
  opts: DeclareExchangeOptions
): EquivalenceMismatch | null {
  if (existing.type !== type) {
    return {
      field: 'type',
      received: `'${type}'`,
      current: `'${existing.type}'`,
    };
  }

  const durable = opts.durable ?? true;
  if (existing.durable !== durable) {
    return {
      field: 'durable',
      received: `'${durable}'`,
      current: `'${existing.durable}'`,
    };
  }

  const autoDelete = opts.autoDelete ?? false;
  if (existing.autoDelete !== autoDelete) {
    return {
      field: 'auto_delete',
      received: `'${autoDelete}'`,
      current: `'${existing.autoDelete}'`,
    };
  }

  const internal = opts.internal ?? false;
  if (existing.internal !== internal) {
    return {
      field: 'internal',
      received: `'${internal}'`,
      current: `'${existing.internal}'`,
    };
  }

  const newArgs = opts.arguments ?? {};
  const existingArgs = existing.arguments;
  const existingKeys = Object.keys(existingArgs);
  const newKeys = Object.keys(newArgs);
  if (existingKeys.length !== newKeys.length) {
    return {
      field: 'arguments',
      received: 'inequivalent arguments',
      current: 'current arguments',
    };
  }
  for (const key of existingKeys) {
    if (existingArgs[key] !== newArgs[key]) {
      return {
        field: 'arguments',
        received: 'inequivalent arguments',
        current: 'current arguments',
      };
    }
  }

  return null;
}

/**
 * Exchange registry — manages exchange lifecycle within a vhost.
 *
 * Pre-declares the six default RabbitMQ exchanges on construction.
 */
/** Optional hooks for exchange registry operations. */
export interface ExchangeRegistryHooks {
  readonly exchangeDeclare?: Hook<ExchangeDeclareCtx, ExchangeDeclareResult>;
  readonly checkExchange?: Hook<CheckExchangeCtx, CheckExchangeResult>;
  readonly exchangeDelete?: Hook<ExchangeDeleteCtx, ExchangeDeleteResult>;
}

export class ExchangeRegistry {
  private readonly exchanges = new Map<string, Exchange>();
  private readonly bindingCountFn:
    | ((exchangeName: string) => number)
    | undefined;
  private readonly hooks: ExchangeRegistryHooks;
  /** Tracks exchanges that have had at least one binding in their lifetime. */
  private readonly hasHadBindings = new Set<string>();

  constructor(options?: {
    bindingCount?: (exchangeName: string) => number;
    hooks?: ExchangeRegistryHooks;
  }) {
    this.bindingCountFn = options?.bindingCount;
    this.hooks = options?.hooks ?? {};
    this.initDefaults();
  }

  /** Declare an exchange (idempotent if equivalent). */
  declareExchange(
    name: string,
    type: ExchangeType,
    opts: DeclareExchangeOptions = {}
  ): Exchange {
    const ctx: ExchangeDeclareCtx = {
      name,
      type,
      durable: opts.durable ?? true,
      autoDelete: opts.autoDelete ?? false,
      internal: opts.internal ?? false,
      arguments: opts.arguments ?? {},
      meta: {
        alreadyExists: this.exchanges.has(name),
      },
    };

    runHooked(this.hooks.exchangeDeclare, ctx, () => {
      const existing = this.exchanges.get(name);

      if (existing) {
        const mismatch = findMismatch(existing, type, opts);
        if (!mismatch) {
          return { exchange: name };
        }

        throw channelError.preconditionFailed(
          `inequivalent arg '${mismatch.field}' for exchange '${name}' in vhost '/': received ${mismatch.received} but current is ${mismatch.current}`,
          EXCHANGE_CLASS_ID,
          EXCHANGE_DECLARE_METHOD_ID
        );
      }

      // New exchange with reserved prefix: ACCESS_REFUSED
      if (isReservedPrefix(name)) {
        throw channelError.accessRefused(
          `exchange name '${name}' contains reserved prefix 'amq.*'`,
          EXCHANGE_CLASS_ID,
          EXCHANGE_DECLARE_METHOD_ID
        );
      }

      const args = opts.arguments ?? {};
      const alternateExchange =
        typeof args['alternate-exchange'] === 'string'
          ? args['alternate-exchange']
          : undefined;

      const exchange: Exchange = {
        name,
        type,
        durable: opts.durable ?? true,
        autoDelete: opts.autoDelete ?? false,
        internal: opts.internal ?? false,
        arguments: args,
        alternateExchange,
      };

      this.exchanges.set(name, exchange);
      return { exchange: name };
    });

    // Return the exchange (may be existing or newly created)
    return this.exchanges.get(name) as Exchange;
  }

  /**
   * Delete an exchange.
   *
   * @param ifUnused - If true, only delete if the exchange has no bindings.
   */
  deleteExchange(name: string, ifUnused = false): void {
    const bindingCount = this.bindingCountFn ? this.bindingCountFn(name) : 0;
    const ctx: ExchangeDeleteCtx = {
      name,
      ifUnused,
      meta: {
        exists: this.exchanges.has(name),
        hasBindings: bindingCount > 0,
      },
    };

    runHooked(this.hooks.exchangeDelete, ctx, () => {
      if (DEFAULT_EXCHANGE_NAMES.has(name)) {
        throw channelError.accessRefused(
          `cannot delete exchange '${name}': it is a pre-declared exchange`,
          EXCHANGE_CLASS_ID,
          EXCHANGE_DELETE_METHOD_ID
        );
      }

      const existing = this.exchanges.get(name);

      // RabbitMQ (since 3.0) silently returns delete-ok for non-existent exchanges,
      // deviating from the AMQP 0-9-1 spec which requires NOT_FOUND.
      if (!existing) {
        return undefined;
      }

      if (ifUnused) {
        const count = this.bindingCountFn ? this.bindingCountFn(name) : 0;
        if (count > 0) {
          throw channelError.preconditionFailed(
            `exchange '${name}' has ${count} binding(s)`,
            EXCHANGE_CLASS_ID,
            EXCHANGE_DELETE_METHOD_ID
          );
        }
      }

      this.exchanges.delete(name);
      this.hasHadBindings.delete(name);
      return undefined;
    });
  }

  /**
   * Passive declare — checks that the exchange exists without modifying state.
   *
   * Throws NOT_FOUND channel error if the exchange does not exist.
   */
  checkExchange(name: string): Exchange {
    const ctx: CheckExchangeCtx = {
      name,
      meta: {
        exists: this.exchanges.has(name),
      },
    };

    runHooked(this.hooks.checkExchange, ctx, () => {
      const existing = this.exchanges.get(name);
      if (!existing) {
        throw channelError.notFound(
          `no exchange '${name}' in vhost '/'`,
          EXCHANGE_CLASS_ID,
          EXCHANGE_DECLARE_METHOD_ID
        );
      }
      return undefined;
    });

    return this.exchanges.get(name) as Exchange;
  }

  /** Get an exchange by name, or undefined if not found. */
  getExchange(name: string): Exchange | undefined {
    return this.exchanges.get(name);
  }

  /** Check whether an exchange exists. */
  hasExchange(name: string): boolean {
    return this.exchanges.has(name);
  }

  /** Get all exchange names. */
  exchangeNames(): string[] {
    return [...this.exchanges.keys()];
  }

  /** Mark an exchange as having had at least one binding. */
  markHasHadBindings(name: string): void {
    this.hasHadBindings.add(name);
  }

  /**
   * Check if an exchange is ready for auto-deletion.
   *
   * Returns true when the exchange has autoDelete=true, has had at least one
   * binding in its lifetime, and currently has zero bindings.
   */
  isAutoDeleteReady(name: string): boolean {
    const exchange = this.exchanges.get(name);
    if (!exchange) return false;
    if (!exchange.autoDelete) return false;
    if (!this.hasHadBindings.has(name)) return false;
    const count = this.bindingCountFn ? this.bindingCountFn(name) : 0;
    return count === 0;
  }

  private initDefaults(): void {
    for (const def of DEFAULT_EXCHANGE_DEFS) {
      const exchange: Exchange = {
        name: def.name,
        type: def.type,
        durable: true,
        autoDelete: false,
        internal: false,
        arguments: {},
      };
      this.exchanges.set(def.name, exchange);
    }
  }
}
