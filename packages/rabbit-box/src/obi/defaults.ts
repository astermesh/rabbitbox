import type {
  ObiTime,
  ObiTimers,
  ObiRandom,
  ObiDelivery,
  ObiReturn,
  ObiPersist,
  ObiHooks,
} from './types.ts';

/** Default time: delegates to Date.now(). */
export function createDefaultTime(): ObiTime {
  return { now: () => Date.now() };
}

/** Default timers: delegates to globalThis.setTimeout / clearTimeout. */
export function createDefaultTimers(): ObiTimers {
  return {
    setTimeout: (callback: () => void, ms: number): unknown =>
      globalThis.setTimeout(callback, ms),
    clearTimeout: (handle: unknown): void => {
      globalThis.clearTimeout(
        handle as ReturnType<typeof globalThis.setTimeout>
      );
    },
  };
}

/** Default random: delegates to crypto.randomUUID(). */
export function createDefaultRandom(): ObiRandom {
  return {
    uuid: () => globalThis.crypto.randomUUID(),
  };
}

/** Default delivery: delegates to queueMicrotask(). */
export function createDefaultDelivery(): ObiDelivery {
  return {
    schedule: (callback: () => void): void => {
      queueMicrotask(callback);
    },
  };
}

/** Default return: pass-through (calls next). */
export function createDefaultReturn(): ObiReturn {
  return {
    notify: (_ctx, next) => {
      next();
    },
  };
}

/** Default persist: no-op for in-memory engine. */
export function createDefaultPersist(): ObiPersist {
  return {
    save: () => {
      // no-op: in-memory engine does not persist
    },
    load: () => null,
  };
}

/** Create a complete ObiHooks set with all default implementations. */
export function createDefaultObiHooks(): ObiHooks {
  return {
    time: createDefaultTime(),
    timers: createDefaultTimers(),
    random: createDefaultRandom(),
    delivery: createDefaultDelivery(),
    return: createDefaultReturn(),
    persist: createDefaultPersist(),
  };
}
