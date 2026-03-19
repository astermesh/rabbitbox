import type { Hook, SimDecision } from '@rabbitbox/sbi';

/**
 * Run an eng operation through a hook's pre/post phases.
 *
 * Pre-hook decisions (SimDecision):
 * - undefined / proceed: execute eng normally
 * - delay: wait N ms, then execute
 * - fail: throw specified error
 * - short_circuit: skip eng, return specified value
 * - transform: execute eng, then replace result
 *
 * Post-hook returns:
 * - undefined: return result unchanged
 * - Result: replace result with returned value
 *
 * No-hook fast path: if hook is undefined, calls engFn directly with zero overhead.
 */
export function runHooked<Ctx, R>(
  hook: Hook<Ctx, R> | undefined,
  ctx: Ctx,
  engFn: () => R
): R {
  // Fast path: no hook registered
  if (!hook) {
    return engFn();
  }

  // Pre-phase
  let result: R;
  if (hook.pre) {
    const decision = hook.pre(ctx) as SimDecision<R> | undefined;
    if (decision) {
      switch (decision.type) {
        case 'fail':
          throw decision.error;
        case 'short_circuit':
          result = decision.result;
          return applyPost(hook, ctx, result);
        case 'delay':
          // In synchronous mode, delay is a no-op hint.
          // Actual delay would be handled by an async variant.
          result = engFn();
          return applyPost(hook, ctx, result);
        case 'proceed':
          break;
        case 'transform':
          // transform in pre-phase: execute eng, then override result
          result = engFn();
          return applyPost(hook, ctx, decision.result);
      }
    }
  }

  result = engFn();
  return applyPost(hook, ctx, result);
}

function applyPost<Ctx, R>(hook: Hook<Ctx, R>, ctx: Ctx, result: R): R {
  if (!hook.post) return result;

  const transformed = hook.post(ctx, result);
  if (transformed !== undefined) {
    return transformed;
  }
  return result;
}
