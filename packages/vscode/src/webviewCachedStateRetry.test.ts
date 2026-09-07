import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { scheduleCachedStateRetries } from './webviewCachedStateRetry';

type ScheduledCall = { delayMs: number; fire: () => void };

const captureTimeouts = (): { calls: ScheduledCall[]; restore: () => void } => {
  const calls: ScheduledCall[] = [];
  const original = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, delay?: number) => {
    calls.push({ delayMs: delay ?? 0, fire: fn });
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  return {
    calls,
    restore: () => {
      globalThis.setTimeout = original;
    },
  };
};

describe('scheduleCachedStateRetries', () => {
  test('schedules the staggered retry ladder when connected with a target', () => {
    const target = { id: 'view-1' };
    let sends = 0;
    const { calls, restore } = captureTimeouts();
    try {
      scheduleCachedStateRetries({
        target,
        getCurrent: () => target,
        isConnected: () => true,
        send: () => {
          sends += 1;
        },
      });

      assert.deepEqual(calls.map((call) => call.delayMs), [500, 1500, 3500, 7000, 12000, 20000]);
      for (const call of calls) call.fire();
      assert.equal(sends, 6);
    } finally {
      restore();
    }
  });

  test('skips scheduling when not connected', () => {
    const { calls, restore } = captureTimeouts();
    try {
      scheduleCachedStateRetries({
        target: { id: 'view-1' },
        getCurrent: () => ({ id: 'view-1' }),
        isConnected: () => false,
        send: () => {},
      });
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });

  test('skips scheduling without a target', () => {
    const { calls, restore } = captureTimeouts();
    try {
      scheduleCachedStateRetries({
        target: undefined,
        getCurrent: () => undefined,
        isConnected: () => true,
        send: () => {},
      });
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });

  test('stops retries once the view is replaced', () => {
    const target = { id: 'view-1' };
    const replacement = { id: 'view-2' };
    let sends = 0;
    const { calls, restore } = captureTimeouts();
    try {
      scheduleCachedStateRetries({
        target,
        getCurrent: () => replacement,
        isConnected: () => true,
        send: () => {
          sends += 1;
        },
      });
      for (const call of calls) call.fire();
      assert.equal(sends, 0);
    } finally {
      restore();
    }
  });
});
