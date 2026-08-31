import type { WorktreeMetadata } from '@/types/worktree';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { getProjectWorktreeKey } from '@/lib/worktrees/worktreeKeys';
import { partitionWorktreesByRegisteredProject } from '@/lib/worktrees/worktreeManager';

type WorktreeDiscoveryProjectInput = {
  readonly id: string;
  readonly path: string;
  readonly serverId?: string;
  readonly pinned?: boolean;
  readonly unavailable?: boolean;
  readonly label?: string;
};

export type WorktreeDiscoveryProject = WorktreeDiscoveryProjectInput & {
  readonly normalizedPath: string;
  readonly discoveryKey: string;
  readonly legacyDiscoveryKey: string;
};

type MergeProjectWorktreeResultInput = {
  readonly currentByProject: Map<string, WorktreeMetadata[]>;
  readonly projectKey: string;
  readonly legacyProjectKey: string;
  readonly worktrees: WorktreeMetadata[];
  readonly orderedProjectKeys: readonly string[];
};

type MergeProjectWorktreeResult = {
  readonly byProject: Map<string, WorktreeMetadata[]>;
  readonly allWorktrees: WorktreeMetadata[];
};

const sameWorktreeStatus = (
  left: WorktreeMetadata['status'],
  right: WorktreeMetadata['status'],
): boolean => {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  return left.isDirty === right.isDirty
    && left.ahead === right.ahead
    && left.behind === right.behind
    && left.upstream === right.upstream;
};

const sameWorktree = (left: WorktreeMetadata, right: WorktreeMetadata): boolean => {
  return left.path === right.path
    && left.projectDirectory === right.projectDirectory
    && left.serverId === right.serverId
    && left.branch === right.branch
    && left.label === right.label
    && left.source === right.source
    && left.name === right.name
    && left.kind === right.kind
    && left.createdFromBranch === right.createdFromBranch
    && left.relativePath === right.relativePath
    && left.worktreeRoot === right.worktreeRoot
    && left.worktreeStatus === right.worktreeStatus
    && left.headState === right.headState
    && left.worktreeSource === right.worktreeSource
    && sameWorktreeStatus(left.status, right.status);
};

export const sameWorktreeList = (
  left: readonly WorktreeMetadata[],
  right: readonly WorktreeMetadata[],
): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (!sameWorktree(left[i], right[i])) return false;
  }
  return true;
};

export const sameWorktreesByProject = (
  left: Map<string, WorktreeMetadata[]>,
  right: Map<string, WorktreeMetadata[]>,
): boolean => {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [key, leftWorktrees] of left) {
    const rightWorktrees = right.get(key);
    if (!rightWorktrees || !sameWorktreeList(leftWorktrees, rightWorktrees)) {
      return false;
    }
  }
  return true;
};

const normalizePath = (value?: string | null): string => {
  const source = (value ?? '').trim().replace(/\\/g, '/');
  if (!source) return '';
  if (source === '/') return '/';
  return source.replace(/\/+$/, '') || '/';
};

const isDefaultServer = (serverId?: string | null): boolean => {
  const value = serverId?.trim();
  return !value || value === DEFAULT_SERVER_ID;
};

export const buildWorktreeDiscoveryQueue = (
  projects: readonly WorktreeDiscoveryProjectInput[],
): WorktreeDiscoveryProject[] => {
  return projects
    .map((project, index) => {
      const normalizedPath = normalizePath(project.path);
      return { project, index, normalizedPath };
    })
    .filter(({ project, normalizedPath }) => {
      if (project.unavailable) return false;
      if (!normalizedPath) return false;
      return isDefaultServer(project.serverId) || normalizedPath !== '/';
    })
    .sort((left, right) => {
      if (left.project.pinned && !right.project.pinned) return -1;
      if (!left.project.pinned && right.project.pinned) return 1;
      return left.index - right.index;
    })
    .map(({ project, normalizedPath }) => ({
      ...project,
      path: normalizedPath,
      normalizedPath,
      discoveryKey: getProjectWorktreeKey(normalizedPath, project.serverId),
      legacyDiscoveryKey: getProjectWorktreeKey(normalizedPath, null),
    }));
};

