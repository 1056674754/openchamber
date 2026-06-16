import { create } from 'zustand';
import type { OpencodeClient, Session } from '@opencode-ai/sdk/v2';
import type { SessionStatus } from '@opencode-ai/sdk/v2/client';
import { opencodeClient } from '@/lib/opencode/client';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { registerRemoteInstanceProxy } from '@/lib/remote-instances/registry';
import { listGlobalSessionPages } from '@/stores/globalSessions';
import { retry } from '@/sync/retry';
import { useProjectsStore } from './useProjectsStore';

type GlobalSessionsStatus = 'idle' | 'loading' | 'ready' | 'error';

type LoadResult = {
  activeSessions: Session[];
  archivedSessions: Session[];
};

type GlobalSessionsState = {
  activeSessions: Session[];
  archivedSessions: Session[];
  sessionsByDirectory: Map<string, Session[]>;
  hasLoaded: boolean;
  status: GlobalSessionsStatus;
  /** Session running status across all directories — single source of truth for sidebar indicators */
  sessionStatuses: Map<string, SessionStatus>;
  loadSessions: (fallbackActive?: Session[]) => Promise<LoadResult>;
  refreshSessionsForDirectories: (directories: Iterable<string>, fallbackActive?: Session[]) => Promise<LoadResult>;
  applySnapshot: (activeSessions: Session[], archivedSessions: Session[], status?: GlobalSessionsStatus) => void;
  upsertSession: (session: Session) => void;
  removeSessions: (ids: Iterable<string>) => void;
  archiveSessions: (ids: Iterable<string>, archivedAt?: number) => void;
  upsertStatus: (sessionId: string, status: SessionStatus) => void;
  removeStatuses: (ids: Iterable<string>) => void;
  batchLoadStatuses: (directories: string[]) => Promise<void>;
};

const PAGE_SIZE = 200;
const STATUS_BATCH_TTL_MS = 15_000;
const STATUS_BATCH_MAX_CONCURRENCY = 6;

let inflightLoad: Promise<LoadResult> | null = null;
const statusLoadedAtByDirectory = new Map<string, number>();
const inflightStatusLoadsByDirectory = new Map<string, Promise<unknown>>();

const normalizePath = (value?: string | null): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const replaced = trimmed.replace(/\\/g, '/');
  if (replaced === '/') {
    return '/';
  }
  return replaced.length > 1 ? replaced.replace(/\/+$/, '') : replaced;
};

const resolveStatusClientForDirectory = (directory: string) => {
  const normalized = normalizePath(directory);
  if (!normalized) {
    return opencodeClient.getSdkClient();
  }

  const projects = useProjectsStore.getState().projects;
  let bestProject: typeof projects[number] | null = null;
  for (const project of projects) {
    const projectPath = normalizePath(project.path);
    if (!projectPath || projectPath === '/') {
      continue;
    }
    if (normalized !== projectPath && !normalized.startsWith(`${projectPath}/`)) {
      continue;
    }
    if (!bestProject || projectPath.length > (normalizePath(bestProject.path)?.length ?? 0)) {
      bestProject = project;
    }
  }

  if (bestProject?.serverId && bestProject.serverId !== DEFAULT_SERVER_ID) {
    const conn = serverRegistry.get(bestProject.serverId)
      ?? registerRemoteInstanceProxy({
        id: bestProject.serverId,
        label: bestProject.label || bestProject.serverId,
        healthStatus: 'connecting',
      });
    if (conn.healthStatus !== 'healthy') {
      return null;
    }
    return conn.client;
  }

  return serverRegistry.getDefault()?.client ?? opencodeClient.getSdkClient();
};

export const resolveGlobalSessionDirectory = (session: Session): string | null => {
  const record = session as Session & {
    directory?: string | null;
    project?: { worktree?: string | null } | null;
  };

  return normalizePath(record.directory ?? null)
    ?? normalizePath(record.project?.worktree ?? null);
};

