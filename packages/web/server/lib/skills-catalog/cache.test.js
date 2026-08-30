import { beforeEach, describe, expect, it } from 'vitest';

import { clearCache, getCacheKey, scanWithCache } from './cache.js';

beforeEach(() => clearCache());

describe('skills scan cache', () => {
  it('isolates entries by repository, subpath, and identity', () => {
    expect(getCacheKey({ normalizedRepo: 'a/b', subpath: 'skills', identityId: 'one' }))
      .not.toBe(getCacheKey({ normalizedRepo: 'a/b', subpath: 'skills', identityId: 'two' }));
  });

  it('deduplicates simultaneous scans of the same source', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const loader = async () => {
      calls += 1;
      await gate;
      return { ok: true, items: [] };
    };
    const first = scanWithCache('same', loader);
    const second = scanWithCache('same', loader);
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  it('runs at most two distinct scans concurrently', async () => {
    let active = 0;
    let maximum = 0;
    const loader = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ok: true, items: [] };
    };
    await Promise.all(['a', 'b', 'c', 'd'].map((key) => scanWithCache(key, loader, { refresh: true })));
    expect(maximum).toBe(2);
  });
});
