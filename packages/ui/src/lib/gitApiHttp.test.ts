import { describe, expect, test } from 'bun:test';
import { isLinkedWorktree } from './gitApiHttp';

const withHttpMocks = async (fetchImpl: typeof fetch, callback: () => Promise<void>) => {
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: 'http://127.0.0.1:3000' },
    } as unknown as Window,
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fetchImpl,
  });

  try {
    await callback();
  } finally {
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }

    if (previousFetchDescriptor) {
      Object.defineProperty(globalThis, 'fetch', previousFetchDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
};

describe('isLinkedWorktree', () => {
  test('dedupes in-flight checks and reuses cached results', async () => {
    let calls = 0;
    let releaseFetch: () => void = () => undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    await withHttpMocks(async (input) => {
      calls += 1;
      expect(String(input)).toContain('/api/git/worktree-type');
      await fetchGate;
      return new Response(JSON.stringify({ linked: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }, async () => {
      const first = isLinkedWorktree('/repo-linked-cache-test');
      const second = isLinkedWorktree('/repo-linked-cache-test');

      expect(calls).toBe(1);
      releaseFetch();
      expect(await Promise.all([first, second])).toEqual([true, true]);

      expect(await isLinkedWorktree('/repo-linked-cache-test')).toBe(true);
      expect(calls).toBe(1);
    });
  });
});
