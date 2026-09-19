import React from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { formatDirectoryName, formatPathForDisplay, cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useSessionDisplayStore, type ProjectSortOrder } from '@/stores/useSessionDisplayStore';
import { Icon } from '@/components/icon/Icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SortableDragHandleProps } from './sortableItems';
import { SortableGroupItem, SortableProjectItem } from './sortableItems';
import {
  getRemoteProjectLoadStates,
  type RemoteProjectLoadState,
  type RemoteProjectRef,
} from './remoteProjectLoadState';
import { formatProjectLabel } from './utils';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { subscribeSyncStoresRegistry } from '@/sync/multi-server-registry';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import { resolveInstanceLabel } from '@/lib/desktopSsh';
import {
  getSessionNodesActivityState,
  mergeCollapsedActivityStates,
  type CollapsedActivityState,
} from './collapsedActivityState';
import { DirectoryActionIndicator } from './sessions/DirectoryActionIndicator';
import type { SessionGroup, SessionNode, GroupSearchData } from './types';
import type { SessionFolder, SessionFoldersMap } from '@/stores/useSessionFoldersStore';
import { buildSessionSidebarRowModel, resolveSessionSidebarStickyHeader, type SessionSidebarRow } from './sessionSidebarRowModel';
import { SessionSidebarRows } from './SessionSidebarRows';
import { DroppableFolderWrapper } from './sessionFolderDnd';
import type { SessionNodeChildRenderExtras } from './sessionNodeItemUtils';

type ProjectSection = {
  project: {
    id: string;
    label?: string;
    normalizedPath: string;
    icon?: string;
    color?: string;
    iconImage?: { mime: string; updatedAt: number; source: 'custom' | 'auto' };
    iconBackground?: string;
    serverId?: string;
    unavailable?: boolean;
    pinned?: boolean;
  };
  groups: SessionGroup[];
};

type SecondaryMeta = { projectLabel?: string | null; branchLabel?: string | null } | null;

// Stable extras: session rows receive them unchanged so React.memo on the row
// keeps working; per-row accuracy is only a render optimization upstream.
const EMPTY_ROW_EXTRAS: SessionNodeChildRenderExtras = {
  subtreeContainsActive: new Set<string>(),
  subtreeContainsEditing: new Set<string>(),
  menuOpenSessionId: null,
  nodeStructureKey: '',
};

type RenderSessionNode = (
  node: SessionNode,
  depth?: number,
  groupDirectory?: string | null,
  projectId?: string | null,
  archivedBucket?: boolean,
  secondaryMeta?: SecondaryMeta,
  renderContext?: 'project' | 'recent' | 'global-pinned',
  renderExtras?: SessionNodeChildRenderExtras,
) => React.ReactNode;

type RenderGroupHeader = (
  group: SessionGroup,
  groupKey: string,
  projectId: string | null,
  dragHandleProps: SortableDragHandleProps | null,
) => React.ReactNode;

type RenderFolderItem = (args: {
  folder: SessionFolder;
  scopeKey: string;
  scopeDirectory: string | null;
  projectId: string | null;
  groupDirectory: string | null;
  archivedBucket: boolean;
  isCollapsed: boolean;
  depth: number;
  droppableRef: (node: HTMLElement | null) => void;
  isDropTarget: boolean;
  activityNodes: readonly SessionNode[];
  deleteSessions: readonly import('@opencode-ai/sdk/v2').Session[];
}) => React.ReactNode;

const getRemoteProjectSignature = (projects: RemoteProjectRef[]): string =>
  projects
    .map((project) => `${project.id}:${project.serverId ?? ''}:${project.normalizedPath}`)
    .sort()
    .join('|');

const remoteProjectLoadStatesEqual = (
  left: Map<string, RemoteProjectLoadState>,
  right: Map<string, RemoteProjectLoadState>,
): boolean => {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [projectId, state] of left) {
    if (right.get(projectId)?.phase !== state.phase) {
      return false;
    }
  }
  return true;
};

