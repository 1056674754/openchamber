import { create } from 'zustand';
import type { Session } from '@opencode-ai/sdk/v2';
import type { SessionStatus } from '@opencode-ai/sdk/v2/client';
import { getRuntimeKey, subscribeRuntimeEndpointWillChange } from '@/lib/runtime-switch';
import { getBtwSessionID } from '@/lib/sessionBtwMetadata';
import { resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useUIStore, type SessionRetentionAction } from '@/stores/useUIStore';
import { useSessionUIStore } from './session-ui-store';
import { archiveSession, deleteSession } from './session-actions';

const DAY_MS = 86_400_000;
export const RETENTION_KEEP_RECENT = 5;
export const RETENTION_INTERVAL_MS = DAY_MS;

const retentionTimestamp = (session: Session, onlyArchived: boolean): number => (
  onlyArchived ? session.time.archived ?? 0 : session.time.updated ?? session.time.created
);

const isOlderThanCutoff = (session: Session, cutoff: number, onlyArchived: boolean): boolean => {
  const timestamp = retentionTimestamp(session, onlyArchived);
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp < cutoff;
};

type CandidateOptions = {
  sessions: readonly Session[];
  currentSessionId: string | null;
  cutoffDays: number;
  action: SessionRetentionAction;
  onlyArchived?: boolean;
  activeSessionIds: ReadonlySet<string>;
  now?: number;
};

/** The unselected scope stays protected, including from cascading parent deletion. */
export function buildSessionRetentionCandidates({
  sessions, currentSessionId, cutoffDays, action, onlyArchived = false, activeSessionIds, now = Date.now(),
}: CandidateOptions): string[] {
  if (!Number.isFinite(cutoffDays) || cutoffDays < 1) return [];
  const cutoff = now - cutoffDays * DAY_MS;
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const sorted = sessions.filter((session) => Boolean(session.time.archived) === onlyArchived)
    .sort((a, b) => retentionTimestamp(b, onlyArchived) - retentionTimestamp(a, onlyArchived));
  const protectedIds = new Set(sorted.slice(0, RETENTION_KEEP_RECENT).map((session) => session.id));
  for (const session of sessions) {
    if (Boolean(session.time.archived) !== onlyArchived || session.share || getBtwSessionID(session) || session.id === currentSessionId
      || activeSessionIds.has(session.id) || !isOlderThanCutoff(session, cutoff, onlyArchived)) {
      protectedIds.add(session.id);
    }
  }
  if (action === 'delete' || onlyArchived) {
    // OpenCode deletes the whole subtree. Protect every ancestor of a retained session.
    for (const id of protectedIds) {
      const parentId = byId.get(id)?.parentID;
      if (parentId) protectedIds.add(parentId);
    }
  }
  const candidates = sorted.filter((session) => !protectedIds.has(session.id));
  if (action === 'archive' && !onlyArchived) return candidates.map((session) => session.id);

  // Children first: each request deletes one eligible session, and a failed child
  // can prevent its parent from bypassing that failure with a cascading delete.
  const ids = new Set(candidates.map((session) => session.id));
  const childrenLeft = new Map<string, number>();
  for (const session of candidates) {
    if (session.parentID && ids.has(session.parentID)) {
      childrenLeft.set(session.parentID, (childrenLeft.get(session.parentID) ?? 0) + 1);
    }
  }
  const ordered = candidates.filter((session) => !childrenLeft.has(session.id)).map((session) => session.id);
  for (let index = 0; index < ordered.length; index += 1) {
    const parentId = byId.get(ordered[index])?.parentID;
    if (!parentId || !ids.has(parentId)) continue;
    const remaining = (childrenLeft.get(parentId) ?? 0) - 1;
    childrenLeft.set(parentId, remaining);
    if (remaining === 0) ordered.push(parentId);
  }
  // Cyclic/malformed hierarchies never become leaves and cannot be deleted.
  return ordered;
}

type SessionRetentionResult = {
  completedIds: string[];
  failedIds: string[];
  action: SessionRetentionAction;
  skippedReason?: 'disabled' | 'loading' | 'cooldown' | 'no-candidates' | 'running' | 'runtime-changed';
};

// Shared by the app's automatic runner and every Settings mount. Acquire before any await.
export const useSessionRetentionRunStore = create(() => ({ isRunning: false }));

const collectActiveSessionIds = (statuses: Map<string, SessionStatus>): Set<string> => {
  const activeIds = new Set<string>();
  for (const [id, status] of statuses) {
    if (status.type === 'busy' || status.type === 'retry') activeIds.add(id);
  }
  return activeIds;
};

const groupChildrenByParentId = (sessions: readonly Session[]): Map<string, string[]> => {
  const childrenByParentId = new Map<string, string[]>();
  for (const session of sessions) {
    if (!session.parentID) continue;
    const children = childrenByParentId.get(session.parentID);
    if (children) children.push(session.id);
    else childrenByParentId.set(session.parentID, [session.id]);
  }
  return childrenByParentId;
};

