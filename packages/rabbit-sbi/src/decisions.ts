/**
 * SimDecision types for hook pre-phase and post-phase.
 *
 * Pre-hook decisions control whether the eng operation executes:
 * - proceed: execute normally (default when handler returns void)
 * - delay: wait N ms, then execute
 * - fail: throw the specified error
 * - short_circuit: skip eng, return the specified value
 *
 * Post-hook decisions control the result:
 * - transform: replace the result with a new value
 */

/** Execute the eng operation normally. */
export interface ProceedDecision {
  readonly action: 'proceed';
}

/** Wait delayMs, then execute the eng operation. */
export interface DelayDecision {
  readonly action: 'delay';
  readonly delayMs: number;
}

/** Throw the specified error instead of executing. */
export interface FailDecision {
  readonly action: 'fail';
  readonly error: Error;
}

/** Skip the eng operation and return the specified value. */
export interface ShortCircuitDecision<R = unknown> {
  readonly action: 'short_circuit';
  readonly value: R;
}

/** Pre-hook decision union. */
export type PreDecision<R = unknown> =
  | ProceedDecision
  | DelayDecision
  | FailDecision
  | ShortCircuitDecision<R>;

/** Replace the eng result with a new value. */
export interface TransformDecision<R = unknown> {
  readonly action: 'transform';
  readonly value: R;
}

/** Post-hook decision union. */
export type PostDecision<R = unknown> = TransformDecision<R>;

/** Factory functions for creating decisions. */
export const decide = {
  proceed(): ProceedDecision {
    return { action: 'proceed' };
  },
  delay(delayMs: number): DelayDecision {
    return { action: 'delay', delayMs };
  },
  fail(error: Error): FailDecision {
    return { action: 'fail', error };
  },
  shortCircuit<R>(value: R): ShortCircuitDecision<R> {
    return { action: 'short_circuit', value };
  },
  transform<R>(value: R): TransformDecision<R> {
    return { action: 'transform', value };
  },
} as const;
