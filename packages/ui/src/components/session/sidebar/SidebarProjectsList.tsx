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
import type { SessionGroup } from './types';
import type { SortableDragHandleProps } from './sortableItems';
import { SortableGroupItem, SortableProjectItem } from './sortableItems';
import { formatProjectLabel } from './utils';
import { useI18n } from '@/lib/i18n';
import { serverRegistry } from '@/lib/opencode/server-registry';
import { subscribeSyncStoresRegistry } from '@/sync/multi-server-registry';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import { resolveInstanceLabel } from '@/lib/desktopSsh';
import { getMainWorkspaceSectionForRender } from './mainWorkspaceSection';
import type { ProjectSortOrder } from '@/stores/useSessionDisplayStore';
import {
  getRemoteProjectLoadStates,
  type RemoteProjectLoadState,
  type RemoteProjectRef,
} from './remoteProjectLoadState';

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

type Props = {
  topContent?: React.ReactNode;
  /** Renders inside the scroll viewport after project rows (not sticky). */
  bottomContent?: React.ReactNode;
  sectionsForRender: ProjectSection[];
  projectSections: ProjectSection[];
  activeProjectId: string | null;
  showOnlyMainWorkspace: boolean;
  hasSessionSearchQuery: boolean;
  emptyState: React.ReactNode;
  searchEmptyState: React.ReactNode;
  renderGroupSessions: (group: SessionGroup, groupKey: string, projectId?: string | null, hideGroupLabel?: boolean, dragHandleProps?: SortableDragHandleProps | null, compactBodyPadding?: boolean) => React.ReactNode;
  homeDirectory: string | null;
  collapsedProjects: Set<string>;
  hideDirectoryControls: boolean;
  projectRepoStatus: Map<string, boolean | null>;
  isDesktopShellRuntime: boolean;
  stuckProjectHeaders: Set<string>;
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
  onRefreshProject?: () => void;
  isInlineEditing: boolean;
};

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

