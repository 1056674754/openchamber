import { getGitStatus } from '@/lib/gitApi';
import * as gitHttp from '@/lib/gitApiHttp';
import { execCommand } from '@/lib/execCommands';
import type { WorktreeMetadata } from '@/types/worktree';

const normalizePath = (value: string): string => {
  if (!value) {
    return '';
  }
  const replaced = value.replace(/\\/g, '/');
  if (replaced === '/') {
    return '/';
  }
  return replaced.replace(/\/+$/, '');
};

const toAbsolutePath = (baseDir: string, maybeRelativePath: string): string => {
  const normalizedBase = normalizePath(baseDir);
  const normalizedInput = normalizePath(maybeRelativePath);
  if (!normalizedInput) return normalizedBase;
  if (normalizedInput.startsWith('/')) return normalizedInput;

  const stack = normalizedBase.split('/').filter(Boolean);
  const parts = normalizedInput.split('/').filter(Boolean);
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return `/${stack.join('/')}`;
};

const derivePrimaryWorktreeRootFromGitDir = (gitDir: string): string | null => {
  const normalized = normalizePath(gitDir);
  if (!normalized) return null;
  if (normalized.endsWith('/.git')) {
    return normalized.slice(0, -'/.git'.length) || null;
  }
  const worktreesMarker = '/.git/worktrees/';
  const markerIndex = normalized.indexOf(worktreesMarker);
  if (markerIndex > 0) {
    return normalized.slice(0, markerIndex) || null;
  }
  return null;
};

const RESOLVED_ROOT_TTL_MS = 60_000;
const RESOLVED_ROOT_CACHE_MAX_ENTRIES = 500;
const RESOLVED_ROOT_CACHE_MAX_BYTES = 1024 * 1024;
const resolvedRootCache = new Map<string, { root: string; resolvedAt: number; directory: string }>();
const inFlightRootResolves = new Map<string, Promise<string>>();
let resolveCacheEpoch = 0;

const resolvedRootCacheKey = (directory: string, baseUrl?: string): string => `${baseUrl ?? 'local'}\0${directory}`;
const resolvedRootEntryBytes = (key: string, root: string): number => key.length + root.length;

const setResolvedRootCacheEntry = (key: string, directory: string, root: string): void => {
  resolvedRootCache.delete(key);
  resolvedRootCache.set(key, { root, resolvedAt: Date.now(), directory });

  let totalBytes = 0;
  for (const [entryKey, entry] of resolvedRootCache) {
    totalBytes += resolvedRootEntryBytes(entryKey, entry.root);
  }

  while (
    resolvedRootCache.size > RESOLVED_ROOT_CACHE_MAX_ENTRIES ||
    (totalBytes > RESOLVED_ROOT_CACHE_MAX_BYTES && resolvedRootCache.size > 1)
  ) {
    const oldest = resolvedRootCache.entries().next().value;
    if (!oldest) break;
    totalBytes -= resolvedRootEntryBytes(oldest[0], oldest[1].root);
    resolvedRootCache.delete(oldest[0]);
  }
};

export function invalidateResolvedProjectRootCache(directory?: string): void {
  resolveCacheEpoch += 1;
  if (typeof directory === 'string' && directory.trim()) {
    const normalized = normalizePath(directory);
    for (const [key, entry] of resolvedRootCache) {
      if (entry.directory === normalized) {
        resolvedRootCache.delete(key);
      }
    }
    for (const key of inFlightRootResolves.keys()) {
      if (key.endsWith(`\0${normalized}`)) {
        inFlightRootResolves.delete(key);
      }
    }
    return;
  }
  resolvedRootCache.clear();
  inFlightRootResolves.clear();
}

const computeProjectRoot = async (directory: string, baseUrl?: string): Promise<string> => {
  const result = await execCommand('git rev-parse --absolute-git-dir --git-common-dir', directory, { baseUrl });
  if (!result.success) {
    return directory;
  }

  const lines = (result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const absoluteGitDir = normalizePath(lines[0] || '');
  if (absoluteGitDir) {
    const rootFromAbsoluteGitDir = derivePrimaryWorktreeRootFromGitDir(absoluteGitDir);
    if (rootFromAbsoluteGitDir) {
      return rootFromAbsoluteGitDir;
    }
  }

  const rawCommonDir = normalizePath(lines[1] || '');
  if (rawCommonDir) {
    const commonDir = toAbsolutePath(directory, rawCommonDir);
    const rootFromCommonDir = derivePrimaryWorktreeRootFromGitDir(commonDir);
    if (rootFromCommonDir) {
      return rootFromCommonDir;
    }
  }

  return directory;
};

export const resolveProjectRoot = async (directory: string, baseUrl?: string): Promise<string> => {
  const key = resolvedRootCacheKey(directory, baseUrl);
  const cached = resolvedRootCache.get(key);
  if (cached && Date.now() - cached.resolvedAt < RESOLVED_ROOT_TTL_MS) {
    resolvedRootCache.delete(key);
    resolvedRootCache.set(key, cached);
    return cached.root;
  }
  if (cached) {
    resolvedRootCache.delete(key);
  }

  const inflight = inFlightRootResolves.get(key);
  if (inflight) {
    return inflight;
  }

  const startEpoch = resolveCacheEpoch;
  const promise = computeProjectRoot(directory, baseUrl)
    .then((root) => {
      if (resolveCacheEpoch === startEpoch) {
        setResolvedRootCacheEntry(key, directory, root);
      }
      return root;
    })
    .catch(() => directory)
    .finally(() => {
      if (inFlightRootResolves.get(key) === promise) {
        inFlightRootResolves.delete(key);
      }
    });

  inFlightRootResolves.set(key, promise);
  return promise;
};

export async function getWorktreeStatus(worktreePath: string): Promise<WorktreeMetadata['status']> {
  const normalizedPath = normalizePath(worktreePath);
  const status = await getGitStatus(normalizedPath);
  return {
    isDirty: !status.isClean,
    ahead: status.ahead,
    behind: status.behind,
    upstream: status.tracking,
  };
}

export async function getRootBranch(
  projectDirectory: string,
  options?: { knownBranch?: string; baseUrl?: string },
): Promise<string> {
  const normalizedPath = normalizePath(projectDirectory);
  if (!normalizedPath) {
    return 'HEAD';
  }

  try {
    const projectRoot = await resolveProjectRoot(normalizedPath, options?.baseUrl).catch(() => normalizedPath);
    const knownBranch = options?.knownBranch?.trim();
    if (knownBranch && projectRoot === normalizedPath) {
      return knownBranch;
    }

    const status = options?.baseUrl
      ? await gitHttp.getGitStatus(projectRoot, undefined, options.baseUrl)
      : await getGitStatus(projectRoot);
    const branch = typeof status.current === 'string' ? status.current.trim() : '';
    return branch || 'HEAD';
  } catch {
    return 'HEAD';
  }
}