const useRemoteProjectLoadStates = (projects: RemoteProjectRef[]): Map<string, RemoteProjectLoadState> => {
  const signature = React.useMemo(() => getRemoteProjectSignature(projects), [projects]);
  const projectsRef = React.useRef(projects);
  const [states, setStates] = React.useState(() => getRemoteProjectLoadStates(projects));

  React.useEffect(() => {
    projectsRef.current = projects;
  }, [projects, signature]);

  React.useEffect(() => {
    let cancelled = false;
    const update = () => {
      if (!cancelled) {
        const next = getRemoteProjectLoadStates(projectsRef.current);
        setStates((prev) => remoteProjectLoadStatesEqual(prev, next) ? prev : next);
      }
    };

    update();
    const unsubRegistry = subscribeSyncStoresRegistry(update);
    const healthUnsubs = Array.from(new Set(projectsRef.current.map((project) => project.serverId).filter((id): id is string => Boolean(id && id !== 'default'))))
      .map((serverId) => serverRegistry.onHealthChange(serverId, update));
    const interval = window.setInterval(update, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unsubRegistry();
      for (const unsubscribe of healthUnsubs) unsubscribe();
    };
  }, [signature]);

  return states;
};

const TOP_FADE_MAX_SIZE = 48;
const TOP_FADE_MIN_SIZE = 32;
const TOP_FADE_CLEAR_MAX_SIZE = 24;

const hasAnySessions = (section: ProjectSection): boolean =>
  section.groups.some((group) => group.sessions.length > 0);

const RemoteProjectSessionSkeleton = () => (
  <div className="space-y-1 py-1" aria-hidden="true">
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
      <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[var(--surface-subtle)] animate-pulse" />
      <span className="h-3 w-[66%] rounded-full bg-[var(--surface-subtle)] animate-pulse" />
    </div>
  </div>
);

type SessionSidebarListProps = {
  topContent?: React.ReactNode;
  /** Renders inside the scroll viewport after project rows (not sticky). */
  bottomContent?: React.ReactNode;
  sectionsForRender: ProjectSection[];
  projectSections: ProjectSection[];
  projectPickerSections: ProjectSection[];
  activeProjectId: string | null;
  singleProjectMode: boolean;
  singleProjectId: string | null;
  setSingleProjectId: (id: string) => void;
  showOnlyMainWorkspace: boolean;
  hasSessionSearchQuery: boolean;
  normalizedSessionSearchQuery: string;
  emptyState: React.ReactNode;
  searchEmptyState: React.ReactNode;
  activeActivitySessionKeys: ReadonlySet<string>;
  unreadActivitySessionIds: ReadonlySet<string>;
  notifyOnSubtasks: boolean;
  homeDirectory: string | null;
  collapsedProjects: Set<string>;
  collapsedGroups: Set<string>;
  collapsedFolderIds: Set<string>;
  expandedParents: Set<string>;
  foldersMap: SessionFoldersMap;
  groupSearchDataByGroup: WeakMap<SessionGroup, GroupSearchData>;
  pinnedSessionIds: ReadonlySet<string>;
  sessionOrderIndex: ReadonlyMap<string, number>;
  visibleCountByContainer: ReadonlyMap<string, number>;
  renderSessionNode: RenderSessionNode;
  renderGroupHeader: RenderGroupHeader;
  renderFolderItem: RenderFolderItem;
  hideDirectoryControls: boolean;
  projectRepoStatus: Map<string, boolean | null>;
  isDesktopShellRuntime: boolean;
  mobileVariant: boolean;
  alwaysShowActions: boolean;
  toggleProject: (id: string) => void;
  setActiveProjectIdOnly: (id: string) => void;
  setActiveMainTab: (tab: 'chat' | 'plan' | 'git' | 'diff' | 'terminal' | 'files') => void;
  setSessionSwitcherOpen: (open: boolean) => void;
  openNewSessionDraft: (options?: { directoryOverride?: string | null; selectedProjectId?: string | null }) => void;
  openNewWorktreeDialog: () => void;
  openWorktreesPage: (projectId: string) => void;
  openProjectEditDialog: (id: string) => void;
  removeProject: (id: string) => void;
  projectHeaderSentinelRefs: React.MutableRefObject<Map<string, HTMLDivElement | null>>;
  reorderProjectsById: (activeProjectId: string, overProjectId: string) => void;
  projectSortOrder: ProjectSortOrder;
  toggleProjectPin: (id: string) => void;
  getOrderedGroups: (projectId: string, groups: SessionGroup[]) => SessionGroup[];
  setGroupOrderByProject: React.Dispatch<React.SetStateAction<Map<string, string[]>>>;
  openSidebarMenuKey: string | null;
  setOpenSidebarMenuKey: (key: string | null) => void;
  showMoreGroupSessions: (containerKey: string, nextVisibleCount: number) => void;
  resetGroupSessionLimit: (containerKey: string) => void;
  /** Session dropped on a folder row (row-model flat dnd; [fork-port]). */
  onSessionDroppedOnFolder: (sessionId: string, folderId: string) => void;
  onRefreshProject?: () => void;
  isInlineEditing: boolean;
  hasLeadingActivitySections?: boolean;
  hasStandaloneContent?: boolean;
};