export const mergeSessionDirectoryMetadata = (incoming: Session, existing?: Session | null): Session => {
  if (!existing) {
    return incoming;
  }

  const incomingRecord = incoming as Session & {
    directory?: string | null;
    project?: ({ worktree?: string | null } & Record<string, unknown>) | null;
  };
  const existingRecord = existing as Session & {
    directory?: string | null;
    project?: ({ worktree?: string | null } & Record<string, unknown>) | null;
  };

  const incomingDirectory = normalizePath(incomingRecord.directory ?? null);
  const incomingWorktree = normalizePath(incomingRecord.project?.worktree ?? null);
  const existingDirectory = normalizePath(existingRecord.directory ?? null);
  const existingWorktree = normalizePath(existingRecord.project?.worktree ?? null);

  let changed = false;
  const next: typeof incomingRecord = { ...incomingRecord };

  if (!incomingDirectory && existingDirectory) {
    next.directory = existingRecord.directory;
    changed = true;
  }

  if (!incomingWorktree && existingWorktree) {
    next.project = {
      ...(existingRecord.project ?? {}),
      ...(incomingRecord.project ?? {}),
      worktree: existingRecord.project?.worktree,
    };
    changed = true;
  } else if (!incomingRecord.project && existingRecord.project) {
    next.project = existingRecord.project;
    changed = true;
  }

  return changed ? next : incoming;
};

const buildSessionsByDirectory = (sessions: Session[]): Map<string, Session[]> => {
  const next = new Map<string, Session[]>();
  for (const session of sessions) {
    const directory = resolveGlobalSessionDirectory(session);
    if (!directory) {
      continue;
    }
    const existing = next.get(directory);
    if (existing) {
      existing.push(session);
      continue;
    }
    next.set(directory, [session]);
  }
  return next;
};

const getSessionSignature = (session: Session): string => {
  const parentID = (session as Session & { parentID?: string | null }).parentID ?? '';
  return [
    session.id,
    session.title ?? '',
    session.time?.created ?? 0,
    session.time?.updated ?? 0,
    session.time?.archived ?? 0,
    parentID,
    session.share?.url ?? '',
    resolveGlobalSessionDirectory(session) ?? '',
  ].join(':');
};

const sameSessionList = (prev: Session[], next: Session[]): boolean => {
  if (prev === next) {
    return true;
  }
  if (prev.length !== next.length) {
    return false;
  }
  for (let index = 0; index < prev.length; index += 1) {
    if (getSessionSignature(prev[index]) !== getSessionSignature(next[index])) {
      return false;
    }
  }
  return true;
};

const sameStatus = (prev: SessionStatus | undefined, next: SessionStatus | undefined): boolean => {
  if (prev === next) {
    return true;
  }
  return prev?.type === next?.type
    && (prev as { message?: unknown } | undefined)?.message === (next as { message?: unknown } | undefined)?.message
    && (prev as { attempt?: unknown } | undefined)?.attempt === (next as { attempt?: unknown } | undefined)?.attempt
    && (prev as { next?: unknown } | undefined)?.next === (next as { next?: unknown } | undefined)?.next;
};

const getSessionUpdatedAt = (session: Session): number => {
  const updatedAt = session.time?.updated;
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  const createdAt = session.time?.created;
  return typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0;
};

const sortSessionsByUpdated = (sessions: Session[]): Session[] => {
  return [...sessions].sort((left, right) => {
    const timeDelta = getSessionUpdatedAt(right) - getSessionUpdatedAt(left);
    if (timeDelta !== 0) return timeDelta;
    return right.id.localeCompare(left.id);
  });
};

const normalizeDirectorySet = (directories: Iterable<string>): Set<string> => {
  const next = new Set<string>();
  for (const directory of directories) {
    const normalized = normalizePath(directory);
    if (normalized) next.add(normalized);
  }
  return next;
};

