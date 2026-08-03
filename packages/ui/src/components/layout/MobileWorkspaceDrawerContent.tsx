import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { McpIcon } from '@/components/icons/McpIcon';
import { McpDropdownContent } from '@/components/mcp/McpDropdown';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { SortableTabsStrip, type SortableTabsStripItem } from '@/components/ui/sortable-tabs-strip';
import { lazyWithChunkRecovery } from '@/lib/chunkLoadRecovery';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { ProjectContextPanel } from './RightSidebarTabs';

const DiffView = lazyWithChunkRecovery(() => import('@/components/views/DiffView').then((module) => ({ default: module.DiffView })));
const FilesView = lazyWithChunkRecovery(() => import('@/components/views/FilesView').then((module) => ({ default: module.FilesView })));
const TerminalView = lazyWithChunkRecovery(() => import('@/components/views/TerminalView').then((module) => ({ default: module.TerminalView })));

type MobileWorkspaceTab = 'changes' | 'files' | 'terminal' | 'notes' | 'mcp';

type MobileWorkspaceDrawerContentProps = {
  readonly open: boolean;
  readonly onClose: () => void;
};

export const MobileWorkspaceDrawerContent: React.FC<MobileWorkspaceDrawerContentProps> = ({
  open,
  onClose,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = React.useState<MobileWorkspaceTab>('changes');
  const [visitedTabs, setVisitedTabs] = React.useState<ReadonlySet<MobileWorkspaceTab>>(
    () => new Set(['changes']),
  );

  React.useEffect(() => {
    if (!open) return;
    setVisitedTabs((current) => {
      if (current.has(activeTab)) return current;
      const next = new Set(current);
      next.add(activeTab);
      return next;
    });
  }, [activeTab, open]);

  const tabs = React.useMemo<SortableTabsStripItem[]>(() => [
    {
      id: 'changes',
      label: t('layout.mainTab.diff'),
      icon: <Icon name="git-branch" className="h-3.5 w-3.5" />,
    },
    {
      id: 'files',
      label: t('layout.mainTab.files'),
      icon: <Icon name="file-text" className="h-3.5 w-3.5" />,
    },
    {
      id: 'terminal',
      label: t('layout.mainTab.terminal'),
      icon: <Icon name="terminal" className="h-3.5 w-3.5" />,
    },
    {
      id: 'notes',
      label: t('contextRail.surface.notes'),
      icon: <Icon name="sticky-note" className="h-3.5 w-3.5" />,
    },
    {
      id: 'mcp',
      label: t('mcpDropdown.title'),
      icon: <McpIcon className="h-3.5 w-3.5" />,
    },
  ], [t]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 px-2">
        <SortableTabsStrip
          items={tabs}
          activeId={activeTab}
          onSelect={(id) => setActiveTab(id as MobileWorkspaceTab)}
          layoutMode="fit"
          variant="active-pill"
          inactiveTabsIconOnly
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t('mainLayout.mobile.closeDrawerAria')}
          onClick={onClose}
        >
          <Icon name="close" className="size-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {visitedTabs.has('changes') ? (
          <div className={cn('h-full', activeTab !== 'changes' && 'hidden')}>
            <ErrorBoundary>
              <React.Suspense fallback={null}><DiffView /></React.Suspense>
            </ErrorBoundary>
          </div>
        ) : null}
        {visitedTabs.has('files') ? (
          <div className={cn('h-full', activeTab !== 'files' && 'hidden')}>
            <ErrorBoundary>
              <React.Suspense fallback={null}><FilesView /></React.Suspense>
            </ErrorBoundary>
          </div>
        ) : null}
        {visitedTabs.has('terminal') ? (
          <div className={cn('h-full', activeTab !== 'terminal' && 'hidden')}>
            <ErrorBoundary>
              <React.Suspense fallback={null}>
                <TerminalView />
              </React.Suspense>
            </ErrorBoundary>
          </div>
        ) : null}
        {visitedTabs.has('notes') ? (
          <div className={cn('h-full', activeTab !== 'notes' && 'hidden')}>
            <ErrorBoundary><ProjectContextPanel /></ErrorBoundary>
          </div>
        ) : null}
        {visitedTabs.has('mcp') ? (
          <div className={cn('h-full', activeTab !== 'mcp' && 'hidden')}>
            <ErrorBoundary>
              <McpDropdownContent active={open && activeTab === 'mcp'} />
            </ErrorBoundary>
          </div>
        ) : null}
      </div>
    </div>
  );
};
