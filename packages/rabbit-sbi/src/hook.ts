import type { SimDecision } from './sim-decision.ts';

/**
 * Pre-hook handler: runs before the engine operation.
 *
 * Returns a SimDecision to override execution, or undefined to proceed normally.
 */
export type PreHandler<Ctx, Result> = (
  ctx: Ctx
) => SimDecision<Result> | undefined;

/**
 * Post-hook handler: runs after the engine operation completes.
 *
 * Returns a transformed result, or undefined to keep the original result.
 */
export type PostHandler<Ctx, Result> = (
  ctx: Ctx,
  result: Result
) => Result | undefined;

/**
 * SBI hook with optional pre and post handler phases.
 *
 * Each hook point wraps an engine operation:
 *   pre → engine execution → post → final result
 */
export interface Hook<Ctx, Result> {
  readonly pre?: PreHandler<Ctx, Result>;
  readonly post?: PostHandler<Ctx, Result>;
}
