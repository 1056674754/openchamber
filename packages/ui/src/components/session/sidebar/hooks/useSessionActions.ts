import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { toast } from '@/components/ui';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { normalizePath } from '../utils';

type DeleteSessionConfirmSetter = React.Dispatch<React.SetStateAction<{
  session: Session;
  descendantCount: number;
  descendantIds: string[];
  archivedBucket: boolean;
} | null>>;

type Args = {
  activeProjectId: string | null;
  currentSessionId: string | null;
  mobileVariant: boolean;
  allowReselect: boolean;
  onSessionSelected?: (sessionId: string) => void;
  isSessionSearchOpen: boolean;
  sessionSearchQuery: string;
  setSessionSearchQuery: (value: string) => void;
  setIsSessionSearchOpen: (open: boolean) => void;
  setActiveMainTab: (tab: 'chat' | 'plan' | 'git' | 'diff' | 'terminal' | 'files') => void;
  setSessionSwitcherOpen: (open: boolean) => void;
  updateSessionTitle: (id: string, title: string) => Promise<void>;
  shareSession: (id: string) => Promise<Session | null>;
  unshareSession: (id: string) => Promise<Session | null>;
  deleteSession: (id: string) => Promise<boolean>;
  deleteSessions: (ids: string[]) => Promise<{ deletedIds: string[]; failedIds: string[] }>;
  archiveSession: (id: string) => Promise<boolean>;
  archiveSessions: (ids: string[]) => Promise<{ archivedIds: string[]; failedIds: string[] }>;
  childrenMap: Map<string, Session[]>;
  showDeletionDialog: boolean;
  setDeleteSessionConfirm: DeleteSessionConfirmSetter;
  deleteSessionConfirm: { session: Session; descendantCount: number; descendantIds: string[]; archivedBucket: boolean } | null;
  setEditingId: (id: string | null) => void;
  setEditTitle: (value: string) => void;
  editingId: string | null;
  editTitle: string;
};

const normalizeServerId = (serverId?: string | null): string =>
  serverId && serverId !== DEFAULT_SERVER_ID ? serverId : DEFAULT_SERVER_ID;

const resolveProjectIdForSessionSelection = (
  sessionId: string,
  sessionDirectory?: string | null,
  explicitProjectId?: string | null,
): string | null => {
  if (explicitProjectId) {
    return explicitProjectId;
  }

  const directory = normalizePath(sessionDirectory ?? null);
  if (!directory) {
    return null;
  }

  const indexedServerId = serverRegistry.getServerForSession(sessionId);
  let best: { id: string; pathLength: number } | null = null;

  for (const project of useProjectsStore.getState().projects) {
    if (indexedServerId && normalizeServerId(project.serverId) !== indexedServerId) {
      continue;
    }

    const projectPath = normalizePath(project.path);
    if (!projectPath) {
      continue;
    }
    if (directory !== projectPath && !directory.startsWith(`${projectPath}/`)) {
      continue;
    }
    if (!best || projectPath.length > best.pathLength) {
      best = { id: project.id, pathLength: projectPath.length };
    }
  }

  return best?.id ?? null;
};

