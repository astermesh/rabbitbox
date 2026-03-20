import { describe, expect, it, vi } from 'vitest';
import { QueueExpiry } from './queue-expiry.ts';
import type { ObiTimers } from './obi/types.ts';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

function createFakeTimers(): ObiTimers & {
  fire: (handle: unknown) => void;
  pending: Map<unknown, { callback: () => void; ms: number }>;
} {
  let nextHandle = 1;
  const pending = new Map<unknown, { callback: () => void; ms: number }>();

  return {
    pending,
    setTimeout(callback: () => void, ms: number): unknown {
      const handle = nextHandle++;
      pending.set(handle, { callback, ms });
      return handle;
    },
    clearTimeout(handle: unknown): void {
      pending.delete(handle);
    },
    fire(handle: unknown): void {
      const entry = pending.get(handle);
      if (entry) {
        pending.delete(handle);
        entry.callback();
      }
    },
  };
}

function firstKey(map: Map<unknown, unknown>): unknown {
  const key = [...map.keys()][0];
  expect(key).toBeDefined();
  return key;
}

function firstEntry(
  map: Map<unknown, { callback: () => void; ms: number }>
): [unknown, { callback: () => void; ms: number }] {
  const entry = [...map.entries()][0];
  expect(entry).toBeDefined();
  return entry as [unknown, { callback: () => void; ms: number }];
}

// ── Validation ────────────────────────────────────────────────────────

describe('queue expiry validation', () => {
  it('rejects x-expires = 0', () => {
    const timers = createFakeTimers();
    const expiry = new QueueExpiry({ timers, onExpire: noop });
    expect(() => expiry.register('q1', 0)).toThrow('PRECONDITION_FAILED');
  });

  it('rejects negative x-expires', () => {
    const timers = createFakeTimers();
    const expiry = new QueueExpiry({ timers, onExpire: noop });
    expect(() => expiry.register('q1', -100)).toThrow('PRECONDITION_FAILED');
  });

  it('rejects non-integer x-expires', () => {
    const timers = createFakeTimers();
    const expiry = new QueueExpiry({ timers, onExpire: noop });
    expect(() => expiry.register('q1', 1.5)).toThrow('PRECONDITION_FAILED');
  });
});

// ── Timer creation ───────────────────────────────────────────────────

describe('queue expiry timer creation', () => {
  it('sets a timer when queue is registered', () => {
    const timers = createFakeTimers();
    const expiry = new QueueExpiry({ timers, onExpire: noop });
    expiry.register('q1', 5000);
    expect(timers.pending.size).toBe(1);
  });

  it('timer fires after specified ms', () => {
    const timers = createFakeTimers();
    const expired = vi.fn();
    const expiry = new QueueExpiry({ timers, onExpire: expired });
    expiry.register('q1', 5000);

    const [handle, entry] = firstEntry(timers.pending);
    expect(entry.ms).toBe(5000);

    timers.fire(handle);
    expect(expired).toHaveBeenCalledWith('q1');
  });

  it('does not fire callback after unregister', () => {
    const timers = createFakeTimers();
    const expired = vi.fn();
    const expiry = new QueueExpiry({ timers, onExpire: expired });
    expiry.register('q1', 5000);

    const handle = firstKey(timers.pending);
    expiry.unregister('q1');

    timers.fire(handle);
    expect(expired).not.toHaveBeenCalled();
    expect(timers.pending.size).toBe(0);
  });
});

// ── Timer reset ──────────────────────────────────────────────────────

describe('queue expiry timer reset', () => {
  it('resetActivity resets the timer', () => {
    const timers = createFakeTimers();
    const expired = vi.fn();
    const expiry = new QueueExpiry({ timers, onExpire: expired });
    expiry.register('q1', 5000);

    const handleBefore = firstKey(timers.pending);

    expiry.resetActivity('q1');

    // Old timer should be cleared, new one created
    expect(timers.pending.has(handleBefore)).toBe(false);
    expect(timers.pending.size).toBe(1);

    // New timer should still fire
    const newHandle = firstKey(timers.pending);
    timers.fire(newHandle);
    expect(expired).toHaveBeenCalledWith('q1');
  });

  it('resetActivity is a no-op for queues without x-expires', () => {
    const timers = createFakeTimers();
    const expiry = new QueueExpiry({ timers, onExpire: noop });

    // Should not throw
    expiry.resetActivity('nonexistent');
    expect(timers.pending.size).toBe(0);
  });

  it('multiple resets keep only one active timer', () => {
    const timers = createFakeTimers();
    const expired = vi.fn();
    const expiry = new QueueExpiry({ timers, onExpire: expired });
    expiry.register('q1', 3000);

    expiry.resetActivity('q1');
    expiry.resetActivity('q1');
    expiry.resetActivity('q1');

    expect(timers.pending.size).toBe(1);
  });
});

// ── Multiple queues ──────────────────────────────────────────────────

describe('queue expiry multiple queues', () => {
  it('manages timers for multiple queues independently', () => {
    const timers = createFakeTimers();
    const expired: string[] = [];
    const expiry = new QueueExpiry({
      timers,
      onExpire: (name) => expired.push(name),
    });

    expiry.register('q1', 1000);
    expiry.register('q2', 2000);

    expect(timers.pending.size).toBe(2);

    // Fire only q1's timer
    const entries = [...timers.pending.entries()];
    const q1Entry = entries.find(([, e]) => e.ms === 1000);
    expect(q1Entry).toBeDefined();
    timers.fire((q1Entry as [unknown, unknown])[0]);

    expect(expired).toEqual(['q1']);
    expect(timers.pending.size).toBe(1);
  });

  it('unregister one queue does not affect others', () => {
    const timers = createFakeTimers();
    const expired: string[] = [];
    const expiry = new QueueExpiry({
      timers,
      onExpire: (name) => expired.push(name),
    });

    expiry.register('q1', 1000);
    expiry.register('q2', 2000);
    expiry.unregister('q1');

    expect(timers.pending.size).toBe(1);

    const handle = firstKey(timers.pending);
    timers.fire(handle);
    expect(expired).toEqual(['q2']);
  });
});

// ── Re-registration ─────────────────────────────────────────────────

describe('queue expiry re-registration', () => {
  it('re-register with same value resets the timer (re-declare)', () => {
    const timers = createFakeTimers();
    const expired = vi.fn();
    const expiry = new QueueExpiry({ timers, onExpire: expired });
    expiry.register('q1', 5000);

    const handleBefore = firstKey(timers.pending);
    expiry.register('q1', 5000);

    // Old timer cleared, new one set
    expect(timers.pending.has(handleBefore)).toBe(false);
    expect(timers.pending.size).toBe(1);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────

describe('queue expiry edge cases', () => {
  it('unregister is idempotent', () => {
    const timers = createFakeTimers();
    const expiry = new QueueExpiry({ timers, onExpire: noop });
    expiry.register('q1', 5000);
    expiry.unregister('q1');
    expiry.unregister('q1'); // second call should not throw
    expect(timers.pending.size).toBe(0);
  });

  it('unregister for non-existent queue is a no-op', () => {
    const timers = createFakeTimers();
    const expiry = new QueueExpiry({ timers, onExpire: noop });
    expiry.unregister('ghost'); // should not throw
  });
});
