import { describe, expect, mock, test } from 'bun:test';
import type { Session, SessionStatus } from '@opencode-ai/sdk/v2';

mock.module('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: ({ baseUrl }: { baseUrl: string }) => ({ baseUrl }),
}));

const {
  isSessionStatusRunning,
  partitionSessionIdsByRunningStatus,
  partitionSessionsByRunningStatus,
} = await import('./utils');

const busy = (): SessionStatus => ({ type: 'busy' });
const retry = (): SessionStatus => ({
  type: 'retry',
  attempt: 2,
  message: 'rate-limited',
  next: 1_700_000_000_000,
});
const idle = (): SessionStatus => ({ type: 'idle' });

const session = (id: string): Session =>
  ({
    id,
    time: { created: 1, updated: 1 },
  }) as Session;

describe('isSessionStatusRunning', () => {
  test('busy is running', () => {
    expect(isSessionStatusRunning(busy())).toBe(true);
  });

  test('retry is running', () => {
    expect(isSessionStatusRunning(retry())).toBe(true);
  });

  test('idle is not running', () => {
    expect(isSessionStatusRunning(idle())).toBe(false);
  });

  test('absent (undefined) is not running', () => {
    expect(isSessionStatusRunning(undefined)).toBe(false);
  });

  test('null is not running', () => {
    expect(isSessionStatusRunning(null)).toBe(false);
  });

  test('unrecognized status type (e.g. "error") is not running', () => {
    expect(isSessionStatusRunning({ type: 'error' })).toBe(false);
  });
});

describe('partitionSessionIdsByRunningStatus', () => {
  test('routes busy/retry to running and idle/absent to notRunning, preserving order', () => {
    const statusMap = new Map<string, SessionStatus>([
      ['busy-1', busy()],
      ['retry-1', retry()],
      ['idle-1', idle()],
    ]);
    const ids = ['busy-1', 'absent-1', 'retry-1', 'idle-1', 'absent-2'];

    const result = partitionSessionIdsByRunningStatus(ids, statusMap);

    expect(result.running).toEqual(['busy-1', 'retry-1']);
    expect(result.notRunning).toEqual(['absent-1', 'idle-1', 'absent-2']);
  });

  test('returns empty buckets for empty input', () => {
    const statusMap = new Map<string, SessionStatus>([['x', busy()]]);
    const result = partitionSessionIdsByRunningStatus([], statusMap);
    expect(result.running).toEqual([]);
    expect(result.notRunning).toEqual([]);
  });

  test('treats every id as not running when the status map is empty', () => {
    const result = partitionSessionIdsByRunningStatus(
      ['a', 'b', 'c'],
      new Map<string, SessionStatus>(),
    );
    expect(result.running).toEqual([]);
    expect(result.notRunning).toEqual(['a', 'b', 'c']);
  });

  test('does not mutate the input status map', () => {
    const statusMap = new Map<string, SessionStatus>([['busy-1', busy()]]);
    partitionSessionIdsByRunningStatus(['busy-1', 'idle-1'], statusMap);
    expect(statusMap.get('busy-1')).toEqual(busy());
    expect(statusMap.has('idle-1')).toBe(false);
    expect(statusMap.size).toBe(1);
  });
});

describe('partitionSessionsByRunningStatus', () => {
  test('partitions Session objects by authoritative status, preserving order', () => {
    const statusMap = new Map<string, SessionStatus>([
      ['busy-1', busy()],
      ['retry-1', retry()],
      ['idle-1', idle()],
    ]);
    const sessions = [
      session('busy-1'),
      session('absent-1'),
      session('retry-1'),
      session('idle-1'),
    ];

    const result = partitionSessionsByRunningStatus(sessions, statusMap);

    expect(result.running.map((s) => s.id)).toEqual(['busy-1', 'retry-1']);
    expect(result.notRunning.map((s) => s.id)).toEqual(['absent-1', 'idle-1']);
  });

  test('treats sessions missing from the status map as not running', () => {
    const sessions = [session('a'), session('b')];
    const result = partitionSessionsByRunningStatus(
      sessions,
      new Map<string, SessionStatus>(),
    );
    expect(result.running).toEqual([]);
    expect(result.notRunning.map((s) => s.id)).toEqual(['a', 'b']);
  });
});