const replaceSessionsForDirectories = (
  existing: Session[],
  incoming: Session[],
  directories: Set<string>,
): Session[] => {
  if (directories.size === 0) {
    return existing;
  }

  const existingById = new Map(existing.map((session) => [session.id, session]));
  const incomingById = new Map<string, Session>();

  for (const session of incoming) {
    if (!session?.id) continue;
    incomingById.set(session.id, mergeSessionDirectoryMetadata(session, existingById.get(session.id)));
  }

  const kept = existing.filter((session) => {
    if (incomingById.has(session.id)) return false;
    const directory = resolveGlobalSessionDirectory(session);
    return !directory || !directories.has(directory);
  });

  return sortSessionsByUpdated([...incomingById.values(), ...kept]);
};

type DirectoryPageResult = {
  directories: Set<string>;
  sessions: Session[];
  errors: unknown[];
};

const fetchDirectoryPages = async (
  sdk: OpencodeClient,
  directories: Set<string>,
  archived: boolean,
): Promise<DirectoryPageResult> => {
  const results = await Promise.allSettled(
    [...directories].map(async (directory) => ({
      directory,
      sessions: await listGlobalSessionPages(sdk, { directory, archived, pageSize: PAGE_SIZE }),
    })),
  );

  const fulfilledDirectories = new Set<string>();
  const sessions: Session[] = [];
  const errors: unknown[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      fulfilledDirectories.add(result.value.directory);
      sessions.push(...result.value.sessions);
    } else {
      errors.push(result.reason);
    }
  }

  return { directories: fulfilledDirectories, sessions, errors };
};

type StatusLoadResult = {
  directory: string;
  response: unknown;
};

const loadStatusForDirectory = (directory: string): Promise<unknown> => {
  const existing = inflightStatusLoadsByDirectory.get(directory);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const sdk = resolveStatusClientForDirectory(directory);
    if (!sdk) return null;
    return retry(() => sdk.session.status({ directory }), { attempts: 2, delay: 300, retryIf: () => true });
  })().finally(() => {
    inflightStatusLoadsByDirectory.delete(directory);
  });

  inflightStatusLoadsByDirectory.set(directory, promise);
  return promise;
};

const loadStatusesWithLimit = async (directories: string[]): Promise<Array<PromiseSettledResult<StatusLoadResult>>> => {
  const results: Array<PromiseSettledResult<StatusLoadResult>> = [];
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < directories.length) {
      const directory = directories[nextIndex];
      nextIndex += 1;
      if (!directory) continue;
      try {
        const response = await loadStatusForDirectory(directory);
        statusLoadedAtByDirectory.set(directory, Date.now());
        results.push({ status: 'fulfilled', value: { directory, response } });
      } catch (reason) {
        results.push({ status: 'rejected', reason });
      }
    }
  };

  const workerCount = Math.min(STATUS_BATCH_MAX_CONCURRENCY, directories.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};

const upsertSessionIntoList = (sessions: Session[], session: Session): Session[] => {
  const index = sessions.findIndex((candidate) => candidate.id === session.id);
  if (index === -1) {
    return [session, ...sessions];
  }
  const mergedSession = mergeSessionDirectoryMetadata(session, sessions[index]);
  if (getSessionSignature(sessions[index]) === getSessionSignature(mergedSession)) {
    return sessions;
  }
  const next = [...sessions];
  next[index] = mergedSession;
  return next;
};

const mergeSessionLists = (existing: Session[], incoming?: Session[]): Session[] => {
  if (!incoming || incoming.length === 0) {
    return existing;
  }

  if (existing.length === 0) {
    return incoming;
  }

  const byId = new Map(existing.map((session) => [session.id, session]));
  incoming.forEach((session) => {
    byId.set(session.id, mergeSessionDirectoryMetadata(session, byId.get(session.id)));
  });

  const ordered: Session[] = [];
  const seen = new Set<string>();

  existing.forEach((session) => {
    const next = byId.get(session.id);
    if (!next) {
      return;
    }
    ordered.push(next);
    seen.add(session.id);
  });

  incoming.forEach((session) => {
    if (seen.has(session.id)) {
      return;
    }
    const next = byId.get(session.id);
    if (next) {
      ordered.push(next);
      seen.add(session.id);
    }
  });

  return ordered;
};

const indexDefaultServerSessions = (sessions: Session[]): void => {
  for (const session of sessions) {
    if (session.id) {
      serverRegistry.indexSession(session.id, DEFAULT_SERVER_ID);
    }
  }
};

