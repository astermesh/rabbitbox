/**
 * OBI (Outbound Box Interface) — engine-internal dependency injection interfaces.
 *
 * These interfaces wrap every external dependency the engine calls out to.
 * Default implementations reproduce real behavior. A Sim replaces them
 * to inject virtual behavior (virtual time, deterministic random, etc.).
 *
 * Note: These are distinct from the SBI Hook<Ctx, Result> types in @rabbitbox/sbi
 * which define the Sim-facing interception points. OBI interfaces are the actual
 * implementations that the hooks wrap.
 */

/** Time provider — all timestamp sources in the engine. */
export interface ObiTime {
  /** Returns current time in milliseconds since epoch. */
  now(): number;
}

/** Timer provider — scheduling deferred operations. */
export interface ObiTimers {
  /** Schedule a callback after `ms` milliseconds. Returns an opaque handle. */
  setTimeout(callback: () => void, ms: number): unknown;
  /** Cancel a previously scheduled timer. */
  clearTimeout(handle: unknown): void;
}

/** Random provider — unique ID generation. */
export interface ObiRandom {
  /** Generate a UUID string. */
  uuid(): string;
}

/** Delivery provider — consumer message dispatch scheduling. */
export interface ObiDelivery {
  /** Schedule asynchronous delivery of a consumer callback. */
  schedule(callback: () => void): void;
}

/** Context passed to the return hook. */
export interface ReturnContext {
  readonly replyCode: number;
  readonly replyText: string;
  readonly exchange: string;
  readonly routingKey: string;
}

/** Return provider — mandatory message return notification. */
export interface ObiReturn {
  /** Emit a basic.return notification. Call next() to proceed. */
  notify(ctx: ReturnContext, next: () => void): void;
}

/** Persist provider — durable storage (no-op for in-memory engine). */
export interface ObiPersist {
  /** Save data under a key. */
  save(key: string, data: Uint8Array): void;
  /** Load data by key, returns null if not found. */
  load(key: string): Uint8Array | null;
}

/** Complete set of outbound dependency injection hooks. */
export interface ObiHooks {
  readonly time: ObiTime;
  readonly timers: ObiTimers;
  readonly random: ObiRandom;
  readonly delivery: ObiDelivery;
  readonly return: ObiReturn;
  readonly persist: ObiPersist;
}
