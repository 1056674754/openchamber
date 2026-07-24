import { create } from 'zustand';
import type { OpencodeClient, Session } from '@opencode-ai/sdk/v2';
import type { SessionStatus } from '@opencode-ai/sdk/v2/client';
import { opencodeClient } from '@/lib/opencode/client';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { listGlobalSessionPage, listGlobalSessionPages } from '@/stores/globalSessions';
import { retry } from '@/sync/retry';
import { readRemoteSessionStatuses } from '@/sync/remote-session-status';
import { shouldSkipStaleSessionEvent } from '@/sync/session-event-freshness';
import { normalizePath } from '@/lib/pathNormalization';

type GlobalSessionsStatus = 'idle' | 'loading' | 'ready' | 'error';
type DemandLoadStatus = 'loading' | 'loaded' | 'error';

type LoadResult = {
  activeSessions: Session[];
  archivedSessions: Session[];
};

type GlobalSessionsState = {
  activeSessions: Session[];
  archivedSessions: Session[];
  sessionsByDirectory: Map<string, Session[]>;
  hasLoaded: boolean;
  isCompleteSnapshot: boolean;
  status: GlobalSessionsStatus;
  childLoadState: Map<string, DemandLoadStatus>;
  archivedLoadState: Map<string, DemandLoadStatus>;
  /** Session running status across all directories — single source of truth for sidebar indicators */
  sessionStatuses: Map<string, SessionStatus>;
  loadSessions: (fallbackActive?: Session[]) => Promise<LoadResult>;
  refreshSessionsForDirectories: (directories: Iterable<string>, fallbackActive?: Session[]) => Promise<LoadResult>;
  loadSessionChildren: (session: Session) => Promise<Session[]>;
  loadArchivedSessions: (serverId?: string, force?: boolean) => Promise<Session[]>;
  applySnapshot: (activeSessions: Session[], archivedSessions: Session[], status?: GlobalSessionsStatus) => void;
  applyRemoteDirectorySnapshot: (serverId: string, directory: string, sessions: Session[]) => void;
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
const inflightChildLoads = new Map<string, Promise<Session[]>>();
const inflightArchivedLoads = new Map<string, Promise<Session[]>>();
const statusLoadedAtByDirectory = new Map<string, number>();
const inflightStatusLoadsByDirectory = new Map<string, Promise<unknown>>();

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

export const mergeLiveSessionWithGlobalSession = (
  liveSession: Session,
  globalSession: Session,
): Session => {
  const merged = mergeSessionDirectoryMetadata(liveSession, globalSession);
  if (merged.share !== globalSession.share) {
    return { ...merged, share: globalSession.share };
  }
  return merged;
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

type DirectoryPageResult = {
  sessions: Session[];
  errors: unknown[];
};

const fetchDirectoryPages = async (
  sdk: OpencodeClient,
  directories: Set<string>,
): Promise<DirectoryPageResult> => {
  const results = await Promise.allSettled(
    [...directories].map(async (directory) => ({
      directory,
      sessions: await listGlobalSessionPage(sdk, {
        directory,
        archived: false,
        roots: true,
        pageSize: PAGE_SIZE,
      }),
    })),
  );

  const sessions: Session[] = [];
  const errors: unknown[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      sessions.push(...result.value.sessions);
    } else {
      errors.push(result.reason);
    }
  }

  return { sessions, errors };
};

type StatusLoadResult = {
  directory: string;
  serverId?: string;
  response: unknown;
};

export type StatusBatchMergeInput = {
  currentStatuses: Map<string, SessionStatus>;
  sessionsByDirectory: Map<string, readonly Session[]>;
  serverIdBySession?: ReadonlyMap<string, string>;
  results: ReadonlyArray<PromiseSettledResult<StatusLoadResult>>;
};

/**
 * Pure merge of directory status batch results into the live status map.
 *
 * Rejected results, nullish responses, array `data`, and non-object `data`
 * are treated as fetch failure / invalid: existing statuses are preserved.
 * A fulfilled response with object `data` is authoritative for its directory:
 * session IDs belonging to that directory (per `sessionsByDirectory`) but
 * absent from the payload are stale and pruned; other directories are never
 * pruned. Returns `null` when nothing changed so callers preserve the
 * existing map reference.
 */
export const computeStatusBatchMerge = (
  input: StatusBatchMergeInput,
): Map<string, SessionStatus> | null => {
  const { currentStatuses, sessionsByDirectory, serverIdBySession, results } = input;

  let next: Map<string, SessionStatus> = currentStatuses;
  let changed = false;

  const clone = (): Map<string, SessionStatus> => {
    if (!changed) {
      next = new Map(currentStatuses);
      changed = true;
    }
    return next;
  };

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      continue;
    }
    const { directory, serverId, response } = result.value;
    if (!response) {
      continue;
    }
    const responseRecord = response as { data?: unknown };
    const data = responseRecord?.data;
    if (Array.isArray(data) || data === null || typeof data !== 'object') {
      continue;
    }
    const payload = data as Record<string, SessionStatus>;

    const directorySessions = sessionsByDirectory.get(directory);
    if (directorySessions) {
      for (const session of directorySessions) {
        const sessionId = session?.id;
        if (!sessionId) continue;
        if (serverId && serverIdBySession?.get(sessionId) !== serverId) continue;
        if (!(sessionId in payload) && next.has(sessionId)) {
          clone().delete(sessionId);
        }
      }
    }

    for (const [sessionId, status] of Object.entries(payload)) {
      if (status && typeof status.type === 'string') {
        if (!sameStatus(next.get(sessionId), status)) {
          clone().set(sessionId, status);
        }
      }
    }
  }

  return changed ? next : null;
};