export const flattenWorktreesByProject = (
  byProject: Map<string, WorktreeMetadata[]>,
  orderedProjectKeys: readonly string[],
): WorktreeMetadata[] => {
  const seenKeys = new Set<string>();
  const result: WorktreeMetadata[] = [];

  for (const key of orderedProjectKeys) {
    const worktrees = byProject.get(key);
    if (!worktrees) continue;
    seenKeys.add(key);
    result.push(...worktrees);
  }

  for (const [key, worktrees] of byProject) {
    if (seenKeys.has(key)) continue;
    result.push(...worktrees);
  }

  return result;
};

export const mergeProjectWorktreeResult = (
  input: MergeProjectWorktreeResultInput,
): MergeProjectWorktreeResult => {
  const byProject = new Map(input.currentByProject);

  if (input.worktrees.length > 0) {
    byProject.set(input.projectKey, input.worktrees);
  } else {
    byProject.delete(input.projectKey);
  }

  if (input.legacyProjectKey && input.legacyProjectKey !== input.projectKey) {
    byProject.delete(input.legacyProjectKey);
  }

  return {
    byProject,
    allWorktrees: flattenWorktreesByProject(byProject, input.orderedProjectKeys),
  };
};

export const pruneWorktreesForDiscoveryQueue = (
  currentByProject: Map<string, WorktreeMetadata[]>,
  projectQueue: readonly WorktreeDiscoveryProject[],
): MergeProjectWorktreeResult => {
  const orderedProjectKeys = projectQueue.map((project) => project.discoveryKey);

  const byProject = new Map<string, WorktreeMetadata[]>();
  for (const project of projectQueue) {
    const worktrees = currentByProject.get(project.discoveryKey)
      ?? (project.legacyDiscoveryKey !== project.discoveryKey
        ? currentByProject.get(project.legacyDiscoveryKey)
        : undefined);
    if (worktrees) {
      byProject.set(project.discoveryKey, worktrees);
    }
  }

  return {
    byProject,
    allWorktrees: flattenWorktreesByProject(byProject, orderedProjectKeys),
  };
};

/**
 * Merge one project's freshly discovered worktrees into the published topology
 * and re-partition by registered project. Returns null when the result is
 * identical to what is already published, so callers can skip the setState.
 * Shared by the sidebar's background discovery and the worktree-move submenu's
 * forced refresh so both write through the same authority.
 */
export const computePublishedProjectWorktrees = (args: {
  currentByProject: Map<string, WorktreeMetadata[]>;
  currentAllWorktrees: readonly WorktreeMetadata[];
  projectQueue: readonly WorktreeDiscoveryProject[];
  project: WorktreeDiscoveryProject;
  worktrees: WorktreeMetadata[];
}): { availableWorktrees: WorktreeMetadata[]; availableWorktreesByProject: Map<string, WorktreeMetadata[]> } | null => {
  const orderedProjectKeys = args.projectQueue.map((entry) => entry.discoveryKey);
  const currentProjectWorktrees = args.currentByProject.get(args.project.discoveryKey) ?? [];
  const legacyProjectHasWorktrees = args.project.legacyDiscoveryKey !== args.project.discoveryKey
    && args.currentByProject.has(args.project.legacyDiscoveryKey);

  const merged = mergeProjectWorktreeResult({
    currentByProject: args.currentByProject,
    projectKey: args.project.discoveryKey,
    legacyProjectKey: args.project.legacyDiscoveryKey,
    worktrees: args.worktrees,
    orderedProjectKeys,
  });

  if (
    !legacyProjectHasWorktrees
    && sameWorktreeList(currentProjectWorktrees, args.worktrees)
    && sameWorktreeList(args.currentAllWorktrees, merged.allWorktrees)
  ) {
    return null;
  }

  const partitionedByProject = partitionWorktreesByRegisteredProject(
    args.projectQueue.map((entry) => ({ path: entry.normalizedPath })),
    merged.byProject,
  );

  return {
    availableWorktrees: [...partitionedByProject.values()].flat(),
    availableWorktreesByProject: partitionedByProject,
  };
};
