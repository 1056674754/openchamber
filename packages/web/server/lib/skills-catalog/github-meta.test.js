import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearGitHubMetaCache, fetchGitHubRepoMetas } from './github-meta.js';

let dataDir;

beforeEach(() => {
  vi.useFakeTimers();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-meta-'));
  process.env.OPENCHAMBER_DATA_DIR = dataDir;
  clearGitHubMetaCache();
});

afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.OPENCHAMBER_DATA_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('GitHub skills metadata', () => {
  it('deduplicates repos and returns stars plus last push', async () => {
    const fetchMock = vi.fn(async () => Response.json({ stargazers_count: 42, pushed_at: '2026-08-01T00:00:00Z' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchGitHubRepoMetas(['anthropics/skills', 'anthropics/skills'])).resolves.toEqual({
      'anthropics/skills': { stars: 42, repoUpdatedAt: '2026-08-01T00:00:00Z' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches failures briefly instead of repeatedly hitting GitHub', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchGitHubRepoMetas(['a/b']))['a/b']).toBeNull();
    expect((await fetchGitHubRepoMetas(['a/b']))['a/b']).toEqual({ stars: null, repoUpdatedAt: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
