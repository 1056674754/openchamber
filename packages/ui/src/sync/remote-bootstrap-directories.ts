import type { ProjectEntry } from "@/lib/api/types";
import { DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";
import { dedupeWorktreesByPath, getWorktreesForProject } from "@/lib/worktrees/worktreeKeys";
import type { WorktreeMetadata } from "@/types/worktree";

export const normalizeRemoteBootstrapDirectory = (value: string): string => {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
};

export const isRemoteBootstrapDirectory = (value: string): boolean => {
  return normalizeRemoteBootstrapDirectory(value) !== "/";
};

const addRemoteBootstrapDirectory = (
  map: Map<string, string[]>,
  healthyServerIds: ReadonlySet<string>,
  serverId: string | null | undefined,
  path: string | null | undefined,
): void => {
  if (!serverId || serverId === DEFAULT_SERVER_ID || !healthyServerIds.has(serverId)) {
    return;
  }
  if (!path || !isRemoteBootstrapDirectory(path)) {
    return;
  }

  const normalizedPath = normalizeRemoteBootstrapDirectory(path);
  const dirs = map.get(serverId) ?? [];
  if (!dirs.includes(normalizedPath)) {
    dirs.push(normalizedPath);
    map.set(serverId, dirs);
  }
};

export const buildRemoteBootstrapDirectoryMap = (
  projects: ReadonlyArray<ProjectEntry>,
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>,
  healthyServerIds: ReadonlySet<string>,
): Map<string, string[]> => {
  const map = new Map<string, string[]>();

  for (const project of projects) {
    const serverId = project.serverId;
    if (!serverId || serverId === DEFAULT_SERVER_ID || !healthyServerIds.has(serverId)) {
      continue;
    }

    const normalizedProjectPath = normalizeRemoteBootstrapDirectory(project.path);
    addRemoteBootstrapDirectory(map, healthyServerIds, serverId, normalizedProjectPath);

    const worktrees = dedupeWorktreesByPath(
      getWorktreesForProject(availableWorktreesByProject, normalizedProjectPath, serverId),
      serverId,
    );
    for (const worktree of worktrees) {
      addRemoteBootstrapDirectory(map, healthyServerIds, worktree.serverId ?? serverId, worktree.path);
    }
  }

  for (const worktrees of availableWorktreesByProject.values()) {
    for (const worktree of dedupeWorktreesByPath(worktrees)) {
      addRemoteBootstrapDirectory(map, healthyServerIds, worktree.serverId, worktree.path);
    }
  }

  return map;
};
