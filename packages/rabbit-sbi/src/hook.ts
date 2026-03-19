import type { PreDecision, PostDecision } from './decisions.ts';

/**
 * Pre-hook handler: receives context, returns a decision or void (= proceed).
 */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
export type PreHook<Ctx, R> = (ctx: Ctx) => PreDecision<R> | void;

/**
 * Post-hook handler: receives context + result, returns a decision or void (= pass-through).
 */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
export type PostHook<Ctx, R> = (ctx: Ctx, result: R) => PostDecision<R> | void;

/**
 * A hook with optional pre and post phases.
 */
export interface Hook<Ctx, R> {
  readonly pre?: PreHook<Ctx, R>;
  readonly post?: PostHook<Ctx, R>;
}
