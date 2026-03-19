import { describe, expect, it, vi } from 'vitest';
import { runHooked } from './hook-runner.ts';
import type { Hook } from '@rabbitbox/sbi';

interface TestCtx {
  readonly value: number;
}

interface TestResult {
  readonly sum: number;
}

function makeEng(result: TestResult) {
  return vi.fn(() => result);
}

describe('runHooked', () => {
  // ── No-hook fast path ───────────────────────────────────────────

  describe('no-hook fast path', () => {
    it('calls engFn directly when hook is undefined', () => {
      const eng = makeEng({ sum: 42 });
      const result = runHooked(undefined, { value: 1 }, eng);

      expect(result).toEqual({ sum: 42 });
      expect(eng).toHaveBeenCalledOnce();
    });

    it('calls engFn directly when hook has no pre or post', () => {
      const hook: Hook<TestCtx, TestResult> = {};
      const eng = makeEng({ sum: 42 });
      const result = runHooked(hook, { value: 1 }, eng);

      expect(result).toEqual({ sum: 42 });
      expect(eng).toHaveBeenCalledOnce();
    });
  });

  // ── Pre-hook: proceed ───────────────────────────────────────────

  describe('pre-hook proceed', () => {
    it('executes engFn when pre returns undefined', () => {
      const hook: Hook<TestCtx, TestResult> = {
        pre: vi.fn(() => undefined),
      };
      const eng = makeEng({ sum: 10 });
      const result = runHooked(hook, { value: 5 }, eng);

      expect(result).toEqual({ sum: 10 });
      expect(eng).toHaveBeenCalledOnce();
      expect(hook.pre).toHaveBeenCalledWith({ value: 5 });
    });

    it('executes engFn when pre returns proceed decision', () => {
      const hook: Hook<TestCtx, TestResult> = {
        pre: () => ({ type: 'proceed' as const }),
      };
      const eng = makeEng({ sum: 10 });
      const result = runHooked(hook, { value: 5 }, eng);

      expect(result).toEqual({ sum: 10 });
      expect(eng).toHaveBeenCalledOnce();
    });
  });

  // ── Pre-hook: fail ──────────────────────────────────────────────

  describe('pre-hook fail', () => {
    it('throws the specified error without calling engFn', () => {
      const error = new Error('simulated failure');
      const hook: Hook<TestCtx, TestResult> = {
        pre: () => ({ type: 'fail' as const, error }),
      };
      const eng = makeEng({ sum: 10 });

      expect(() => runHooked(hook, { value: 5 }, eng)).toThrow(
        'simulated failure'
      );
      expect(eng).not.toHaveBeenCalled();
    });
  });

  // ── Pre-hook: short_circuit ─────────────────────────────────────

  describe('pre-hook short_circuit', () => {
    it('returns specified value without calling engFn', () => {
      const hook: Hook<TestCtx, TestResult> = {
        pre: () => ({
          type: 'short_circuit' as const,
          result: { sum: 999 },
        }),
      };
      const eng = makeEng({ sum: 10 });
      const result = runHooked(hook, { value: 5 }, eng);

      expect(result).toEqual({ sum: 999 });
      expect(eng).not.toHaveBeenCalled();
    });

    it('applies post-hook to short_circuit value', () => {
      const hook: Hook<TestCtx, TestResult> = {
        pre: () => ({
          type: 'short_circuit' as const,
          result: { sum: 100 },
        }),
        post: (_ctx, result) => ({ sum: result.sum + 1 }),
      };
      const eng = makeEng({ sum: 10 });
      const result = runHooked(hook, { value: 5 }, eng);

      expect(result).toEqual({ sum: 101 });
      expect(eng).not.toHaveBeenCalled();
    });
  });

  // ── Pre-hook: delay ─────────────────────────────────────────────

  describe('pre-hook delay', () => {
    it('still executes engFn (delay is a hint in sync mode)', () => {
      const hook: Hook<TestCtx, TestResult> = {
        pre: () => ({ type: 'delay' as const, ms: 1000 }),
      };
      const eng = makeEng({ sum: 10 });
      const result = runHooked(hook, { value: 5 }, eng);

      expect(result).toEqual({ sum: 10 });
      expect(eng).toHaveBeenCalledOnce();
    });
  });

  // ── Post-hook: transform ────────────────────────────────────────

  describe('post-hook transform', () => {
    it('replaces result with transformed value', () => {
      const hook: Hook<TestCtx, TestResult> = {
        post: (_ctx, result) => ({ sum: result.sum * 2 }),
      };
      const eng = makeEng({ sum: 21 });
      const result = runHooked(hook, { value: 5 }, eng);

      expect(result).toEqual({ sum: 42 });
      expect(eng).toHaveBeenCalledOnce();
    });

    it('returns result unchanged when post returns undefined', () => {
      const hook: Hook<TestCtx, TestResult> = {
        post: vi.fn(() => undefined),
      };
      const eng = makeEng({ sum: 10 });
      const result = runHooked(hook, { value: 5 }, eng);

      expect(result).toEqual({ sum: 10 });
      expect(hook.post).toHaveBeenCalledWith({ value: 5 }, { sum: 10 });
    });
  });

  // ── Pre + post combined ─────────────────────────────────────────

  describe('pre + post combined', () => {
    it('calls pre, then engFn, then post', () => {
      const order: string[] = [];
      const hook: Hook<TestCtx, TestResult> = {
        pre: () => {
          order.push('pre');
          return undefined;
        },
        post: (_ctx, result) => {
          order.push('post');
          return { sum: result.sum + 1 };
        },
      };
      const eng = vi.fn(() => {
        order.push('eng');
        return { sum: 10 };
      });

      const result = runHooked(hook, { value: 5 }, eng);

      expect(order).toEqual(['pre', 'eng', 'post']);
      expect(result).toEqual({ sum: 11 });
    });
  });

  // ── Hook errors don't corrupt state ─────────────────────────────

  describe('error propagation', () => {
    it('propagates pre-hook errors cleanly', () => {
      const hook: Hook<TestCtx, TestResult> = {
        pre: () => {
          throw new Error('pre-hook bug');
        },
      };
      const eng = makeEng({ sum: 10 });

      expect(() => runHooked(hook, { value: 5 }, eng)).toThrow('pre-hook bug');
      expect(eng).not.toHaveBeenCalled();
    });

    it('propagates post-hook errors cleanly', () => {
      const hook: Hook<TestCtx, TestResult> = {
        post: () => {
          throw new Error('post-hook bug');
        },
      };
      const eng = makeEng({ sum: 10 });

      expect(() => runHooked(hook, { value: 5 }, eng)).toThrow('post-hook bug');
      expect(eng).toHaveBeenCalledOnce();
    });

    it('propagates engFn errors even with hooks', () => {
      const hook: Hook<TestCtx, TestResult> = {
        pre: vi.fn(() => undefined),
        post: vi.fn(() => undefined),
      };
      const eng = vi.fn(() => {
        throw new Error('eng failure');
      });

      expect(() => runHooked(hook, { value: 5 }, eng)).toThrow('eng failure');
      expect(hook.pre).toHaveBeenCalledOnce();
      expect(hook.post).not.toHaveBeenCalled();
    });
  });
});
