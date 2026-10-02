import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';

/**
 * Live-activity marker for one session row or aggregate: 'running' while the
 * turn streams (busy/retry), 'unread' while finished-but-unseen.
 *
 * Fork adaptation of upstream's indicator: only the static dot (info while
 * running, success while unread) — the fork has not carried the opt-in
 * animated spinner preference yet, so motion stays with the callers that own
 * their own elapsed counters.
 */
export const SessionActivityIndicator: React.FC<{
  /** 'running' (busy/retry) or 'unread' (unseen activity on a settled turn). */
  state: 'running' | 'unread';
  /** Localized accessible label; also rendered as the hover title. */
  label: string;
  className?: string;
}> = ({ state, label, className }) => {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      aria-label={label}
      title={label}
      data-session-activity-indicator={state}
    >
      <Icon
        name="checkbox-blank-circle-fill"
        className={cn(
          'h-2 w-2',
          state === 'running' ? 'text-status-info' : 'text-status-success',
        )}
      />
    </span>
  );
};
