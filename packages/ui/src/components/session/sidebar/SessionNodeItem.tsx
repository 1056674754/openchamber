import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  RiAddLine,
  RiArchiveLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiChat4Line,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDownloadLine,
  RiErrorWarningLine,
  RiFileCopyLine,
  RiFolderLine,
  RiLinkUnlinkM,
  RiPencilAiLine,
  RiPushpinLine,
  RiRefreshLine,
  RiShare2Line,
  RiShieldLine,
  RiComputerLine,
  RiUnpinLine,
  RiGitBranchLine,
  RiWindowLine,
} from '@remixicon/react';
import { cn } from '@/lib/utils';
import { canUseElectronDesktopIPC, invokeDesktop, isVSCodeRuntime } from '@/lib/desktop';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { buildExportFilename, downloadAsMarkdown, formatSessionAsMarkdown, getExportRevealLabelKey, revealExportedMarkdown, saveAsMarkdownDesktop } from '@/lib/exportSession';
import type { ChildSessionExport } from '@/lib/exportSession';
import { buildSessionMessageRecordsSnapshot, useAllSessionStatuses, useDirectoryStore, useGlobalSessionStatus, useSession, useSessionPermissions } from '@/sync/sync-context';
import { useSync } from '@/sync/use-sync';
import { useViewportStore } from '@/sync/viewport-store';
import { DraggableSessionRow } from './sessionFolderDnd';
import { SidebarSpinner } from './SidebarSpinner';
import type { SessionNode, SessionSummaryMeta } from './types';
import { formatSessionCompactDateLabel, formatSessionDateLabel, normalizePath, renderHighlightedText, resolveSessionDiffStats } from './utils';
import { resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useSessionDisplayStore } from '@/stores/useSessionDisplayStore';
import { useSessionUnseenCount } from '@/sync/notification-store';
import { useSessionMultiSelectStore } from '@/stores/useSessionMultiSelectStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import { resolveInstanceLabel } from '@/lib/desktopSsh';
import { serverRegistry, DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useI18n } from '@/lib/i18n';

type Folder = { id: string; name: string; sessionIds: string[] };

const GLOBAL_PINNED_CHILD_INDENT = 20;

type SecondaryMeta = {
  projectLabel?: string | null;
  branchLabel?: string | null;
};

type SessionRowKind = 'pinned' | 'normal' | 'subtask';

type LeadingStatusKind = 'none' | 'spinner' | 'unread' | 'spinner-unread';

type LeadingStructureKind = 'none' | 'pin' | 'chevron' | 'pin-chevron';

type LeadingSlotValue = LeadingStatusKind | LeadingStructureKind;

type LeadingStatusInput = {
  rowKind: SessionRowKind;
  hasChildren: boolean;
  hasSpinner: boolean;
  hasUnread: boolean;
};

type LeadingState = {
  slot1: LeadingSlotValue;
  slot2: LeadingSlotValue;
};

const resolveSessionRowKind = (input: { isPinned: boolean; isSubtask: boolean }): SessionRowKind => {
  if (input.isSubtask) return 'subtask';
  if (input.isPinned) return 'pinned';
  return 'normal';
};

const resolveStatusSlot = (input: { hasSpinner: boolean; hasUnread: boolean }): LeadingStatusKind => {
  if (input.hasSpinner && input.hasUnread) return 'spinner-unread';
  if (input.hasSpinner) return 'spinner';
  if (input.hasUnread) return 'unread';
  return 'none';
};

const resolveLeadingState = (input: LeadingStatusInput): LeadingState => {
  const status = resolveStatusSlot(input);

  if (input.rowKind === 'pinned') {
    return {
      slot1: status,
      slot2: input.hasChildren ? 'pin-chevron' : 'pin',
    };
  }

  if (input.hasChildren) {
    return {
      slot1: status,
      slot2: 'chevron',
    };
  }

  return {
    slot1: input.hasUnread ? 'unread' : 'none',
    slot2: input.hasSpinner ? 'spinner' : 'none',
  };
};

const resolveGlobalPinnedLeadingState = (input: { hasChildren: boolean; hasSpinner: boolean }): LeadingState => {
  return {
    slot1: input.hasChildren ? 'pin-chevron' : 'pin',
    slot2: input.hasSpinner ? 'spinner' : 'none',
  };
};

type Props = {
  node: SessionNode;
  depth?: number;
  groupDirectory?: string | null;
  projectId?: string | null;
  archivedBucket?: boolean;
  directoryStatus: Map<string, 'unknown' | 'exists' | 'missing'>;
  currentSessionId: string | null;
  pinnedSessionIds: Set<string>;
  expandedParents: Set<string>;
  hasSessionSearchQuery: boolean;
  normalizedSessionSearchQuery: string;
  notifyOnSubtasks: boolean;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  editTitle: string;
  setEditTitle: (value: string) => void;
  handleSaveEdit: () => void;
  handleCancelEdit: () => void;
  toggleParent: (sessionId: string) => void;
  handleSessionSelect: (sessionId: string, sessionDirectory: string | null, isMissingDirectory: boolean, projectId?: string | null) => void;
  handleSessionDoubleClick: () => void;
  togglePinnedSession: (sessionId: string, scope: 'global' | string) => void;
  pinnedSessionIdsByProject: Map<string, Set<string>>;
  handleShareSession: (session: Session) => void;
  copiedSessionId: string | null;
  handleCopyShareUrl: (url: string, sessionId: string) => void;
  handleUnshareSession: (sessionId: string) => void;
  openSidebarMenuKey: string | null;
  setOpenSidebarMenuKey: (key: string | null) => void;
  renamingFolderId: string | null;
  getFoldersForScope: (scopeKey: string) => Folder[];
  getSessionFolderId: (scopeKey: string, sessionId: string) => string | null;
  removeSessionFromFolder: (scopeKey: string, sessionId: string) => void;
  addSessionToFolder: (scopeKey: string, folderId: string, sessionId: string) => void;
  createFolderAndStartRename: (scopeKey: string, parentId?: string | null) => { id: string } | null;
  openContextPanelTab: (directory: string, options: { mode: 'chat'; dedupeKey: string; label: string }) => void;
  handleDeleteSession: (session: Session, source?: { archivedBucket?: boolean }) => void;
  mobileVariant: boolean;
  alwaysShowActions: boolean;
  renderSessionNode: (node: SessionNode, depth?: number, groupDirectory?: string | null, projectId?: string | null, archivedBucket?: boolean, secondaryMeta?: SecondaryMeta | null, renderContext?: 'project' | 'recent' | 'global-pinned') => React.ReactNode;
  secondaryMeta?: SecondaryMeta | null;
  renderContext?: 'project' | 'recent' | 'global-pinned';
};

