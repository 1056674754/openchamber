import React from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useDurationTickerNow } from '@/hooks/useDurationTicker';
import {
  useSessionActivityStartedAt,
  useSessionSettledDurationMs,
} from '@/sync/session-activity-timing';
import { formatSessionActivityDuration } from './sessionActivityDurationFormat';

const TICK_MS = 1000;

/**
 * Elapsed time of a session's current turn, or of the turn that just finished.
 * Colored to match the row's status dot in each state, so the pair reads as one
 * indicator rather than two.
 *
 * Deliberately a leaf. The tick re-renders this span alone rather than the
 * session row around it, which is what makes a live counter cheaper than the
 * spinner it replaced — that spinner repainted a composited layer per row every
 * frame for as long as the session ran.
 */
export const SessionActivityDuration: React.FC<{
  serverId: string;
  directory: string;
  sessionId: string;
  running: boolean;
  className?: string;
}> = ({ serverId, directory, sessionId, running, className }) => {
  const { t } = useI18n();
  const startedAt = useSessionActivityStartedAt(serverId, directory, sessionId);
  const settledMs = useSessionSettledDurationMs(serverId, directory, sessionId);
  const now = useDurationTickerNow(running, TICK_MS);

  const durationMs = running ? Math.max(0, now - (startedAt ?? now)) : settledMs;
  if (durationMs === undefined) return null;

  const label = formatSessionActivityDuration(durationMs, t);
  const description = running
    ? t('sessions.sidebar.session.status.activeFor', { duration: label })
    : t('sessions.sidebar.session.status.lastTurnDuration', { duration: label });

  return (
    <span
      className={cn(
        'shrink-0 tabular-nums',
        running ? 'text-primary' : 'text-[var(--status-info)]',
        className,
      )}
      aria-label={description}
      title={description}
    >
      {label}
    </span>
  );
};
