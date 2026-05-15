import React from 'react';
import { useSessionUIStore } from '@/sync/session-ui-store';
import {
  useSessionStatus,
  useSessionMessages,
  useSessionPermissions,
  useSessionActivityTimestamp,
} from '@/sync/sync-context';

export type SessionActivityPhase = 'idle' | 'busy' | 'retry';

export interface SessionActivityResult {
  phase: SessionActivityPhase;
  isWorking: boolean;
  isBusy: boolean;
  isCooldown: boolean;
}

const IDLE_RESULT: SessionActivityResult = {
  phase: 'idle',
  isWorking: false,
  isBusy: false,
  isCooldown: false,
};

/**
 * How recent a `message.part.*` event must be for the UI to override a
 * server-reported `idle` status and treat the session as still streaming.
 *
 * This fallback only activates when the server has **never** reported a status
 * for this session (no `session.status` / `session.idle` event received). When
 * the server has explicitly reported `idle`, the activity timestamp is ignored
 * entirely — the server is the authoritative source.
 *
 * Calibration:
 *  - Long enough to cover brief SSE reconnection gaps (typical: 1–3s).
 *  - Short enough that a stale activity timestamp from a dead session doesn't
 *    keep the UI stuck in "busy" for an unreasonable time.
 */
const STREAM_DESYNC_WINDOW_MS = 5_000;

/**
 * Grace period after the server reports `idle` during which a trailing
 * assistant message without `time.completed` is still treated as "working".
 *
 * This covers the race where `session.idle` arrives before the final
 * `message.updated` (with `time.completed`). Once the grace period expires,
 * the server's `idle` status takes absolute precedence.
 */
const IDLE_GRACE_PERIOD_MS = 3_000;

/**
 * Determines if a session is actively working.
 *
 * Priority chain (first match wins):
 *
 *  1. **Permissions pending** → idle (permission indicator takes priority).
 *  2. **Server status busy/retry** → working (authoritative).
 *  3. **Server status explicitly idle** → check grace period:
 *     a. Within grace period AND trailing assistant has no `time.completed`
 *        → still working (race protection).
 *     b. Grace period expired → idle (server is authoritative).
 *  4. **No server status received** (no `session.status` event yet):
 *     a. Trailing assistant without `time.completed` → working.
 *     b. Recent `message.part.*` activity (within STREAM_DESYNC_WINDOW_MS)
 *        → working.
 *     c. Otherwise → idle.
 */
export function useSessionActivity(sessionId: string | null | undefined, directory?: string): SessionActivityResult {
  const status = useSessionStatus(sessionId ?? '', directory);
  const messages = useSessionMessages(sessionId ?? '', directory);
  const permissions = useSessionPermissions(sessionId ?? '', directory);
  const lastActivityAt = useSessionActivityTimestamp(sessionId ?? '', directory);

  return React.useMemo<SessionActivityResult>(() => {
    if (!sessionId) return IDLE_RESULT;

    if (permissions.length > 0) return IDLE_RESULT;

    const phase: SessionActivityPhase = (status?.type ?? 'idle') as SessionActivityPhase;

    const lastMessage = messages[messages.length - 1];
    const hasPendingAssistant = Boolean(
      lastMessage
      && lastMessage.role === 'assistant'
      && typeof (lastMessage as { time?: { completed?: number } }).time?.completed !== 'number',
    );

    const hasAuthoritativeStatus = status !== undefined;
    const statusWorking = hasAuthoritativeStatus && phase !== 'idle';

    // Server says busy/retry → working, no questions asked.
    if (statusWorking) {
      return {
        phase,
        isWorking: true,
        isBusy: phase === 'busy',
        isCooldown: false,
      };
    }

    // --- Server says idle (or we have an explicit status that is idle) ---

    if (hasAuthoritativeStatus) {
      // Server explicitly reported idle. Only keep "working" if we're in the
      // grace period AND the trailing assistant message hasn't been marked
      // complete yet (race: session.idle arrived before message.updated).
      if (hasPendingAssistant && lastActivityAt && Date.now() - lastActivityAt < IDLE_GRACE_PERIOD_MS) {
        return {
          phase: 'busy',
          isWorking: true,
          isBusy: true,
          isCooldown: false,
        };
      }
      // Grace period expired or message already completed → server wins.
      return IDLE_RESULT;
    }

    // --- No authoritative status received (no session.status event yet) ---

    const hasRecentStreamActivity = Boolean(
      lastActivityAt && Date.now() - lastActivityAt < STREAM_DESYNC_WINDOW_MS,
    );

    if (!hasPendingAssistant && !hasRecentStreamActivity) return IDLE_RESULT;

    return {
      phase: 'busy',
      isWorking: true,
      isBusy: true,
      isCooldown: false,
    };
  }, [sessionId, status, messages, permissions, lastActivityAt]);
}

export function useCurrentSessionActivity(): SessionActivityResult {
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  return useSessionActivity(currentSessionId);
}
