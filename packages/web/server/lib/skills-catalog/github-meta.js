import { readDiskCache, writeDiskCache } from './disk-cache.js';

const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;
const DISK_CACHE_FILE = 'skills-github-meta.json';
const cache = new Map();
const inFlight = new Map();
let diskLoaded = false;
let diskWriteTimer = null;

const loadDiskEntries = () => {
  if (diskLoaded) return;
  diskLoaded = true;
  const persisted = readDiskCache(DISK_CACHE_FILE);
  const now = Date.now();
  for (const [repo, entry] of Object.entries(persisted ?? {})) {
    if (entry && typeof entry === 'object' && entry.expiresAt > now && entry.value && typeof entry.value === 'object') {
      cache.set(repo, entry);
    }
  }
};

const scheduleDiskWrite = () => {
  if (diskWriteTimer) return;
  diskWriteTimer = setTimeout(() => {
    diskWriteTimer = null;
    const now = Date.now();
    writeDiskCache(DISK_CACHE_FILE, Object.fromEntries(
      [...cache].filter(([, entry]) => entry.expiresAt > now),
    ));
  }, 1000);
  diskWriteTimer.unref?.();
};

const fetchRepoMeta = (repo) => {
  loadDiskEntries();
  const cached = cache.get(repo);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  const existing = inFlight.get(repo);
  if (existing) return existing;

  const request = (async () => {
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw new Error(`GitHub metadata HTTP ${response.status}`);
      const payload = await response.json();
      const value = {
        stars: Number.isFinite(payload?.stargazers_count) ? payload.stargazers_count : null,
        repoUpdatedAt: typeof payload?.pushed_at === 'string' && payload.pushed_at ? payload.pushed_at : null,
      };
      cache.set(repo, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      scheduleDiskWrite();
      return value;
    } catch {
      const value = { stars: null, repoUpdatedAt: null };
      cache.set(repo, { expiresAt: Date.now() + FAILURE_CACHE_TTL_MS, value });
      scheduleDiskWrite();
      return null;
    } finally {
      inFlight.delete(repo);
    }
  })();
  inFlight.set(repo, request);
  return request;
};

export const fetchGitHubRepoMetas = async (repos) => Object.fromEntries(
  await Promise.all([...new Set(repos.filter(Boolean))].map(async (repo) => [repo, await fetchRepoMeta(repo)])),
);

export const clearGitHubMetaCache = () => {
  cache.clear();
  inFlight.clear();
  diskLoaded = true;
};
