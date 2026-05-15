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
  key: 'active-now' | 'global-pinned';
  title: string;
  items: ActivityItem[];
};

type Props = {
  sections: ActivitySection[];
  renderSessionNode: (node: SessionNode, depth?: number, groupDirectory?: string | null, projectId?: string | null, archivedBucket?: boolean, secondaryMeta?: { projectLabel?: string | null; branchLabel?: string | null } | null, renderContext?: 'project' | 'recent' | 'global-pinned') => React.ReactNode;
  onReorderGlobalPinned?: (fromIndex: number, toIndex: number) => void;
};

const MAX_VISIBLE_RECENT_SESSIONS = 7;

const SortableActivityItem: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="relative">
      <div
        className="absolute left-0 top-0 bottom-0 w-3 cursor-grab active:cursor-grabbing -ml-1 z-10"
        {...attributes}
        {...listeners}
      />
      <div style={{ opacity: isDragging ? 0.4 : undefined }}>
        {children}
      </div>
    </div>
  );
};

export function SidebarActivitySections({ sections, renderSessionNode, onReorderGlobalPinned }: Props): React.ReactNode {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(new Set());

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

  const visibleSections = sections.filter((section) => section.items.length > 0);
  if (visibleSections.length === 0) {
    return null;
  }

  const renderItems = (section: ActivitySection, visibleItems: ActivityItem[]) => {
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
                {renderSessionNode(item.node, 0, item.groupDirectory, item.projectId, false, item.secondaryMeta, 'global-pinned')}
              </SortableActivityItem>
            ))}
          </SortableContext>
        </DndContext>
      );
    }

    return visibleItems.map((item) =>
      renderSessionNode(item.node, 0, item.groupDirectory, item.projectId, false, item.secondaryMeta, section.key === 'global-pinned' ? 'global-pinned' : 'recent'),
    );
  };

  return (
    <div className="space-y-2 pb-2 pt-1">
      {visibleSections.map((section) => {
        const isGlobalPinned = section.key === 'global-pinned';
        const isCollapsed = collapsed.has(section.key);
        const isExpanded = expandedSections.has(section.key);
        const visibleItems = isExpanded || isGlobalPinned ? section.items : section.items.slice(0, MAX_VISIBLE_RECENT_SESSIONS);
        const remainingCount = section.items.length - visibleItems.length;

        if (isGlobalPinned) {
          return (
            <div key={section.key} className="space-y-1">
              <span className="block px-0.5 py-0.5 text-[14px] font-normal text-foreground/95">{section.title}</span>
              <div className="space-y-0 pt-0 pb-0.5">
                {renderItems(section, visibleItems)}
              </div>
            </div>
          );
        }

        return (
          <div key={section.key} className="space-y-1">
            <button
              type="button"
              onClick={() => toggleSection(section.key)}
              className="group flex w-full items-center gap-1 rounded-md px-0.5 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-expanded={!isCollapsed}
            >
              <span className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground">
                {isCollapsed ? <Icon name="arrow-right-s" className="h-3.5 w-3.5" /> : <Icon name="arrow-down-s" className="h-3.5 w-3.5" />}
              </span>
              <span className="text-[14px] font-normal text-foreground/95">{section.title}</span>
            </button>
            {!isCollapsed ? (
              <div className={cn('space-y-0.5 pl-7')}>
                {renderItems(section, visibleItems)}
                {remainingCount > 0 && !isExpanded ? (
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
                {isExpanded && section.items.length > MAX_VISIBLE_RECENT_SESSIONS ? (
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
