import React from 'react';
import { getRootBranch } from '@/lib/worktrees/worktreeStatus';
import { mapWithConcurrency } from '@/lib/concurrency';
import { useGitStore } from '@/stores/useGitStore';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';

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

const isLocalProject = (project: Project): boolean => (
  !project.serverId || project.serverId === DEFAULT_SERVER_ID
);

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
  const localProjects = React.useMemo(
    () => normalizedProjects.filter(isLocalProject),
    [normalizedProjects],
  );

  // Derive repo status from centralized Git store
  React.useEffect(() => {
    if (!git || normalizedProjects.length === 0) {
      setProjectRepoStatus((prev) => prev.size === 0 ? prev : new Map());
      return;
    }

    // Trigger ensureStatus for each project to populate store
    probeProjects.forEach((project) => {
      void ensureStatus(project.normalizedPath, git);
    });
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
    return localProjects
      .map((project) => {
        const branch = gitRepoStatus.get(project.normalizedPath)?.branch ?? '';
        return `${project.id}:${branch}`;
      })
      .join('|');
  }, [localProjects, gitRepoStatus]);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const entries = await mapWithConcurrency(localProjects, 2, async (project) => {
        const branch = await getRootBranch(project.normalizedPath).catch(() => null);
        return { id: project.id, branch };
      });
      if (cancelled) {
        return;
      }
      setProjectRootBranches((prev) => {
        const next = new Map(prev);
        let changed = false;
        entries.forEach(({ id, branch }) => {
          if (branch && next.get(id) !== branch) {
            next.set(id, branch);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [localProjects, projectGitBranchesKey, setProjectRootBranches]);
};
