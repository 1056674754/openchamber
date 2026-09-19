import { substituteCommandVariables } from '@/lib/openchamberConfig';
import { toast } from '@/components/ui';
import { formatMessage, useI18nStore } from '@/lib/i18n/store';
import type { WorktreeMetadata } from '@/types/worktree';
import { execCommand } from '@/lib/execCommands';
import {
  deleteRemoteBranch,
  git,
} from '@/lib/gitApi';
import * as gitHttp from '@/lib/gitApiHttp';
import {
  clearWorktreeBootstrapState,
  markWorktreeBootstrapPending,
  setWorktreeBootstrapState,
} from '@/lib/worktrees/worktreeBootstrap';
import { invalidateResolvedProjectRootCache } from '@/lib/worktrees/worktreeStatus';
import type {
  CreateGitWorktreePayload,
  GitWorktreeValidationResult,
} from '@/lib/api/types';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { dedupeWorktreesByPath, getProjectWorktreeKey, getWorktreesForProject } from '@/lib/worktrees/worktreeKeys';

type WorktreeListEntry = {
  path?: string;
  branch?: string;
  head?: string;
  name?: string;
  prunable?: boolean;
};

const deriveHeadStateFromWorktreeEntry = (entry: WorktreeListEntry): 'branch' | 'detached' | 'unborn' => {
  const branch = (entry.branch || '').trim();
  const head = (entry.head || '').trim();
  if (!branch) {
    if (!head) return 'unborn';
    return 'detached';
  }
  return 'branch';
};

const deriveCanonicalWorktreeFields = (
  entry: WorktreeListEntry,
  worktreePath: string,
): Pick<WorktreeMetadata, 'worktreeRoot' | 'worktreeStatus' | 'headState' | 'worktreeSource'> => {
  return {
    worktreeRoot: worktreePath,
    // A prunable worktree is still registered by git but its directory is
    // gone. It stays in the topology as `missing` so the sessions that lived
    // there keep their group in the sidebar and can be opened and relocated;
    // dropping it would hide those sessions with no way back.
    worktreeStatus: entry.prunable === true ? 'missing' : 'ready',
    headState: deriveHeadStateFromWorktreeEntry(entry),
    worktreeSource: 'existing',
  };
};

export type ProjectRef = { id: string; path: string; serverId?: string; label?: string };

const normalizePath = (value: string): string => {
  const replaced = value.replace(/\\/g, '/');
  if (replaced === '/') {
    return '/';
  }
  return replaced.length > 1 ? replaced.replace(/\/+$/, '') : replaced;
};

export const getLatestWorktreeMetadata = (metadata: WorktreeMetadata): WorktreeMetadata => {
  const target = normalizePath(metadata.path);
  const state = useSessionUIStore.getState();
  const available = state.availableWorktrees.find((candidate) => normalizePath(candidate.path) === target);
  if (available) return available;
  for (const worktrees of state.availableWorktreesByProject.values()) {
    const candidate = worktrees.find((worktree) => normalizePath(worktree.path) === target);
    if (candidate) return candidate;
  }
  return metadata;
};

/** The name the sidebar shows for a worktree, used in worktree-scoped toasts. */
export const getWorktreeDisplayName = (worktree: WorktreeMetadata): string =>
  worktree.branch || worktree.label || worktree.path;

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

const getProjectBaseUrl = (project: ProjectRef): string | undefined => {
  const serverId = project.serverId?.trim();
  if (!serverId || serverId === DEFAULT_SERVER_ID) {
    return undefined;
  }
  return serverRegistry.get(serverId)?.config.baseUrl ?? `/api/remote/${encodeURIComponent(serverId)}`;
};

