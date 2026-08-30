import React from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import type { SessionNode } from './types';
import { useI18n } from '@/lib/i18n';
import { Icon } from "@/components/icon/Icon";
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionDisplayStore } from '@/stores/useSessionDisplayStore';
import {
  buildSessionNodeRenderExtras,
  type SessionNodeChildRenderExtras,
  type SidebarRenderContext,
} from './sessionNodeItemUtils';
import { useStickyHeader } from './hooks/useStickyProjectHeaders';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type ActivityItem = {
  node: SessionNode;
  projectId: string | null;
  groupDirectory: string | null;
  secondaryMeta: {
    projectLabel?: string | null;
    branchLabel?: string | null;
  } | null;
};

export type ActivitySection = {
  key: 'active-now' | 'global-pinned' | 'chats';
  title: string;
  items: ActivityItem[];
};

type Props = {
  sections: ActivitySection[];
  renderSessionNode: (
    node: SessionNode,
    depth?: number,
    groupDirectory?: string | null,
    projectId?: string | null,
    archivedBucket?: boolean,
    secondaryMeta?: { projectLabel?: string | null; branchLabel?: string | null } | null,
    renderContext?: SidebarRenderContext,
    renderExtras?: SessionNodeChildRenderExtras,
  ) => React.ReactNode;
  openSidebarMenuKey?: string | null;
  onReorderGlobalPinned?: (fromIndex: number, toIndex: number) => void;
  isDesktopShellRuntime: boolean;
  onNewChat?: () => void;
  alwaysShowActions?: boolean;
  renderChatsSection?: (items: ActivityItem[]) => React.ReactNode;
};

const MAX_VISIBLE_RECENT_SESSIONS = 7;

const SortableActivityItem: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="relative cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <div style={{ opacity: isDragging ? 0.4 : undefined }}>
        {children}
      </div>
    </div>
  );
};

