import React from 'react';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { Icon } from '@/components/icon/Icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useI18n } from '@/lib/i18n';
import { sortContextSurfaces, type ContextSurfaceDescriptor } from '@/lib/surfaces/registry';
import { useGitHubAuthStore } from '@/stores/useGitHubAuthStore';
import { cn } from '@/lib/utils';
import { useFeatureFlagsStore } from '@/stores/useFeatureFlagsStore';
import { useGitStatus } from '@/stores/useGitStore';
import { normalizeContextPanelDirectoryKey, useUIStore } from '@/stores/useUIStore';

const EMPTY_TABS: never[] = [];

type RailItemProps = {
  surface: ContextSurfaceDescriptor;
  isActive: boolean;
  showActivityDot: boolean;
  label: string;
  description: string;
  onSelect: (surface: ContextSurfaceDescriptor) => void;
};

const ContextPanelRailItem: React.FC<RailItemProps> = ({
  surface,
  isActive,
  showActivityDot,
  label,
  description,
  onSelect,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: surface.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('relative', isDragging && 'z-10 opacity-70')}
    >
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={() => onSelect(surface)}
            aria-label={label}
            aria-pressed={isActive}
            className={cn(
              'flex h-9 w-9 touch-none select-none items-center justify-center rounded-md transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon name={surface.icon} className="h-[18px] w-[18px]" />
            {showActivityDot ? (
              <span
                aria-hidden="true"
                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-status-info"
              />
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={8}>
          <div className="flex flex-col gap-0.5">
            <span>{label}</span>
            <span className="typography-micro text-muted-foreground">{description}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  );
};

export const ContextPanelRail: React.FC = () => {
  const { t } = useI18n();
  const effectiveDirectory = useEffectiveDirectory();
  const directoryKey = effectiveDirectory ? normalizeContextPanelDirectoryKey(effectiveDirectory) : '';
  const panelState = useUIStore((state) => (
    directoryKey ? state.contextPanelByDirectory[directoryKey] : undefined
  ));
  const contextRailOrder = useUIStore((state) => state.contextRailOrder);
  const setContextRailOrder = useUIStore((state) => state.setContextRailOrder);
  const openContextSurface = useUIStore((state) => state.openContextSurface);
  const closeContextPanel = useUIStore((state) => state.closeContextPanel);
  const planModeEnabled = useFeatureFlagsStore((state) => state.planModeEnabled);
  const githubAuthChecked = useGitHubAuthStore((state) => state.hasChecked);
  const githubConnected = useGitHubAuthStore((state) => state.status?.connected === true);
  const gitStatus = useGitStatus(directoryKey || null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const tabs = panelState?.tabs ?? EMPTY_TABS;
  const activeTab = tabs.find((tab) => tab.id === panelState?.activeTabId) ?? null;
  const activeMode = panelState?.isOpen ? activeTab?.mode ?? null : null;
  const surfaces = React.useMemo(() => (
    sortContextSurfaces(contextRailOrder).filter((surface) => {
      if (surface.id === 'plan' && !planModeEnabled) return false;
      // The pull-request rail icon stays off until GitHub is connected (OAuth
      // or a detected `gh` CLI login); GitHub is connected from Settings, so
      // hiding the surface removes no entry point.
      if (surface.id === 'pr' && !githubConnected) return false;
      if (surface.availability === 'has-content') {
        return tabs.some((tab) => tab.mode === surface.mode);
      }
      return true;
    })
  ), [contextRailOrder, githubConnected, planModeEnabled, tabs]);

  // A surface whose integration disconnected closes rather than lingering as
  // an active panel with no rail icon.
  React.useEffect(() => {
    if (!directoryKey || !githubAuthChecked || githubConnected || activeMode !== 'pr') {
      return;
    }
    closeContextPanel(directoryKey);
  }, [activeMode, closeContextPanel, directoryKey, githubAuthChecked, githubConnected]);

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const orderedIds = sortContextSurfaces(useUIStore.getState().contextRailOrder)
      .map((surface) => surface.id);
    const fromIndex = orderedIds.indexOf(active.id as (typeof orderedIds)[number]);
    const toIndex = orderedIds.indexOf(over.id as (typeof orderedIds)[number]);
    if (fromIndex === -1 || toIndex === -1) return;
    setContextRailOrder(arrayMove(orderedIds, fromIndex, toIndex));
  }, [setContextRailOrder]);

  if (!directoryKey) return null;

  return (
    <nav
      data-context-panel-rail="true"
      aria-label={t('contextRail.aria.rail')}
      className="flex h-full w-11 flex-shrink-0 flex-col items-center gap-1 border-l border-border/40 bg-background py-2 max-sm:hidden"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={surfaces.map((surface) => surface.id)} strategy={verticalListSortingStrategy}>
          {surfaces.map((surface) => (
            <ContextPanelRailItem
              key={surface.id}
              surface={surface}
              isActive={activeMode === surface.mode}
              showActivityDot={surface.id === 'git' && (gitStatus?.files.length ?? 0) > 0}
              label={t(surface.labelKey)}
              description={t(surface.descriptionKey)}
              onSelect={(selected) => openContextSurface(directoryKey, selected.mode)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </nav>
  );
};