const resolvePrimaryWorktreeDirectory = async (directory: string, baseUrl?: string): Promise<string> => {
  const normalizedDirectory = normalizePath(directory);

  const absoluteGitDirResult = await execCommand('git rev-parse --absolute-git-dir', normalizedDirectory, { baseUrl });
  const absoluteGitDir = normalizePath((absoluteGitDirResult.stdout || '').trim());
  if (absoluteGitDirResult.success && absoluteGitDir) {
    const rootFromAbsoluteGitDir = derivePrimaryWorktreeRootFromGitDir(absoluteGitDir);
    if (rootFromAbsoluteGitDir) {
      return rootFromAbsoluteGitDir;
    }
  }

  const commonDirResult = await execCommand('git rev-parse --git-common-dir', normalizedDirectory, { baseUrl });
  const rawCommonDir = normalizePath((commonDirResult.stdout || '').trim());
  if (!commonDirResult.success || !rawCommonDir) {
    return normalizedDirectory;
  }

  const commonDir = toAbsolutePath(normalizedDirectory, rawCommonDir);
  const rootFromCommonDir = derivePrimaryWorktreeRootFromGitDir(commonDir);
  if (rootFromCommonDir) {
    return rootFromCommonDir;
  }

  return normalizedDirectory;
};

const slugifyWorktreeName = (value: string): string => {
  return value
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^heads\//, '')
    .replace(/\s+/g, '-')
    .replace(/^\/+|\/+$/g, '')
    .split('/').join('-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
};

const normalizeBranchName = (value: string): string => {
  return value
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^heads\//, '')
    .replace(/\s+/g, '-')
    .replace(/^\/+|\/+$/g, '');
};

const deriveSdkWorktreeNameFromDirectory = (directory: string): string => {
  const normalized = normalizePath(directory);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
};

export const buildSdkStartCommand = (args: {
  projectDirectory: string;
  setupCommands: string[];
}): string | undefined => {
  const commands: string[] = [];

  for (const raw of args.setupCommands) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    commands.push(
      substituteCommandVariables(trimmed, { rootWorktreePath: args.projectDirectory })
    );
  }

  const joined = commands.filter(Boolean).join(' && ');
  return joined.trim().length > 0 ? joined : undefined;
};

const toCreatePayload = (args: {
  preferredName?: string;
  setupCommands?: string[];
  mode?: 'new' | 'existing';
  worktreeName?: string;
  branchName?: string;
  existingBranch?: string;
  startRef?: string;
  setUpstream?: boolean;
  upstreamRemote?: string;
  upstreamBranch?: string;
  ensureRemoteName?: string;
  ensureRemoteUrl?: string;
}, projectDirectory: string): CreateGitWorktreePayload => {
  const mode = args.mode === 'existing' ? 'existing' : 'new';

  const worktreeNameSeed = args.worktreeName ?? args.preferredName ?? '';
  const worktreeName = slugifyWorktreeName(worktreeNameSeed);

  const branchNameSeed = args.branchName ?? (mode === 'new' ? args.preferredName : undefined) ?? '';
  const branchName = normalizeBranchName(branchNameSeed);

  const existingBranch = normalizeBranchName(args.existingBranch ?? args.branchName ?? '');
  const startRef = (args.startRef || '').trim();

  const commands = Array.isArray(args.setupCommands) ? args.setupCommands : [];
  const startCommand = buildSdkStartCommand({
    projectDirectory,
    setupCommands: commands,
  });

  return {
    mode,
    ...(worktreeName ? { worktreeName } : {}),
    ...(branchName ? { branchName } : {}),
    ...(existingBranch ? { existingBranch } : {}),
    ...(startRef ? { startRef } : {}),
    ...(startCommand ? { startCommand } : {}),
    ...(args.setUpstream ? { setUpstream: true } : {}),
    ...(args.upstreamRemote ? { upstreamRemote: args.upstreamRemote } : {}),
    ...(args.upstreamBranch ? { upstreamBranch: args.upstreamBranch } : {}),
    ...(args.ensureRemoteName ? { ensureRemoteName: args.ensureRemoteName } : {}),
    ...(args.ensureRemoteUrl ? { ensureRemoteUrl: args.ensureRemoteUrl } : {}),
  };
};

