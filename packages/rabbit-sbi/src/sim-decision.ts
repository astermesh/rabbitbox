/**
 * Decisions a pre-hook handler can return to control execution flow.
 *
 * When a pre-hook returns void (or undefined), the engine proceeds normally.
 * Returning a SimDecision overrides the default behavior.
 */
export type SimDecision<Result = unknown> =
  | ProceedDecision
  | DelayDecision
  | FailDecision
  | ShortCircuitDecision<Result>
  | TransformDecision<Result>;

/** Continue with normal execution (explicit no-op). */
export interface ProceedDecision {
  readonly type: 'proceed';
}

/** Add latency before engine execution. */
export interface DelayDecision {
  readonly type: 'delay';
  readonly ms: number;
}

/** Reject the operation with an error, skip engine execution. */
export interface FailDecision {
  readonly type: 'fail';
  readonly error: Error;
}

/** Skip engine execution entirely and return a predefined result. */
export interface ShortCircuitDecision<Result = unknown> {
  readonly type: 'short_circuit';
  readonly result: Result;
}

/** Transform the result before returning it to the caller. */
export interface TransformDecision<Result = unknown> {
  readonly type: 'transform';
  readonly result: Result;
}
