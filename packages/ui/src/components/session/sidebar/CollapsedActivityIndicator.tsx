import React from 'react';
import { Icon } from '@/components/icon/Icon';
import type { CollapsedActivityState } from './collapsedActivityState';

export const CollapsedActivityIndicator = ({
  state,
  activeLabel,
  unreadLabel,
}: {
  state: Exclude<CollapsedActivityState, null>;
  activeLabel: string;
  unreadLabel: string;
}): React.ReactNode => state === 'active' ? (
  <Icon name="loader-4" className="size-3 shrink-0 animate-spin text-primary" aria-label={activeLabel} />
) : (
  <span className="size-1.5 shrink-0 rounded-full bg-status-info" aria-label={unreadLabel} title={unreadLabel} />
);
