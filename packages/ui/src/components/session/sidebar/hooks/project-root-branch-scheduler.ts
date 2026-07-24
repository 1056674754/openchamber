export type ProjectRootBranchCandidate = {
  id: string;
  inputKey: string;
  resolve: () => Promise<string | null>;
};

type ProjectRootBranchResult = {
  id: string;
  branch: string;
};

type Options = {
  concurrency: number;
  onResolved: (result: ProjectRootBranchResult) => void;
};

export type ProjectRootBranchScheduler = {
  sync: (candidates: ProjectRootBranchCandidate[]) => void;
  dispose: () => void;
};

export const createProjectRootBranchScheduler = ({
  concurrency,
  onResolved,
}: Options): ProjectRootBranchScheduler => {
  const maxConcurrency = Math.max(1, concurrency);
  const pendingByProjectId = new Map<string, ProjectRootBranchCandidate>();
  const activeInputByProjectId = new Map<string, string>();
  const currentInputByProjectId = new Map<string, string>();
  const resolvedInputByProjectId = new Map<string, string>();
  let activeCount = 0;
  let disposed = false;

  const drain = () => {
    if (disposed) {
      return;
    }

    while (activeCount < maxConcurrency && pendingByProjectId.size > 0) {
      const nextEntry = pendingByProjectId.entries().next().value;
      if (!nextEntry) {
        return;
      }

      const [projectId, candidate] = nextEntry;
      pendingByProjectId.delete(projectId);

      if (
        currentInputByProjectId.get(projectId) !== candidate.inputKey
        || resolvedInputByProjectId.get(projectId) === candidate.inputKey
        || activeInputByProjectId.get(projectId) === candidate.inputKey
      ) {
        continue;
      }

      activeCount += 1;
      activeInputByProjectId.set(projectId, candidate.inputKey);

      void (async () => {
        try {
          const branch = await candidate.resolve();
          if (
            disposed
            || !branch
            || currentInputByProjectId.get(projectId) !== candidate.inputKey
          ) {
            return;
          }

          resolvedInputByProjectId.set(projectId, candidate.inputKey);
          onResolved({ id: projectId, branch });
        } catch {
          return;
        } finally {
          if (activeInputByProjectId.get(projectId) === candidate.inputKey) {
            activeInputByProjectId.delete(projectId);
          }
          activeCount -= 1;
          drain();
        }
      })();
    }
  };

  return {
    sync: (candidates) => {
      if (disposed) {
        return;
      }

      const nextInputByProjectId = new Map(
        candidates.map((candidate) => [candidate.id, candidate.inputKey]),
      );

      for (const projectId of currentInputByProjectId.keys()) {
        if (!nextInputByProjectId.has(projectId)) {
          currentInputByProjectId.delete(projectId);
          pendingByProjectId.delete(projectId);
          resolvedInputByProjectId.delete(projectId);
        }
      }

      for (const candidate of candidates) {
        currentInputByProjectId.set(candidate.id, candidate.inputKey);
        if (
          resolvedInputByProjectId.get(candidate.id) === candidate.inputKey
          || activeInputByProjectId.get(candidate.id) === candidate.inputKey
        ) {
          continue;
        }
        pendingByProjectId.set(candidate.id, candidate);
      }

      drain();
    },
    dispose: () => {
      disposed = true;
      pendingByProjectId.clear();
      currentInputByProjectId.clear();
    },
  };
};