const useRemoteProjectLoadStates = (
  projects: RemoteProjectRef[],
): Map<string, RemoteProjectLoadState> => {
  const signature = React.useMemo(
    () => getRemoteProjectSignature(projects),
    [projects],
  );
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

export function SidebarProjectsList(props: Props): React.ReactNode {
  const { t } = useI18n();
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
  const projectSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const groupSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  // Empty sensor list: keeps SortableContext happy without attaching pointer listeners.
  const noopSensors = useSensors();

  // Capacitor/mobile drawer: native overflow only. OverlayScrollbar + ScrollShadow
  // observers fight 2k+ session-row DOM during touch scroll.
  const listScrollProps = {
    useScrollShadow: !props.mobileVariant,
    scrollShadowSize: 96 as const,
    observeMutations: !props.mobileVariant,
    disableOverlayScrollbar: Boolean(props.mobileVariant),
    outerClassName: 'flex-1 min-h-0',
    className: cn('space-y-1 pb-1 pl-2.5 pr-2', props.mobileVariant ? 'overscroll-contain touch-pan-y' : ''),
  };

  if (props.projectSections.length === 0) {
    return (
      <ScrollableOverlay {...listScrollProps}>
        {props.topContent}
        {props.emptyState}
        {props.bottomContent}
      </ScrollableOverlay>
    );
  }

  if (props.sectionsForRender.length === 0) {
    return (
      <ScrollableOverlay {...listScrollProps}>
        {props.searchEmptyState}
        {props.bottomContent}
      </ScrollableOverlay>
    );
  }

  return (
    <ScrollableOverlay {...listScrollProps}>
      {props.topContent}
      {props.showOnlyMainWorkspace ? (
        <div className="space-y-[0.6rem] py-1">
          {(() => {
            const activeSection = getMainWorkspaceSectionForRender(
              props.sectionsForRender,
              props.activeProjectId,
              props.hasSessionSearchQuery,
            );
            if (!activeSection) {
              return props.hasSessionSearchQuery ? props.searchEmptyState : props.emptyState;
            }
            const activeRemoteLoadState = remoteProjectLoadStates.get(activeSection.project.id);
            if (activeRemoteLoadState && activeRemoteLoadState.phase !== 'complete' && !hasAnySessions(activeSection)) {
              return <RemoteProjectSessionSkeleton />;
            }
            const primaryGroup =
              activeSection.groups.find((candidate) => candidate.isMain && candidate.sessions.length > 0)
              ?? activeSection.groups.find((candidate) => candidate.sessions.length > 0)
              ?? activeSection.groups.find((candidate) => candidate.isMain)
              ?? activeSection.groups[0];
            if (!primaryGroup) {
              return <div className="py-1 text-left typography-micro text-muted-foreground">{t('sessions.sidebar.empty.noSessions.title')}</div>;
            }
            const archivedGroup = activeSection.groups.find((candidate) => candidate.isArchivedBucket);
            const groupsToRender = [
              primaryGroup,
              ...(archivedGroup && archivedGroup.id !== primaryGroup.id ? [archivedGroup] : []),
            ];

            return groupsToRender.map((group) => {
              const groupKey = `${activeSection.project.id}:${group.id}`;
              const hideGroupLabel = group.id === primaryGroup.id;
              return (
                <React.Fragment key={groupKey}>
                  {props.renderGroupSessions(group, groupKey, activeSection.project.id, hideGroupLabel, null, true)}
                </React.Fragment>
              );
            });
          })()}
        </div>
      ) : (
        (() => {
          const renderProjectSections = orderedSectionsForRender.map((section) => {
            const project = section.project;
            const projectKey = project.id;
            const rawProjectLabel = project.label?.trim();
            const sshInst = project.serverId ? sshInstances.find((i) => i.id === project.serverId) : undefined;
            const serverLabel = sshInst ? resolveInstanceLabel(sshInst) : (project.serverId || '');
            const projectLabel = formatProjectLabel(
              rawProjectLabel && rawProjectLabel !== serverLabel
                ? rawProjectLabel
                : formatDirectoryName(project.normalizedPath, props.homeDirectory) || project.normalizedPath,
            );
            const projectDescription = formatPathForDisplay(project.normalizedPath, props.homeDirectory);
            const isCollapsed = props.collapsedProjects.has(projectKey);
            const isActiveProject = projectKey === props.activeProjectId;
            const isRepo = props.projectRepoStatus.get(projectKey);
            const orderedGroups = props.getOrderedGroups(projectKey, section.groups);
            const rootGroup = orderedGroups.find((group) => group.isMain) ?? null;
            const nestedGroups = rootGroup
              ? orderedGroups.filter((group) => group.id !== rootGroup.id)
              : orderedGroups;
            const remoteLoadState = remoteProjectLoadStates.get(projectKey);
            const showRemoteSkeleton = Boolean(
              remoteLoadState && remoteLoadState.phase !== 'complete' && !hasAnySessions(section),
            );

            const groupBody = showRemoteSkeleton ? (
              <RemoteProjectSessionSkeleton />
            ) : section.groups.length > 0 ? (
              props.mobileVariant ? (
                <>
                  {rootGroup
                    ? props.renderGroupSessions(rootGroup, `${projectKey}:${rootGroup.id}`, projectKey, nestedGroups.length === 0)
                    : null}
                  {nestedGroups.map((group) => {
                    const groupKey = `${projectKey}:${group.id}`;
                    return (
                      <React.Fragment key={group.id}>
                        {props.renderGroupSessions(group, groupKey, projectKey, false, null)}
                      </React.Fragment>
                    );
                  })}
                </>
              ) : (
                <DndContext
                  sensors={groupSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => {
                    if (props.isInlineEditing) return;
                    const { active, over } = event;
                    if (!over || active.id === over.id) return;
                    const oldIndex = nestedGroups.findIndex((item) => item.id === active.id);
                    const newIndex = nestedGroups.findIndex((item) => item.id === over.id);
                    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
                    const nextNested = arrayMove(nestedGroups, oldIndex, newIndex).map((item) => item.id);
                    const next = rootGroup ? [rootGroup.id, ...nextNested] : nextNested;
                    props.setGroupOrderByProject((prev) => {
                      const map = new Map(prev);
                      map.set(projectKey, next);
                      return map;
                    });
                  }}
                >
                  {rootGroup ? props.renderGroupSessions(rootGroup, `${projectKey}:${rootGroup.id}`, projectKey, nestedGroups.length === 0) : null}
                  <SortableContext items={nestedGroups.map((group) => group.id)} strategy={verticalListSortingStrategy}>
                    {nestedGroups.map((group) => {
                      const groupKey = `${projectKey}:${group.id}`;
                      return (
                        <SortableGroupItem key={group.id} id={group.id} disabled={props.isInlineEditing}>
                          {(dragHandleProps) => props.renderGroupSessions(group, groupKey, projectKey, false, dragHandleProps)}
                        </SortableGroupItem>
                      );
                    })}
                  </SortableContext>
                  <DragOverlay dropAnimation={null} />
                </DndContext>
              )
            ) : (
              <div className="py-1 text-left typography-micro text-muted-foreground">{t('sessions.sidebar.empty.noSessions.title')}</div>
            );

            return (
              <SortableProjectItem
                key={projectKey}
                id={projectKey}
                disabled={props.mobileVariant || props.projectSortOrder !== 'manual'}
                projectLabel={projectLabel}
                projectDescription={projectDescription}
                projectIcon={project.icon}
                projectColor={project.color}
                projectIconImage={project.iconImage}
                projectIconBackground={project.iconBackground}
                isCollapsed={isCollapsed}
                isActiveProject={isActiveProject}
                isRepo={Boolean(isRepo)}
                isDesktopShell={props.isDesktopShellRuntime}
                isStuck={props.stuckProjectHeaders.has(projectKey)}
                hideDirectoryControls={props.hideDirectoryControls}
                mobileVariant={props.mobileVariant}
                alwaysShowActions={props.alwaysShowActions}
                serverId={project.serverId}
                serverHealthStatus={project.serverId ? serverRegistry.get(project.serverId)?.healthStatus ?? null : undefined}
                unavailable={project.unavailable}
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
                  if (props.mobileVariant) props.setSessionSwitcherOpen(false);
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
                {!isCollapsed ? (
                  <div className="space-y-0 pt-0 pb-0.5 pl-3">
                    {groupBody}
                  </div>
                ) : null}
              </SortableProjectItem>
            );
          });

          // Capacitor: DndContext with no pointer sensors — nested PointerSensor
          // otherwise swallows session-row taps ("click does nothing").
          if (props.mobileVariant) {
            return (
              <DndContext sensors={noopSensors} collisionDetection={closestCenter}>
                <SortableContext items={orderedSectionsForRender.map((section) => section.project.id)} strategy={verticalListSortingStrategy}>
                  {renderProjectSections}
                </SortableContext>
              </DndContext>
            );
          }

          return (
            <DndContext
              sensors={projectSensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => {
                if (props.isInlineEditing) return;
                if (props.projectSortOrder !== 'manual') return;
                const { active, over } = event;
                if (!over || active.id === over.id) return;
                const activeProjectId = String(active.id);
                const overProjectId = String(over.id);
                const activeSection = orderedSectionsForRender.find((section) => section.project.id === activeProjectId);
                const overSection = orderedSectionsForRender.find((section) => section.project.id === overProjectId);
                if (!activeSection || !overSection) return;
                props.reorderProjectsById(activeProjectId, overProjectId);
              }}
            >
              <SortableContext items={orderedSectionsForRender.map((section) => section.project.id)} strategy={verticalListSortingStrategy}>
                {renderProjectSections}
              </SortableContext>
              <DragOverlay dropAnimation={null} />
            </DndContext>
          );
        })()
      )}
      {props.bottomContent}
    </ScrollableOverlay>
  );
}
