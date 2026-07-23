import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { normalizePath } from '@/lib/pathNormalization';
import type { WorktreeMetadata } from '@/types/worktree';

const normalizeWorktreePath = (value?: string | null): string => normalizePath(value) ?? '';

const normalizeServerId = (serverId?: string | null): string => {
  const value = (serverId ?? '').trim();
  return value && value !== DEFAULT_SERVER_ID ? value : '';
};

const normalizeMetadataPath = (value?: string | null): string => normalizeWorktreePath(value);

const mergeWorktreeMetadata = (
  current: WorktreeMetadata,
  next: WorktreeMetadata,
): WorktreeMetadata => {
  const merged: WorktreeMetadata = { ...current };
  const path = normalizeMetadataPath(next.path);
  const projectDirectory = normalizeMetadataPath(next.projectDirectory);
  const serverId = normalizeServerId(next.serverId);
  const worktreeRoot = normalizeMetadataPath(next.worktreeRoot);

  if (next.source) merged.source = next.source;
  if (path) merged.path = path;
  if (projectDirectory) merged.projectDirectory = projectDirectory;
  if (serverId) merged.serverId = serverId;
  if (next.branch.trim()) merged.branch = next.branch.trim();
  if (next.label.trim()) merged.label = next.label.trim();
  if (next.name?.trim()) merged.name = next.name.trim();
  if (next.kind) merged.kind = next.kind;
  if (next.createdFromBranch?.trim()) merged.createdFromBranch = next.createdFromBranch.trim();
  if (next.relativePath?.trim()) merged.relativePath = next.relativePath.trim();
  if (next.status) merged.status = next.status;
  if (worktreeRoot) merged.worktreeRoot = worktreeRoot;
  if (next.worktreeStatus) merged.worktreeStatus = next.worktreeStatus;
  if (next.headState) merged.headState = next.headState;
  if (next.worktreeSource) merged.worktreeSource = next.worktreeSource;

  return merged;
};

export const getProjectWorktreeKey = (path?: string | null, serverId?: string | null): string => {
  const normalizedPath = normalizeWorktreePath(path);
  const normalizedServerId = normalizeServerId(serverId);
  return normalizedServerId ? `${normalizedServerId}::${normalizedPath}` : normalizedPath;
};

export const dedupeWorktreesByPath = (
  worktrees: readonly WorktreeMetadata[],
  fallbackServerId?: string | null,
): WorktreeMetadata[] => {
  const resultByKey = new Map<string, WorktreeMetadata>();
  const order: string[] = [];

  for (const worktree of worktrees) {
    const path = normalizeMetadataPath(worktree.path);
    if (!path) continue;

    const serverId = normalizeServerId(worktree.serverId ?? fallbackServerId);
    const key = getProjectWorktreeKey(path, serverId);
    if (!key) continue;

    const projectDirectory = normalizeMetadataPath(worktree.projectDirectory) || path;
    const normalized: WorktreeMetadata = {
      ...worktree,
      path,
      projectDirectory,
    };

    if (serverId) {
      normalized.serverId = serverId;
    } else {
      delete normalized.serverId;
    }

    const existing = resultByKey.get(key);
    if (existing) {
      resultByKey.set(key, mergeWorktreeMetadata(existing, normalized));
    } else {
      resultByKey.set(key, normalized);
      order.push(key);
    }
  }

  return order.flatMap((key) => {
    const item = resultByKey.get(key);
    return item ? [item] : [];
  });
};

export const getWorktreesForProject = (
  worktreesByProject: Map<string, WorktreeMetadata[]>,
  path?: string | null,
  serverId?: string | null,
): WorktreeMetadata[] => {
  const key = getProjectWorktreeKey(path, serverId);
  if (key && worktreesByProject.has(key)) {
    return worktreesByProject.get(key) ?? [];
  }

  // Backward compatibility for maps populated before server-scoped keys existed.
  const legacyPathKey = normalizeWorktreePath(path);
  return legacyPathKey ? (worktreesByProject.get(legacyPathKey) ?? []) : [];
};
