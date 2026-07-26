import React from 'react';
import { getRootBranch } from '@/lib/worktrees/worktreeStatus';
import { mapWithConcurrency } from '@/lib/concurrency';
import { useGitStore } from '@/stores/useGitStore';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { retryProjectRepoStatusProbe } from './project-repo-status-probe';
import { createProjectRootBranchScheduler } from './project-root-branch-scheduler';

type Project = {
  id: string;
  path: string;
  normalizedPath: string;
  serverId?: string;
  unavailable?: boolean;
};

type Args = {
  normalizedProjects: Project[];
  gitRepoStatus: Map<string, { isGitRepo: boolean | null; branch: string | null }>;
  setProjectRepoStatus: React.Dispatch<React.SetStateAction<Map<string, boolean | null>>>;
  setProjectRootBranches: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  /** When false, skip light-status burst / remote health subscriptions. Default true. */
  enabled?: boolean;
};

const PROJECT_STATUS_PROBE_CONCURRENCY = 3;

const projectRepoStatusEqual = (
  left: Map<string, boolean | null>,
  right: Map<string, boolean | null>,
): boolean => {
  if (left === right) return true;
  if (left.size !== right.size) return false;

  for (const [projectId, status] of left) {
    if (right.get(projectId) !== status) {
      return false;
    }
  }

  return true;
};

const getProjectBaseUrl = (project: Project): string | undefined => {
  const serverId = project.serverId?.trim();
  if (!serverId || serverId === DEFAULT_SERVER_ID) {
    return undefined;
  }
  return serverRegistry.get(serverId)?.config.baseUrl ?? `/api/remote/${encodeURIComponent(serverId)}`;
};

const sameServerHealthMap = (
  left: Map<string, string | null>,
  right: Map<string, string | null>,
): boolean => {
  if (left.size !== right.size) return false;
  for (const [serverId, health] of left) {
    if (right.get(serverId) !== health) return false;
  }
  return true;
};

export const useProjectRepoStatus = (args: Args): void => {
  const {
    normalizedProjects,
    gitRepoStatus,
    setProjectRepoStatus,
    setProjectRootBranches,
    enabled = true,
  } = args;

  const { git } = useRuntimeAPIs();
  const ensureStatus = useGitStore((state) => state.ensureStatus);
  const remoteServerIds = React.useMemo(() => {
    return Array.from(
      new Set(
        normalizedProjects
          .map((project) => project.serverId)
          .filter((serverId): serverId is string => Boolean(serverId && serverId !== DEFAULT_SERVER_ID)),
      ),
    ).sort();
  }, [normalizedProjects]);
  const remoteServerIdsKey = remoteServerIds.join('|');
  const [serverHealthById, setServerHealthById] = React.useState<Map<string, string | null>>(() => new Map());

  React.useEffect(() => {
    if (!enabled) return;
    const readHealth = () => {
      const next = new Map<string, string | null>();
      for (const serverId of remoteServerIds) {
        next.set(serverId, serverRegistry.get(serverId)?.healthStatus ?? null);
      }
      setServerHealthById((prev) => sameServerHealthMap(prev, next) ? prev : next);
    };

    readHealth();
    if (remoteServerIds.length === 0) return undefined;
    const unsubs = remoteServerIds.map((serverId) =>
      serverRegistry.onHealthChange(serverId, readHealth),
    );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [enabled, remoteServerIds, remoteServerIdsKey]);

  const probeProjects = React.useMemo(
    () => normalizedProjects.filter((project) => {
      if (!project.serverId || project.serverId === DEFAULT_SERVER_ID) {
        return true;
      }
      if (project.unavailable) {
        return false;
      }
      return serverHealthById.get(project.serverId) === 'healthy';
    }),
    [normalizedProjects, serverHealthById],
  );
  // Derive repo status from centralized Git store
  React.useEffect(() => {
    if (!enabled || !git || normalizedProjects.length === 0) {
      if (!enabled) return;
      setProjectRepoStatus((prev) => prev.size === 0 ? prev : new Map());
      return;
    }

    const controller = new AbortController();
    void mapWithConcurrency(probeProjects, PROJECT_STATUS_PROBE_CONCURRENCY, async (project) => {
      await retryProjectRepoStatusProbe(
        () => ensureStatus(project.normalizedPath, git, {
          mode: 'light',
          reportErrors: false,
        }),
        { signal: controller.signal },
      );
    }).catch(() => {
      // Individual status fetches update the store with their own failure state.
    });

    return () => {
      controller.abort();
    };
  }, [enabled, normalizedProjects.length, probeProjects, git, ensureStatus, setProjectRepoStatus]);

  // Read isGitRepo from the store-populated state
  React.useEffect(() => {
    const next = new Map<string, boolean | null>();
    normalizedProjects.forEach((project) => {
      next.set(project.id, gitRepoStatus.get(project.normalizedPath)?.isGitRepo ?? null);
    });
    setProjectRepoStatus((prev) => projectRepoStatusEqual(prev, next) ? prev : next);
  }, [normalizedProjects, gitRepoStatus, setProjectRepoStatus]);

  const rootBranchScheduler = React.useMemo(
    () => createProjectRootBranchScheduler({
      concurrency: 2,
      onResolved: ({ id, branch }) => {
        setProjectRootBranches((prev) => {
          if (prev.get(id) === branch) {
            return prev;
          }
          const next = new Map(prev);
          next.set(id, branch);
          return next;
        });
      },
    }),
    [setProjectRootBranches],
  );

  React.useEffect(() => {
    const candidates = probeProjects.flatMap((project) => {
      const status = gitRepoStatus.get(project.normalizedPath);
      if (status?.isGitRepo !== true || status.branch === null) {
        return [];
      }

      const inputBranch = status.branch.trim();
      const inputKey = `${project.serverId ?? DEFAULT_SERVER_ID}\0${project.normalizedPath}\0${inputBranch}`;
      const baseUrl = getProjectBaseUrl(project);
      return [{
        id: project.id,
        inputKey,
        resolve: () => getRootBranch(project.normalizedPath, {
          ...(inputBranch ? { knownBranch: inputBranch } : {}),
          ...(baseUrl ? { baseUrl } : {}),
        }),
      }];
    });
    rootBranchScheduler.sync(candidates);
  }, [probeProjects, gitRepoStatus, rootBranchScheduler]);

  React.useEffect(() => {
    return () => {
      rootBranchScheduler.dispose();
    };
  }, [rootBranchScheduler]);
};