export const useSessionActions = (args: Args) => {
  const { t } = useI18n();
  const [copiedSessionId, setCopiedSessionId] = React.useState<string | null>(null);
  const copyTimeout = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyTimeout.current) {
        clearTimeout(copyTimeout.current);
      }
    };
  }, []);

  const handleSessionSelect = React.useCallback(
    (sessionId: string, sessionDirectory?: string | null, disabled?: boolean, projectId?: string | null) => {
      if (disabled) {
        return;
      }

      const resetSessionSearch = () => {
        if (!args.isSessionSearchOpen && args.sessionSearchQuery.length === 0) {
          return;
        }
        args.setSessionSearchQuery('');
        args.setIsSessionSearchOpen(false);
      };

      if (args.mobileVariant) {
        args.setActiveMainTab('chat');
        args.setSessionSwitcherOpen(false);
      }

      const indexedServerId = serverRegistry.getServerForSession(sessionId);
      const currentDirectory = useSessionUIStore.getState().getDirectoryForSession(sessionId);
      const nextDirectory = normalizePath(sessionDirectory ?? null);
      const needsSelectionRefresh = sessionId === args.currentSessionId && (
        Boolean(nextDirectory && currentDirectory !== nextDirectory)
        || !indexedServerId
      );

      if (sessionId === args.currentSessionId && !needsSelectionRefresh) {
        if (args.allowReselect) {
          args.onSessionSelected?.(sessionId);
        }
        resetSessionSearch();
        return;
      }

      const resolvedProjectId = resolveProjectIdForSessionSelection(sessionId, sessionDirectory, projectId);
      if (sessionDirectory && resolvedProjectId) {
        useSessionUIStore.getState().navigateToSession(sessionId, sessionDirectory, resolvedProjectId);
      } else {
        useSessionUIStore.getState().setCurrentSession(
          sessionId,
          sessionDirectory ?? null,
          indexedServerId ? { serverId: indexedServerId } : undefined,
        );
      }
      args.onSessionSelected?.(sessionId);
      resetSessionSearch();
    },
    [args],
  );

  const handleSessionDoubleClick = React.useCallback((sessionId: string, sessionTitle: string) => {
    args.setEditingId(sessionId);
    args.setEditTitle(sessionTitle);
  }, [args]);

  const handleSaveEdit = React.useCallback(async () => {
    if (!args.editingId) {
      return;
    }
    const trimmed = args.editTitle.trim();
    if (trimmed) {
      await args.updateSessionTitle(args.editingId, trimmed);
    }
    args.setEditingId(null);
    args.setEditTitle('');
  }, [args]);

  const handleCancelEdit = React.useCallback(() => {
    args.setEditingId(null);
    args.setEditTitle('');
  }, [args]);

  const handleShareSession = React.useCallback(async (session: Session) => {
    const result = await args.shareSession(session.id);
    if (result && result.share?.url) {
      toast.success(t('sessions.sidebar.session.share.successTitle'), {
        description: t('sessions.sidebar.session.share.successDescription'),
      });
    } else {
      toast.error(t('sessions.sidebar.session.share.error'));
    }
  }, [args, t]);

  const handleCopyShareUrl = React.useCallback((url: string, sessionId: string) => {
    void copyTextToClipboard(url)
      .then((result) => {
        if (!result.ok) {
          toast.error(t('sessions.sidebar.session.share.copyUrlError'));
          return;
        }
        setCopiedSessionId(sessionId);
        if (copyTimeout.current) {
          clearTimeout(copyTimeout.current);
        }
        copyTimeout.current = window.setTimeout(() => {
          setCopiedSessionId(null);
          copyTimeout.current = null;
        }, 2000);
      })
      .catch(() => {
        toast.error(t('sessions.sidebar.session.share.copyUrlError'));
      });
  }, [t]);

  const handleUnshareSession = React.useCallback(async (sessionId: string) => {
    const result = await args.unshareSession(sessionId);
    if (result) {
      toast.success(t('sessions.sidebar.session.unshare.success'));
    } else {
      toast.error(t('sessions.sidebar.session.unshare.error'));
    }
  }, [args, t]);

  const collectDescendants = React.useCallback((sessionId: string): Session[] => {
    const collected: Session[] = [];
    const visit = (id: string) => {
      const children = args.childrenMap.get(id) ?? [];
      children.forEach((child) => {
        collected.push(child);
        visit(child.id);
      });
    };
    visit(sessionId);
    return collected;
  }, [args.childrenMap]);

  const filterDescendantsForAction = React.useCallback((descendants: Session[], shouldHardDelete: boolean): Session[] => {
    if (shouldHardDelete) return descendants;
    return descendants.filter((session) => !session.time?.archived);
  }, []);

  const executeDeleteSession = React.useCallback(
    async (
      session: Session,
      source?: { archivedBucket?: boolean },
      precomputed?: { descendantIds: string[] },
    ) => {
      const shouldHardDelete = source?.archivedBucket === true;
      const descendantIds = precomputed?.descendantIds
        ?? filterDescendantsForAction(collectDescendants(session.id), shouldHardDelete).map((descendant) => descendant.id);
      if (descendantIds.length === 0) {
        const success = shouldHardDelete
          ? await args.deleteSession(session.id)
          : await args.archiveSession(session.id);
        if (success) {
          toast.success(shouldHardDelete
            ? t('sessions.sidebar.session.delete.success')
            : t('sessions.sidebar.session.archive.success'));
        } else {
          toast.error(shouldHardDelete
            ? t('sessions.sidebar.session.delete.error')
            : t('sessions.sidebar.session.archive.error'));
        }
        return;
      }

      const ids = [...descendantIds, session.id];
      if (shouldHardDelete) {
        const { deletedIds, failedIds } = await args.deleteSessions(ids);
        if (deletedIds.length > 0) {
          toast.success(deletedIds.length === 1
            ? t('sessions.sidebar.bulkActions.deletedSingle', { count: deletedIds.length })
            : t('sessions.sidebar.bulkActions.deletedPlural', { count: deletedIds.length }));
        }
        if (failedIds.length > 0) {
          toast.error(failedIds.length === 1
            ? t('sessions.sidebar.bulkActions.failedDeleteSingle', { count: failedIds.length })
            : t('sessions.sidebar.bulkActions.failedDeletePlural', { count: failedIds.length }));
        }
        return;
      }

      const { archivedIds, failedIds } = await args.archiveSessions(ids);
      if (archivedIds.length > 0) {
        toast.success(archivedIds.length === 1
          ? t('sessions.sidebar.bulkActions.archivedSingle', { count: archivedIds.length })
          : t('sessions.sidebar.bulkActions.archivedPlural', { count: archivedIds.length }));
      }
      if (failedIds.length > 0) {
        toast.error(failedIds.length === 1
          ? t('sessions.sidebar.bulkActions.failedArchiveSingle', { count: failedIds.length })
          : t('sessions.sidebar.bulkActions.failedArchivePlural', { count: failedIds.length }));
      }
    },
    [args, collectDescendants, filterDescendantsForAction, t],
  );

  const handleDeleteSession = React.useCallback(
    (session: Session, source?: { archivedBucket?: boolean }) => {
      const shouldHardDelete = source?.archivedBucket === true;
      const descendantIds = filterDescendantsForAction(
        collectDescendants(session.id),
        shouldHardDelete,
      ).map((descendant) => descendant.id);
      if (!args.showDeletionDialog) {
        void executeDeleteSession(session, source, { descendantIds });
        return;
      }
      args.setDeleteSessionConfirm({
        session,
        descendantCount: descendantIds.length,
        descendantIds,
        archivedBucket: shouldHardDelete,
      });
    },
    [args, collectDescendants, executeDeleteSession, filterDescendantsForAction],
  );

  const confirmDeleteSession = React.useCallback(async () => {
    if (!args.deleteSessionConfirm) return;
    const { session, archivedBucket, descendantIds } = args.deleteSessionConfirm;
    args.setDeleteSessionConfirm(null);
    await executeDeleteSession(session, { archivedBucket }, { descendantIds });
  }, [args, executeDeleteSession]);

  return {
    copiedSessionId,
    handleSessionSelect,
    handleSessionDoubleClick,
    handleSaveEdit,
    handleCancelEdit,
    handleShareSession,
    handleCopyShareUrl,
    handleUnshareSession,
    handleDeleteSession,
    confirmDeleteSession,
  };
};
