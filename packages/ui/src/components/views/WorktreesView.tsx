import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { WorktreeSectionContent } from '@/components/sections/openchamber/WorktreeSectionContent';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';

export function WorktreesView(): React.ReactNode {
  const { t } = useI18n();
  const projectId = useUIStore((state) => state.worktreesPageProjectId);
  const setWorktreesPageProjectId = useUIStore((state) => state.setWorktreesPageProjectId);
  const setNewWorktreeDialogOpen = useUIStore((state) => state.setNewWorktreeDialogOpen);
  const setActiveProjectIdOnly = useProjectsStore((state) => state.setActiveProjectIdOnly);
  const project = useProjectsStore((state) => (
    state.projects.find((entry) => entry.id === projectId) ?? null
  ));

  if (!projectId || !project) return null;

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border/50 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => setWorktreesPageProjectId(null)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground"
          aria-label={t('header.actions.backAria')}
        >
          <Icon name="arrow-left" className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate typography-ui-header font-semibold text-foreground">
            {t('sessions.sidebar.project.actions.manageWorktrees')}
          </h2>
          <p className="truncate typography-micro text-muted-foreground">
            {project.label?.trim() || project.path}
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto w-full max-w-4xl space-y-4">
          <Button
            size="sm"
            onClick={() => {
              setActiveProjectIdOnly(project.id);
              setNewWorktreeDialogOpen(true);
            }}
          >
            <Icon name="node-tree" className="mr-1 h-3.5 w-3.5" />
            {t('sessions.sidebar.project.actions.newWorktree')}
          </Button>
          <WorktreeSectionContent projectRef={{
            id: project.id,
            path: project.path,
            serverId: project.serverId,
            label: project.label,
          }} />
        </div>
      </div>
    </div>
  );
}