export function SidebarActivitySections({
  sections,
  renderSessionNode,
  openSidebarMenuKey = null,
  onReorderGlobalPinned,
  isDesktopShellRuntime,
  onNewChat,
  alwaysShowActions = false,
  renderChatsSection,
}: Props): React.ReactNode {
  const { t } = useI18n();
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const stickyZoneHeaders = useSessionDisplayStore((state) => state.stickyZoneHeaders);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(new Set());
  const { isStuck: isActivityHeaderStuck, sentinelRef: activityHeaderSentinelRef } = useStickyHeader({
    enabled: stickyZoneHeaders,
    isDesktopShellRuntime,
  });

  const extrasBySectionKey = React.useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildSessionNodeRenderExtras>>();
    for (const section of sections) {
      const renderContext: SidebarRenderContext = section.key === 'global-pinned' ? 'global-pinned' : 'recent';
      map.set(
        section.key,
        buildSessionNodeRenderExtras(
          section.items.map((item) => item.node),
          currentSessionId,
          null,
          openSidebarMenuKey,
          renderContext,
          false,
        ),
      );
    }
    return map;
  }, [currentSessionId, openSidebarMenuKey, sections]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggleSection = React.useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleSectionLimit = React.useCallback((key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const visibleSections = sections.filter((section) => (
    section.items.length > 0 || (section.key === 'chats' && onNewChat)
  ));
  if (visibleSections.length === 0) {
    return null;
  }

  const renderItems = (section: ActivitySection, visibleItems: ActivityItem[]) => {
    const renderContext: SidebarRenderContext = section.key === 'global-pinned' ? 'global-pinned' : 'recent';
    const sectionExtras = extrasBySectionKey.get(section.key);
    const renderItem = (item: ActivityItem) => {
      const extras = sectionExtras?.childRenderExtrasFor?.(item.node);
      return renderSessionNode(
        item.node,
        0,
        item.groupDirectory,
        item.projectId,
        false,
        item.secondaryMeta,
        renderContext,
        extras,
      );
    };

    if (section.key === 'global-pinned' && onReorderGlobalPinned && section.items.length > 1) {
      return (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) => {
            const { active, over } = event;
            if (!over || active.id === over.id) return;
            const oldIndex = section.items.findIndex((item) => item.node.session.id === active.id);
            const newIndex = section.items.findIndex((item) => item.node.session.id === over.id);
            if (oldIndex === -1 || newIndex === -1) return;
            onReorderGlobalPinned(oldIndex, newIndex);
          }}
        >
          <SortableContext items={section.items.map((item) => item.node.session.id)} strategy={verticalListSortingStrategy}>
            {visibleItems.map((item) => (
              <SortableActivityItem key={item.node.session.id} id={item.node.session.id}>
                {renderItem(item)}
              </SortableActivityItem>
            ))}
          </SortableContext>
        </DndContext>
      );
    }

    if (section.key === 'chats' && renderChatsSection) {
      return renderChatsSection(section.items);
    }

    return visibleItems.map((item) => renderItem(item));
  };

  return (
    <div className="space-y-2 pb-2 pt-1">
      {visibleSections.map((section) => {
        const isGlobalPinned = section.key === 'global-pinned';
        const isChats = section.key === 'chats';
        const isCollapsed = collapsed.has(section.key);
        const isExpanded = expandedSections.has(section.key);
        const visibleItems = isExpanded || isGlobalPinned ? section.items : section.items.slice(0, MAX_VISIBLE_RECENT_SESSIONS);
        const remainingCount = section.items.length - visibleItems.length;

        if (isGlobalPinned) {
          return (
            <div key={section.key} className="relative space-y-1">
              <div
                ref={activityHeaderSentinelRef}
                className="absolute top-0 h-px w-full pointer-events-none"
                aria-hidden="true"
              />
              <span className={cn(
                'block px-0.5 py-0.5 text-[14px] font-normal text-foreground/95',
                stickyZoneHeaders && 'sticky top-0 z-20 bg-sidebar',
                stickyZoneHeaders && isActivityHeaderStuck && 'oc-zone-header-backing',
              )}>{section.title}</span>
              <div className="space-y-0 pt-0 pb-0.5">
                {renderItems(section, visibleItems)}
              </div>
            </div>
          );
        }

        return (
          <div key={section.key} className="relative space-y-1">
            <div
              ref={activityHeaderSentinelRef}
              className="absolute top-0 h-px w-full pointer-events-none"
              aria-hidden="true"
            />
            <div className={cn(
              'relative group/chats',
              stickyZoneHeaders && 'sticky top-0 z-20 bg-sidebar',
              stickyZoneHeaders && isActivityHeaderStuck && 'oc-zone-header-backing',
            )}>
              <button
                type="button"
                onClick={() => toggleSection(section.key)}
                className={cn(
                  'group flex w-full items-center gap-1 rounded-md py-0.5 pl-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  isChats && onNewChat ? 'pr-7' : 'pr-0.5',
                )}
                aria-expanded={!isCollapsed}
              >
                <span className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground">
                  <Icon name={isChats ? 'chat-4' : 'history'} className="h-3.5 w-3.5 group-hover:hidden" />
                  <span className="hidden group-hover:inline-flex">
                    {isCollapsed ? <Icon name="arrow-right-s" className="h-3.5 w-3.5" /> : <Icon name="arrow-down-s" className="h-3.5 w-3.5" />}
                  </span>
                </span>
                <span className="text-[14px] font-normal text-foreground/95">{section.title}</span>
              </button>
              {isChats && onNewChat ? (
                <div className="absolute right-0.5 top-1/2 z-10 -translate-y-1/2">
                  <Tooltip delayDuration={500}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onNewChat();
                        }}
                        className={cn(
                          'inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                          alwaysShowActions
                            ? 'opacity-100'
                            : 'pointer-events-none opacity-0 group-hover/chats:pointer-events-auto group-hover/chats:opacity-100 group-focus-within/chats:pointer-events-auto group-focus-within/chats:opacity-100',
                        )}
                        aria-label={t('sessions.sidebar.header.actions.newSession')}
                      >
                        <Icon name="add" className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={4}>
                      <p>{t('sessions.sidebar.header.actions.newSession')}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : null}
            </div>
            {!isCollapsed ? (
              <div className={cn('space-y-0.5', isChats ? '' : 'pl-7')}>
                {renderItems(section, visibleItems)}
                {!isChats && remainingCount > 0 && !isExpanded ? (
                  <button
                    type="button"
                    onClick={() => toggleSectionLimit(section.key)}
                    className="mt-0.5 flex items-center justify-start rounded-md px-1.5 py-0.5 text-left text-xs text-muted-foreground/70 leading-tight hover:text-foreground hover:underline"
                  >
                    {remainingCount === 1
                      ? t('sessions.sidebar.group.showMoreSingle', { count: remainingCount })
                      : t('sessions.sidebar.group.showMorePlural', { count: remainingCount })}
                  </button>
                ) : null}
                {!isChats && isExpanded && section.items.length > MAX_VISIBLE_RECENT_SESSIONS ? (
                  <button
                    type="button"
                    onClick={() => toggleSectionLimit(section.key)}
                    className="mt-0.5 flex items-center justify-start rounded-md px-1.5 py-0.5 text-left text-xs text-muted-foreground/70 leading-tight hover:text-foreground hover:underline"
                  >
                    {t('sessions.sidebar.group.showFewer')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
