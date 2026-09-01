import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { normalizePath } from '@/lib/pathNormalization';
import { serverRegistry } from '@/lib/opencode/server-registry';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSelectionStore } from '@/sync/selection-store';
import { cn } from '@/lib/utils';

import type { OpenChamberTaskCard } from './taskCardMetadata';

type TaskCardProps = {
  readonly card: OpenChamberTaskCard;
  readonly sessionId?: string;
};

type StartState = 'idle' | 'starting' | 'started' | 'error';

function resolveProjectIdForDirectory(directory: string, serverId: string | null): string | null {
  const normalizedDirectory = normalizePath(directory) ?? directory;
  let best: { id: string; pathLength: number } | null = null;
  for (const project of useProjectsStore.getState().projects) {
    if (serverId && project.serverId && project.serverId !== serverId) continue;
    const projectPath = normalizePath(project.path ?? null);
    if (!projectPath || !normalizedDirectory.startsWith(`${projectPath}/`)) continue;
    if (!best || projectPath.length > best.pathLength) best = { id: project.id, pathLength: projectPath.length };
  }
  return best?.id ?? null;
}

const TaskCard: React.FC<TaskCardProps> = React.memo(({ card, sessionId }) => {
  const { t } = useI18n();
  const [state, setState] = React.useState<StartState>('idle');

  const start = React.useCallback(async () => {
    if (state === 'starting' || state === 'started') return;
    setState('starting');

    try {
      const store = useSessionUIStore.getState();
      const directory =
        card.directory
        ?? (sessionId ? store.getDirectoryForSession(sessionId) : null);
      if (!directory) {
        throw new Error('task card: source directory unknown');
      }

      const serverId = sessionId ? serverRegistry.getServerForSession(sessionId) : null;
      const session = await store.createSession(card.title, directory, null, serverId);
      if (!session) {
        throw new Error('task card: session creation failed');
      }

      const sessionDirectory =
        normalizePath((session as { directory?: string | null }).directory ?? directory) ?? directory;
      const targetServerId = serverRegistry.getServerForSession(session.id) ?? serverId;

      const sessionChoice = sessionId ? store.getLastUserChoice(sessionId) : null;
      const lastUsed = useSelectionStore.getState().lastUsedProvider;
      const providerID = sessionChoice?.providerID ?? lastUsed?.providerID;
      const modelID = sessionChoice?.modelID ?? lastUsed?.modelID;
      const agent = card.agent ?? sessionChoice?.agent ?? undefined;

      if (providerID && modelID) {
        await store.sendMessage(
          card.prompt,
          providerID,
          modelID,
          agent,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { sessionId: session.id, directory: sessionDirectory, serverId: targetServerId },
        );
      } else {
        console.error('[task-card] no provider selection available; session created without first prompt');
      }

      const projectId = resolveProjectIdForDirectory(sessionDirectory, targetServerId ?? null);
      if (projectId) {
        store.navigateToSession(session.id, sessionDirectory, projectId);
      } else {
        store.setCurrentSession(
          session.id,
          sessionDirectory,
          targetServerId ? { serverId: targetServerId } : undefined,
        );
        useProjectsStore.getState().setActiveProjectIdOnly('');
      }
      setState('started');
    } catch (error) {
      console.error('[task-card] failed to start conversation', error);
      setState('error');
    }
  }, [card, sessionId, state]);

  const busy = state === 'starting';
  const started = state === 'started';
  const label = started
    ? t('chat.taskCard.started')
    : busy
      ? t('chat.taskCard.starting')
      : state === 'error'
        ? t('chat.taskCard.failed')
        : t('chat.taskCard.start');
  const startAria = `${label}: ${card.title}`;

  return (
    <article
      className={cn(
        'mx-3 mb-2 flex min-w-0 items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2',
        'bg-[var(--surface-elevated)] text-foreground',
      )}
      aria-label={`Task: ${card.title}`}
      title={card.tldr}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-[var(--surface-muted)] text-muted-foreground"
        aria-hidden="true"
      >
        <Icon name="ai-agent" className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate typography-meta font-medium text-foreground" title={card.title}>
          {card.title}
        </div>
        <div
          className="mt-0.5 truncate typography-micro text-muted-foreground"
          title={card.tldr ?? card.prompt}
        >
          {card.tldr ?? card.prompt}
        </div>
      </div>

      <button
        type="button"
        onClick={start}
        disabled={busy || started}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 typography-meta transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-border)]',
          started
            ? 'text-muted-foreground'
            : 'bg-[var(--surface-muted)] text-foreground hover:bg-[var(--surface-hover)]',
          state === 'error' && 'text-destructive',
        )}
        aria-label={startAria}
      >
        <Icon name={started ? 'check' : 'arrow-right'} className="h-3.5 w-3.5" />
        {label}
      </button>
    </article>
  );
});

TaskCard.displayName = 'TaskCard';

export { TaskCard };