const loadStatusForDirectory = (serverId: string, directory: string): Promise<unknown> => {
  const key = `${serverId}\n${directory}`;
  const existing = inflightStatusLoadsByDirectory.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    if (serverId !== DEFAULT_SERVER_ID) {
      return { data: await readRemoteSessionStatuses(serverId, directory) };
    }
    const client = serverRegistry.getDefault()?.client ?? opencodeClient.getSdkClient();
    return retry(() => client.session.status({ directory }), { attempts: 2, delay: 300 });
  })().finally(() => {
    inflightStatusLoadsByDirectory.delete(key);
  });

  inflightStatusLoadsByDirectory.set(key, promise);
  return promise;
};

type StatusTarget = { serverId: string; directory: string };

const loadStatusesWithLimit = async (targets: StatusTarget[]): Promise<Array<PromiseSettledResult<StatusLoadResult>>> => {
  const results: Array<PromiseSettledResult<StatusLoadResult>> = [];
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < targets.length) {
      const target = targets[nextIndex];
      nextIndex += 1;
      if (!target) continue;
      try {
        const response = await loadStatusForDirectory(target.serverId, target.directory);
        const key = `${target.serverId}\n${target.directory}`;
        statusLoadedAtByDirectory.set(key, Date.now());
        results.push({ status: 'fulfilled', value: { ...target, response } });
      } catch (reason) {
        results.push({ status: 'rejected', reason });
      }
    }
  };

  const workerCount = Math.min(STATUS_BATCH_MAX_CONCURRENCY, targets.length);
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

const indexServerSessions = (sessions: Session[], serverId: string): void => {
  for (const session of sessions) {
    if (session.id) {
      serverRegistry.indexSession(session.id, serverId);
    }
  }
};

const getClientForServer = (serverId: string): OpencodeClient => {
  if (serverId === DEFAULT_SERVER_ID) {
    return opencodeClient.getSdkClient();
  }

  const connection = serverRegistry.get(serverId);
  if (!connection) {
    throw new Error(`OpenCode server is not registered: ${serverId}`);
  }
  return connection.client;
};

const unwrapChildren = (
  result: { data?: Session[]; error?: unknown; response?: { status?: number } },
): Session[] => {
  if (result.error) {
    const status = result.response?.status;
    throw new Error(`session.children failed${status ? ` (${status})` : ''}`);
  }
  if (!Array.isArray(result.data)) {
    throw new Error('session.children returned no data');
  }
  return result.data;
};

