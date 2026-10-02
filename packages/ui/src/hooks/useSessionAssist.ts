import React from 'react';
import { useDirectoryStore, useSession, useSessionStatus } from '@/sync/sync-context';
import { serverRegistry } from '@/lib/opencode/server-registry';
import { opencodeClient } from '@/lib/opencode/client';
import { getSessionAssist, getCurrentSessionAssist, type SessionAssistPayload } from '@/lib/sessionAssistMetadata';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useUIStore } from '@/stores/useUIStore';

// How long the chat must sit untouched before the recap becomes visible.
// The suggestion has no such delay — it shows as soon as it arrives.
export const RECAP_VISIBILITY_DELAY_MS = 60 * 1000;

// Resolve the server (local vs remote) owning a session so the directory store
// lookup hits the right child store. Mirrors sync-context's useServerIdForSession.
function useServerIdForSession(sessionId: string | undefined): string | undefined {
  return React.useSyncExternalStore(
    React.useCallback(
      (notify: () => void) => (sessionId
        ? serverRegistry.onSessionServerChange(sessionId, notify)
        : () => undefined),
      [sessionId],
    ),
    React.useCallback(
      () => (sessionId ? serverRegistry.getServerForSession(sessionId) : undefined),
      [sessionId],
    ),
    () => undefined,
  );
}

interface LastMessageSnapshot {
  id: string;
  role: string;
  timestamp: number;
}

/** Narrow subscription to the last message of a session (id/role/time only). */
function useLastMessageSnapshot(sessionId: string, directory?: string): LastMessageSnapshot | null {
  const serverId = useServerIdForSession(sessionId);
  const store = useDirectoryStore(directory, serverId, sessionId);
  const cacheRef = React.useRef<LastMessageSnapshot | null>(null);

  const getSnapshot = React.useCallback((): LastMessageSnapshot | null => {
    if (!sessionId) return null;
    const messages = store.getState().message[sessionId];
    const last = messages && messages.length > 0 ? messages[messages.length - 1] : null;
    const info = last as { id?: string; role?: string; time?: { completed?: number; created?: number } } | null;
    if (!info?.id) {
      cacheRef.current = null;
      return null;
    }
    const next: LastMessageSnapshot = {
      id: info.id,
      role: typeof info.role === 'string' ? info.role : '',
      timestamp: info.time?.completed ?? info.time?.created ?? 0,
    };
    const cached = cacheRef.current;
    if (cached && cached.id === next.id && cached.role === next.role && cached.timestamp === next.timestamp) {
      return cached;
    }
    cacheRef.current = next;
    return next;
  }, [sessionId, store]);

  const subscribe = React.useCallback((notify: () => void) => {
    if (!sessionId) return () => undefined;
    return store.subscribe(notify);
  }, [sessionId, store]);

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface SessionAssistState {
  /** Valid (fresh) assist payload, or null. */
  assist: SessionAssistPayload | null;
  /** Recap text, only when the 1-minute quiet window has elapsed. */
  visibleRecap: string | null;
  /** Suggestion text — fresh payload, session idle; caller still gates on input emptiness. */
  suggestion: string | null;
}

export function useSessionAssistState(sessionId: string, directory?: string): SessionAssistState {
  const session = useSession(sessionId, directory);
  const status = useSessionStatus(sessionId, directory);
  const lastMessage = useLastMessageSnapshot(sessionId, directory);
  const sessionRecapEnabled = useUIStore((state) => state.sessionRecapEnabled);
  const sessionSuggestionEnabled = useUIStore((state) => state.sessionSuggestionEnabled);

  // OC2 spine S6 (upstream cb7400923): the freshness rule is per protocol
  // track. Resolved through the dual-track SDK handle (plan §2 — the only
  // sanctioned mode source); any resolution failure keeps the v1 rule.
  const serverId = useServerIdForSession(sessionId);
  const protocolMode = React.useMemo((): 'v1' | 'v2' => {
    if (!sessionId) return 'v1';
    try {
      const resolvedDirectory = directory
        ?? useSessionUIStore.getState().getDirectoryForSession(sessionId)
        ?? '';
      if (!resolvedDirectory) return 'v1';
      return opencodeClient.resolveSdkHandle(resolvedDirectory, sessionId, serverId).mode;
    } catch {
      return 'v1';
    }
  }, [sessionId, directory, serverId]);

  const isIdle = !status || status.type === 'idle';
  const payload = getSessionAssist(session);

  // v1: fresh = the payload's target message is still the session's last message.
  // v2: freshness comes from the session record alone (see getCurrentSessionAssist).
  const assist = protocolMode === 'v2'
    ? (isIdle ? getCurrentSessionAssist(session) : null)
    : payload
      && lastMessage
      && lastMessage.role === 'assistant'
      && lastMessage.id === payload.forMessageID
      && isIdle
      ? payload
      : null;

  // Recap waits out the quiet window; re-render once when the boundary passes.
  const lastTimestamp = protocolMode === 'v2'
    ? ((session as { time?: { idle?: number } | null })?.time?.idle ?? 0) || lastMessage?.timestamp || 0
    : lastMessage?.timestamp ?? 0;
  const [, forceTick] = React.useReducer((tick: number) => tick + 1, 0);
  const quietElapsed = assist ? Date.now() - lastTimestamp >= RECAP_VISIBILITY_DELAY_MS : false;

  React.useEffect(() => {
    if (!assist || quietElapsed || !lastTimestamp) return undefined;
    const remaining = RECAP_VISIBILITY_DELAY_MS - (Date.now() - lastTimestamp);
    if (remaining <= 0) return undefined;
    const timer = setTimeout(forceTick, remaining + 250);
    return () => clearTimeout(timer);
  }, [assist, quietElapsed, lastTimestamp]);

  return {
    assist,
    visibleRecap: sessionRecapEnabled && assist && assist.recap && quietElapsed ? assist.recap : null,
    suggestion: sessionSuggestionEnabled && assist && assist.suggestion ? assist.suggestion : null,
  };
}
