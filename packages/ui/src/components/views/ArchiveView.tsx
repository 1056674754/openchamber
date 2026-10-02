import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { Icon } from '@/components/icon/Icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui';
import { formatSessionDateLabel, normalizePath } from '@/components/session/sidebar/utils';
import { useI18n } from '@/lib/i18n';
import { sessionEvents } from '@/lib/sessionEvents';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { cn, formatDirectoryName } from '@/lib/utils';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useShallow } from 'zustand/react/shallow';
import { refreshSpaceArchives, useSpaceArchivesStore } from '@/lib/spaces/space-archives';

type DirectoryBucket = {
  directory: string;
  label: string;
  sessions: Session[];
  // The chats of a deleted isolated space: named after the space, with no way to restore them.
  fromDeletedSpace: boolean;
};

const PAGE_SIZE = 100;

export function ArchiveView(): React.ReactNode {
  const { t } = useI18n();
  const open = useUIStore((state) => state.isArchivePageOpen);
  const setOpen = useUIStore((state) => state.setArchivePageOpen);
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab);
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const unarchiveSession = useSessionUIStore((state) => state.unarchiveSession);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const projects = useProjectsStore((state) => state.projects);
  const archivedSessions = useGlobalSessionsStore(useShallow((state) => (
    open ? state.archivedSessions : []
  )));
  const loadArchivedSessions = useGlobalSessionsStore((state) => state.loadArchivedSessions);
  const [query, setQuery] = React.useState('');
  const [selectedDirectory, setSelectedDirectory] = React.useState<string | null>(null);
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const spaceArchives = useSpaceArchivesStore((state) => state.byDirectory);

  // The chats of deleted spaces are read-only and named after their space; read which they are
  // each time the page opens, since a space may have been deleted from another window.
  React.useEffect(() => {
    if (open) void refreshSpaceArchives().catch(() => {});
  }, [open]);

  const labelOf = React.useCallback((directory: string): string => {
    const archive = spaceArchives?.get(directory);
    if (archive) return archive.name;
    return directory ? (formatDirectoryName(directory, homeDirectory) || directory) : t('sessions.archivePage.otherProjects');
  }, [homeDirectory, spaceArchives, t]);

  React.useEffect(() => {
    if (!open) return;
    const serverIds = new Set<string>([DEFAULT_SERVER_ID]);
    for (const project of projects) {
      const serverId = project.serverId ?? DEFAULT_SERVER_ID;
      if (serverId === DEFAULT_SERVER_ID || serverRegistry.get(serverId)?.healthStatus === 'healthy') {
        serverIds.add(serverId);
      }
    }
    for (const serverId of serverIds) {
      void loadArchivedSessions(serverId).catch(() => undefined);
    }
  }, [loadArchivedSessions, open, projects]);

  const normalizedQuery = query.trim().toLowerCase();
  const sortedSessions = React.useMemo(() => {
    if (!open) return [];
    return [...archivedSessions].sort((left, right) => (
      (right.time?.archived ?? 0) - (left.time?.archived ?? 0)
    ));
  }, [archivedSessions, open]);

  const buckets = React.useMemo<DirectoryBucket[]>(() => {
    const byDirectory = new Map<string, DirectoryBucket>();
    for (const session of sortedSessions) {
      const directory = normalizePath(resolveGlobalSessionDirectory(session)) ?? '';
      const existing = byDirectory.get(directory);
      if (existing) {
        existing.sessions.push(session);
        continue;
      }
      byDirectory.set(directory, {
        directory,
        label: labelOf(directory),
        sessions: [session],
        fromDeletedSpace: spaceArchives?.has(directory) ?? false,
      });
    }
    return [...byDirectory.values()].sort((left, right) => right.sessions.length - left.sessions.length);
  }, [labelOf, sortedSessions, spaceArchives]);

  const filteredSessions = React.useMemo(() => {
    if (normalizedQuery) {
      // Exact session-ID queries match only the full ID, case-insensitively.
      if (normalizedQuery.startsWith('ses_')) {
        return sortedSessions.filter((session) => session.id.toLowerCase() === normalizedQuery);
      }
      return sortedSessions.filter((session) => (
        (session.title ?? '').toLowerCase().includes(normalizedQuery)
      ));
    }
    if (selectedDirectory === null) return sortedSessions;
    return buckets.find((bucket) => bucket.directory === selectedDirectory)?.sessions ?? [];
  }, [buckets, normalizedQuery, selectedDirectory, sortedSessions]);

  const visibleSessions = filteredSessions.slice(0, visibleCount);
  const remainingCount = filteredSessions.length - visibleSessions.length;

  const openSession = React.useCallback((session: Session) => {
    const directory = normalizePath(resolveGlobalSessionDirectory(session));
    const serverId = serverRegistry.getServerForSession(session.id);
    setCurrentSession(session.id, directory, { serverId });
    setActiveMainTab('chat');
    setOpen(false);
  }, [setActiveMainTab, setCurrentSession, setOpen]);

  const restoreSession = React.useCallback((session: Session) => {
    void unarchiveSession(session.id).then((success) => {
      if (success) {
        toast.success(t('sessions.sidebar.session.restore.success'));
      } else {
        toast.error(t('sessions.sidebar.session.restore.error'));
      }
    });
  }, [t, unarchiveSession]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-10 flex min-h-0 flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border/50 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground"
          aria-label={t('header.actions.backAria')}
        >
          <Icon name="arrow-left" className="h-4 w-4" />
        </button>
        <h2 className="typography-ui-header font-semibold text-foreground">
          {t('sessions.sidebar.nav.archive')}
        </h2>
      </header>
      <div className="flex min-h-0 flex-1">
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-border/50">
        <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
          <button
            type="button"
            onClick={() => {
              setSelectedDirectory(null);
              setVisibleCount(PAGE_SIZE);
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left typography-ui-label',
              selectedDirectory === null
                ? 'bg-interactive-selection text-foreground'
                : 'text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{t('sessions.archivePage.allDirectories')}</span>
            <span className="typography-micro text-muted-foreground/70">{archivedSessions.length}</span>
          </button>
          {buckets.map((bucket) => (
            <div key={bucket.directory || '__none__'} className="group/dir relative">
              <button
                type="button"
                title={bucket.fromDeletedSpace ? t('spaces.archive.groupTitle', { name: bucket.label }) : (bucket.directory || undefined)}
                onClick={() => {
                  setSelectedDirectory(bucket.directory);
                  setVisibleCount(PAGE_SIZE);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 pr-8 text-left typography-ui-label',
                  selectedDirectory === bucket.directory
                    ? 'bg-interactive-selection text-foreground'
                    : 'text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground',
                )}
              >
                {bucket.fromDeletedSpace ? <Icon name="box-3" className="h-3.5 w-3.5 flex-shrink-0" /> : null}
                <span className="min-w-0 flex-1 truncate">{bucket.label}</span>
                <span className="typography-micro text-muted-foreground/70">{bucket.sessions.length}</span>
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => sessionEvents.requestDelete({ sessions: bucket.sessions, mode: 'session' })}
                    className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:text-destructive group-hover/dir:opacity-100 focus-visible:opacity-100"
                    aria-label={t('sessions.archivePage.deleteProjectAria', { label: bucket.label })}
                  >
                    <Icon name="delete-bin" className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('sessions.archivePage.deleteProject')}</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 px-6 pt-3">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder={t('sessions.archivePage.searchPlaceholder')}
              className="h-8 w-full rounded-md border border-border bg-transparent pl-8 pr-3 typography-ui-label text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <span className="typography-micro text-muted-foreground">
            {filteredSessions.length === 1
              ? t('sessions.archivePage.countSingle', { count: filteredSessions.length })
              : t('sessions.archivePage.countPlural', { count: filteredSessions.length })}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
          <div className="mx-auto w-full max-w-3xl space-y-0.5">
            {visibleSessions.length === 0 ? (
              <p className="py-10 text-center typography-ui-label text-muted-foreground">
                {normalizedQuery
                  ? t('sessions.archivePage.empty.noMatches')
                  : t('sessions.archivePage.empty.noArchived')}
              </p>
            ) : visibleSessions.map((session) => {
              // A deleted space's chat has nowhere to be restored to.
              const sessionDirectory = normalizePath(resolveGlobalSessionDirectory(session)) ?? '';
              const restorable = !(spaceArchives?.has(sessionDirectory) ?? false);
              return (
              <div key={session.id} className="group/session relative">                <button
                  type="button"
                  onClick={() => openSession(session)}
                  className="flex w-full items-center gap-3 rounded-md py-1 pl-2 pr-14 text-left hover:bg-interactive-hover/40"
                >
                  <span className="min-w-0 flex-1 truncate typography-ui-label text-foreground">
                    {session.title || t('sessions.sidebar.session.untitled')}
                  </span>
                  <span className="typography-micro text-muted-foreground/75">
                    {formatSessionDateLabel(session.time?.archived ?? session.time?.updated ?? session.time?.created ?? Date.now())}
                  </span>
                </button>
                {restorable ? <button
                  type="button"
                  onClick={() => restoreSession(session)}
                  className="absolute right-7 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:text-foreground group-hover/session:opacity-100 focus-visible:opacity-100"
                  aria-label={t('sessions.archivePage.restoreSessionAria', {
                    title: session.title || t('sessions.sidebar.session.untitled'),
                  })}
                >
                  <Icon name="inbox-unarchive" className="h-3.5 w-3.5" />
                </button> : null}
                <button
                  type="button"
                  onClick={() => sessionEvents.requestDelete({ sessions: [session], mode: 'session' })}
                  className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:text-destructive group-hover/session:opacity-100 focus-visible:opacity-100"
                  aria-label={t('sessions.archivePage.deleteSessionAria', {
                    title: session.title || t('sessions.sidebar.session.untitled'),
                  })}
                >
                  <Icon name="delete-bin" className="h-3.5 w-3.5" />
                </button>
              </div>
              );
            })}
            {remainingCount > 0 ? (
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                className="mt-1 rounded-md px-2 py-1 typography-micro text-muted-foreground hover:text-foreground hover:underline"
              >
                {t('sessions.sidebar.group.showMore')}
              </button>
            ) : null}
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