const getNodeChildSignature = (node: SessionNode): string => {
  if (node.children.length === 0) {
    return '';
  }

  return node.children
    .map((child) => `${child.session.id}:${getNodeChildSignature(child)}`)
    .join('|');
};

const treeContainsExpandedStateChange = (
  prevNode: SessionNode,
  nextNode: SessionNode,
  prevExpandedParents: Set<string>,
  nextExpandedParents: Set<string>,
): boolean => {
  if (prevExpandedParents.has(prevNode.session.id) !== nextExpandedParents.has(nextNode.session.id)) {
    return true;
  }

  const nextChildrenById = new Map(nextNode.children.map((child) => [child.session.id, child]));
  for (const prevChild of prevNode.children) {
    const nextChild = nextChildrenById.get(prevChild.session.id);
    if (!nextChild) {
      return true;
    }
    if (treeContainsExpandedStateChange(prevChild, nextChild, prevExpandedParents, nextExpandedParents)) {
      return true;
    }
  }

  return false;
};

const directoryBelongsToProject = (directory: string | null | undefined, projectPath: string): boolean => {
  const normalizedDirectory = normalizePath(directory ?? null);
  const normalizedProjectPath = normalizePath(projectPath);
  if (!normalizedDirectory || !normalizedProjectPath) return false;
  return normalizedDirectory === normalizedProjectPath || normalizedDirectory.startsWith(`${normalizedProjectPath}/`);
};

const treeContainsSessionId = (node: SessionNode, sessionId: string | null): boolean => {
  if (!sessionId) {
    return false;
  }

  if (node.session.id === sessionId) {
    return true;
  }

  for (const child of node.children) {
    if (treeContainsSessionId(child, sessionId)) {
      return true;
    }
  }

  return false;
};

const treeContainsMenuKey = (
  node: SessionNode,
  menuKey: string | null,
  renderContext: 'project' | 'recent' | 'global-pinned',
  archivedBucket: boolean,
): boolean => {
  if (!menuKey) {
    return false;
  }

  const nodeMenuKey = `${renderContext}:${archivedBucket ? 'archived' : 'active'}:${node.session.id}`;
  if (nodeMenuKey === menuKey) {
    return true;
  }

  for (const child of node.children) {
    if (treeContainsMenuKey(child, menuKey, renderContext, archivedBucket)) {
      return true;
    }
  }

  return false;
};

const areEqual = (prev: Props, next: Props): boolean => {
  const prevSession = prev.node.session;
  const nextSession = next.node.session;
  const prevSessionId = prevSession.id;
  const nextSessionId = nextSession.id;

  if (prevSessionId !== nextSessionId) return false;
  if (prev.node.session !== next.node.session) return false;
  if (getNodeChildSignature(prev.node) !== getNodeChildSignature(next.node)) return false;
  if (prev.depth !== next.depth) return false;
  if (prev.groupDirectory !== next.groupDirectory) return false;
  if (prev.projectId !== next.projectId) return false;
  if (prev.archivedBucket !== next.archivedBucket) return false;
  if (prev.currentSessionId !== next.currentSessionId) {
    const prevActiveInTree = treeContainsSessionId(prev.node, prev.currentSessionId);
    const nextActiveInTree = treeContainsSessionId(next.node, next.currentSessionId);
    if (prevActiveInTree || nextActiveInTree) {
      return false;
    }
  }
  const prevIsPinned = prev.pinnedSessionIds.has(prevSessionId)
    || Boolean(prev.groupDirectory && prev.pinnedSessionIdsByProject.get(prev.groupDirectory)?.has(prevSessionId));
  const nextIsPinned = next.pinnedSessionIds.has(nextSessionId)
    || Boolean(next.groupDirectory && next.pinnedSessionIdsByProject.get(next.groupDirectory)?.has(nextSessionId));
  if (prevIsPinned !== nextIsPinned) return false;
  if (treeContainsExpandedStateChange(prev.node, next.node, prev.expandedParents, next.expandedParents)) return false;
  if (prev.hasSessionSearchQuery !== next.hasSessionSearchQuery) return false;
  if (prev.normalizedSessionSearchQuery !== next.normalizedSessionSearchQuery) return false;
  if (prev.notifyOnSubtasks !== next.notifyOnSubtasks) return false;
  if (prev.editingId !== next.editingId) {
    const prevEditingInTree = treeContainsSessionId(prev.node, prev.editingId);
    const nextEditingInTree = treeContainsSessionId(next.node, next.editingId);
    if (prevEditingInTree || nextEditingInTree) {
      return false;
    }
  }
  if (prev.editTitle !== next.editTitle) {
    const prevEditingInTree = treeContainsSessionId(prev.node, prev.editingId);
    const nextEditingInTree = treeContainsSessionId(next.node, next.editingId);
    if (prevEditingInTree || nextEditingInTree) {
      return false;
    }
  }
  if ((prev.copiedSessionId === prevSessionId) !== (next.copiedSessionId === nextSessionId)) return false;

  const prevMenuInTree = treeContainsMenuKey(prev.node, prev.openSidebarMenuKey, prev.renderContext ?? 'project', prev.archivedBucket ?? false);
  const nextMenuInTree = treeContainsMenuKey(next.node, next.openSidebarMenuKey, next.renderContext ?? 'project', next.archivedBucket ?? false);
  if (prevMenuInTree !== nextMenuInTree) return false;

  const prevIsGlobalPinned = (prev.renderContext ?? 'project') === 'global-pinned';
  const nextIsGlobalPinned = (next.renderContext ?? 'project') === 'global-pinned';
  const prevDirectory = resolveGlobalSessionDirectory(prevSession)
    ?? (prevIsGlobalPinned ? null : normalizePath(prev.groupDirectory ?? null));
  const nextDirectory = resolveGlobalSessionDirectory(nextSession)
    ?? (nextIsGlobalPinned ? null : normalizePath(next.groupDirectory ?? null));
  if (prevDirectory !== nextDirectory) return false;
  if ((prevDirectory ? prev.directoryStatus.get(prevDirectory) : null) !== (nextDirectory ? next.directoryStatus.get(nextDirectory) : null)) return false;

  if ((prev.secondaryMeta?.projectLabel ?? null) !== (next.secondaryMeta?.projectLabel ?? null)) return false;
  if ((prev.secondaryMeta?.branchLabel ?? null) !== (next.secondaryMeta?.branchLabel ?? null)) return false;
  if (prev.mobileVariant !== next.mobileVariant) return false;
  if (prev.alwaysShowActions !== next.alwaysShowActions) return false;
  if ((prev.renderContext ?? 'project') !== (next.renderContext ?? 'project')) return false;
  if (prev.renamingFolderId !== next.renamingFolderId) return false;
  if (prev.renderSessionNode !== next.renderSessionNode) return false;

  return true;
};