export async function runSessionRetentionCleanup({ force = false } = {}): Promise<SessionRetentionResult> {
  const settings = useUIStore.getState();
  const onlyArchived = settings.sessionRetentionOnlyArchived;
  const action: SessionRetentionAction = onlyArchived ? 'delete' : settings.sessionRetentionAction;
  const result: SessionRetentionResult = { completedIds: [], failedIds: [], action };
  if (useSessionRetentionRunStore.getState().isRunning) return { ...result, skippedReason: 'running' };
  if (!Number.isFinite(settings.autoDeleteAfterDays) || settings.autoDeleteAfterDays < 1
    || (!force && !settings.autoDeleteEnabled)) return { ...result, skippedReason: 'disabled' };
  if (!force && useSessionUIStore.getState().isLoading) return { ...result, skippedReason: 'loading' };
  const now = Date.now();
  if (!force && settings.autoDeleteLastRunAt && now - settings.autoDeleteLastRunAt < RETENTION_INTERVAL_MS) {
    return { ...result, skippedReason: 'cooldown' };
  }

  const runtimeKey = getRuntimeKey();
  let runtimeChanged = false;
  const unsubscribe = subscribeRuntimeEndpointWillChange(() => { runtimeChanged = true; });
  const isCurrentRuntime = () => !runtimeChanged && getRuntimeKey() === runtimeKey;
  useSessionRetentionRunStore.setState({ isRunning: true });
  try {
    await useGlobalSessionsStore.getState().loadSessions();
    if (!isCurrentRuntime()) return { ...result, skippedReason: 'runtime-changed' };
    if (useGlobalSessionsStore.getState().status !== 'ready') {
      throw new Error('Session retention requires a complete session list');
    }
    const state = useGlobalSessionsStore.getState();
    const candidateIds = buildSessionRetentionCandidates({
      sessions: [...state.activeSessions, ...state.archivedSessions],
      currentSessionId: useSessionUIStore.getState().currentSessionId,
      cutoffDays: settings.autoDeleteAfterDays,
      action,
      onlyArchived,
      activeSessionIds: collectActiveSessionIds(state.sessionStatuses),
      now,
    });
    if (candidateIds.length === 0) return { ...result, skippedReason: 'no-candidates' };

    const failedIds = new Set<string>();
    let snapshot = { active: undefined as readonly Session[] | undefined, archived: undefined as readonly Session[] | undefined, statuses: undefined as Map<string, SessionStatus> | undefined };
    let sessionById = new Map<string, Session>();
    let activeChildrenByParentId = new Map<string, string[]>();
    let archivedChildrenByParentId = new Map<string, string[]>();
    let activeSessionIds = new Set<string>();
    const syncSnapshot = (): void => {
      const state = useGlobalSessionsStore.getState();
      if (snapshot.active !== state.activeSessions) {
        snapshot.active = state.activeSessions;
        activeChildrenByParentId = groupChildrenByParentId(state.activeSessions);
      }
      if (snapshot.archived !== state.archivedSessions) {
        snapshot.archived = state.archivedSessions;
        archivedChildrenByParentId = groupChildrenByParentId(state.archivedSessions);
      }
      if (snapshot.statuses !== state.sessionStatuses) {
        snapshot.statuses = state.sessionStatuses;
        activeSessionIds = collectActiveSessionIds(state.sessionStatuses);
      }
      if (snapshot.active !== state.activeSessions || snapshot.archived !== state.archivedSessions) {
        sessionById = new Map([...state.activeSessions, ...state.archivedSessions].map((item) => [item.id, item]));
      }
    };
    syncSnapshot();
    for (const [index, id] of candidateIds.entries()) {
      if (!isCurrentRuntime()) {
        result.failedIds.push(...candidateIds.slice(index));
        break;
      }
      syncSnapshot();
      const session = sessionById.get(id);
      if (!session) continue;
      if (Boolean(session.time.archived) !== onlyArchived || session.share || getBtwSessionID(session) || session.id === useSessionUIStore.getState().currentSessionId
        || activeSessionIds.has(id)
        || !isOlderThanCutoff(session, now - settings.autoDeleteAfterDays * DAY_MS, onlyArchived)) continue;
      if (action === 'delete') {
        // Planned children ran first. Any child still present either failed,
        // became protected, or arrived mid-run. Never delete it via its parent.
        const children = [
          ...(activeChildrenByParentId.get(id) ?? []),
          ...(archivedChildrenByParentId.get(id) ?? []),
        ];
        if (children.length > 0) {
          if (children.some((childId) => failedIds.has(childId))) {
            failedIds.add(id);
            result.failedIds.push(id);
          }
          continue;
        }
      }
      if (!resolveGlobalSessionDirectory(session)) {
        failedIds.add(id);
        result.failedIds.push(id);
        continue;
      }
      const completed = action === 'archive'
        ? await archiveSession(id, runtimeKey)
        : await deleteSession(id, { expectedRuntimeKey: runtimeKey });
      if (completed) result.completedIds.push(id);
      else {
        failedIds.add(id);
        result.failedIds.push(id);
      }
    }
    return result;
  } finally {
    if (isCurrentRuntime()) settings.setAutoDeleteLastRunAt(Date.now());
    unsubscribe();
    useSessionRetentionRunStore.setState({ isRunning: false });
  }
}
