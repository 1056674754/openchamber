import { beforeEach, describe, expect, test } from 'bun:test';

import {
  clearLastActiveSession,
  persistLastActiveSession,
  readLastActiveSession,
} from './last-session-cache';

class TestStorage implements Storage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

let storage: TestStorage;

beforeEach(() => {
  storage = new TestStorage();
});

describe('last active session persistence', () => {
  test('keeps the server and directory authority independent per runtime', () => {
    persistLastActiveSession('runtime-a', {
      sessionId: 'ses-a',
      serverId: 'remote-a',
      directory: '/repo/a',
    }, storage);
    persistLastActiveSession('runtime-b', {
      sessionId: 'ses-b',
      serverId: 'default',
      directory: null,
    }, storage);

    expect(readLastActiveSession('runtime-a', storage)).toEqual({
      sessionId: 'ses-a',
      serverId: 'remote-a',
      directory: '/repo/a',
    });
    expect(readLastActiveSession('runtime-b', storage)).toEqual({
      sessionId: 'ses-b',
      serverId: 'default',
      directory: null,
    });
  });

  test('clear removes only the targeted runtime', () => {
    persistLastActiveSession('runtime-a', {
      sessionId: 'ses-a',
      serverId: 'remote-a',
      directory: null,
    }, storage);
    persistLastActiveSession('runtime-b', {
      sessionId: 'ses-b',
      serverId: 'remote-b',
      directory: null,
    }, storage);

    clearLastActiveSession('runtime-a', storage);

    expect(readLastActiveSession('runtime-a', storage)).toBeNull();
    expect(readLastActiveSession('runtime-b', storage)?.sessionId).toBe('ses-b');
  });

  test('rejects malformed entries without leaking them into another runtime', () => {
    storage.setItem('oc.lastSession.v1', JSON.stringify({
      version: 1,
      runtimes: {
        'runtime-a': { sessionId: 'ses-a', serverId: 42, updatedAt: 1 },
      },
    }));

    expect(readLastActiveSession('runtime-a', storage)).toBeNull();
  });

  test('bounds retained runtime namespaces to the newest eight', () => {
    for (let index = 0; index < 10; index += 1) {
      persistLastActiveSession(`runtime-${index}`, {
        sessionId: `ses-${index}`,
        serverId: 'default',
        directory: null,
      }, storage);
    }

    const retained = Array.from({ length: 10 }, (_, index) => (
      readLastActiveSession(`runtime-${index}`, storage)
    )).filter(Boolean);

    expect(retained).toHaveLength(8);
    expect(readLastActiveSession('runtime-9', storage)).not.toBeNull();
    expect(readLastActiveSession('runtime-0', storage)).toBeNull();
  });
});