function SessionNodeItemComponent(props: Props): React.ReactNode {
  const { t } = useI18n();
  const {
    node,
    depth = 0,
    groupDirectory,
    projectId,
    archivedBucket = false,
    directoryStatus,
    currentSessionId,
    pinnedSessionIds,
    pinnedSessionIdsByProject,
    expandedParents,
    hasSessionSearchQuery,
    normalizedSessionSearchQuery,
    notifyOnSubtasks,
    editingId,
    setEditingId,
    editTitle,
    setEditTitle,
    handleSaveEdit,
    handleCancelEdit,
    toggleParent,
    handleSessionSelect,
    handleSessionDoubleClick,
    togglePinnedSession,
    handleShareSession,
    copiedSessionId,
    handleCopyShareUrl,
    handleUnshareSession,
    openSidebarMenuKey,
    setOpenSidebarMenuKey,
    renamingFolderId,
    getFoldersForScope,
    getSessionFolderId,
    removeSessionFromFolder,
    addSessionToFolder,
    createFolderAndStartRename,
    openContextPanelTab,
    handleDeleteSession,
    mobileVariant,
    alwaysShowActions,
    renderSessionNode,
    secondaryMeta,
    renderContext = 'project',
  } = props;
  const displayMode = useSessionDisplayStore((state) => state.displayMode);
  const isMinimalMode = displayMode === 'minimal';
  const isVSCode = React.useMemo(() => isVSCodeRuntime(), []);
  const isElectron = React.useMemo(() => canUseElectronDesktopIPC(), []);
  const revealOnHoverClass = isVSCode
    ? 'group-hover:opacity-100 group-hover:pointer-events-auto'
    : 'group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto';
  const hideOnHoverClass = isVSCode
    ? 'group-hover:opacity-0'
    : 'group-hover:opacity-0 group-focus-within:opacity-0';
  const suppressNextSelectRef = React.useRef(false);
  const [isTouchPressed, setIsTouchPressed] = React.useState(false);

  const session = node.session;
  const liveSession = useSession(session.id);
  const resolvedSession = liveSession ?? session;
  const isGlobalPinnedContext = renderContext === 'global-pinned';
  const isGlobalPinnedRootRow = isGlobalPinnedContext && depth === 0;

  const sessionDirectory =
    resolveGlobalSessionDirectory(session)
    ?? (isGlobalPinnedContext ? null : normalizePath(groupDirectory ?? null));

  const hasSecondaryProjectLabel = Boolean(secondaryMeta?.projectLabel);
  const hasSecondaryBranchLabel = Boolean(secondaryMeta?.branchLabel);

  const projectsStore = useProjectsStore((state) => state.projects);
  const { currentTheme } = useThemeSystem();
  const remoteProject = React.useMemo(() => {
    const indexedServerId = serverRegistry.getServerForSession(session.id);
    const serverScopedProjects = indexedServerId && indexedServerId !== DEFAULT_SERVER_ID
      ? projectsStore.filter((project) => project.serverId === indexedServerId)
      : [];

    const candidates = serverScopedProjects.length > 0
      ? serverScopedProjects
      : projectsStore.filter((project) => project.serverId);

    const projectById = projectId
      ? candidates.find((project) => project.id === projectId && project.serverId)
      : null;
    if (projectById) return projectById;

    const directory = sessionDirectory ?? groupDirectory ?? null;
    return candidates
      .filter((project) => project.serverId && directoryBelongsToProject(directory, project.path))
      .sort((a, b) => normalizePath(b.path)!.length - normalizePath(a.path)!.length)[0] ?? null;
  }, [groupDirectory, projectId, projectsStore, session.id, sessionDirectory]);
  const remoteIndicatorProject = isGlobalPinnedContext ? remoteProject : null;
  const sshInstance = useDesktopSshStore((state) =>
    remoteIndicatorProject?.serverId ? state.instances.find((entry) => entry.id === remoteIndicatorProject.serverId) : undefined,
  );
  const sshStatus = useDesktopSshStore((state) =>
    remoteIndicatorProject?.serverId ? state.statusesById[remoteIndicatorProject.serverId] : undefined,
  );
  const remoteStatusLabel = sshStatus?.phase === 'ready'
    ? t('sessions.sidebar.remote.connected')
    : sshStatus?.phase === 'error'
      ? t('sessions.sidebar.remote.error')
      : sshStatus && sshStatus.phase !== 'idle'
        ? t('sessions.sidebar.remote.connecting')
        : t('sessions.sidebar.remote.disconnected');
  const remoteInstanceLabel = remoteIndicatorProject?.serverId
    ? (sshInstance ? resolveInstanceLabel(sshInstance) : remoteIndicatorProject.serverId)
    : null;
  const remoteProjectDirectory = remoteIndicatorProject?.path ?? sessionDirectory ?? null;
  const remoteStatusColor = React.useMemo(() => {
    if (!sshStatus || sshStatus.phase === 'idle') return currentTheme.colors.surface.subtle;
    if (sshStatus.phase === 'ready') return currentTheme.colors.status.success;
    if (sshStatus.phase === 'error') return currentTheme.colors.status.error;
    return currentTheme.colors.status.warning;
  }, [sshStatus, currentTheme.colors.surface.subtle, currentTheme.colors.status]);
  const remoteIndicator = remoteIndicatorProject ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="flex-shrink-0 inline-flex items-center"
          aria-label={t('sessions.sidebar.session.status.remoteInstance', { status: remoteStatusLabel })}
        >
          <RiComputerLine className="h-3.5 w-3.5" style={{ color: remoteStatusColor, transition: 'color 0.2s' }} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-xs text-left">
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-2">
            <RiComputerLine className="h-3.5 w-3.5 flex-shrink-0" style={{ color: remoteStatusColor }} />
            <span className="font-medium text-foreground">{remoteInstanceLabel}</span>
            <span className="text-muted-foreground">({remoteStatusLabel})</span>
          </div>
          {remoteProjectDirectory ? (
            <div className="min-w-0 text-muted-foreground">
              <span className="font-medium text-foreground">{t('sessions.sidebar.session.status.remoteProjectDir')}</span>
              <span className="ml-1 break-all">{remoteProjectDirectory}</span>
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  ) : null;
  const directoryStore = useDirectoryStore(sessionDirectory ?? undefined);
  const sync = useSync();

  const selectionModeEnabled = useSessionMultiSelectStore((state) => state.enabled);
  const isRowSelected = useSessionMultiSelectStore(
    React.useCallback((state) => state.selectedIds.has(session.id), [session.id]),
  );
  const toggleRowSelected = useSessionMultiSelectStore((state) => state.toggleSelected);
  const setRowRange = useSessionMultiSelectStore((state) => state.setRange);

  const collectNodeDescendantIds = React.useCallback((root: SessionNode): string[] => {
    const out: string[] = [];
    const walk = (n: SessionNode) => {
      n.children.forEach((child) => {
        out.push(child.session.id);
        walk(child);
      });
    };
    walk(root);
    return out;
  }, []);

  const [exportDialogOpen, setExportDialogOpen] = React.useState(false);
  const [exportIncludeSubtasks, setExportIncludeSubtasks] = React.useState(true);

  const menuInstanceKey = `${renderContext}:${archivedBucket ? 'archived' : 'active'}:${session.id}`;
  const isZombie = useViewportStore(
    React.useCallback((state) => Boolean(state.sessionMemoryState.get(session.id)?.isZombie), [session.id]),
  );
  const sessionStatus = useGlobalSessionStatus(session.id);
  const sessionPermissions = useSessionPermissions(session.id, sessionDirectory ?? undefined);
  const directoryState = sessionDirectory ? directoryStatus.get(sessionDirectory) : null;
  const isMissingDirectory = directoryState === 'missing';
  const isActive = currentSessionId === session.id;
  const sessionTitle = resolvedSession.title || t('sessions.sidebar.session.untitled');
  const hasChildren = node.children.length > 0;
  const isPinnedSession = pinnedSessionIds.has(session.id)
    || Boolean(groupDirectory && pinnedSessionIdsByProject.get(groupDirectory)?.has(session.id));
  const isGloballyPinned = pinnedSessionIds.has(session.id);
  const isExpanded = hasSessionSearchQuery ? true : expandedParents.has(session.id);
  const isSubtaskSession = Boolean((resolvedSession as Session & { parentID?: string | null }).parentID);
  const unseenCount = useSessionUnseenCount(session.id);
  const needsAttention = unseenCount > 0 && (!isSubtaskSession || notifyOnSubtasks);
  const sessionSummary = resolvedSession.summary as SessionSummaryMeta | undefined;
  const sessionDiffStats = resolveSessionDiffStats(sessionSummary);
  const sessionTimestamp = resolvedSession.time?.updated || resolvedSession.time?.created || Date.now();
  const sessionUpdatedLabel = formatSessionDateLabel(sessionTimestamp);
  const sessionCompactUpdatedLabel = formatSessionCompactDateLabel(sessionTimestamp);
  const isMenuOpen = openSidebarMenuKey === menuInstanceKey;
  const [menuPosition, setMenuPosition] = React.useState<{ x: number; y: number } | null>(null);
  const [archiveConfirming, setArchiveConfirming] = React.useState(false);

  React.useEffect(() => {
    if (!archiveConfirming) return;
    const timer = setTimeout(() => setArchiveConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [archiveConfirming]);

  const descendantIds = React.useMemo(() => collectNodeDescendantIds(node), [collectNodeDescendantIds, node]);
  const descendantCount = descendantIds.length;
  const liveSessionStatuses = useAllSessionStatuses();
  const descendantStatusSignature = useGlobalSessionsStore(
    React.useCallback(
      (state) => descendantIds.map((id) => `${id}:${state.sessionStatuses.get(id)?.type ?? ''}`).join('|'),
      [descendantIds],
    ),
  );
  const hasRunningChildSession = React.useMemo(() => {
    if (descendantIds.length === 0) return false;
    if (descendantStatusSignature.includes(':busy') || descendantStatusSignature.includes(':retry')) {
      return true;
    }
    return descendantIds.some((id) => {
      const status = liveSessionStatuses[id];
      return status?.type === 'busy' || status?.type === 'retry';
    });
  }, [descendantIds, descendantStatusSignature, liveSessionStatuses]);

  const collectChildExports = React.useCallback(async (children: SessionNode[]): Promise<{ children: ChildSessionExport[]; skipped: number }> => {
    const results: ChildSessionExport[] = [];
    let skipped = 0;
    for (const child of children) {
      try {
        await sync.syncSession(child.session.id);
        const childRecords = buildSessionMessageRecordsSnapshot(directoryStore.getState(), child.session.id).list;
        const childTitle = child.session.title || t('sessions.sidebar.session.export.untitledSubagent');
        const childAgent = (child.session as Session & { agent?: string }).agent;
        const grandChildren = await collectChildExports(child.children);
        skipped += grandChildren.skipped;
        results.push({
          title: childTitle,
          agent: childAgent,
          records: childRecords,
          children: grandChildren.children,
        });
      } catch {
        skipped += collectNodeDescendantIds(child).length + 1;
      }
    }
    return { children: results, skipped };
  }, [collectNodeDescendantIds, directoryStore, sync, t]);

  const showSkippedSubtasksWarning = React.useCallback((count: number) => {
    if (count <= 0) return;
    toast.warning(count === 1
      ? t('sessions.sidebar.session.export.skippedSubtaskSingle', { count })
      : t('sessions.sidebar.session.export.skippedSubtaskMany', { count }));
  }, [t]);

  const doExportSession = React.useCallback(async (includeSubtasks: boolean) => {
    if (!sessionDirectory) {
      toast.error(t('sessions.sidebar.session.export.nothingToExport'));
      return;
    }

    await sync.syncSession(session.id);

    const records = buildSessionMessageRecordsSnapshot(directoryStore.getState(), session.id).list;
    if (records.length === 0) {
      toast.error(t('sessions.sidebar.session.export.nothingToExport'));
      return;
    }

    let childExports: ChildSessionExport[] | undefined;
    let skippedSubtaskCount = 0;
    if (includeSubtasks && node.children.length > 0) {
      const collected = await collectChildExports(node.children);
      childExports = collected.children;
      skippedSubtaskCount = collected.skipped;
    }

    const markdown = formatSessionAsMarkdown(records, resolvedSession.title ?? null, childExports);
    const filename = buildExportFilename(resolvedSession.title ?? null);
    const savedPath = await saveAsMarkdownDesktop(markdown, filename);

    if (savedPath) {
      toast.success(t('sessions.sidebar.session.export.success'), {
        action: {
          label: t(getExportRevealLabelKey()),
          onClick: () => {
            void revealExportedMarkdown(savedPath).then((revealed) => {
              if (!revealed) {
                toast.error(t('sessions.sidebar.session.export.failedRevealPath'));
              }
            });
          },
        },
      });
      showSkippedSubtasksWarning(skippedSubtaskCount);
      return;
    }

    downloadAsMarkdown(markdown, filename);
    toast.success(t('sessions.sidebar.session.export.success'));
    showSkippedSubtasksWarning(skippedSubtaskCount);
  }, [collectChildExports, directoryStore, node.children, resolvedSession.title, session.id, sessionDirectory, showSkippedSubtasksWarning, sync, t]);
  const handleExportSession = React.useCallback(async () => {
    if (node.children.length > 0) {
      setExportIncludeSubtasks(true);
      setExportDialogOpen(true);
      return;
    }
    await doExportSession(false);
  }, [doExportSession, node.children.length]);

  const handleOpenMiniChatWindow = React.useCallback(() => {
    if (!sessionDirectory) return;
    void invokeDesktop('desktop_open_session_mini_chat_window', {
      sessionId: session.id,
      directory: sessionDirectory,
    }).catch((error) => {
      console.warn('[session-sidebar] failed to open mini chat window', error);
    });
  }, [session.id, sessionDirectory]);

  if (editingId === session.id) {
    return (
      <div
        key={session.id}
        className={cn('group relative flex items-center rounded-sm px-1.5 py-1', depth > 0 && 'pl-[20px]')}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0">
          <form
            className="flex w-full items-center gap-2"

            onSubmit={(event) => {
              event.preventDefault();
              handleSaveEdit();
            }}
          >
            <input
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              className="flex-1 min-w-0 bg-transparent typography-ui-label outline-none placeholder:text-muted-foreground"
              autoFocus
              placeholder={t('sessions.sidebar.session.menu.rename')}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  handleCancelEdit();
                  return;
                }
                if (event.key === ' ' || event.key === 'Enter') {
                  event.stopPropagation();
                }
              }}
            />
            <button type="submit" className="shrink-0 text-muted-foreground hover:text-foreground"><RiCheckLine className="size-4" /></button>
            <button type="button" onClick={handleCancelEdit} className="shrink-0 text-muted-foreground hover:text-foreground"><RiCloseLine className="size-4" /></button>
          </form>
          {!isMinimalMode ? (
            <div className="flex items-center justify-between gap-3 text-muted-foreground/60 min-w-0 overflow-hidden leading-tight" style={{ fontSize: 'calc(var(--text-ui-label) * 0.85)' }}>
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                {hasChildren ? <span className="inline-flex items-center justify-center flex-shrink-0">{isExpanded ? <RiArrowDownSLine className="h-3 w-3" /> : <RiArrowRightSLine className="h-3 w-3" />}</span> : null}
                <span className="flex-shrink-0">{sessionUpdatedLabel}</span>
                {sessionDiffStats ? <span className="flex flex-shrink-0 items-center gap-0 text-[0.92em]"><span className="text-status-success/80">+{sessionDiffStats.additions}</span><span className="text-status-error/65">/-{sessionDiffStats.deletions}</span></span> : null}
                {hasSecondaryProjectLabel ? <span className="truncate">{secondaryMeta?.projectLabel}</span> : null}
                {hasSecondaryBranchLabel ? <span className="inline-flex min-w-0 items-center gap-0.5"><RiGitBranchLine className="h-3 w-3 flex-shrink-0 text-muted-foreground/70" /><span className="truncate">{secondaryMeta?.branchLabel}</span></span> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const statusType = sessionStatus?.type ?? 'idle';
  const isStreaming = statusType === 'busy' || statusType === 'retry';
  const pendingPermissionCount = sessionPermissions.length;
  const showUnreadStatus = needsAttention && !isActive;

  const spinnerState = (() => {
    if (isStreaming && isSubtaskSession) return 'subagent' as const;
    if (isStreaming) return 'streaming' as const;
    if (hasRunningChildSession) return 'subagent' as const;
    return 'hidden' as const;
  })();

  const shouldShowSpinner = spinnerState !== 'hidden';

  const hasChildrenChevron = hasChildren;

  const renderUnreadDot = () => (
    <span
      className="h-1.5 w-1.5 rounded-full bg-[var(--status-info)]"
      aria-label={t('sessions.sidebar.session.status.unread')}
      title={t('sessions.sidebar.session.status.unread')}
    />
  );

  const renderSpinner = () => (
    <SidebarSpinner state={spinnerState} aria-label={t('sessions.sidebar.session.status.active')} />
  );

  const renderAlternating = () => (
    <span className="relative inline-flex h-4 w-4 items-center justify-center">
      <span className="animate-slot-fade-in">{renderSpinner()}</span>
      <span className="absolute animate-slot-fade-out">{renderUnreadDot()}</span>
    </span>
  );

  const rowKind = resolveSessionRowKind({ isPinned: isPinnedSession, isSubtask: isSubtaskSession });
  const leadingState = isGlobalPinnedRootRow
    ? resolveGlobalPinnedLeadingState({
      hasChildren: hasChildrenChevron,
      hasSpinner: shouldShowSpinner,
    })
    : resolveLeadingState({
      rowKind,
      hasChildren: hasChildrenChevron,
      hasSpinner: shouldShowSpinner,
      hasUnread: showUnreadStatus,
    });

  const renderChevron = (mode: 'normal' | 'overlay') => (
    <span
      role="button"
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleParent(session.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation(); toggleParent(session.id);
        }
      }}
      className={cn(
        mode === 'overlay'
          ? 'absolute inset-0 inline-flex h-4 w-3.5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
          : 'pointer-events-auto inline-flex h-4 w-3.5 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      )}
      aria-label={isExpanded ? t('sessions.sidebar.session.subsessions.collapse') : t('sessions.sidebar.session.subsessions.expand')}
    >
      {isExpanded ? <RiArrowDownSLine className="h-3 w-3" /> : <RiArrowRightSLine className="h-3 w-3" />}
    </span>
  );

  const renderPin = () => (
    <RiPushpinLine
      className={cn('h-3.5 w-3.5 flex-shrink-0', isStreaming ? 'text-primary animate-busy-pulse' : showUnreadStatus ? 'text-[var(--status-info)]' : 'text-foreground')}
      aria-label={isGloballyPinned ? t('sessions.sidebar.session.status.pinnedGlobal') : t('sessions.sidebar.session.status.pinned')}
    />
  );

  const renderLeadingSlot = (slot: LeadingSlotValue) => {
    if (slot === 'none') return null;
    if (slot === 'spinner') return renderSpinner();
    if (slot === 'unread') return renderUnreadDot();
    if (slot === 'spinner-unread') return renderAlternating();
    if (slot === 'pin') return renderPin();
    if (slot === 'chevron') return renderChevron('normal');
    return (
      <span className="relative inline-flex h-4 w-3.5 flex-shrink-0 items-center justify-center group-hover:[&>*:first-child]:opacity-0 group-focus-within:[&>*:first-child]:opacity-0">
        {renderPin()}
        {renderChevron('overlay')}
      </span>
    );
  };

  const slot1Content = renderLeadingSlot(leadingState.slot1);
  const slot2Content = renderLeadingSlot(leadingState.slot2);
  const rowIndentPx = depth > 0
    ? (isGlobalPinnedContext ? depth * 16 + GLOBAL_PINNED_CHILD_INDENT : depth * 16 + 4)
    : 0;
  const nestedLeadingSlotsStyle = depth > 0
    ? { left: `${rowIndentPx - 34}px` }
    : undefined;

  const projectLeadingStatusSlots = slot1Content || slot2Content ? (
    <div className="pointer-events-none absolute -left-7 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5" style={nestedLeadingSlotsStyle}>
      <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {slot1Content}
      </span>
      <span className="inline-flex h-4 w-3.5 flex-shrink-0 items-center justify-center">
        {slot2Content}
      </span>
    </div>
  ) : null;

  const globalPinnedChildLeadingSlots = isGlobalPinnedContext && !isGlobalPinnedRootRow && (slot1Content || slot2Content) ? (
    <div className="pointer-events-none absolute left-0 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5" style={nestedLeadingSlotsStyle}>
      <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {slot1Content}
      </span>
      <span className="inline-flex h-4 w-3.5 flex-shrink-0 items-center justify-center">
        {slot2Content}
      </span>
    </div>
  ) : null;

  const globalPinnedLeadingSlots = isGlobalPinnedContext && isGlobalPinnedRootRow ? (
    <div className="pointer-events-none flex flex-shrink-0 items-center gap-1.5">
      <span className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
        {slot1Content}
      </span>
      {slot2Content ? (
        <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
          {slot2Content}
        </span>
      ) : null}
    </div>
  ) : null;

  const streamingIndicator = isZombie
    ? <RiErrorWarningLine className="h-4 w-4 text-status-warning" />
    : null;

  const handleMenuOpenChange = (open: boolean) => {
    setOpenSidebarMenuKey(open ? menuInstanceKey : null);
  };

  const handleRowSelect = (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressNextSelectRef.current) {
      suppressNextSelectRef.current = false;
      return;
    }
    if (selectionModeEnabled) {
      event?.preventDefault();
      event?.stopPropagation();
      if (event?.shiftKey) {
        const rows = typeof document !== 'undefined'
          ? Array.from(document.querySelectorAll<HTMLElement>('[data-session-row]'))
          : [];
        const orderedIds = rows
          .map((el) => el.getAttribute('data-session-row'))
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        const currentAnchor = useSessionMultiSelectStore.getState().anchorId;
        const descendantsById = new Map<string, string[]>();
        descendantsById.set(session.id, collectNodeDescendantIds(node));
        setRowRange(currentAnchor, session.id, orderedIds, sessionDirectory ?? null, descendantsById);
        return;
      }
      toggleRowSelected(session.id, sessionDirectory ?? null, collectNodeDescendantIds(node));
      return;
    }
    handleSessionSelect(session.id, sessionDirectory, isMissingDirectory, projectId);
  };

  const handleRowMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button === 2 || (event.button === 0 && event.ctrlKey && !selectionModeEnabled)) {
      suppressNextSelectRef.current = true;
    }
  };
  const handleRowPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (mobileVariant && event.pointerType === 'touch') {
      setIsTouchPressed(true);
    }
  };
  const handleRowPointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (mobileVariant && event.pointerType === 'touch') {
      setIsTouchPressed(false);
    }
  };

  const sessionMenuContent = (
    <DropdownMenuContent align="end" className="min-w-[180px]" onCloseAutoFocus={(event) => { if (renamingFolderId) event.preventDefault(); }}>
      <DropdownMenuItem
        onClick={() => {
          setEditingId(session.id);
          setEditTitle(sessionTitle);
        }}
        className="[&>svg]:mr-1"
      >
        <RiPencilAiLine className="mr-1 h-4 w-4" />
        {t('sessions.sidebar.session.menu.rename')}
      </DropdownMenuItem>
      {isGloballyPinned ? (
        <DropdownMenuItem onClick={() => togglePinnedSession(session.id, 'global')} className="[&>svg]:mr-1">
          <RiUnpinLine className="mr-1 h-4 w-4" />
          {t('sessions.sidebar.session.menu.unpinGlobal')}
        </DropdownMenuItem>
      ) : isPinnedSession ? (
        <DropdownMenuItem onClick={() => togglePinnedSession(session.id, groupDirectory ?? '')} className="[&>svg]:mr-1">
          <RiUnpinLine className="mr-1 h-4 w-4" />
          {t('sessions.sidebar.session.menu.unpin')}
        </DropdownMenuItem>
      ) : (
        <>
          <DropdownMenuItem onClick={() => togglePinnedSession(session.id, 'global')} className="[&>svg]:mr-1">
            <RiPushpinLine className="mr-1 h-4 w-4" />
            {t('sessions.sidebar.session.menu.pinGlobal')}
          </DropdownMenuItem>
          {groupDirectory ? (
            <DropdownMenuItem onClick={() => togglePinnedSession(session.id, groupDirectory)} className="[&>svg]:mr-1">
              <RiPushpinLine className="mr-1 h-4 w-4" />
              {t('sessions.sidebar.session.menu.pinToProject')}
            </DropdownMenuItem>
          ) : null}
        </>
      )}
      {!resolvedSession.share ? (
        <DropdownMenuItem onClick={() => handleShareSession(resolvedSession)} className="[&>svg]:mr-1">
          <RiShare2Line className="mr-1 h-4 w-4" />
          {t('sessions.sidebar.session.menu.share')}
        </DropdownMenuItem>
      ) : (
        <>
          <DropdownMenuItem onClick={() => { if (resolvedSession.share?.url) handleCopyShareUrl(resolvedSession.share.url, session.id); }} className="[&>svg]:mr-1">
            {copiedSessionId === session.id
              ? <><RiCheckLine className="mr-1 h-4 w-4" style={{ color: 'var(--status-success)' }} />{t('sessions.sidebar.session.menu.copied')}</>
              : <><RiFileCopyLine className="mr-1 h-4 w-4" />{t('sessions.sidebar.session.menu.copyLink')}</>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleUnshareSession(session.id)} className="[&>svg]:mr-1">
            <RiLinkUnlinkM className="mr-1 h-4 w-4" />
            {t('sessions.sidebar.session.menu.unshare')}
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuItem onClick={() => { void handleExportSession(); }} className="[&>svg]:mr-1">
        <RiDownloadLine className="mr-1 h-4 w-4" />
        {t('sessions.sidebar.session.menu.exportMarkdown')}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => { void sync.syncSession(session.id, true); }}
        className="[&>svg]:mr-1"
      >
        <RiRefreshLine className="mr-1 h-4 w-4" />
        {t('sessions.sidebar.session.menu.refresh')}
      </DropdownMenuItem>

      {sessionDirectory && !archivedBucket ? (() => {
        const scopeFolders = getFoldersForScope(sessionDirectory);
        const currentFolderId = getSessionFolderId(sessionDirectory, session.id);
        return (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="[&>svg]:mr-1"><RiFolderLine className="h-4 w-4" />{t('sessions.sidebar.folders.moveToFolder')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[180px]">
                {scopeFolders.length === 0 ? (
                  <DropdownMenuItem disabled className="text-muted-foreground">{t('sessions.sidebar.folders.none')}</DropdownMenuItem>
                ) : (
                  scopeFolders.map((folder) => (
                    <DropdownMenuItem key={folder.id} onClick={() => { if (currentFolderId === folder.id) removeSessionFromFolder(sessionDirectory, session.id); else addSessionToFolder(sessionDirectory, folder.id, session.id); }}>
                      <span className="flex-1 truncate">{folder.name}</span>
                      {currentFolderId === folder.id ? <RiCheckLine className="ml-2 h-3.5 w-3.5 text-primary flex-shrink-0" /> : null}
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { const newFolder = createFolderAndStartRename(sessionDirectory); if (!newFolder) return; addSessionToFolder(sessionDirectory, newFolder.id, session.id); }}>
                  <RiAddLine className="mr-1 h-4 w-4" />
                  {t('sessions.sidebar.folders.newFolderEllipsis')}
                </DropdownMenuItem>
                {currentFolderId ? (
                  <DropdownMenuItem onClick={() => { removeSessionFromFolder(sessionDirectory, session.id); }} className="text-destructive focus:text-destructive">
                    <RiCloseLine className="mr-1 h-4 w-4" />
                    {t('sessions.sidebar.folders.removeFromFolder')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        );
      })() : null}

      {!isVSCode ? (
        <DropdownMenuItem
          disabled={!sessionDirectory}
          onClick={() => {
            if (!sessionDirectory) return;
            openContextPanelTab(sessionDirectory, {
              mode: 'chat',
              dedupeKey: `session:${session.id}`,
              label: sessionTitle,
            });
          }}
          className="[&>svg]:mr-1"
        >
          <RiChat4Line className="mr-1 h-4 w-4" />
          <span className="truncate">{t('sessions.sidebar.session.menu.openInSidePanel')}</span>
          <span className="shrink-0 typography-micro px-1 rounded leading-none pb-px text-[var(--status-warning)] bg-[var(--status-warning)]/10">{t('sessions.sidebar.session.menu.betaBadge')}</span>
        </DropdownMenuItem>
      ) : null}

      {isElectron ? (
        <DropdownMenuItem
          disabled={!sessionDirectory}
          onClick={handleOpenMiniChatWindow}
          className="[&>svg]:mr-1"
        >
          <RiWindowLine className="mr-1 h-4 w-4" />
          <span className="truncate">{t('sessions.sidebar.session.menu.openMiniChatWindow')}</span>
        </DropdownMenuItem>
      ) : null}

      {!archivedBucket ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => { handleDeleteSession(session, { archivedBucket: true }); }}
            className="[&>svg]:mr-1 text-destructive focus:text-destructive"
          >
            <RiDeleteBinLine className="mr-1 h-4 w-4" />
            {t('sessions.sidebar.session.menu.delete')}
          </DropdownMenuItem>
        </>
      ) : null}

    </DropdownMenuContent>
  );

  return (
    <React.Fragment key={session.id}>
      <DraggableSessionRow sessionId={session.id} sessionDirectory={sessionDirectory ?? null} sessionTitle={sessionTitle}>
        <div
          data-session-row={session.id}
          data-session-scope={sessionDirectory ?? ''}
          data-session-archived={archivedBucket ? '1' : '0'}
          className={cn(
            'group relative my-0.5 flex items-center rounded-sm py-1',
            isGlobalPinnedRootRow ? 'px-0.5' : 'px-1.5',
            isGlobalPinnedRootRow && 'gap-1.5',
            isMissingDirectory ? 'opacity-75' : '',
            isRowSelected && 'bg-primary/15',
          )}
          style={depth > 0 ? { paddingLeft: `${rowIndentPx}px` } : undefined}
          onContextMenu={!mobileVariant ? (e) => {
            e.preventDefault();
            setMenuPosition({ x: e.clientX, y: e.clientY });
            setOpenSidebarMenuKey(menuInstanceKey);
          } : undefined}
        >
          {isGlobalPinnedRootRow ? globalPinnedLeadingSlots : globalPinnedChildLeadingSlots ?? projectLeadingStatusSlots}
          <div className="flex min-w-0 flex-1 items-center">
            {isMinimalMode ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={isMissingDirectory}
                    onPointerDown={handleRowPointerDown}
                    onPointerUp={handleRowPointerEnd}
                    onPointerCancel={handleRowPointerEnd}
                    onMouseDown={handleRowMouseDown}
                    onClick={(event) => handleRowSelect(event)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleSessionDoubleClick();
                    }}
                    className={cn(
                      'flex min-w-0 flex-1 cursor-pointer flex-col gap-0 overflow-hidden rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-foreground select-none disabled:cursor-not-allowed',
                      isTouchPressed && 'bg-interactive-hover/70',
                      alwaysShowActions ? 'pr-7' : null,
                    )}
                    >
                    <div className={cn('flex w-full items-center min-w-0 flex-1 overflow-hidden', isGlobalPinnedContext ? 'gap-1.5' : 'gap-0.5')}>
                      <div
                        className={cn('block min-w-0 flex-1 truncate typography-ui-label font-normal', isActive ? 'text-primary' : 'text-foreground')}
                      >
                        {renderHighlightedText(sessionTitle, normalizedSessionSearchQuery)}
                      </div>
                      {remoteIndicator}
                      {alwaysShowActions ? <span className="ml-2 flex-shrink-0 text-[0.72rem] text-muted-foreground/75">{sessionCompactUpdatedLabel}</span> : null}
                      {!alwaysShowActions ? (
                        <div className="relative ml-1 flex h-4 min-w-4 flex-shrink-0 items-center justify-end">
                          <span className={cn(
                            'whitespace-nowrap text-right text-[0.72rem] text-muted-foreground/75 transition-opacity duration-150',
                            isMenuOpen
                              ? 'opacity-0'
                              : hideOnHoverClass,
                          )}>
                            {sessionCompactUpdatedLabel}
                          </span>
                        </div>
                      ) : null}
                      {pendingPermissionCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1 py-0.5 text-[0.7rem] text-destructive flex-shrink-0" title={t('sessions.sidebar.session.status.permissionRequired')} aria-label={t('sessions.sidebar.session.status.permissionRequired')}>
                          <RiShieldLine className="h-3 w-3" />
                          <span className="leading-none">{pendingPermissionCount}</span>
                        </span>
                      ) : null}
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8} className="max-w-xs text-left">
                  <div className="flex flex-col gap-1 text-left text-xs">
                    <div className={cn('flex items-center gap-3 text-left text-muted-foreground', secondaryMeta?.projectLabel ? 'justify-between' : 'justify-start')}>
                      {secondaryMeta?.projectLabel ? <div className="min-w-0 truncate">{secondaryMeta.projectLabel}</div> : null}
                      <div className="flex-shrink-0">{sessionUpdatedLabel}</div>
                    </div>
                    {secondaryMeta?.branchLabel || sessionDiffStats ? (
                      <div className={cn('flex items-center gap-3 text-left text-muted-foreground', secondaryMeta?.branchLabel ? 'justify-between' : 'justify-start')}>
                        {secondaryMeta?.branchLabel ? (
                          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                            <span className="inline-flex min-w-0 items-center gap-0.5"><RiGitBranchLine className="h-3 w-3 flex-shrink-0" /><span className="truncate">{secondaryMeta.branchLabel}</span></span>
                          </div>
                        ) : null}
                        {sessionDiffStats ? <span className="flex flex-shrink-0 items-center gap-0.5"><span className="text-status-success">+{sessionDiffStats.additions}</span><span className="text-status-error">-{sessionDiffStats.deletions}</span></span> : null}
                      </div>
                    ) : null}
                  </div>
                </TooltipContent>
              </Tooltip>
            ) : (
              <button
                type="button"
                disabled={isMissingDirectory}
                onPointerDown={handleRowPointerDown}
                onPointerUp={handleRowPointerEnd}
                onPointerCancel={handleRowPointerEnd}
                onMouseDown={handleRowMouseDown}
                onClick={(event) => handleRowSelect(event)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleSessionDoubleClick();
                }}
                className={cn(
                  'flex min-w-0 flex-1 cursor-pointer flex-col gap-0 overflow-hidden rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-foreground select-none disabled:cursor-not-allowed',
                  isTouchPressed && 'bg-interactive-hover/70',
                  alwaysShowActions ? 'pr-7' : null,
                )}
              >
                  <div className={cn('flex w-full items-center min-w-0 flex-1 overflow-hidden', isGlobalPinnedContext ? 'gap-1.5' : 'gap-0.5')}>
                  <div
                    className={cn('block min-w-0 flex-1 truncate typography-ui-label font-normal', isActive ? 'text-primary' : 'text-foreground')}
                  >
                    {renderHighlightedText(sessionTitle, normalizedSessionSearchQuery)}
                  </div>
                  {remoteIndicator}
                  {pendingPermissionCount > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1 py-0.5 text-[0.7rem] text-destructive flex-shrink-0" title={t('sessions.sidebar.session.status.permissionRequired')} aria-label={t('sessions.sidebar.session.status.permissionRequired')}>
                      <RiShieldLine className="h-3 w-3" />
                      <span className="leading-none">{pendingPermissionCount}</span>
                    </span>
                  ) : null}
                </div>

                {!isMinimalMode ? (
                  <div className="flex items-center justify-between gap-3 text-muted-foreground/60 min-w-0 overflow-hidden leading-tight" style={{ fontSize: 'calc(var(--text-ui-label) * 0.85)' }}>
                    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                      <span className="flex-shrink-0">{sessionUpdatedLabel}</span>
                      {sessionDiffStats ? <span className="flex flex-shrink-0 items-center gap-0 text-[0.92em]"><span className="text-status-success/80">+{sessionDiffStats.additions}</span><span className="text-muted-foreground/60">/</span><span className="text-status-error/65">-{sessionDiffStats.deletions}</span></span> : null}
                      {hasSecondaryProjectLabel ? <span className="truncate">{secondaryMeta?.projectLabel}</span> : null}
                      {hasSecondaryBranchLabel ? <span className="inline-flex min-w-0 items-center gap-0.5"><RiGitBranchLine className="h-3 w-3 flex-shrink-0 text-muted-foreground/70" /><span className="truncate">{secondaryMeta?.branchLabel}</span></span> : null}
                    </div>
                  </div>
                ) : null}
              </button>
            )}
          </div>

          {streamingIndicator && !mobileVariant ? (
            <div className={cn('absolute top-1/2 -translate-y-1/2 z-10', isMinimalMode ? 'right-0' : 'right-[30px]')}>
              {streamingIndicator}
            </div>
          ) : null}

          <div className={cn(
            'absolute right-0 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 transition-opacity',
            isMenuOpen || archiveConfirming
              ? 'opacity-100'
              : (alwaysShowActions && !isVSCode)
                ? 'opacity-100'
                : cn('opacity-0', revealOnHoverClass),
          )}>
            {/* Context menu uses hidden positioned trigger only — no visible "..." button (removed per project convention, do not re-add) */}
            <button
              type="button"
              className={cn(
                'inline-flex h-5 w-5 items-center justify-center rounded-sm',
                archiveConfirming
                  ? 'text-white bg-[var(--status-error)] hover:bg-[var(--status-error)]/80'
                  : 'text-muted-foreground hover:text-[var(--status-error)]',
              )}
              aria-label={archiveConfirming
                ? (archivedBucket ? t('sessions.sidebar.bulkActions.deleteConfirm') : t('sessions.sidebar.bulkActions.archiveConfirm'))
                : (archivedBucket ? t('sessions.sidebar.bulkActions.delete') : t('sessions.sidebar.bulkActions.archive'))}
              onClick={(e) => {
                e.stopPropagation();
                if (archiveConfirming) {
                  handleDeleteSession(session, { archivedBucket });
                  setArchiveConfirming(false);
                } else {
                  setArchiveConfirming(true);
                }
              }}
            >
              {archivedBucket ? (
                <RiDeleteBinLine className="h-3.5 w-3.5" />
              ) : (
                <RiArchiveLine className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <DropdownMenu open={isMenuOpen} onOpenChange={handleMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <div
                className="fixed w-0 h-0 overflow-hidden"
                style={menuPosition ? { left: menuPosition.x, top: menuPosition.y } : undefined}
                aria-hidden="true"
              />
            </DropdownMenuTrigger>
            {sessionMenuContent}
          </DropdownMenu>
        </div>
      </DraggableSessionRow>
      {hasChildren && isExpanded
        ? node.children.map((child) => renderSessionNode(child, depth + 1, sessionDirectory ?? groupDirectory, projectId, archivedBucket, undefined, renderContext))
        : null}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent showCloseButton={false} className="max-w-sm gap-5">
          <DialogHeader>
            <DialogTitle>{t('sessions.sidebar.session.export.dialog.title')}</DialogTitle>
            <DialogDescription>
              {descendantCount === 1
                ? t('sessions.sidebar.session.export.dialog.descriptionSingle', { count: descendantCount })
                : t('sessions.sidebar.session.export.dialog.descriptionMany', { count: descendantCount })}
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 typography-ui-label cursor-pointer">
            <input
              type="checkbox"
              checked={exportIncludeSubtasks}
              onChange={(e) => setExportIncludeSubtasks(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            {t('sessions.sidebar.session.export.dialog.includeSubtasks')}
          </label>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => setExportDialogOpen(false)}
              variant="outline"
              size="sm"
            >
              {t('sessions.sidebar.dialogs.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setExportDialogOpen(false);
                void doExportSession(exportIncludeSubtasks);
              }}
              size="sm"
            >
              {t('sessions.sidebar.session.export.dialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </React.Fragment>
  );
}

export const SessionNodeItem = React.memo(SessionNodeItemComponent, areEqual);
