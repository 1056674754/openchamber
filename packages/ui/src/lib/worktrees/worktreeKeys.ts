import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import type { WorktreeMetadata } from '@/types/worktree';

const normalizePath = (value?: string | null): string => {
  const source = (value ?? '').trim().replace(/\\/g, '/');
  if (!source) return '';
  if (source === '/') return '/';
  return source.replace(/\/+$/, '') || '/';
};

const normalizeServerId = (serverId?: string | null): string => {
  const value = (serverId ?? '').trim();
  return value && value !== DEFAULT_SERVER_ID ? value : '';
};

export const getProjectWorktreeKey = (path?: string | null, serverId?: string | null): string => {
  const normalizedPath = normalizePath(path);
  const normalizedServerId = normalizeServerId(serverId);
  return normalizedServerId ? `${normalizedServerId}::${normalizedPath}` : normalizedPath;
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
  const legacyPathKey = normalizePath(path);
  return legacyPathKey ? (worktreesByProject.get(legacyPathKey) ?? []) : [];
};
