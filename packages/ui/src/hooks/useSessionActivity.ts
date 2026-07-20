import React from 'react';
import { useSessionUIStore } from '@/sync/session-ui-store';
import {
  useSessionStatus,
  useSessionMessages,
  useSessionPermissions,
  useSessionActivityTimestamp,
} from '@/sync/sync-context';
import { hasTerminalMessageSignal, type TerminalMessageSignalInfo } from '@/lib/messageCompletion';

export type SessionActivityPhase = 'idle' | 'busy' | 'retry';

export interface SessionActivityResult {
  phase: SessionActivityPhase;
  isWorking: boolean;
  isBusy: boolean;
  isCooldown: boolean;
}

type ActivityMessage = TerminalMessageSignalInfo & {
  readonly role?: string
}

export type SessionActivitySnapshotInput = {
  readonly sessionId: string | null | undefined
  readonly status?: { readonly type: SessionActivityPhase }
  readonly messages: readonly ActivityMessage[]
  readonly permissions: readonly unknown[]
  readonly lastActivityAt?: number
  readonly now: number
}

export type SessionActivitySnapshot = {
  readonly result: SessionActivityResult
  readonly expiresAt: number | null
}

const IDLE_RESULT: SessionActivityResult = {
  phase: 'idle',
  isWorking: false,
  isBusy: false,
  isCooldown: false,
};

const IDLE_SNAPSHOT: SessionActivitySnapshot = {
  result: IDLE_RESULT,
  expiresAt: null,
}

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
 *     a. Recent `message.part.*` activity (within STREAM_DESYNC_WINDOW_MS),
 *        without a terminal trailing assistant signal → working.
 *     b. Otherwise → idle. An incomplete historical assistant message alone
 *        never keeps the session busy indefinitely.
 */
export function getSessionActivitySnapshot(input: SessionActivitySnapshotInput): SessionActivitySnapshot {
  if (!input.sessionId || input.permissions.length > 0) return IDLE_SNAPSHOT

  const phase = input.status?.type ?? 'idle'
  const lastMessage = input.messages[input.messages.length - 1]
  const hasTerminalTrailingAssistant = Boolean(
    lastMessage
    && lastMessage.role === 'assistant'
    && hasTerminalMessageSignal(lastMessage),
  )
  const hasPendingAssistant = Boolean(
    lastMessage
    && lastMessage.role === 'assistant'
    && !hasTerminalMessageSignal(lastMessage),
  )

  if (input.status && phase !== 'idle') {
    return {
      result: {
        phase,
        isWorking: true,
        isBusy: phase === 'busy',
        isCooldown: false,
      },
      expiresAt: null,
    }
  }

  if (input.status) {
    const expiresAt = hasPendingAssistant && typeof input.lastActivityAt === 'number'
      ? input.lastActivityAt + IDLE_GRACE_PERIOD_MS
      : null
    if (expiresAt !== null && input.now < expiresAt) {
      return {
        result: { phase: 'busy', isWorking: true, isBusy: true, isCooldown: false },
        expiresAt,
      }
    }
    return IDLE_SNAPSHOT
  }

  const expiresAt = typeof input.lastActivityAt === 'number'
    ? input.lastActivityAt + STREAM_DESYNC_WINDOW_MS
    : null
  const hasRecentStreamActivity = expiresAt !== null && input.now < expiresAt
  if (!hasRecentStreamActivity || hasTerminalTrailingAssistant) return IDLE_SNAPSHOT

  return {
    result: { phase: 'busy', isWorking: true, isBusy: true, isCooldown: false },
    expiresAt,
  }
}

export function useSessionActivity(sessionId: string | null | undefined, directory?: string): SessionActivityResult {
  const status = useSessionStatus(sessionId ?? '', directory)
  const messages = useSessionMessages(sessionId ?? '', directory)
  const permissions = useSessionPermissions(sessionId ?? '', directory)
  const lastActivityAt = useSessionActivityTimestamp(sessionId ?? '', directory)
  const [, refreshAfterExpiry] = React.useReducer((version: number) => version + 1, 0)

  const snapshot = getSessionActivitySnapshot({
    sessionId,
    status,
    messages,
    permissions,
    lastActivityAt,
    now: Date.now(),
  })

  React.useEffect(() => {
    if (snapshot.expiresAt === null) return
    const delay = Math.max(0, snapshot.expiresAt - Date.now())
    const timer = window.setTimeout(refreshAfterExpiry, delay)
    return () => window.clearTimeout(timer)
  }, [snapshot.expiresAt])

  return snapshot.result
}

export function useCurrentSessionActivity(): SessionActivityResult {
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  return useSessionActivity(currentSessionId);
}
