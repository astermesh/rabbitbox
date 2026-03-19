import type { Hook, PreDecision } from '@rabbitbox/sbi';

/**
 * Run an eng operation through a hook's pre/post phases.
 *
 * Pre-hook decisions:
 * - void / proceed: execute eng normally
 * - delay: wait N ms, then execute
 * - fail: throw specified error
 * - short_circuit: skip eng, return specified value
 *
 * Post-hook decisions:
 * - void: return result unchanged
 * - transform: replace result with new value
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
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    const decision = hook.pre(ctx) as PreDecision<R> | void;
    if (decision) {
      switch (decision.action) {
        case 'fail':
          throw decision.error;
        case 'short_circuit':
          result = decision.value;
          return applyPost(hook, ctx, result);
        case 'delay':
          // In synchronous mode, delay is a no-op hint.
          // Actual delay would be handled by an async variant.
          result = engFn();
          return applyPost(hook, ctx, result);
        case 'proceed':
          break;
      }
    }
  }

  result = engFn();
  return applyPost(hook, ctx, result);
}

function applyPost<Ctx, R>(hook: Hook<Ctx, R>, ctx: Ctx, result: R): R {
  if (!hook.post) return result;

  const postDecision = hook.post(ctx, result);
  if (postDecision && postDecision.action === 'transform') {
    return postDecision.value;
  }
  return result;
}