// Cache worktree listings to avoid repeated git worktree list + rev-parse calls.
// The generation counter separates a forced refresh from an older in-flight
// listing: a forced read starts a new request instead of joining the previous
// one, and a stale completion can neither satisfy the caller nor overwrite the
// forced result.
const _worktreeListCache = new Map<string, { value: WorktreeMetadata[]; at: number }>();
const _worktreeListInflight = new Map<string, { generation: number; promise: Promise<WorktreeMetadata[]> }>();
const _worktreeListGeneration = new Map<string, number>();
const WORKTREE_LIST_CACHE_TTL = 30_000; // 30 seconds

const getWorktreeListGeneration = (cacheKey: string): number => _worktreeListGeneration.get(cacheKey) ?? 0;

const invalidateWorktreeList = (cacheKey: string): void => {
  _worktreeListGeneration.set(cacheKey, getWorktreeListGeneration(cacheKey) + 1);
  _worktreeListCache.delete(cacheKey);
};

type WorktreeTopologyListener = (projectDirectory: string) => void;
const worktreeTopologyListeners = new Set<WorktreeTopologyListener>();

/**
 * Subscribe to in-app evidence that a project's worktree topology changed
 * outside the flows that publish it themselves (a session relocated out of a
 * directory the server confirmed missing). The sidebar rediscovers on this
 * signal the same way it does for the server's `session-created` event, so
 * the topology stays event-driven with no idle polling.
 */
export const subscribeWorktreeTopologyChanged = (listener: WorktreeTopologyListener): (() => void) => {
  worktreeTopologyListeners.add(listener);
  return () => {
    worktreeTopologyListeners.delete(listener);
  };
};

export const notifyWorktreeTopologyChanged = (projectDirectory: string): void => {
  const normalized = normalizePath(projectDirectory);
  for (const [key] of _worktreeListCache) {
    invalidateWorktreeList(key);
  }
  for (const listener of worktreeTopologyListeners) listener(normalized);
};