export function SessionSidebarList(props: SessionSidebarListProps): React.ReactNode {
  const { t } = useI18n();
  const stickyZoneHeaders = useSessionDisplayStore((state) => state.stickyZoneHeaders);
  const enableStickyFade = props.isDesktopShellRuntime && stickyZoneHeaders && !props.mobileVariant;
  const scrollContainerRef = React.useRef<HTMLElement | null>(null);
  const [scrollElement, setScrollElement] = React.useState<HTMLElement | null>(null);
  const setScrollContainer = React.useCallback((element: HTMLElement | null) => {
    scrollContainerRef.current = element;
    setScrollElement(element);
  }, []);
  const topFadeSizeRef = React.useRef(0);
  const syncTopFade = React.useCallback((scroller: HTMLElement) => {
    const topFadeSize = scroller.scrollTop > 1
      ? Math.min(TOP_FADE_MIN_SIZE + scroller.scrollTop, TOP_FADE_MAX_SIZE)
      : 0;
    topFadeSizeRef.current = topFadeSize;
    scroller.style.setProperty('--scroll-shadow-top-size', `${topFadeSize}px`);
    scroller.style.setProperty(
      '--scroll-shadow-top-clear-size',
      `${Math.min(Math.max(topFadeSize - 8, 0), TOP_FADE_CLEAR_MAX_SIZE)}px`,
    );
  }, []);
  const blockObscuredInteraction = React.useCallback((
    event: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>,
  ) => {
    if ((event.target as Element).closest('[data-overlay-scrollbar-thumb], [data-sidebar-sticky-header]')) return;
    const eventY = event.clientY - event.currentTarget.getBoundingClientRect().top;
    if (eventY >= topFadeSizeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const sshInstances = useDesktopSshStore((state) => state.instances);
  const remoteProjectRefs = React.useMemo(
    () => props.sectionsForRender.map((section) => ({
      id: section.project.id,
      normalizedPath: section.project.normalizedPath,
      serverId: section.project.serverId,
    })),
    [props.sectionsForRender],
  );
  const remoteProjectLoadStates = useRemoteProjectLoadStates(remoteProjectRefs);

  const orderedSectionsForRender = React.useMemo(() => {
    return [...props.sectionsForRender].sort((a, b) => {
      if (a.project.pinned && !b.project.pinned) return -1;
      if (!a.project.pinned && b.project.pinned) return 1;
      return 0;
    });
  }, [props.sectionsForRender]);

  // ---- Row model -----------------------------------------------------------
  const sectionsForModel = React.useMemo(() => orderedSectionsForRender.map((section) => ({
    ...section,
    groups: props.getOrderedGroups(section.project.id, section.groups),
  })), [orderedSectionsForRender, props.getOrderedGroups]);

  const projectById = React.useMemo(() => {
    const map = new Map<string, ProjectSection['project']>();
    for (const section of props.sectionsForRender) map.set(section.project.id, section.project);
    return map;
  }, [props.sectionsForRender]);

  const remoteLoadingProjectIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const section of props.sectionsForRender) {
      const loadState = remoteProjectLoadStates.get(section.project.id);
      if (loadState && loadState.phase !== 'complete' && !hasAnySessions(section)) {
        ids.add(section.project.id);
      }
    }
    return ids;
  }, [props.sectionsForRender, remoteProjectLoadStates]);

  const groupStatusByKey = React.useMemo(() => {
    const statuses = new Map<string, import('./sessionSidebarRowModel').SessionSidebarGroupStatus>();
    for (const section of sectionsForModel) {
      if (!remoteLoadingProjectIds.has(section.project.id)) continue;
      for (const group of section.groups) {
        statuses.set(`${section.project.id}:${group.id}`, {
          state: 'loading',
          directory: group.directory,
          canGrantAccess: false,
        });
      }
    }
    return statuses;
  }, [remoteLoadingProjectIds, sectionsForModel]);

  const rowModel = React.useMemo(() => buildSessionSidebarRowModel({
    mode: props.hasSessionSearchQuery ? 'search' : 'normal',
    sections: sectionsForModel,
    authoritativeSections: props.projectSections,
    chatGroup: null,
    recentSections: [],
    showRecentSection: false,
    foldersMap: props.foldersMap,
    groupSearchDataByGroup: props.groupSearchDataByGroup,
    normalizedQuery: props.normalizedSessionSearchQuery,
    collapsedProjects: props.collapsedProjects,
    collapsedGroups: props.collapsedGroups,
    collapsedFolders: props.collapsedFolderIds,
    collapsedActivities: new Set<string>(),
    expandedParents: props.expandedParents,
    visibleCountByContainer: props.visibleCountByContainer,
    pinnedSessionIds: props.pinnedSessionIds,
    sessionOrderIndex: props.sessionOrderIndex,
    groupStatusByKey,
    folderAuthorityByOwner: new Map(),
    activeProjectId: props.activeProjectId,
    singleProjectMode: false,
    singleProjectId: null,
    showOnlyMainWorkspace: props.showOnlyMainWorkspace,
    hideDirectoryControls: props.hideDirectoryControls,
  }), [
    groupStatusByKey,
    props.activeProjectId,
    props.collapsedFolderIds,
    props.collapsedGroups,
    props.collapsedProjects,
    props.expandedParents,
    props.foldersMap,
    props.groupSearchDataByGroup,
    props.hasSessionSearchQuery,
    props.hideDirectoryControls,
    props.normalizedSessionSearchQuery,
    props.pinnedSessionIds,
    props.projectSections,
    props.sessionOrderIndex,
    props.showOnlyMainWorkspace,
    props.visibleCountByContainer,
    sectionsForModel,
  ]);

  // ---- Sticky bookkeeping --------------------------------------------------
  const [stickyIdentity, setStickyIdentity] = React.useState<string | null>(null);

  const menuKeyByRowKey = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rowModel.rows) {
      if (row.kind !== 'session') continue;
      map.set(row.key, `${row.renderContext}:${row.archived ? 'archived' : 'active'}:${row.node.session.id}`);
    }
    return map;
  }, [rowModel]);

  const pinnedRowIndexes = React.useMemo(() => {
    const indexes = new Set<number>();
    if (props.openSidebarMenuKey) {
      for (const [rowKey, menuKey] of menuKeyByRowKey) {
        if (props.openSidebarMenuKey === menuKey) {
          const index = rowModel.rowIndexByKey.get(rowKey);
          if (index !== undefined) indexes.add(index);
        }
      }
    }
    if (stickyIdentity && stickyZoneHeaders) {
      const descriptorIndex = rowModel.stickyHeaders.findIndex((descriptor) => `${descriptor.kind}:${descriptor.id}` === stickyIdentity);
      if (descriptorIndex >= 0) {
        const first = Math.max(0, descriptorIndex - 1);
        const last = Math.min(rowModel.stickyHeaders.length - 1, descriptorIndex + 1);
        for (let index = first; index <= last; index += 1) {
          const descriptor = rowModel.stickyHeaders[index];
          if (descriptor) indexes.add(descriptor.rowIndex);
        }
      }
    }
    return indexes;
  }, [menuKeyByRowKey, props.openSidebarMenuKey, rowModel, stickyIdentity, stickyZoneHeaders]);

  const handleFirstVisibleIndexChange = React.useCallback((index: number) => {
    const descriptor = stickyZoneHeaders
      ? resolveSessionSidebarStickyHeader(rowModel.stickyHeaders, index)
      : null;
    const nextIdentity = descriptor ? `${descriptor.kind}:${descriptor.id}` : null;
    setStickyIdentity((current) => current === nextIdentity ? current : nextIdentity);
  }, [rowModel.stickyHeaders, stickyZoneHeaders]);

  // ---- Row rendering -------------------------------------------------------
  const renderRow = React.useCallback((row: SessionSidebarRow): React.ReactNode => {
    if (row.kind === 'project-header') {
      const project: ProjectSection['project'] = projectById.get(row.section.project.id) ?? (row.section.project as ProjectSection['project']);
      const projectKey = project.id;
      const rawProjectLabel = project.label?.trim();
      const sshInst = project.serverId ? sshInstances.find((entry) => entry.id === project.serverId) : undefined;
      const serverLabel = sshInst ? resolveInstanceLabel(sshInst) : (project.serverId || '');
      const projectLabel = formatProjectLabel(
        rawProjectLabel && rawProjectLabel !== serverLabel
          ? rawProjectLabel
          : formatDirectoryName(project.normalizedPath, props.homeDirectory) || project.normalizedPath,
      );
      const isCollapsed = props.collapsedProjects.has(projectKey);
      const projectServerId = project.serverId || DEFAULT_SERVER_ID;
      const collapsedActivityState = isCollapsed
        ? row.section.groups.reduce<CollapsedActivityState>(
          (state, group) => mergeCollapsedActivityStates(state, getSessionNodesActivityState(group.sessions, {
            serverId: projectServerId,
            fallbackDirectory: group.directory,
            activeSessionKeys: props.activeActivitySessionKeys,
            unreadSessionIds: props.unreadActivitySessionIds,
            includeUnreadSubtasks: props.notifyOnSubtasks,
          })),
          null,
        )
        : null;
      return (
        <SortableProjectItem
          id={projectKey}
          disabled={props.mobileVariant || props.projectSortOrder !== 'manual'}
          projectLabel={projectLabel}
          projectDescription={formatPathForDisplay(project.normalizedPath, props.homeDirectory)}
          projectIcon={project.icon}
          projectColor={project.color}
          projectIconImage={project.iconImage}
          projectIconBackground={project.iconBackground}
          isCollapsed={isCollapsed}
          isActiveProject={projectKey === props.activeProjectId}
          isRepo={Boolean(props.projectRepoStatus.get(projectKey))}
          isDesktopShell={props.isDesktopShellRuntime}
          hideDirectoryControls={props.hideDirectoryControls}
          mobileVariant={props.mobileVariant}
          alwaysShowActions={props.alwaysShowActions}
          serverId={project.serverId}
          unavailable={project.unavailable}
          collapsedActivityState={collapsedActivityState}
          onToggle={() => props.toggleProject(projectKey)}
          onNewSession={() => {
            if (projectKey !== props.activeProjectId) props.setActiveProjectIdOnly(projectKey);
            props.setActiveMainTab('chat');
            if (props.mobileVariant) props.setSessionSwitcherOpen(false);
            props.openNewSessionDraft({ directoryOverride: project.normalizedPath, selectedProjectId: projectKey });
          }}
          onNewWorktreeSession={() => {
            if (projectKey !== props.activeProjectId) props.setActiveProjectIdOnly(projectKey);
            props.setActiveMainTab('chat');
            props.openNewWorktreeDialog();
          }}
          onManageWorktrees={() => props.openWorktreesPage(projectKey)}
          onRenameStart={() => props.openProjectEditDialog(projectKey)}
          onClose={() => props.removeProject(projectKey)}
          sentinelRef={(el) => { props.projectHeaderSentinelRefs.current.set(projectKey, el); }}
          showCreateButtons
          openSidebarMenuKey={props.openSidebarMenuKey}
          setOpenSidebarMenuKey={props.setOpenSidebarMenuKey}
          isPinned={project.pinned}
          onTogglePin={() => props.toggleProjectPin(projectKey)}
          onRefresh={props.onRefreshProject}
        >
          <DirectoryActionIndicator directory={project.normalizedPath} className="absolute right-6 top-1/2 -translate-y-1/2" />
        </SortableProjectItem>
      );
    }
    if (row.kind === 'group-header') {
      return (
        <SortableGroupItem id={row.groupKey} disabled={row.forceExpanded || props.isInlineEditing}>
          {(dragHandleProps) => props.renderGroupHeader(row.group, row.groupKey, row.projectId, dragHandleProps)}
        </SortableGroupItem>
      );
    }
    if (row.kind === 'folder-header') {
      const isCollapsed = props.collapsedFolderIds.has(row.folder.id);
      return (
        <DroppableFolderWrapper folderId={row.folder.id}>
          {(droppableRef, isDropTarget) => props.renderFolderItem({
            folder: row.folder,
            scopeKey: row.scopeKey,
            scopeDirectory: row.scopeDirectory,
            projectId: row.projectId,
            groupDirectory: row.scopeDirectory ?? row.group.directory,
            archivedBucket: row.archived,
            isCollapsed,
            depth: 0,
            droppableRef,
            isDropTarget,
            activityNodes: row.activityNodes,
            deleteSessions: row.deleteSessions,
          })}
        </DroppableFolderWrapper>
      );
    }
    if (row.kind === 'session') {
      return props.renderSessionNode(
        row.node,
        row.depth,
        row.groupDirectory,
        row.projectId,
        row.archived,
        row.secondaryMeta,
        'project',
        EMPTY_ROW_EXTRAS,
      );
    }
    if (row.kind === 'show-control') {
      if (row.control === 'more') {
        return (
          <button
            type="button"
            onClick={() => props.showMoreGroupSessions(row.containerKey, row.currentCount + row.increment)}
            className="mt-0.5 flex items-center justify-start rounded-md px-1.5 py-0.5 text-left text-xs text-muted-foreground/70 leading-tight hover:text-foreground hover:underline"
          >
            {t('sessions.sidebar.group.showMorePlural', { count: row.increment })}
          </button>
        );
      }
      return (
        <button
          type="button"
          onClick={() => props.resetGroupSessionLimit(row.containerKey)}
          className="mt-0.5 flex items-center justify-start rounded-md px-1.5 py-0.5 text-left text-xs text-muted-foreground/70 leading-tight hover:text-foreground hover:underline"
        >
          {t('sessions.sidebar.group.showFewer')}
        </button>
      );
    }
    if (row.kind === 'status') {
      return <RemoteProjectSessionSkeleton />;
    }
    if (row.kind === 'activity-header') return null;
    if (row.emptyKind === 'sidebar') return props.emptyState;
    if (row.emptyKind === 'search') return props.searchEmptyState;
    return (
      <div className="py-1 pl-[26px] text-left typography-micro text-muted-foreground">
        {row.emptyKind === 'archived'
          ? t('sessions.sidebar.group.empty.noArchivedSessions')
          : row.group?.emptyMessage ?? t('sessions.sidebar.group.empty.noSessionsInWorkspace')}
      </div>
    );
  }, [projectById, props, sshInstances, t]);

  // ---- Shell ---------------------------------------------------------------
  const projectSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Empty sensor list: keeps SortableContext happy without attaching pointer
  // listeners. Capacitor/mobile: nested PointerSensor otherwise swallows
  // session-row taps ("click does nothing").
  const noopSensors = useSensors();

  const listScrollProps = {
    useScrollShadow: !props.mobileVariant,
    scrollShadowSize: 96 as const,
    hideTopScrollShadow: !enableStickyFade,
    observeMutations: !props.mobileVariant,
    disableOverlayScrollbar: Boolean(props.mobileVariant),
    outerClassName: 'flex-1 min-h-0',
    className: cn('pb-1 pl-2.5 pr-2', props.mobileVariant ? 'overscroll-contain touch-pan-y' : 'oc-sidebar-scroller [overflow-anchor:none]'),
    style: enableStickyFade ? { '--scroll-shadow-top-size': '0px' } as React.CSSProperties : undefined,
    onScroll: enableStickyFade ? (event: React.UIEvent<HTMLElement>) => syncTopFade(event.currentTarget) : undefined,
  };
  React.useLayoutEffect(() => {
    if (enableStickyFade && scrollContainerRef.current) syncTopFade(scrollContainerRef.current);
  }, [enableStickyFade, syncTopFade]);

  const selectedSingleProject = props.singleProjectMode
    ? props.projectPickerSections.find((section) => section.project.id === props.singleProjectId)?.project ?? null
    : null;
  const singleProjectPicker = props.singleProjectMode && selectedSingleProject ? (
    <div className="px-0 pb-1 pt-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-border/70 px-2 text-left hover:bg-interactive-hover"
            aria-label={t('sessions.sidebar.header.projectDisplay.single')}
          >
            <Icon name="folder" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate typography-ui-label">
              {formatProjectLabel(
                selectedSingleProject.label?.trim()
                || formatDirectoryName(selectedSingleProject.normalizedPath, props.homeDirectory)
                || selectedSingleProject.normalizedPath,
              )}
            </span>
            <Icon name="arrow-down-s" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 min-w-[240px] overflow-y-auto">
          <DropdownMenuRadioGroup value={props.singleProjectId ?? ''} onValueChange={props.setSingleProjectId}>
            {props.projectPickerSections.map((section) => (
              <DropdownMenuRadioItem key={section.project.id} value={section.project.id}>
                <span className="truncate">
                  {formatProjectLabel(
                    section.project.label?.trim()
                    || formatDirectoryName(section.project.normalizedPath, props.homeDirectory)
                    || section.project.normalizedPath,
                  )}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : null;

  const structuralIds = React.useMemo(() => rowModel.rows.flatMap((row) => row.kind === 'project-header'
    ? [row.section.project.id]
    : row.kind === 'group-header' ? [row.groupKey] : []), [rowModel.rows]);
  const projectDragIds = React.useMemo(
    () => new Set(props.sectionsForRender.map((section) => section.project.id)),
    [props.sectionsForRender],
  );
  const [isProjectDragging, setIsProjectDragging] = React.useState(false);
  // [fork-port] One flat DndContext owns every drag kind: project/group
  // reorder, and session→folder drops (the old per-group
  // SessionFolderDndScope cannot wrap a virtualized flat list). The session
  // drag preview is preserved through the DragOverlay below.
  const [activeSessionDrag, setActiveSessionDrag] = React.useState<{ id: string; title: string; width: number | null; height: number | null } | null>(null);

  const rowsTree = (
    <DndContext
      sensors={props.mobileVariant ? noopSensors : projectSensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => {
        const data = event.active.data.current as { type?: string; sessionId?: string; sessionTitle?: string } | undefined;
        if (data?.type === 'session' && data.sessionId) {
          const width = event.active.rect.current.initial?.width;
          const height = event.active.rect.current.initial?.height;
          setActiveSessionDrag({
            id: data.sessionId,
            title: data.sessionTitle ?? 'Session',
            width: typeof width === 'number' ? width : null,
            height: typeof height === 'number' ? height : null,
          });
          return;
        }
        setIsProjectDragging(projectDragIds.has(String(event.active.id)));
      }}
      onDragCancel={() => {
        setIsProjectDragging(false);
        setActiveSessionDrag(null);
      }}
      onDragEnd={(event) => {
        setIsProjectDragging(false);
        setActiveSessionDrag(null);
        if (props.isInlineEditing) return;
        if (!event.over) return;
        const activeData = event.active.data.current as { type?: string; sessionId?: string } | undefined;
        const overData = event.over.data.current as { type?: string; folderId?: string } | undefined;
        if (activeData?.type === 'session' && activeData.sessionId && overData?.type === 'folder' && overData.folderId) {
          props.onSessionDroppedOnFolder(activeData.sessionId, overData.folderId);
          return;
        }
        const activeId = String(event.active.id);
        const overId = String(event.over.id);
        if (activeId === overId) return;
        if (props.projectSortOrder === 'manual') {
          const projectIds = props.sectionsForRender.map((section) => section.project.id);
          const from = projectIds.indexOf(activeId);
          const to = projectIds.indexOf(overId);
          if (from >= 0 && to >= 0) {
            props.reorderProjectsById(activeId, overId);
            return;
          }
        }
        const activeRow = rowModel.rows.find((row): row is Extract<SessionSidebarRow, { kind: 'group-header' }> => row.kind === 'group-header' && row.groupKey === activeId);
        const overRow = rowModel.rows.find((row): row is Extract<SessionSidebarRow, { kind: 'group-header' }> => row.kind === 'group-header' && row.groupKey === overId);
        if (!activeRow || !overRow || !activeRow.projectId || activeRow.projectId !== overRow.projectId) return;
        const projectId = activeRow.projectId;
        const section = sectionsForModel.find((entry) => entry.project.id === projectId);
        if (!section) return;
        const from = section.groups.findIndex((group) => group.id === activeRow.group.id);
        const to = section.groups.findIndex((group) => group.id === overRow.group.id);
        if (from < 0 || to < 0) return;
        props.setGroupOrderByProject((current) => {
          const map = new Map(current);
          const rootGroup = section.groups.find((group) => group.isMain);
          const others = arrayMove(section.groups, from, to).map((group) => group.id).filter((id) => id !== rootGroup?.id);
          map.set(projectId, rootGroup ? [rootGroup.id, ...others] : others);
          return map;
        });
      }}
    >
      <SortableContext items={structuralIds} strategy={verticalListSortingStrategy}>
        <SessionSidebarRows
          model={rowModel}
          scrollElement={scrollElement}
          pinnedRowIndexes={pinnedRowIndexes}
          renderRow={renderRow}
          onFirstVisibleIndexChange={handleFirstVisibleIndexChange}
        />
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeSessionDrag ? (
          <div
            style={{
              width: activeSessionDrag.width ? `${activeSessionDrag.width}px` : 'auto',
              height: activeSessionDrag.height ? `${activeSessionDrag.height}px` : 'auto',
            }}
            className="flex items-center rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-2.5 py-1 shadow-none pointer-events-none"
          >
            <Icon name="sticky-note" className="h-4 w-4 text-muted-foreground mr-2 flex-shrink-0" />
            <div className="min-w-0 flex-1 truncate typography-ui-label font-normal text-foreground">
              {activeSessionDrag.title}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );

  if (props.projectSections.length === 0) {
    return (
      <ScrollableOverlay ref={setScrollContainer} {...listScrollProps}>
        {props.topContent}
        {singleProjectPicker}
        {!props.hasStandaloneContent
          ? (props.hasSessionSearchQuery ? props.searchEmptyState : props.emptyState)
          : null}
        {props.bottomContent}
      </ScrollableOverlay>
    );
  }

  if (props.sectionsForRender.length === 0) {
    return (
      <ScrollableOverlay ref={setScrollContainer} {...listScrollProps}>
        {props.topContent}
        {singleProjectPicker}
        {props.searchEmptyState}
        {props.bottomContent}
      </ScrollableOverlay>
    );
  }

  const stickyProject = stickyIdentity?.startsWith('project:')
    ? projectById.get(stickyIdentity.slice('project:'.length)) ?? null
    : null;
  const leadingProject = stickyProject
    ?? (props.hasLeadingActivitySections ? null : orderedSectionsForRender[0]?.project ?? null);
  const leadingProjectLabel = leadingProject ? formatProjectLabel(
    leadingProject.label?.trim()
    || formatDirectoryName(leadingProject.normalizedPath, props.homeDirectory)
    || leadingProject.normalizedPath,
  ) : null;

  return (
    <div
      className="oc-sticky-fade-root relative flex min-h-0 flex-1"
      onPointerDownCapture={enableStickyFade ? blockObscuredInteraction : undefined}
      onClickCapture={enableStickyFade ? blockObscuredInteraction : undefined}
      onContextMenuCapture={enableStickyFade ? blockObscuredInteraction : undefined}
    >
      <ScrollableOverlay ref={setScrollContainer} {...listScrollProps}>
        {props.topContent}
        {singleProjectPicker}
        {rowsTree}
        {props.bottomContent}
      </ScrollableOverlay>
      {enableStickyFade && (leadingProject || props.hasLeadingActivitySections) ? (
        <div
          className="oc-sticky-fade-overlay pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-1.5 py-1 pl-4 pr-5"
          aria-hidden="true"
        >
          <Icon name={leadingProject ? 'folder' : 'history'} className="size-3.5 shrink-0 text-muted-foreground/80" />
          <span className="truncate text-[14px] font-normal lowercase text-foreground">
            {leadingProject && leadingProjectLabel
              ? leadingProjectLabel
              : t('sessions.sidebar.activity.recentTitle')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
