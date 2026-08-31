import type { ProjectRef } from '@/lib/worktrees/worktreeManager';
import type { WorktreeMetadata } from '@/types/worktree';
import { normalizePath } from '@/lib/pathNormalization';

export type SessionWorktreeMenuTarget = {
  metadata: WorktreeMetadata;
  isPrimary: boolean;
  isCurrent: boolean;
};

export type StartSessionWorktreeMenuLoadArgs = {
  projectId: string | null;
  sourceDirectory: string | null;
  currentWorktree: WorktreeMetadata | null;
};

export type StartSessionWorktreeMenuLoadResult = {
  cachedTargets: SessionWorktreeMenuTarget[];
  refreshTargets: Promise<SessionWorktreeMenuTarget[]>;
};

type SessionWorktreeMenuState = {
  refreshState: 'loading' | 'error' | null;
  showNewWorktreeAction: boolean;
};

type StartSessionWorktreeMenuLoadDependencies = {
  getProjects: () => ReadonlyArray<ProjectRef>;
  getPublishedWorktreesByProject: () => Map<string, WorktreeMetadata[]>;
  getPublishedWorktrees: () => readonly WorktreeMetadata[];
  getProjectWorktrees: (
    worktreesByProject: Map<string, WorktreeMetadata[]>,
    projectPath: string,
    serverId?: string | null,
  ) => WorktreeMetadata[];
  resolveProject: (directory: string) => ProjectRef | null;
  listProjectWorktrees: (project: ProjectRef, options: { force: true }) => Promise<WorktreeMetadata[]>;
  publishProjectWorktrees: (args: { project: ProjectRef; worktrees: WorktreeMetadata[] }) => void;
  getRuntimeKey: () => string;
};

const compareLinkedTargets = (a: SessionWorktreeMenuTarget, b: SessionWorktreeMenuTarget): number => {
  const aLabel = a.metadata.branch || a.metadata.name || a.metadata.label || a.metadata.path;
  const bLabel = b.metadata.branch || b.metadata.name || b.metadata.label || b.metadata.path;
  const labelCompare = aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base' });
  if (labelCompare !== 0) {
    return labelCompare;
  }

  return a.metadata.path.localeCompare(b.metadata.path, undefined, { sensitivity: 'base' });
};

const buildFallbackLabel = (path: string): string => {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
};

const cloneMetadata = (metadata: WorktreeMetadata): WorktreeMetadata => ({
  ...metadata,
  path: normalizePath(metadata.path) ?? metadata.path,
  projectDirectory: normalizePath(metadata.projectDirectory) ?? metadata.projectDirectory,
  worktreeRoot: normalizePath(metadata.worktreeRoot ?? metadata.path) ?? metadata.worktreeRoot,
});

const buildSyntheticWorktreeMetadata = (args: {
  path: string;
  projectDirectory: string;
  currentWorktree: WorktreeMetadata | null;
}): WorktreeMetadata => {
  const { currentWorktree, path, projectDirectory } = args;
  const currentPath = normalizePath(currentWorktree?.path ?? null);
  const isCurrentPath = currentPath === path;
  const syntheticMetadata: WorktreeMetadata = {
    path,
    projectDirectory,
    branch: isCurrentPath ? (currentWorktree?.branch ?? '') : '',
    label: isCurrentPath
      ? (currentWorktree?.label || currentWorktree?.branch || currentWorktree?.name || buildFallbackLabel(path))
      : buildFallbackLabel(path),
    name: isCurrentPath ? currentWorktree?.name : undefined,
    worktreeRoot: isCurrentPath
      ? (normalizePath(currentWorktree?.worktreeRoot ?? path) ?? path)
      : path,
    // An unclassified worktree stays movable: remote discovery publishes
    // sandbox worktrees without a git-derived status, and "unknown" is not
    // evidence of "missing".
    worktreeStatus: isCurrentPath ? (currentWorktree?.worktreeStatus ?? 'ready') : 'ready',
    worktreeSource: 'existing',
    headState: isCurrentPath ? currentWorktree?.headState : undefined,
  };

  return isCurrentPath && currentWorktree
    ? { ...currentWorktree, ...syntheticMetadata }
    : syntheticMetadata;
};