const mergeDemandSessions = (
  state: GlobalSessionsState,
  sessions: Session[],
): Pick<GlobalSessionsState, 'activeSessions' | 'archivedSessions' | 'sessionsByDirectory'> => {
  const incomingActive = sessions.filter((session) => !session.time?.archived);
  const incomingArchived = sessions.filter((session) => Boolean(session.time?.archived));
  const activeSessions = sortSessionsByUpdated(mergeSessionLists(state.activeSessions, incomingActive));
  const archivedSessions = sortSessionsByUpdated(mergeSessionLists(state.archivedSessions, incomingArchived));
  const nextActiveSessions = sameSessionList(state.activeSessions, activeSessions)
    ? state.activeSessions
    : activeSessions;
  const nextArchivedSessions = sameSessionList(state.archivedSessions, archivedSessions)
    ? state.archivedSessions
    : archivedSessions;

  return {
    activeSessions: nextActiveSessions,
    archivedSessions: nextArchivedSessions,
    sessionsByDirectory: nextActiveSessions === state.activeSessions
      ? state.sessionsByDirectory
      : buildSessionsByDirectory(nextActiveSessions),
  };
};

export const searchGlobalRootSessions = async (query: string): Promise<Session[]> => {
  const search = query.trim();
  if (!search) return [];

  const targets = new Map<string, OpencodeClient>([
    [DEFAULT_SERVER_ID, getClientForServer(DEFAULT_SERVER_ID)],
  ]);
  for (const connection of serverRegistry.getAll()) {
    if (
      connection.config.id !== DEFAULT_SERVER_ID
      && connection.healthStatus === 'healthy'
    ) {
      targets.set(connection.config.id, connection.client);
    }
  }

  const results = await Promise.allSettled(
    [...targets].map(async ([serverId, client]) => ({
      serverId,
      sessions: await listGlobalSessionPage(client, {
        archived: true,
        roots: true,
        search,
        pageSize: PAGE_SIZE,
      }),
    })),
  );

  const sessions: Session[] = [];
  const seen = new Set<string>();
  let successfulTargets = 0;
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === 'rejected') {
      failures.push(result.reason);
      continue;
    }

    successfulTargets += 1;
    indexServerSessions(result.value.sessions, result.value.serverId);
    for (const session of result.value.sessions) {
      if (!session.id || seen.has(session.id)) continue;
      seen.add(session.id);
      sessions.push(session);
    }
  }

  if (successfulTargets === 0) {
    throw new AggregateError(failures, 'Session search failed on every OpenCode server');
  }

  return sortSessionsByUpdated(sessions);
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
  childLoadState: new Map(),
  archivedLoadState: new Map(),
  hasLoaded: false,
  isCompleteSnapshot: false,
  status: 'idle',

  applySnapshot: (activeSessions, archivedSessions, status = 'ready') => {
    set((state) => applySnapshot(state, activeSessions, archivedSessions, status));
  },

  applyRemoteDirectorySnapshot: (serverId, directory, sessions) => {
    const normalizedDirectory = normalizePath(directory);
    if (!normalizedDirectory || serverId === DEFAULT_SERVER_ID) {
      return;
    }

    const current = get();
    const existingById = new Map(
      [...current.activeSessions, ...current.archivedSessions].map((session) => [session.id, session]),
    );
    const incoming = sessions
      .filter((session) => Boolean(session?.id))
      .map((session) => mergeSessionDirectoryMetadata(session, existingById.get(session.id)));
    const incomingIds = new Set(incoming.map((session) => session.id));
    const previousScopeIds = new Set(
      [...current.activeSessions, ...current.archivedSessions]
        .filter((session) => (
          serverRegistry.getServerForSession(session.id) === serverId
          && resolveGlobalSessionDirectory(session) === normalizedDirectory
        ))
        .map((session) => session.id),
    );

    for (const session of incoming) {
      serverRegistry.indexSession(session.id, serverId);
    }

    set((state) => {
      const keepExisting = (session: Session): boolean => (
        !incomingIds.has(session.id) && !previousScopeIds.has(session.id)
      );
      const incomingActive = incoming.filter((session) => !session.time?.archived);
      const incomingArchived = incoming.filter((session) => Boolean(session.time?.archived));
      let nextActiveSessions = sortSessionsByUpdated([
        ...state.activeSessions.filter(keepExisting),
        ...incomingActive,
      ]);
      let nextArchivedSessions = sortSessionsByUpdated([
        ...state.archivedSessions.filter(keepExisting),
        ...incomingArchived,
      ]);

      if (sameSessionList(state.activeSessions, nextActiveSessions)) {
        nextActiveSessions = state.activeSessions;
      }
      if (sameSessionList(state.archivedSessions, nextArchivedSessions)) {
        nextArchivedSessions = state.archivedSessions;
      }

      let nextStatuses = state.sessionStatuses;
      for (const id of previousScopeIds) {
        if (incomingIds.has(id) || !nextStatuses.has(id)) continue;
        if (nextStatuses === state.sessionStatuses) nextStatuses = new Map(state.sessionStatuses);
        nextStatuses.delete(id);
      }

      if (
        nextActiveSessions === state.activeSessions
        && nextArchivedSessions === state.archivedSessions
        && nextStatuses === state.sessionStatuses
      ) {
        return state;
      }

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
        sessionsByDirectory: nextActiveSessions === state.activeSessions
          ? state.sessionsByDirectory
          : buildSessionsByDirectory(nextActiveSessions),
        sessionStatuses: nextStatuses,
      };
    });

    for (const id of previousScopeIds) {
      if (!incomingIds.has(id) && serverRegistry.getServerForSession(id) === serverId) {
        serverRegistry.forgetSession(id);
      }
    }
  },

  loadSessions: async (fallbackActive) => {
    if (inflightLoad) {
      return inflightLoad;
    }

    set((state) => (state.status === 'loading' ? state : { status: 'loading' }));

    inflightLoad = (async () => {
      try {
        const sdk = opencodeClient.getSdkClient();
        const roots = await listGlobalSessionPage(sdk, {
          archived: false,
          roots: true,
          pageSize: PAGE_SIZE,
        });
        indexDefaultServerSessions(roots);

        set((state) => {
          const nextActiveSessions = sortSessionsByUpdated(
            mergeSessionLists(mergeSessionLists(roots, state.activeSessions), fallbackActive),
          );
          return applySnapshot(state, nextActiveSessions, state.archivedSessions, 'ready');
        });
      } catch (error) {
        console.warn('[GlobalSessions] Failed to load sessions, using fallback snapshot:', error);
        set((state) => {
          const nextActiveSessions = mergeSessionLists(state.activeSessions, fallbackActive);
          return applySnapshot(state, nextActiveSessions, state.archivedSessions, 'error');
        });
      } finally {
        inflightLoad = null;
      }

      const state = get();
      return {
        activeSessions: state.activeSessions,
        archivedSessions: state.archivedSessions,
      };
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
    const active = await fetchDirectoryPages(sdk, directorySet);

    if (active.errors.length > 0) {
      console.warn('[GlobalSessions] Failed to refresh root sessions for some directories:', active.errors[0]);
    }
    indexDefaultServerSessions(active.sessions);

    set((state) => {
      let nextActiveSessions = sortSessionsByUpdated(mergeSessionLists(state.activeSessions, active.sessions));
      nextActiveSessions = sortSessionsByUpdated(mergeSessionLists(nextActiveSessions, fallbackActive));
      if (sameSessionList(state.activeSessions, nextActiveSessions)) {
        nextActiveSessions = state.activeSessions;
      }

      const nextSessionsByDirectory = nextActiveSessions === state.activeSessions
        ? state.sessionsByDirectory
        : buildSessionsByDirectory(nextActiveSessions);

      if (
        nextActiveSessions === state.activeSessions
        && nextSessionsByDirectory === state.sessionsByDirectory
      ) {
        return state;
      }

      return {
        activeSessions: nextActiveSessions,
        sessionsByDirectory: nextSessionsByDirectory,
      };
    });

    const state = get();
    return { activeSessions: state.activeSessions, archivedSessions: state.archivedSessions };
  },

  loadSessionChildren: async (session) => {
    const currentStatus = get().childLoadState.get(session.id);
    if (currentStatus === 'loaded') {
      return [...get().activeSessions, ...get().archivedSessions].filter((candidate) => (
        (candidate as Session & { parentID?: string | null }).parentID === session.id
      ));
    }

    const existing = inflightChildLoads.get(session.id);
    if (existing) return existing;

    const load = (async () => {
      set((state) => {
        const childLoadState = new Map(state.childLoadState);
        childLoadState.set(session.id, 'loading');
        return { childLoadState };
      });

      try {
        const serverId = serverRegistry.getServerForSession(session.id) ?? DEFAULT_SERVER_ID;
        const client = getClientForServer(serverId);
        const directory = resolveGlobalSessionDirectory(session);
        const result = await retry(() => client.session.children({
          sessionID: session.id,
          ...(directory ? { directory } : {}),
        }));
        const children = unwrapChildren(result);
        indexServerSessions(children, serverId);

        set((state) => {
          const merged = mergeDemandSessions(state, children);
          const childLoadState = new Map(state.childLoadState);
          childLoadState.set(session.id, 'loaded');
          return { ...merged, childLoadState };
        });
        return children;
      } catch (error) {
        set((state) => {
          const childLoadState = new Map(state.childLoadState);
          childLoadState.set(session.id, 'error');
          return { childLoadState };
        });
        throw error;
      } finally {
        inflightChildLoads.delete(session.id);
      }
    })();

    inflightChildLoads.set(session.id, load);
    return load;
  },

  loadArchivedSessions: async (serverId = DEFAULT_SERVER_ID, force = false) => {
    const currentStatus = get().archivedLoadState.get(serverId);
    if (!force && currentStatus === 'loaded') {
      return get().archivedSessions.filter((session) => (
        (serverRegistry.getServerForSession(session.id) ?? DEFAULT_SERVER_ID) === serverId
      ));
    }

    const existing = inflightArchivedLoads.get(serverId);
    if (existing) return existing;

    const load = (async () => {
      set((state) => {
        const archivedLoadState = new Map(state.archivedLoadState);
        archivedLoadState.set(serverId, 'loading');
        return { archivedLoadState };
      });

      try {
        const client = getClientForServer(serverId);
        const includedRoots = await listGlobalSessionPages(client, {
          archived: true,
          roots: true,
          pageSize: PAGE_SIZE,
        });
        indexServerSessions(includedRoots, serverId);
        const archivedRoots = includedRoots.filter((session) => Boolean(session.time?.archived));

        set((state) => {
          const merged = mergeDemandSessions(state, archivedRoots);
          const archivedLoadState = new Map(state.archivedLoadState);
          archivedLoadState.set(serverId, 'loaded');
          return { ...merged, archivedLoadState };
        });
        return archivedRoots;
      } catch (error) {
        set((state) => {
          const archivedLoadState = new Map(state.archivedLoadState);
          archivedLoadState.set(serverId, 'error');
          return { archivedLoadState };
        });
        throw error;
      } finally {
        inflightArchivedLoads.delete(serverId);
      }
    })();

    inflightArchivedLoads.set(serverId, load);
    return load;
  },

  upsertSession: (session) => {
    set((state) => {
      const existingSession = state.activeSessions.find((candidate) => candidate.id === session.id)
        ?? state.archivedSessions.find((candidate) => candidate.id === session.id)
        ?? null;
      if (shouldSkipStaleSessionEvent(existingSession, session)) {
        return state;
      }
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
    const targets: StatusTarget[] = [];
    const seenDirectories = new Set<string>();
    for (const directory of directories) {
      const normalized = normalizePath(directory);
      if (!normalized || seenDirectories.has(normalized)) {
        continue;
      }
      seenDirectories.add(normalized);
      const sessions = get().sessionsByDirectory.get(normalized) ?? [];
      const serverIds = new Set<string>();
      for (const session of sessions) {
        const sessionServerId = serverRegistry.getServerForSession(session.id);
        if (sessionServerId) serverIds.add(sessionServerId);
      }
      for (const serverId of serverIds) {
        const key = `${serverId}\n${normalized}`;
        const lastLoadedAt = statusLoadedAtByDirectory.get(key) ?? 0;
        if (now - lastLoadedAt < STATUS_BATCH_TTL_MS) continue;
        targets.push({ serverId, directory: normalized });
      }
    }

    if (targets.length === 0) {
      return;
    }

    const results = await loadStatusesWithLimit(targets);
    const serverIdBySession = new Map<string, string>();
    for (const sessions of get().sessionsByDirectory.values()) {
      for (const session of sessions) {
        const sessionServerId = serverRegistry.getServerForSession(session.id);
        if (sessionServerId) serverIdBySession.set(session.id, sessionServerId);
      }
    }

    const next = computeStatusBatchMerge({
      currentStatuses: get().sessionStatuses,
      sessionsByDirectory: get().sessionsByDirectory,
      serverIdBySession,
      results,
    });

    if (next) {
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
