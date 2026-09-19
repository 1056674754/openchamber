import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { normalizeTerminalDirectory } from '@/lib/pathNormalization';
import { useTerminalStore } from '@/stores/useTerminalStore';
import { cn } from '@/lib/utils';

// [fork-port] Upstream detects a running project action through terminal-tab
// lifecycle flags on the tab itself; the fork tracks runs explicitly in
// `projectActionRuns` (directory + status), so the indicator subscribes to
// that record instead. Behavior is the same: a directory-scoped leaf
// subscription; output chunks do not rerender the indicator.
const hasRunningActionForDirectory = (
  runs: Record<string, { directory: string }>,
  key: string,
): boolean => Object.values(runs).some((run) => run.directory === key);

const selectHasActiveActionFor = (key: string) => (store: { projectActionRuns: Record<string, { directory: string; status: string }> }): boolean =>
  hasRunningActionForDirectory(store.projectActionRuns, key);

/** A directory-scoped leaf subscription; output chunks do not rerender the indicator. */
export const DirectoryActionIndicator = ({ directory, className }: { directory: string; className?: string }) => {
  const { t } = useI18n();
  const key = normalizeTerminalDirectory(directory);
  // Select the resolved boolean so unrelated run records never rerender this leaf.
  const active = useTerminalStore(React.useCallback(selectHasActiveActionFor(key), [key]));
  if (!active) return null;
  const label = t('sessions.sidebar.projectAction.active');
  return <span className={cn('inline-flex shrink-0 items-center text-status-info', className)} role="img" aria-label={label} title={label} data-action-directory={key}>
    <Icon name="pulse" className="size-3.5" />
  </span>;
};