export const buildSessionWorktreeMenuTargets = (args: {
  projectPath: string | null;
  discoveredWorktrees: ReadonlyArray<WorktreeMetadata>;
  sourceDirectory: string | null;
  currentWorktree: WorktreeMetadata | null;
}): SessionWorktreeMenuTarget[] => {
  const normalizedProjectPath = normalizePath(args.projectPath ?? null);
  const normalizedSourceDirectory = normalizePath(args.sourceDirectory ?? null)
    ?? normalizePath(args.currentWorktree?.path ?? null);
  const discoveredPrimaryPath = normalizePath(
    args.discoveredWorktrees.find((worktree) => normalizePath(worktree.projectDirectory ?? null))?.projectDirectory ?? null,
  );
  const currentPrimaryPath = normalizePath(args.currentWorktree?.projectDirectory ?? null);
  const primaryPath = discoveredPrimaryPath ?? currentPrimaryPath ?? normalizedProjectPath;

  const targetsByPath = new Map<string, SessionWorktreeMenuTarget>();
  const pushTarget = (target: SessionWorktreeMenuTarget): void => {
    const normalizedPath = normalizePath(target.metadata.path ?? null);
    if (!normalizedPath || targetsByPath.has(normalizedPath)) {
      return;
    }
    targetsByPath.set(normalizedPath, {
      ...target,
      metadata: cloneMetadata({
        ...target.metadata,
        path: normalizedPath,
      }),
    });
  };

  for (const worktree of args.discoveredWorktrees) {
    const normalizedPath = normalizePath(worktree.path ?? null);
    if (!normalizedPath) {
      continue;
    }
    pushTarget({
      metadata: cloneMetadata({
        ...worktree,
        path: normalizedPath,
        projectDirectory: normalizePath(worktree.projectDirectory ?? null) ?? primaryPath ?? normalizedProjectPath ?? normalizedPath,
      }),
      isPrimary: primaryPath === normalizedPath,
      isCurrent: normalizedSourceDirectory === normalizedPath,
    });
  }

  if (primaryPath && !targetsByPath.has(primaryPath)) {
    pushTarget({
      metadata: buildSyntheticWorktreeMetadata({
        path: primaryPath,
        projectDirectory: primaryPath,
        currentWorktree: args.currentWorktree,
      }),
      isPrimary: true,
      isCurrent: normalizedSourceDirectory === primaryPath,
    });
  }

  if (normalizedSourceDirectory && !targetsByPath.has(normalizedSourceDirectory)) {
    pushTarget({
      metadata: buildSyntheticWorktreeMetadata({
        path: normalizedSourceDirectory,
        projectDirectory: primaryPath ?? normalizedProjectPath ?? normalizedSourceDirectory,
        currentWorktree: args.currentWorktree,
      }),
      isPrimary: primaryPath === normalizedSourceDirectory,
      isCurrent: true,
    });
  }

  const primaryTargets: SessionWorktreeMenuTarget[] = [];
  const linkedTargets: SessionWorktreeMenuTarget[] = [];
  for (const target of targetsByPath.values()) {
    if (target.isPrimary) {
      primaryTargets.push(target);
      continue;
    }
    linkedTargets.push(target);
  }

  primaryTargets.sort((a, b) => a.metadata.path.localeCompare(b.metadata.path, undefined, { sensitivity: 'base' }));
  linkedTargets.sort(compareLinkedTargets);
  return [...primaryTargets, ...linkedTargets];
};

/**
 * A target is unmovable-to when it already hosts the session or git has
 * explicitly classified it as missing/invalid/not-a-repo. An absent
 * worktreeStatus is NOT a rejection: remote discovery publishes sandbox
 * worktrees without a git-derived status.
 */
export const isSessionWorktreeTargetMoveDisabled = (target: SessionWorktreeMenuTarget): boolean => {
  if (target.isCurrent) return true;
  const status = target.metadata.worktreeStatus;
  return status !== undefined && status !== 'ready';
};

export const startSessionWorktreeMenuLoad = (
  args: StartSessionWorktreeMenuLoadArgs,
  deps: StartSessionWorktreeMenuLoadDependencies,
): StartSessionWorktreeMenuLoadResult => {
  const runtimeKey = deps.getRuntimeKey();
  const publishedWorktreesByProject = deps.getPublishedWorktreesByProject();
  const projectById = args.projectId
    ? deps.getProjects().find((candidate) => candidate.id === args.projectId) ?? null
    : null;
  const project = projectById ?? (args.sourceDirectory ? deps.resolveProject(args.sourceDirectory) : null);
  const normalizedProjectPath = normalizePath(project?.path ?? null);
  const cachedTargets = buildSessionWorktreeMenuTargets({
    projectPath: normalizedProjectPath,
    discoveredWorktrees: normalizedProjectPath && project
      ? deps.getProjectWorktrees(publishedWorktreesByProject, normalizedProjectPath, project.serverId)
      : [],
    sourceDirectory: args.sourceDirectory,
    currentWorktree: args.currentWorktree,
  });

  return {
    cachedTargets,
    refreshTargets: (async () => {
      if (!project || !normalizedProjectPath) {
        throw new Error('Unable to resolve worktree project');
      }

      const refreshedWorktrees = await deps.listProjectWorktrees(project, { force: true });

      if (deps.getRuntimeKey() !== runtimeKey) {
        throw new Error('Runtime changed during worktree refresh');
      }

      const currentProject = deps.getProjects().find((candidate) => candidate.id === project.id) ?? null;
      if (!currentProject || normalizePath(currentProject.path ?? null) !== normalizedProjectPath) {
        throw new Error('Project removed during worktree refresh');
      }

      // Publish through the same merge/partition authority the sidebar's
      // background discovery uses, so the forced refresh cannot fork the
      // published topology.
      deps.publishProjectWorktrees({ project, worktrees: refreshedWorktrees });

      return buildSessionWorktreeMenuTargets({
        projectPath: normalizedProjectPath,
        discoveredWorktrees: refreshedWorktrees,
        sourceDirectory: args.sourceDirectory,
        currentWorktree: args.currentWorktree,
      });
    })(),
  };
};

export const getSessionWorktreeMenuState = (args: {
  targets: ReadonlyArray<SessionWorktreeMenuTarget>;
  isRefreshing: boolean;
  loadFailed: boolean;
}): SessionWorktreeMenuState => {
  return {
    refreshState: args.isRefreshing
      ? 'loading'
      : (args.loadFailed && args.targets.length === 0 ? 'error' : null),
    showNewWorktreeAction: true,
  };
};
