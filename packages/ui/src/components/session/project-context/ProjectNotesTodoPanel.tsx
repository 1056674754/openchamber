import React from 'react';

import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';
import { TodoSendDialog } from '@/components/session/TodoSendDialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useActiveServerId } from '@/hooks/useActiveServerId';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import {
  resolveProjectContextId,
  type ProjectRef,
  type ProjectTodoItem,
} from '@/lib/projectContextApi';
import { cn } from '@/lib/utils';
import {
  fetchSessionKnowledgeSummary,
  setSessionProjectContextPin,
  type SessionProjectContextPins,
} from '@/lib/sessionKnowledgeApi';
import {
  EMPTY_PROJECT_CONTEXT_ENTRY,
  useProjectContextStore,
} from '@/stores/useProjectContextStore';
import {
  EMPTY_AGENT_MEMORY_STORE_ENTRY,
  useAgentMemoryStore,
} from '@/stores/useAgentMemoryStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

import { AgentMemorySection } from './AgentMemorySection';
import { NotesSection } from './NotesSection';
import { PlansSection } from './PlansSection';
import { TodosSection } from './TodosSection';
import { useProjectTodoSend } from './useProjectTodoSend';

const PlanView = React.lazy(() => import('@/components/views/PlanView').then((module) => ({ default: module.PlanView })));

type ProjectContextTab = 'notes' | 'todos' | 'plans' | 'memory';

type ProjectNotesTodoPanelProps = {
  projectRef: ProjectRef | null;
  projectLabel?: string | null;
  canCreateWorktree?: boolean;
  onActionComplete?: () => void;
  className?: string;
};

const SIDEBAR_MIN_WIDTH = 112;
const SIDEBAR_MAX_WIDTH = 260;

const clampSidebarWidth = (width: number): number => (
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
);

const sortTodosWithCompletedLast = (items: ProjectTodoItem[]): ProjectTodoItem[] => [
  ...items.filter((todo) => !todo.completed),
  ...items.filter((todo) => todo.completed),
];

const matches = (haystack: string, needle: string): boolean => haystack.toLowerCase().includes(needle);