export async function listProjectWorktrees(project: ProjectRef, options?: { force?: boolean }): Promise<WorktreeMetadata[]> {
  const projectDirectory = normalizePath(project.path);
  const baseUrl = getProjectBaseUrl(project);
  const cacheKey = getProjectWorktreeKey(projectDirectory, project.serverId);
  const force = options?.force === true;

  if (force) {
    invalidateWorktreeList(cacheKey);
  }

  const generation = getWorktreeListGeneration(cacheKey);

  // Return cached if fresh
  const cached = _worktreeListCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < WORKTREE_LIST_CACHE_TTL) {
    return cached.value;
  }

  // Dedup in-flight requests. A forced refresh (or any call made after an
  // invalidation) must not join a request started before it: that request's
  // result predates whatever prompted the refresh.
  const inflight = _worktreeListInflight.get(cacheKey);
  if (inflight && inflight.generation === generation) return inflight.promise;

  const readProjectWorktrees = async (): Promise<WorktreeMetadata[]> => {
    const metadataProjectDirectory = await resolvePrimaryWorktreeDirectory(projectDirectory, baseUrl).catch(() => projectDirectory);
    const normalizedProjectDirectory = normalizePath(projectDirectory);
    const serverId = project.serverId && project.serverId !== DEFAULT_SERVER_ID ? project.serverId : undefined;

    const worktrees = await (baseUrl
      ? gitHttp.listGitWorktrees(projectDirectory, baseUrl)
      : git.worktree.list(projectDirectory)
    );
    const results: WorktreeMetadata[] = worktrees
      .filter((entry) => typeof entry.path === 'string' && entry.path.trim().length > 0)
      .map((entry) => {
        const worktreePath = normalizePath(entry.path);
        const branch = (entry.branch || '').replace(/^refs\/heads\//, '').trim();
        const name = (entry.name || '').trim();

        // Derive canonical worktree metadata from worktree list entry
        const canonical = deriveCanonicalWorktreeFields(entry, worktreePath);

        return {
          source: 'sdk' as const,
          name: name || deriveSdkWorktreeNameFromDirectory(worktreePath),
          path: worktreePath,
          projectDirectory: metadataProjectDirectory,
          ...(serverId ? { serverId } : {}),
          branch: branch,
          label: branch || name || deriveSdkWorktreeNameFromDirectory(worktreePath),
          worktreeRoot: canonical.worktreeRoot,
          worktreeStatus: canonical.worktreeStatus,
          headState: canonical.headState,
          worktreeSource: canonical.worktreeSource,
        };
      })
      .filter((entry) => normalizePath(entry.path) !== normalizedProjectDirectory);

    return dedupeWorktreesByPath(results, project.serverId).sort((a, b) => {
      const aLabel = (a.label || a.branch || a.path).toLowerCase();
      const bLabel = (b.label || b.branch || b.path).toLowerCase();
      return aLabel.localeCompare(bLabel);
    });
  };

  const readStableProjectWorktrees = async (minimumGeneration: number): Promise<WorktreeMetadata[]> => {
    while (true) {
      const observedGeneration = getWorktreeListGeneration(cacheKey);
      const worktrees = await readProjectWorktrees();

      // A concurrent invalidation (worktree create/remove or a forced refresh)
      // moved the generation while the listing ran: retry so the returned
      // topology never predates the invalidation.
      if (observedGeneration >= minimumGeneration && observedGeneration === getWorktreeListGeneration(cacheKey)) {
        return worktrees;
      }
    }
  };

  const promise = readStableProjectWorktrees(generation).then((sorted) => {
    _worktreeListCache.set(cacheKey, { value: sorted, at: Date.now() });
    return sorted;
  }).finally(() => {
    if (_worktreeListInflight.get(cacheKey)?.promise === promise) {
      _worktreeListInflight.delete(cacheKey);
    }
  });

  _worktreeListInflight.set(cacheKey, { generation, promise });
  return promise;
}

export const partitionWorktreesByRegisteredProject = (
  projects: ReadonlyArray<Pick<ProjectRef, 'path'>>,
  worktreesByProject: ReadonlyMap<string, WorktreeMetadata[]>,
): Map<string, WorktreeMetadata[]> => {
  const configuredProjectOrder = new Map<string, number>();
  projects.forEach((project, index) => {
    const projectPath = normalizePath(project.path.trim());
    if (projectPath && !configuredProjectOrder.has(projectPath)) {
      configuredProjectOrder.set(projectPath, index);
    }
  });

  type RepositorySource = {
    projectPath: string;
    worktrees: WorktreeMetadata[];
    projectIndex: number;
  };

  const sourcesByRepository = new Map<string, RepositorySource[]>();
  for (const [rawProjectPath, worktrees] of worktreesByProject) {
    if (worktrees.length === 0) continue;
    const projectPath = normalizePath(rawProjectPath.trim());
    const projectIndex = configuredProjectOrder.get(projectPath);
    if (!projectPath || projectIndex === undefined) continue;

    const metadataRoot = worktrees.find((worktree) => worktree.projectDirectory?.trim())?.projectDirectory;
    const repositoryRoot = normalizePath((metadataRoot || projectPath).trim());
    if (!repositoryRoot) continue;

    const sources = sourcesByRepository.get(repositoryRoot) ?? [];
    sources.push({ projectPath, worktrees, projectIndex });
    sourcesByRepository.set(repositoryRoot, sources);
  }

  const partitioned = new Map<string, WorktreeMetadata[]>();
  for (const [repositoryRoot, sources] of sourcesByRepository) {
    sources.sort((a, b) => a.projectIndex - b.projectIndex || a.projectPath.localeCompare(b.projectPath));
    const firstSource = sources[0];
    if (!firstSource) continue;

    const ownerPath = configuredProjectOrder.has(repositoryRoot) ? repositoryRoot : firstSource.projectPath;
    const topologySource = sources.find((candidate) => candidate.projectPath === ownerPath) ?? firstSource;

    const seenPaths = new Set<string>();
    const ownedWorktrees = topologySource.worktrees.filter((worktree) => {
      const worktreePath = normalizePath(worktree.path.trim());
      if (!worktreePath || configuredProjectOrder.has(worktreePath) || seenPaths.has(worktreePath)) {
        return false;
      }
      seenPaths.add(worktreePath);
      return true;
    });

    if (ownedWorktrees.length > 0) {
      partitioned.set(ownerPath, ownedWorktrees);
    }
  }

  return partitioned;
};

