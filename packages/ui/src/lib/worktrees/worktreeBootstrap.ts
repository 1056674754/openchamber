import * as gitHttp from '@/lib/gitApiHttp';
import type { RuntimeAPIs } from '@/lib/api/types';
import type { GitWorktreeBootstrapStatus } from '@/lib/api/types';
import { normalizePath } from '@/lib/pathNormalization';

declare global {
  interface Window {
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

type WorktreeBootstrapState = GitWorktreeBootstrapStatus;
type WorktreeBootstrapTarget = 'git-ready' | 'setup-ready';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 250;

const state = new Map<string, WorktreeBootstrapState>();
const waiters = new Map<string, Promise<void>>();
const lifecycleVersions = new Map<string, number>();
let nextLifecycleVersion = 0;

const getKey = (directory: string): string => normalizePath(directory) ?? '';
const getWaiterKey = (key: string, target: WorktreeBootstrapTarget): string => `${key}\n${target}`;

// UI surfaces subscribe to know when a directory enters or leaves bootstrap,
// so a half-created worktree's transient files are never shown as changes.
const bootstrapListeners = new Set<() => void>();

const notifyBootstrapListeners = (): void => {
  for (const listener of bootstrapListeners) {
    listener();
  }
};

export const subscribeWorktreeBootstrapState = (listener: () => void): (() => void) => {
  bootstrapListeners.add(listener);
  return () => {
    bootstrapListeners.delete(listener);
  };
};

const startLifecycle = (key: string): void => {
  waiters.delete(getWaiterKey(key, 'git-ready'));
  waiters.delete(getWaiterKey(key, 'setup-ready'));
  const version = ++nextLifecycleVersion;
  lifecycleVersions.set(key, version);
};

const isCurrentLifecycle = (key: string, version: number): boolean => lifecycleVersions.get(key) === version;

const phaseRank = (phase: GitWorktreeBootstrapStatus['phase']): number => {
  switch (phase) {
    case 'setup-ready':
      return 2;
    case 'git-ready':
      return 1;
    case 'directory-created':
    default:
      return 0;
  }
};

const storePolledState = (
  key: string,
  next: WorktreeBootstrapState,
  lifecycleVersion: number,
): WorktreeBootstrapState | null => {
  if (!isCurrentLifecycle(key, lifecycleVersion)) {
    return null;
  }

  const current = state.get(key);
  const wouldRegressReadyState = current?.status === 'ready' && next.status === 'pending';
  const wouldRegressPendingPhase = current?.status === 'pending'
    && next.status === 'pending'
    && phaseRank(next.phase) < phaseRank(current.phase);

  if (wouldRegressReadyState || wouldRegressPendingPhase) {
    return current ?? null;
  }

  state.set(key, next);
  notifyBootstrapListeners();
  return next;
};

const getGitWorktreeBootstrapStatus = async (directory: string): Promise<GitWorktreeBootstrapStatus> => {
  const runtimeGit = typeof window !== 'undefined' ? window.__OPENCHAMBER_RUNTIME_APIS__?.git : undefined;
  if (runtimeGit?.worktree?.bootstrapStatus) {
    return runtimeGit.worktree.bootstrapStatus(directory);
  }
  if (runtimeGit?.getGitWorktreeBootstrapStatus) {
    return runtimeGit.getGitWorktreeBootstrapStatus(directory);
  }
  return gitHttp.getGitWorktreeBootstrapStatus(directory);
};

export const markWorktreeBootstrapPending = (directory: string): void => {
  const key = getKey(directory);
  if (!key) {
    return;
  }
  startLifecycle(key);
  state.set(key, {
    status: 'pending',
    phase: 'directory-created',
    error: null,
    updatedAt: Date.now(),
  });
  notifyBootstrapListeners();
};

export const clearWorktreeBootstrapState = (directory: string): void => {
  const key = getKey(directory);
  if (!key) {
    return;
  }
  startLifecycle(key);
  state.delete(key);
  lifecycleVersions.delete(key);
  notifyBootstrapListeners();
};

export const setWorktreeBootstrapState = (directory: string, next: WorktreeBootstrapState): void => {
  const key = getKey(directory);
  if (!key) {
    return;
  }
  startLifecycle(key);
  state.set(key, next);
  notifyBootstrapListeners();
};

export const getWorktreeBootstrapState = (directory: string): WorktreeBootstrapState | null => {
  const key = getKey(directory);
  if (!key) {
    return null;
  }
  return state.get(key) ?? null;
};

const hasReachedTarget = (status: GitWorktreeBootstrapStatus, target: WorktreeBootstrapTarget): boolean => {
  if (status.status === 'ready') return true;
  if (target === 'git-ready' && (status.phase === 'git-ready' || status.phase === 'setup-ready')) return true;
  return false;
};

const pollWorktreeBootstrapUntilSettled = async (
  directory: string,
  key: string,
  lifecycleVersion: number,
  timeoutMs: number,
  target: WorktreeBootstrapTarget,
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    let current: WorktreeBootstrapState | null = null
    try {
      const result = await getGitWorktreeBootstrapStatus(directory)
      current = storePolledState(key, result, lifecycleVersion)
    } catch {
      // Transient poll/network failures should not abort an in-flight wait.
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      continue
    }

    if (!current) {
      throw new Error('Worktree bootstrap wait was cancelled')
    }

    if (hasReachedTarget(current, target)) {
      return
    }

    if (current.status === 'failed') {
      throw new Error(current.error || 'Worktree bootstrap failed')
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error('Timed out waiting for worktree bootstrap');
};

const waitForWorktreePhase = async (
  directory: string,
  target: WorktreeBootstrapTarget,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> => {
  const key = getKey(directory);
  if (!key) {
    return;
  }

  const current = state.get(key);
  if (!current) {
    // No pending bootstrap tracked locally — treat as already usable.
    return;
  }

  if (hasReachedTarget(current, target)) {
    return;
  }
  if (current.status === 'failed') {
    throw new Error(current.error || 'Worktree bootstrap failed');
  }

  const waiterKey = getWaiterKey(key, target);
  const existing = waiters.get(waiterKey);
  if (existing) {
    return existing;
  }

  const lifecycleVersion = lifecycleVersions.get(key) ?? 0;
  const pending = pollWorktreeBootstrapUntilSettled(directory, key, lifecycleVersion, timeoutMs, target).finally(() => {
    if (waiters.get(waiterKey) === pending) {
      waiters.delete(waiterKey);
    }
  });
  waiters.set(waiterKey, pending);
  return pending;
};

/** Wait until git worktree populate is done (session move / control-plane). */
export const waitForWorktreeGitReady = (directory: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> =>
  waitForWorktreePhase(directory, 'git-ready', timeoutMs);

/** Wait until setup scripts finish (existing create-session / config flows). */
export const waitForWorktreeBootstrap = (directory: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> =>
  waitForWorktreePhase(directory, 'setup-ready', timeoutMs);