export const ProjectNotesTodoPanel: React.FC<ProjectNotesTodoPanelProps> = ({
  projectRef,
  projectLabel,
  canCreateWorktree = false,
  onActionComplete,
  className,
}) => {
  const { t } = useI18n();
  const projectContextId = React.useMemo(() => resolveProjectContextId(projectRef), [projectRef]);
  const contextEntry = useProjectContextStore(
    React.useCallback(
      (state) => (projectContextId ? state.entries[projectContextId] : undefined) ?? EMPTY_PROJECT_CONTEXT_ENTRY,
      [projectContextId],
    ),
  );
  const loadProjectContext = useProjectContextStore((state) => state.load);
  const saveTodos = useProjectContextStore((state) => state.saveTodos);
  const memoryEntry = useAgentMemoryStore(
    React.useCallback(
      (state) => (projectContextId ? state.entries[projectContextId] : undefined) ?? EMPTY_AGENT_MEMORY_STORE_ENTRY,
      [projectContextId],
    ),
  );
  const loadAgentMemory = useAgentMemoryStore((state) => state.load);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const draftOpen = useSessionUIStore((state) => state.newSessionDraft.open);
  const draftPins = useSessionUIStore((state) => state.newSessionDraft.projectContextPins);
  const setDraftProjectContextPin = useSessionUIStore((state) => state.setDraftProjectContextPin);
  const sessionDirectory = useEffectiveDirectory() ?? null;
  const serverId = useActiveServerId();
  const [sessionPins, setSessionPins] = React.useState<SessionProjectContextPins>({ notes: [], plans: [] });
  const [activeTab, setActiveTab] = React.useState<ProjectContextTab>('notes');
  const [query, setQuery] = React.useState('');
  const [openPlan, setOpenPlan] = React.useState<{ id: string; title: string } | null>(null);
  const [sidebarWidth, setSidebarWidth] = React.useState(144);
  const [isResizing, setIsResizing] = React.useState(false);
  const trimmedQuery = query.trim().toLowerCase();
  const todos = React.useMemo(() => sortTodosWithCompletedLast(contextEntry.todos), [contextEntry.todos]);
  const isLoading = contextEntry.loading && !contextEntry.loaded;
  const memoryAvailable = memoryEntry.available === true;

  const counts = React.useMemo(() => {
    if (!trimmedQuery) {
      return {
        notes: contextEntry.notes.length,
        todos: todos.length,
        plans: contextEntry.plans.length,
        memory: memoryEntry.global.length + memoryEntry.project.length,
      };
    }
    return {
      notes: contextEntry.notes.filter((note) => matches(note.body, trimmedQuery)).length,
      todos: todos.filter((todo) => matches(todo.text, trimmedQuery)).length,
      plans: contextEntry.plans.filter((plan) => matches(plan.title, trimmedQuery)).length,
      memory: [...memoryEntry.project, ...memoryEntry.global].filter((entry) => (
        matches(`${entry.title}\n${entry.body}\n${entry.type}`, trimmedQuery)
      )).length,
    };
  }, [contextEntry.notes, contextEntry.plans, memoryEntry.global, memoryEntry.project, todos, trimmedQuery]);

  const send = useProjectTodoSend({ projectRef, canCreateWorktree, onActionComplete });

  React.useEffect(() => {
    if (draftOpen) {
      setSessionPins(draftPins ?? { notes: [], plans: [] });
      return undefined;
    }
    if (!currentSessionId || !sessionDirectory) {
      setSessionPins({ notes: [], plans: [] });
      return undefined;
    }
    let cancelled = false;
    void fetchSessionKnowledgeSummary(sessionDirectory, currentSessionId, serverId).then((summary) => {
      if (!cancelled) {
        setSessionPins({
          notes: summary.notes.map((note) => note.id),
          plans: summary.plans.map((plan) => plan.id),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentSessionId, draftOpen, draftPins, serverId, sessionDirectory]);

  const toggleSessionPin = React.useCallback(async (
    kind: 'note' | 'plan',
    id: string,
    pinned: boolean,
  ): Promise<boolean> => {
    if (draftOpen) {
      setDraftProjectContextPin(kind, id, pinned);
      return true;
    }
    if (!currentSessionId || !sessionDirectory) return false;
    const next = await setSessionProjectContextPin(
      sessionDirectory,
      currentSessionId,
      kind,
      id,
      pinned,
      serverId,
    );
    if (!next) return false;
    setSessionPins(next);
    return true;
  }, [currentSessionId, draftOpen, serverId, sessionDirectory, setDraftProjectContextPin]);

  const pinnedNoteIds = React.useMemo(() => new Set(sessionPins.notes), [sessionPins.notes]);
  const pinnedPlanIds = React.useMemo(() => new Set(sessionPins.plans), [sessionPins.plans]);

  React.useEffect(() => {
    if (projectRef) void loadProjectContext(projectRef);
  }, [loadProjectContext, projectRef]);

  React.useEffect(() => {
    if (projectRef) void loadAgentMemory(projectRef);
  }, [loadAgentMemory, projectRef]);

  React.useEffect(() => {
    setQuery('');
    setOpenPlan(null);
    setActiveTab('notes');
  }, [projectContextId]);

  React.useEffect(() => {
    if (!trimmedQuery || counts[activeTab] > 0) return;
    const candidates: ProjectContextTab[] = memoryAvailable
      ? ['notes', 'todos', 'plans', 'memory']
      : ['notes', 'todos', 'plans'];
    const next = candidates.find((tab) => counts[tab] > 0);
    if (next) setActiveTab(next);
  }, [activeTab, counts, memoryAvailable, trimmedQuery]);

  React.useEffect(() => {
    if (activeTab === 'memory' && memoryEntry.available === false) setActiveTab('notes');
  }, [activeTab, memoryEntry.available]);

  const reportedErrorRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!contextEntry.error) {
      reportedErrorRef.current = null;
      return;
    }
    if (reportedErrorRef.current === contextEntry.error) return;
    reportedErrorRef.current = contextEntry.error;
    if (!contextEntry.loaded) {
      toast.error(t('rightSidebar.contextNotesTodo.toast.loadNotesFailed'), {
        description: contextEntry.error,
      });
    }
  }, [contextEntry.error, contextEntry.loaded, t]);

  const handlePersistTodos = React.useCallback(async (nextTodos: ProjectTodoItem[]) => {
    if (!projectRef) return false;
    const ok = await saveTodos(projectRef, nextTodos);
    if (!ok) {
      const detail = useProjectContextStore.getState().getEntry(projectRef).error;
      toast.error(t('rightSidebar.contextNotesTodo.toast.saveNotesFailed'), detail ? { description: detail } : undefined);
    }
    return ok;
  }, [projectRef, saveTodos, t]);

  const handleResizeMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const panelRight = event.currentTarget.closest('nav')?.getBoundingClientRect().right ?? 0;
    setSidebarWidth(clampSidebarWidth(panelRight - event.clientX));
  }, []);

  const handleResizeEnd = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
  }, []);

  if (!projectRef) {
    return (
      <div className={cn('w-full min-w-0 p-3', className)}>
        <p className="typography-meta text-muted-foreground">
          {t('rightSidebar.contextNotesTodo.empty.selectProject')}
        </p>
      </div>
    );
  }

  const projectTitle = projectLabel?.trim()
    || projectRef.path.split('/').filter(Boolean).pop()
    || projectRef.path;
  const sections: Array<{ id: ProjectContextTab; icon: IconName; label: string; count: number }> = [
    { id: 'notes', icon: 'sticky-note', label: t('rightSidebar.contextNotesTodo.tabs.notes'), count: counts.notes },
    { id: 'todos', icon: 'checkbox-circle', label: t('rightSidebar.contextNotesTodo.tabs.todos'), count: counts.todos },
    { id: 'plans', icon: 'file-text', label: t('rightSidebar.contextNotesTodo.tabs.plans'), count: counts.plans },
    ...(memoryAvailable ? [{
      id: 'memory' as const,
      icon: 'brain-ai-3' as IconName,
      label: t('rightSidebar.contextNotesTodo.tabs.memory'),
      count: counts.memory,
    }] : []),
  ];

  return (
    <div className={cn('flex h-full min-h-0 w-full min-w-0 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-2 p-3 pb-2">
        {openPlan ? (
          <button
            type="button"
            onClick={() => setOpenPlan(null)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={t('rightSidebar.contextNotesTodo.plans.actions.back')}
            title={t('rightSidebar.contextNotesTodo.plans.actions.back')}
          >
            <Icon name="arrow-left-s" className="size-4" />
          </button>
        ) : null}
        <h3 className="min-w-0 flex-1 truncate typography-ui-label font-semibold text-foreground" title={projectRef.path}>
          {projectTitle}
        </h3>
        <div className="relative w-40 shrink-0">
          <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('rightSidebar.contextNotesTodo.search.placeholder')}
            className="h-8 pl-7 pr-7"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground"
              aria-label={t('rightSidebar.contextNotesTodo.search.clear')}
              title={t('rightSidebar.contextNotesTodo.search.clear')}
            >
              <Icon name="close" className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn('min-h-0 min-w-0 flex-1 p-3', openPlan ? 'overflow-hidden' : 'overflow-y-auto')}>
          {activeTab === 'notes' ? (
            <NotesSection
              projectRef={projectRef}
              notes={contextEntry.notes}
              disabled={isLoading}
              query={query}
              pinnedNoteIds={pinnedNoteIds}
              onTogglePinned={(noteId, pinned) => toggleSessionPin('note', noteId, pinned)}
            />
          ) : null}
          {activeTab === 'todos' ? (
            <TodosSection
              todos={todos}
              query={query}
              disabled={isLoading}
              canCreateWorktree={canCreateWorktree}
              sendingTodoId={send.sendingTodoId}
              onPersistTodos={handlePersistTodos}
              onSendToCurrentSession={send.sendToCurrentSession}
              onSendToNewSession={send.sendToNewSession}
              onSendToNewWorktreeSession={send.sendToNewWorktreeSession}
            />
          ) : null}
          {activeTab === 'plans' && !openPlan ? (
            <PlansSection
              projectRef={projectRef}
              plans={contextEntry.plans}
              query={query}
              onOpenPlan={setOpenPlan}
              pinnedPlanIds={pinnedPlanIds}
              onTogglePinned={(planId, pinned) => toggleSessionPin('plan', planId, pinned)}
            />
          ) : null}
          {activeTab === 'plans' && openPlan ? (
            <React.Suspense fallback={null}>
              <PlanView projectPlanId={openPlan.id} />
            </React.Suspense>
          ) : null}
          {activeTab === 'memory' && memoryAvailable ? (
            <AgentMemorySection projectRef={projectRef} projectKey={projectContextId} query={query} />
          ) : null}
        </div>

        <nav
          className="relative flex shrink-0 flex-col gap-0.5 overflow-y-auto border-l border-[var(--interactive-border)] p-2"
          style={{ width: `${sidebarWidth}px` }}
          aria-label={t('rightSidebar.contextNotesTodo.sections.label')}
        >
          <div
            className={cn(
              'absolute left-0 top-0 z-20 h-full w-[3px] cursor-col-resize transition-colors hover:bg-[var(--interactive-border)]/80',
              isResizing && 'bg-[var(--interactive-border)]',
            )}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setIsResizing(true);
            }}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('rightSidebar.contextNotesTodo.sections.resize')}
          />
          {sections.map((section) => {
            const selected = activeTab === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => {
                  setActiveTab(section.id);
                  if (section.id !== 'plans') setOpenPlan(null);
                }}
                aria-current={selected ? 'page' : undefined}
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left',
                  selected
                    ? 'bg-interactive-active text-foreground'
                    : 'text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground',
                )}
              >
                <Icon name={section.icon} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate typography-meta">{section.label}</span>
                <span className="shrink-0 typography-micro text-muted-foreground">{section.count}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <TodoSendDialog
        open={send.pendingSendTarget !== null}
        onOpenChange={(open) => { if (!open) send.closeDialog(); }}
        target={send.pendingSendTarget?.kind ?? 'session'}
        projectDirectory={projectRef.path}
        submitting={send.isSubmitting}
        onConfirm={send.confirmSend}
      />
    </div>
  );
};