const applySnapshot = (
  state: GlobalSessionsState,
  activeSessions: Session[],
  archivedSessions: Session[],
  status: GlobalSessionsStatus,
): Partial<GlobalSessionsState> | GlobalSessionsState => {
  const nextActiveSessions = sameSessionList(state.activeSessions, activeSessions)
    ? state.activeSessions
    : activeSessions;
  const nextArchivedSessions = sameSessionList(state.archivedSessions, archivedSessions)
    ? state.archivedSessions
    : archivedSessions;
  const nextSessionsByDirectory = nextActiveSessions === state.activeSessions
    ? state.sessionsByDirectory
    : buildSessionsByDirectory(nextActiveSessions);

  if (
    nextActiveSessions === state.activeSessions
    && nextArchivedSessions === state.archivedSessions
    && nextSessionsByDirectory === state.sessionsByDirectory
    && state.hasLoaded
    && state.status === status
  ) {
    return state;
  }

  return {
    activeSessions: nextActiveSessions,
    archivedSessions: nextArchivedSessions,
    sessionsByDirectory: nextSessionsByDirectory,
    hasLoaded: true,
    status,
  };
};

export const useGlobalSessionsStore = create<GlobalSessionsState>((set, get) => ({
  activeSessions: [],
  archivedSessions: [],
  sessionsByDirectory: new Map(),
  sessionStatuses: new Map(),
  hasLoaded: false,
  status: 'idle',

  applySnapshot: (activeSessions, archivedSessions, status = 'ready') => {
    set((state) => applySnapshot(state, activeSessions, archivedSessions, status));
  },

  loadSessions: async (fallbackActive) => {
    if (inflightLoad) {
      return inflightLoad;
    }

    set((state) => (state.status === 'loading' ? state : { status: 'loading' }));

    inflightLoad = (async () => {
      const current = get();

      try {
        const sdk = opencodeClient.getSdkClient();
        const [activeResult, archivedResult] = await Promise.allSettled([
          listGlobalSessionPages(sdk, { archived: false, pageSize: PAGE_SIZE }),
          listGlobalSessionPages(sdk, { archived: true, pageSize: PAGE_SIZE }),
        ]);

        const fallbackSnapshot = mergeSessionLists(current.activeSessions, fallbackActive);
        // Preserve live sessions on success — server list may lag behind newly created sessions.
        const nextActiveSessions = activeResult.status === 'fulfilled'
          ? mergeSessionLists(activeResult.value, fallbackActive)
          : fallbackSnapshot;
        const nextArchivedSessions = archivedResult.status === 'fulfilled'
          ? archivedResult.value
          : current.archivedSessions;

        if (activeResult.status === 'rejected') {
          console.warn('[GlobalSessions] Failed to load active sessions, preserving existing snapshot with fallback merge:', activeResult.reason);
        }
        if (archivedResult.status === 'rejected') {
          console.warn('[GlobalSessions] Failed to load archived sessions, preserving current snapshot:', archivedResult.reason);
        }

        if (activeResult.status === 'fulfilled') {
          indexDefaultServerSessions(activeResult.value);
        }
        if (archivedResult.status === 'fulfilled') {
          indexDefaultServerSessions(archivedResult.value);
        }

        set((state) => applySnapshot(state, nextActiveSessions, nextArchivedSessions, 'ready'));

        if (nextActiveSessions.length > 0) {
          const directories = new Set<string>();
          for (const session of nextActiveSessions) {
            const dir = resolveGlobalSessionDirectory(session);
            if (dir) directories.add(dir);
          }
          if (directories.size > 0) {
            void get().batchLoadStatuses([...directories]).catch((err) => {
              console.warn('[GlobalSessions] Failed to batch-load statuses:', err);
            });
          }
        }

        return { activeSessions: nextActiveSessions, archivedSessions: nextArchivedSessions };
      } catch (error) {
        const nextActiveSessions = mergeSessionLists(current.activeSessions, fallbackActive);
        const nextArchivedSessions = current.archivedSessions;
        console.warn('[GlobalSessions] Failed to load sessions, using fallback snapshot:', error);
        set((state) => applySnapshot(state, nextActiveSessions, nextArchivedSessions, 'error'));
        return { activeSessions: nextActiveSessions, archivedSessions: nextArchivedSessions };
      } finally {
        inflightLoad = null;
      }
    })();

    return inflightLoad;
  },

  refreshSessionsForDirectories: async (directories, fallbackActive) => {
    const directorySet = normalizeDirectorySet(directories);
    if (directorySet.size === 0) {
      const state = get();
      return { activeSessions: state.activeSessions, archivedSessions: state.archivedSessions };
    }

    const sdk = opencodeClient.getSdkClient();
    const [active, archived] = await Promise.all([
      fetchDirectoryPages(sdk, directorySet, false),
      fetchDirectoryPages(sdk, directorySet, true),
    ]);

    if (active.errors.length > 0) {
      console.warn('[GlobalSessions] Failed to refresh active sessions for some directories:', active.errors[0]);
    }
    if (archived.errors.length > 0) {
      console.warn('[GlobalSessions] Failed to refresh archived sessions for some directories:', archived.errors[0]);
    }

    set((state) => {
      let nextActiveSessions = replaceSessionsForDirectories(state.activeSessions, active.sessions, active.directories);
      nextActiveSessions = mergeSessionLists(nextActiveSessions, fallbackActive);
      if (sameSessionList(state.activeSessions, nextActiveSessions)) {
        nextActiveSessions = state.activeSessions;
      }

      let nextArchivedSessions = replaceSessionsForDirectories(state.archivedSessions, archived.sessions, archived.directories);
      if (sameSessionList(state.archivedSessions, nextArchivedSessions)) {
        nextArchivedSessions = state.archivedSessions;
      }

      const nextSessionsByDirectory = nextActiveSessions === state.activeSessions
        ? state.sessionsByDirectory
        : buildSessionsByDirectory(nextActiveSessions);

      if (
        nextActiveSessions === state.activeSessions
        && nextArchivedSessions === state.archivedSessions
        && nextSessionsByDirectory === state.sessionsByDirectory
      ) {
        return state;
      }

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
        sessionsByDirectory: nextSessionsByDirectory,
      };
    });

    const state = get();
    return { activeSessions: state.activeSessions, archivedSessions: state.archivedSessions };
  },

  upsertSession: (session) => {
    set((state) => {
      const existingSession = state.activeSessions.find((candidate) => candidate.id === session.id)
        ?? state.archivedSessions.find((candidate) => candidate.id === session.id)
        ?? null;
      const sessionWithMetadata = mergeSessionDirectoryMetadata(session, existingSession);
      const isArchived = Boolean(sessionWithMetadata.time?.archived);
      const nextActiveSessions = isArchived
        ? state.activeSessions.filter((candidate) => candidate.id !== session.id)
        : upsertSessionIntoList(state.activeSessions, sessionWithMetadata);
      const nextArchivedSessions = isArchived
        ? upsertSessionIntoList(state.archivedSessions, sessionWithMetadata)
        : state.archivedSessions.filter((candidate) => candidate.id !== session.id);

      if (
        nextActiveSessions === state.activeSessions
        && nextArchivedSessions === state.archivedSessions
      ) {
        return state;
      }

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
        sessionsByDirectory: nextActiveSessions === state.activeSessions
          ? state.sessionsByDirectory
          : buildSessionsByDirectory(nextActiveSessions),
      };
    });
  },

  removeSessions: (ids) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (idSet.size === 0) {
      return;
    }

    set((state) => {
      const nextActiveSessions = state.activeSessions.filter((session) => !idSet.has(session.id));
      const nextArchivedSessions = state.archivedSessions.filter((session) => !idSet.has(session.id));

      if (
        nextActiveSessions.length === state.activeSessions.length
        && nextArchivedSessions.length === state.archivedSessions.length
      ) {
        return state;
      }

      const nextStatuses = new Map(state.sessionStatuses);
      let statusChanged = false;
      for (const id of idSet) {
        if (nextStatuses.delete(id)) {
          statusChanged = true;
        }
      }

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
        sessionsByDirectory: buildSessionsByDirectory(nextActiveSessions),
        ...(statusChanged ? { sessionStatuses: nextStatuses } : {}),
      };
    });
  },

  archiveSessions: (ids, archivedAt = Date.now()) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (idSet.size === 0) {
      return;
    }

    set((state) => {
      const movedSessions: Session[] = [];
      const nextActiveSessions = state.activeSessions.filter((session) => {
        if (!idSet.has(session.id)) {
          return true;
        }

        movedSessions.push({
          ...session,
          time: {
            ...session.time,
            archived: archivedAt,
          },
        });
        return false;
      });

      if (movedSessions.length === 0) {
        return state;
      }

      const remainingArchivedSessions = state.archivedSessions.filter((session) => !idSet.has(session.id));

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: [...movedSessions, ...remainingArchivedSessions],
        sessionsByDirectory: buildSessionsByDirectory(nextActiveSessions),
      };
    });
  },

  upsertStatus: (sessionId, status) => {
    set((state) => {
      const current = state.sessionStatuses.get(sessionId);
      if (sameStatus(current, status)) {
        return state;
      }
      const next = new Map(state.sessionStatuses);
      next.set(sessionId, status);
      return { sessionStatuses: next };
    });
  },

  removeStatuses: (ids) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (idSet.size === 0) {
      return;
    }
    set((state) => {
      let changed = false;
      const next = new Map(state.sessionStatuses);
      for (const id of idSet) {
        if (next.delete(id)) {
          changed = true;
        }
      }
      return changed ? { sessionStatuses: next } : state;
    });
  },

  batchLoadStatuses: async (directories) => {
    if (directories.length === 0) {
      return;
    }

    const now = Date.now();
    const targetDirectories: string[] = [];
    const seenDirectories = new Set<string>();
    for (const directory of directories) {
      const normalized = normalizePath(directory);
      if (!normalized || seenDirectories.has(normalized)) {
        continue;
      }
      seenDirectories.add(normalized);
      const lastLoadedAt = statusLoadedAtByDirectory.get(normalized) ?? 0;
      if (now - lastLoadedAt < STATUS_BATCH_TTL_MS) {
        continue;
      }
      targetDirectories.push(normalized);
    }

    if (targetDirectories.length === 0) {
      return;
    }

    const results = await loadStatusesWithLimit(targetDirectories);

    const currentStatuses = get().sessionStatuses;
    const next = new Map(currentStatuses);
    let changed = false;
    for (const result of results) {
      if (result.status !== 'fulfilled') {
        continue;
      }
      const response = result.value.response;
      if (!response) {
        continue;
      }
      const responseRecord = response as { data?: unknown };
      const payload = Array.isArray(responseRecord.data)
        ? undefined
        : responseRecord.data as Record<string, SessionStatus> | undefined;
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      for (const [sessionId, status] of Object.entries(payload)) {
        if (status && typeof status.type === 'string') {
          if (sameStatus(next.get(sessionId), status)) {
            continue;
          }
          next.set(sessionId, status);
          changed = true;
        }
      }
    }

    if (changed) {
      set({ sessionStatuses: next });
    }
  },
}));

export const ensureGlobalSessionsLoaded = async (fallbackActive?: Session[]): Promise<LoadResult> => {
  const state = useGlobalSessionsStore.getState();
  if (state.hasLoaded && state.status !== 'error') {
    return {
      activeSessions: state.activeSessions,
      archivedSessions: state.archivedSessions,
    };
  }
  return state.loadSessions(fallbackActive);
};

export const refreshGlobalSessions = async (fallbackActive?: Session[]): Promise<LoadResult> => {
  return useGlobalSessionsStore.getState().loadSessions(fallbackActive);
};

export const refreshGlobalSessionsForDirectories = async (
  directories: Iterable<string>,
  fallbackActive?: Session[],
): Promise<LoadResult> => {
  return useGlobalSessionsStore.getState().refreshSessionsForDirectories(directories, fallbackActive);
};
