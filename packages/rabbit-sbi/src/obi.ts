/**
 * OBI (Outbound Box Interface) hook type definitions.
 *
 * OBI hooks wrap every external dependency the engine calls out to:
 * time, timers, random, delivery, return, persist.
 *
 * Default implementations reproduce real behavior.
 * A Sim can replace any hook to inject virtual behavior
 * (virtual time, deterministic random, etc.).
 */

/** Time provider — all timestamp sources in the engine. */
export interface ObiTime {
  /** Returns current time in milliseconds since epoch. */
  now(): number;
}

/** Timer provider — scheduling deferred operations (TTL expiry, queue expiry, heartbeat). */
export interface ObiTimers {
  /** Schedule a callback after `ms` milliseconds. Returns an opaque handle. */
  setTimeout(callback: () => void, ms: number): unknown;
  /** Cancel a previously scheduled timer. */
  clearTimeout(handle: unknown): void;
}

/** Random provider — unique ID generation (queue names, message IDs). */
export interface ObiRandom {
  /** Generate a UUID string. */
  uuid(): string;
}

/** Delivery provider — consumer message dispatch scheduling. */
export interface ObiDelivery {
  /** Schedule asynchronous delivery of a consumer callback. */
  schedule(callback: () => void): void;
}

/** Context passed to the return hook for Sim decision-making. */
export interface ReturnContext {
  readonly replyCode: number;
  readonly replyText: string;
  readonly exchange: string;
  readonly routingKey: string;
}

/** Return provider — mandatory message return notification. */
export interface ObiReturn {
  /**
   * Emit a basic.return notification.
   *
   * @param ctx - Return context with routing details for Sim inspection.
   * @param next - Default behavior (calls the channel return handler).
   *               Call next() to proceed, or skip it to suppress the return.
   */
  notify(ctx: ReturnContext, next: () => void): void;
}

/** Persist provider — durable storage (no-op for in-memory engine). */
export interface ObiPersist {
  /** Save data under a key. */
  save(key: string, data: Uint8Array): void;
  /** Load data by key, returns null if not found. */
  load(key: string): Uint8Array | null;
}

/** Complete set of outbound hooks. */
export interface ObiHooks {
  readonly time: ObiTime;
  readonly timers: ObiTimers;
  readonly random: ObiRandom;
  readonly delivery: ObiDelivery;
  readonly return: ObiReturn;
  readonly persist: ObiPersist;
}
