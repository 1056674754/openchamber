import type { ProjectEntry } from '@/lib/api/types';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { normalizePath } from '@/lib/pathNormalization';
import { resolveProjectForSessionDirectory } from '@/lib/projectResolution';
import type { ProviderResult, UsageWindow } from '@/types/quota';
import type { WorktreeMetadata } from '@/types/worktree';
import type { NewSessionDraftState } from '@/sync/session-ui-store';

export type DraftWorkStatusAuthority = {
  directory: string;
  project: ProjectEntry | null;
  /** Null means an explicit project id could not be resolved. */
  serverId: string | null;
};

type ResolveDraftAuthorityInput = {
  draft: Pick<
    NewSessionDraftState,
    'open' | 'selectedProjectId' | 'directoryOverride' | 'bootstrapPendingDirectory'
  >;
  projects: ProjectEntry[];
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>;
  activeProjectId: string | null;
};

/**
 * Resolve a new draft from the draft itself, never from the currently open
 * session. The selected project owns sibling worktrees and duplicate paths on
 * another server; a missing explicit project fails closed instead of becoming
 * a local request.
 */
export const resolveDraftWorkStatusAuthority = ({
  draft,
  projects,
  availableWorktreesByProject,
  activeProjectId,
}: ResolveDraftAuthorityInput): DraftWorkStatusAuthority | null => {
  if (!draft.open) return null;

  const explicitProject = draft.selectedProjectId
    ? projects.find((project) => project.id === draft.selectedProjectId) ?? null
    : null;
  const explicitProjectMissing = Boolean(draft.selectedProjectId && !explicitProject);
  const requestedDirectory = normalizePath(
    draft.bootstrapPendingDirectory
      ?? draft.directoryOverride
      ?? explicitProject?.path
      ?? null,
  );

  const directoryProject = explicitProjectMissing
    ? null
    : explicitProject
      ?? resolveProjectForSessionDirectory(projects, availableWorktreesByProject, requestedDirectory);
  const activeProject = !requestedDirectory && !draft.selectedProjectId && activeProjectId
    ? projects.find((project) => project.id === activeProjectId) ?? null
    : null;
  const project = directoryProject ?? activeProject;
  const directory = requestedDirectory ?? normalizePath(project?.path ?? null);

  if (!directory) return null;

  return {
    directory,
    project,
    serverId: explicitProjectMissing ? null : project?.serverId || DEFAULT_SERVER_ID,
  };
};

export type DraftQuotaSummary = {
  configuredProviders: number;
  lowestRemainingPercent: number | null;
};

const remainingPercent = (window: UsageWindow): number | null => {
  if (typeof window.remainingPercent === 'number' && Number.isFinite(window.remainingPercent)) {
    return Math.max(0, Math.min(100, window.remainingPercent));
  }
  if (typeof window.usedPercent === 'number' && Number.isFinite(window.usedPercent)) {
    return Math.max(0, Math.min(100, 100 - window.usedPercent));
  }
  return null;
};

const collectWindows = (result: ProviderResult): UsageWindow[] => {
  if (!result.usage) return [];
  const windows = Object.values(result.usage.windows ?? {});
  for (const model of Object.values(result.usage.models ?? {})) {
    windows.push(...Object.values(model.windows ?? {}));
  }
  return windows;
};

export const summarizeDraftQuota = (results: readonly ProviderResult[]): DraftQuotaSummary => {
  const configured = results.filter((result) => result.configured);
  let lowestRemainingPercent: number | null = null;

  for (const result of configured) {
    for (const window of collectWindows(result)) {
      const remaining = remainingPercent(window);
      if (remaining === null) continue;
      if (lowestRemainingPercent === null || remaining < lowestRemainingPercent) {
        lowestRemainingPercent = remaining;
      }
    }
  }

  return {
    configuredProviders: configured.length,
    lowestRemainingPercent,
  };
};
