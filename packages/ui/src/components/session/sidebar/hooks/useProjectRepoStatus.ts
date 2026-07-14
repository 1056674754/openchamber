import React from 'react';
import { getRootBranch } from '@/lib/worktrees/worktreeStatus';
import { mapWithConcurrency } from '@/lib/concurrency';
import { useGitStore } from '@/stores/useGitStore';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { retryProjectRepoStatusProbe } from './project-repo-status-probe';

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
  }, [remoteServerIds, remoteServerIdsKey]);

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
    if (!git || normalizedProjects.length === 0) {
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
  }, [normalizedProjects.length, probeProjects, git, ensureStatus, setProjectRepoStatus]);

  // Read isGitRepo from the store-populated state
  React.useEffect(() => {
    const next = new Map<string, boolean | null>();
    normalizedProjects.forEach((project) => {
      next.set(project.id, gitRepoStatus.get(project.normalizedPath)?.isGitRepo ?? null);
    });
    setProjectRepoStatus((prev) => projectRepoStatusEqual(prev, next) ? prev : next);
  }, [normalizedProjects, gitRepoStatus, setProjectRepoStatus]);

  const projectGitBranchesKey = React.useMemo(() => {
    return probeProjects
      .map((project) => {
        const branch = gitRepoStatus.get(project.normalizedPath)?.branch ?? '';
        return `${project.id}:${project.serverId ?? DEFAULT_SERVER_ID}:${branch}`;
      })
      .join('|');
  }, [probeProjects, gitRepoStatus]);

  const resolvedInputKeyByProjectId = React.useRef<Map<string, string>>(new Map());

  React.useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      const run = async () => {
        const validIds = new Set(probeProjects.map((project) => project.id));
        for (const id of resolvedInputKeyByProjectId.current.keys()) {
          if (!validIds.has(id)) {
            resolvedInputKeyByProjectId.current.delete(id);
          }
        }

        const pending = probeProjects.filter((project) => {
          const status = gitRepoStatus.get(project.normalizedPath);
          if (status?.isGitRepo === false) {
            resolvedInputKeyByProjectId.current.delete(project.id);
            return false;
          }
          if (status?.isGitRepo !== true || status.branch === null) {
            return false;
          }

          const currentBranch = status.branch.trim();
          const currentInputKey = `${project.serverId ?? DEFAULT_SERVER_ID}\0${project.normalizedPath}\0${currentBranch}`;
          const lastInputKey = resolvedInputKeyByProjectId.current.get(project.id);
          return lastInputKey === undefined || lastInputKey !== currentInputKey;
        });

        if (pending.length === 0) {
          return;
        }

        const entries = await mapWithConcurrency(pending, 2, async (project) => {
          const inputBranch = gitRepoStatus.get(project.normalizedPath)?.branch?.trim() ?? '';
          const inputKey = `${project.serverId ?? DEFAULT_SERVER_ID}\0${project.normalizedPath}\0${inputBranch}`;
          const branch = await getRootBranch(project.normalizedPath, {
            ...(inputBranch ? { knownBranch: inputBranch } : {}),
            ...(getProjectBaseUrl(project) ? { baseUrl: getProjectBaseUrl(project) } : {}),
          }).catch(() => null);
          return { id: project.id, inputKey, branch };
        });

        if (cancelled) {
          return;
        }

        const resolved = entries.filter((entry) => entry.branch);
        if (resolved.length === 0) {
          return;
        }

        setProjectRootBranches((prev) => {
          const next = new Map(prev);
          let changed = false;
          resolved.forEach(({ id, branch }) => {
            if (branch && next.get(id) !== branch) {
              next.set(id, branch);
              changed = true;
            }
          });
          return changed ? next : prev;
        });
        resolved.forEach(({ id, inputKey }) => {
          resolvedInputKeyByProjectId.current.set(id, inputKey);
        });
      };
      void run();
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [probeProjects, projectGitBranchesKey, gitRepoStatus, setProjectRootBranches]);
};
