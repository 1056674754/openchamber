import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { ensureGlobalSessionsLoaded, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import {
  buildSessionRetentionCandidates,
  RETENTION_INTERVAL_MS,
  RETENTION_KEEP_RECENT,
  runSessionRetentionCleanup,
  useSessionRetentionRunStore,
} from '@/sync/session-retention';
import { useUIStore } from '@/stores/useUIStore';

const EMPTY_SESSIONS: Session[] = [];
const EMPTY_ACTIVE_IDS: ReadonlySet<string> = new Set<string>();

type CleanupOptions = { autoRun?: boolean; enabled?: boolean };

export const useSessionAutoCleanup = (enabledOrOptions?: boolean | CleanupOptions) => {
  const options = typeof enabledOrOptions === 'object' ? enabledOrOptions : undefined;
  const autoRun = options?.autoRun !== false;
  const enabled = typeof enabledOrOptions === 'boolean' ? enabledOrOptions : (options?.enabled ?? true);

  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const isLoading = useSessionUIStore((state) => state.isLoading);
  const autoDeleteEnabled = useUIStore((state) => state.autoDeleteEnabled);
  const autoDeleteAfterDays = useUIStore((state) => state.autoDeleteAfterDays);
  const onlyArchived = useUIStore((state) => state.sessionRetentionOnlyArchived);
  const action = useUIStore((state) => state.sessionRetentionOnlyArchived ? 'delete' as const : state.sessionRetentionAction);
  const autoDeleteLastRunAt = useUIStore((state) => state.autoDeleteLastRunAt);
  const needsGlobalSessions = enabled && (!autoRun || autoDeleteEnabled);
  const activeSessions = useGlobalSessionsStore((state) => needsGlobalSessions ? state.activeSessions : EMPTY_SESSIONS);
  const archivedSessions = useGlobalSessionsStore((state) => needsGlobalSessions ? state.archivedSessions : EMPTY_SESSIONS);
  const sessionStatuses = useGlobalSessionsStore((state) => needsGlobalSessions ? state.sessionStatuses : undefined);
  const status = useGlobalSessionsStore((state) => state.status);
  const isRunning = useSessionRetentionRunStore((state) => state.isRunning);

  React.useEffect(() => {
    if (needsGlobalSessions) void ensureGlobalSessionsLoaded();
  }, [needsGlobalSessions]);

  const activeSessionIds = React.useMemo(() => {
    if (!sessionStatuses) return EMPTY_ACTIVE_IDS;
    const ids = new Set<string>();
    for (const [id, sessionStatus] of sessionStatuses) {
      if (sessionStatus.type === 'busy' || sessionStatus.type === 'retry') ids.add(id);
    }
    return ids;
  }, [sessionStatuses]);

  const candidates = React.useMemo(() => buildSessionRetentionCandidates({
    sessions: [...activeSessions, ...archivedSessions],
    currentSessionId,
    cutoffDays: autoDeleteAfterDays,
    action,
    onlyArchived,
    activeSessionIds,
  }), [activeSessions, archivedSessions, currentSessionId, autoDeleteAfterDays, action, onlyArchived, activeSessionIds]);

  React.useEffect(() => {
    if (!enabled || !autoRun || !autoDeleteEnabled || autoDeleteAfterDays <= 0
      || isLoading || status !== 'ready' || isRunning) return;
    if (autoDeleteLastRunAt && Date.now() - autoDeleteLastRunAt < RETENTION_INTERVAL_MS) return;
    void runSessionRetentionCleanup().catch((error) => {
      console.error('[SessionRetention] Cleanup failed', error);
    });
  }, [enabled, autoRun, autoDeleteEnabled, autoDeleteAfterDays, isLoading, status, isRunning, autoDeleteLastRunAt]);

  return {
    candidates,
    isRunning,
    status,
    runCleanup: runSessionRetentionCleanup,
    keepRecentCount: RETENTION_KEEP_RECENT,
    action,
  };
};