export type CreateWorktreeArgs = {
  preferredName?: string;
  setupCommands?: string[];
  mode?: 'new' | 'existing';
  worktreeName?: string;
  branchName?: string;
  existingBranch?: string;
  startRef?: string;
  setUpstream?: boolean;
  upstreamRemote?: string;
  upstreamBranch?: string;
  ensureRemoteName?: string;
  ensureRemoteUrl?: string;
  /** Reserved for API parity; fork create already returns after git worktree add. */
  returnAfterDirectoryCreated?: boolean;
};

export async function createWorktree(project: ProjectRef, args: CreateWorktreeArgs): Promise<WorktreeMetadata> {
  const projectDirectory = normalizePath(project.path);
  const baseUrl = getProjectBaseUrl(project);
  const metadataProjectDirectory = await resolvePrimaryWorktreeDirectory(projectDirectory, baseUrl).catch(() => projectDirectory);
  const payload = toCreatePayload(args, projectDirectory);

  const created = baseUrl
    ? await gitHttp.createGitWorktree(projectDirectory, payload, baseUrl)
    : await git.worktree.create(projectDirectory, payload);
  if (created?.sourceFetchFailed) {
    toast.warning(
      formatMessage(useI18nStore.getState().dictionary, 'session.newWorktree.toast.fetchSourceFailed'),
    );
  }
  const returnedName = typeof created?.name === 'string' ? created.name : '';
  const returnedBranch = typeof created?.branch === 'string' ? created.branch : '';
  const returnedPath = typeof created?.path === 'string' ? created.path : '';

  if (!returnedName || !returnedPath) {
    throw new Error('Worktree create missing name/path');
  }

  const metadata: WorktreeMetadata = {
    source: 'sdk',
    name: returnedName,
    path: normalizePath(returnedPath),
    projectDirectory: metadataProjectDirectory,
    ...(project.serverId && project.serverId !== DEFAULT_SERVER_ID ? { serverId: project.serverId } : {}),
    branch: returnedBranch,
    label: returnedBranch || returnedName,
    worktreeRoot: normalizePath(returnedPath),
    worktreeStatus: 'ready',
    headState: returnedBranch ? 'branch' : 'unborn',
    worktreeSource: 'created-for-session',
  };

  if (created?.bootstrapStatus) {
    setWorktreeBootstrapState(metadata.path, created.bootstrapStatus);
  } else {
    markWorktreeBootstrapPending(metadata.path);
  }

  invalidateWorktreeList(getProjectWorktreeKey(projectDirectory, project.serverId));
  invalidateResolvedProjectRootCache();

  // Update sidebar store so new worktree appears immediately
  const sidebarProjectKey = getProjectWorktreeKey(projectDirectory, project.serverId);
  const currentByProject = useSessionUIStore.getState().availableWorktreesByProject;
  const updatedByProject = new Map(currentByProject);
  const existing = getWorktreesForProject(updatedByProject, projectDirectory, project.serverId);
  updatedByProject.set(sidebarProjectKey, [...existing, metadata]);
  useSessionUIStore.setState({
    availableWorktreesByProject: updatedByProject,
    availableWorktrees: [...useSessionUIStore.getState().availableWorktrees, metadata],
  });

  return metadata;
}

