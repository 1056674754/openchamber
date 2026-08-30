import { readDiskCache, writeDiskCache } from './disk-cache.js';

const DEFAULT_TTL_MS = 3 * 60 * 60 * 1000;
const DISK_CACHE_FILE = 'skills-catalog-cache.json';
const MAX_CONCURRENT_SCANS = 2;

const cache = new Map();
const inFlight = new Map();
let diskLoaded = false;
let diskWriteTimer = null;
let activeScans = 0;
const scanQueue = [];

const loadDiskEntries = () => {
  if (diskLoaded) return;
  diskLoaded = true;
  const now = Date.now();
  for (const [key, entry] of Object.entries(readDiskCache(DISK_CACHE_FILE) ?? {})) {
    if (entry && typeof entry === 'object' && entry.expiresAt > now && entry.value && typeof entry.value === 'object') {
      cache.set(key, entry);
    }
  }
};

const scheduleDiskWrite = () => {
  if (diskWriteTimer) return;
  diskWriteTimer = setTimeout(() => {
    diskWriteTimer = null;
    const now = Date.now();
    writeDiskCache(DISK_CACHE_FILE, Object.fromEntries([...cache].filter(([, entry]) => entry.expiresAt > now)));
  }, 1000);
  diskWriteTimer.unref?.();
};

export function getCacheKey({ normalizedRepo, subpath, identityId }) {
  const safeRepo = String(normalizedRepo || '').trim();
  const safeSubpath = String(subpath || '').trim();
  const safeIdentity = String(identityId || '').trim();
  return `${safeRepo}::${safeSubpath}::${safeIdentity}`;
}

export function getCachedScan(key) {
  loadDiskEntries();
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCachedScan(key, value, ttlMs = DEFAULT_TTL_MS) {
  const ttl = Number.isFinite(ttlMs) ? ttlMs : DEFAULT_TTL_MS;
  cache.set(key, { expiresAt: Date.now() + ttl, value });
  scheduleDiskWrite();
}

export function clearCache() {
  cache.clear();
  inFlight.clear();
}

const pumpScanQueue = () => {
  while (activeScans < MAX_CONCURRENT_SCANS && scanQueue.length > 0) {
    activeScans += 1;
    scanQueue.shift()();
  }
};

const acquireScanSlot = () => new Promise((resolve) => {
  scanQueue.push(resolve);
  pumpScanQueue();
});

export async function scanWithCache(key, loader, { refresh = false } = {}) {
  if (!refresh) {
    const cached = getCachedScan(key);
    if (cached) return cached;
  }
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    await acquireScanSlot();
    try {
      const result = await loader();
      if (result?.ok) setCachedScan(key, result);
      return result;
    } finally {
      activeScans -= 1;
      inFlight.delete(key);
      pumpScanQueue();
    }
  })();
  inFlight.set(key, request);
  return request;
}
