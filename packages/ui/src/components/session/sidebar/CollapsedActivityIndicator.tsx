import React from 'react';
import { cn } from '@/lib/utils';
import type { CollapsedActivityState } from './collapsedActivityState';

export const CollapsedActivityIndicator = ({
  state,
  activeLabel,
  unreadLabel,
}: {
  state: Exclude<CollapsedActivityState, null>;
  activeLabel: string;
  unreadLabel: string;
}): React.ReactNode => (
  <span
    className={cn(
      'size-1.5 shrink-0 rounded-full',
      state === 'active' ? 'bg-status-info' : 'bg-status-info',
    )}
    aria-label={state === 'active' ? activeLabel : unreadLabel}
    title={state === 'active' ? activeLabel : unreadLabel}
  />
);