export async function validateWorktreeCreate(project: ProjectRef, args: CreateWorktreeArgs): Promise<GitWorktreeValidationResult> {
  const projectDirectory = project.path;
  const payload = toCreatePayload(args, projectDirectory);
  const baseUrl = getProjectBaseUrl(project);
  return baseUrl
    ? gitHttp.validateGitWorktree(projectDirectory, payload, baseUrl)
    : git.worktree.validate(projectDirectory, payload);
}

export async function removeProjectWorktree(project: ProjectRef, worktree: WorktreeMetadata, options?: {
  deleteRemoteBranch?: boolean;
  deleteLocalBranch?: boolean;
  remoteName?: string;
}): Promise<void> {
  const projectDirectory = normalizePath(project.path);
  const baseUrl = getProjectBaseUrl(project);

  const deleteRemote = Boolean(options?.deleteRemoteBranch);
  const deleteLocalBranch = options?.deleteLocalBranch === true;
  const remoteName = options?.remoteName;
  const raw = baseUrl
    ? await gitHttp.deleteGitWorktree(projectDirectory, {
      directory: worktree.path,
      deleteLocalBranch,
    }, baseUrl)
    : await git.worktree.remove(projectDirectory, {
      directory: worktree.path,
      deleteLocalBranch,
    });
  if (!raw?.success) {
    throw new Error('Worktree removal failed');
  }

  clearWorktreeBootstrapState(worktree.path);

  invalidateWorktreeList(getProjectWorktreeKey(project.path, project.serverId));
  invalidateResolvedProjectRootCache();

  // Update sidebar store so removed worktree disappears immediately. The
  // entry may be filed under a different registered project than the one the
  // removal was requested from, so every project group is cleaned — but only
  // within the removed worktree's server scope.
  const normalizedWorktreePath = normalizePath(worktree.path);
  const removedServerId = project.serverId?.trim() || worktree.serverId?.trim() || '';
  const currentByProject = useSessionUIStore.getState().availableWorktreesByProject;
  const updatedByProject = new Map(currentByProject);
  for (const [projectKey, projectWorktrees] of currentByProject) {
    const remainingWorktrees = projectWorktrees.filter((candidate) => {
      if (normalizePath(candidate.path) !== normalizedWorktreePath) return true;
      const candidateServerId = candidate.serverId?.trim() || '';
      return candidateServerId !== removedServerId;
    });
    if (remainingWorktrees.length !== projectWorktrees.length) {
      updatedByProject.set(projectKey, remainingWorktrees);
    }
  }

  // Clean up worktreeMetadata for sessions in the removed worktree
  const currentMetadata = useSessionUIStore.getState().worktreeMetadata;
  const updatedMetadata = new Map(currentMetadata);
  for (const [sid, meta] of currentMetadata.entries()) {
    if (meta && normalizePath(meta.path) === normalizedWorktreePath) {
      const metaServerId = meta.serverId?.trim() || '';
      if (metaServerId === removedServerId) {
        updatedMetadata.delete(sid);
      }
    }
  }

  useSessionUIStore.setState({
    availableWorktreesByProject: updatedByProject,
    availableWorktrees: useSessionUIStore.getState().availableWorktrees.filter(
      (w) => normalizePath(w.path) !== normalizedWorktreePath
        || (w.serverId?.trim() || '') !== removedServerId,
    ),
    worktreeMetadata: updatedMetadata,
  });

  const branchName = (worktree.branch || '').replace(/^refs\/heads\//, '').trim();
  if (deleteRemote && branchName) {
    if (baseUrl) {
      await gitHttp.deleteRemoteBranch(projectDirectory, { branch: branchName, remote: remoteName }, baseUrl).catch(() => undefined);
    } else {
      await deleteRemoteBranch(projectDirectory, { branch: branchName, remote: remoteName }).catch(() => undefined);
    }
  }
}
