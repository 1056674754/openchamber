import type { Session } from '@opencode-ai/sdk/v2';
import type { WorktreeMetadata } from '@/types/worktree';
import { useSessionProjectStore } from '@/stores/useSessionProjectStore';
import { normalizePath } from '@/components/session/sidebar/utils';

export type ProjectForOwnership = {
  id: string;
  normalizedPath: string;
  serverId?: string;
};

const sessionDirectoryOf = (session: Session): string | null => {
  const direct = normalizePath((session as Session & { directory?: string | null }).directory ?? null);
  if (direct) return direct;
  return normalizePath(
    (session as Session & { project?: { worktree?: string | null } | null }).project?.worktree ?? null,
  );
};

const projectMatchesDirectory = (project: ProjectForOwnership, directory: string): boolean => {
  return directory === project.normalizedPath
    || directory.startsWith(`${project.normalizedPath}/`);
};

const collectWorktreeDirectories = (
  worktreesByProject: Map<string, WorktreeMetadata[]>,
  projectPath: string,
): string[] => {
  const worktrees = worktreesByProject.get(projectPath) ?? [];
  const directories: string[] = [];
  for (const meta of worktrees) {
    const normalized = normalizePath(meta.path);
    if (normalized) directories.push(normalized);
  }
  return directories;
};

/**
 * Pure path-prefix derivation. Returns the longest-matching project's id,
 * or null when no project owns the session by path. This is the bootstrap
 * algorithm used to populate session→project bindings for legacy sessions
 * that predate explicit binding storage.
 *
 * Worktree paths registered for a project count as owned subpaths even if
 * they aren't lexical descendants of the project root.
 */
export const resolveProjectIdViaPathPrefix = (
  session: Session,
  projects: ProjectForOwnership[],
  worktreesByProject: Map<string, WorktreeMetadata[]>,
): string | null => {
  const directory = sessionDirectoryOf(session);
  if (!directory) return null;

  let bestMatch: { id: string; matchLength: number } | null = null;

  for (const project of projects) {
    if (!project.normalizedPath) continue;

    if (projectMatchesDirectory(project, directory)) {
      const len = project.normalizedPath.length;
      if (!bestMatch || len > bestMatch.matchLength) {
        bestMatch = { id: project.id, matchLength: len };
      }
      continue;
    }

    const worktreeDirectories = collectWorktreeDirectories(worktreesByProject, project.normalizedPath);
    for (const worktreeDir of worktreeDirectories) {
      if (directory === worktreeDir || directory.startsWith(`${worktreeDir}/`)) {
        const len = worktreeDir.length;
        if (!bestMatch || len > bestMatch.matchLength) {
          bestMatch = { id: project.id, matchLength: len };
        }
        break;
      }
    }
  }

  return bestMatch?.id ?? null;
};

/**
 * Authoritative ownership query. Consults the explicit binding store first;
 * falls back to path-prefix derivation only when no binding exists or the
 * bound project no longer exists. Returns null when no project owns the
 * session.
 *
 * Callers iterating over many sessions should pass a snapshot of
 * `bindings` from the store (read once) for stable React selectors and
 * to avoid resubscribing to the store during a render pass.
 */
export const getProjectIdForSession = (
  session: Session,
  projects: ProjectForOwnership[],
  worktreesByProject: Map<string, WorktreeMetadata[]>,
  bindings?: Map<string, string>,
): string | null => {
  const bindingMap = bindings ?? useSessionProjectStore.getState().bindings;
  const explicit = bindingMap.get(session.id);
  if (explicit && projects.some((project) => project.id === explicit)) {
    return explicit;
  }
  return resolveProjectIdViaPathPrefix(session, projects, worktreesByProject);
};

/**
 * Eager hydration: scan unbound sessions and persist a path-prefix binding
 * for any session whose owning project can be determined. Idempotent —
 * already-bound sessions are skipped. Pure read for already-bound sessions.
 */
export const hydrateSessionProjectBindings = (
  sessions: Session[],
  projects: ProjectForOwnership[],
  worktreesByProject: Map<string, WorktreeMetadata[]>,
): void => {
  if (sessions.length === 0 || projects.length === 0) return;
  const store = useSessionProjectStore.getState();
  const existing = store.bindings;
  const toBind: Array<readonly [string, string]> = [];

  for (const session of sessions) {
    if (existing.has(session.id)) continue;
    const projectId = resolveProjectIdViaPathPrefix(session, projects, worktreesByProject);
    if (projectId) toBind.push([session.id, projectId]);
  }

  if (toBind.length > 0) store.bindMany(toBind);
};
