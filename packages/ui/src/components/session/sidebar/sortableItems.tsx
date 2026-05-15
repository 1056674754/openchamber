import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Icon } from "@/components/icon/Icon";
import { cn } from '@/lib/utils';
import { PROJECT_COLOR_MAP, PROJECT_ICON_MAP, getProjectIconImageUrl } from '@/lib/projectMeta';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useI18n } from '@/lib/i18n';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import { resolveInstanceLabel } from '@/lib/desktopSsh';

export interface SortableProjectItemProps {
  id: string;
  projectLabel: string;
  projectDescription: string;
  projectIcon?: string;
  projectColor?: string;
  projectIconImage?: { mime: string; updatedAt: number; source: 'custom' | 'auto' };
  projectIconBackground?: string;
  isCollapsed: boolean;
  isActiveProject: boolean;
  isRepo: boolean;
  isDesktopShell: boolean;
  isStuck: boolean;
  hideDirectoryControls: boolean;
  mobileVariant: boolean;
  alwaysShowActions: boolean;
  onToggle: () => void;
  onNewSession: () => void;
  onNewWorktreeSession?: () => void;
  onRenameStart: () => void;
  onClose: () => void;
  sentinelRef: (el: HTMLDivElement | null) => void;
  children?: React.ReactNode;
  showCreateButtons?: boolean;
  hideHeader?: boolean;
  openSidebarMenuKey: string | null;
  setOpenSidebarMenuKey: (key: string | null) => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onRefresh?: () => void;
  serverId?: string;
  serverHealthStatus?: 'healthy' | 'unhealthy' | 'connecting' | null;
  unavailable?: boolean;
}

export type SortableDragHandleProps = {
  listeners: ReturnType<typeof useSortable>['listeners'];
  setActivatorNodeRef: ReturnType<typeof useSortable>['setActivatorNodeRef'];
};

export const SortableProjectItem: React.FC<SortableProjectItemProps> = ({
  id,
  projectLabel,
  projectDescription,
  projectIcon,
  projectColor,
  projectIconImage,
  projectIconBackground,
  isCollapsed,
  isActiveProject,
  isRepo,
  isDesktopShell,
  isStuck,
  hideDirectoryControls,
  onToggle,
  onNewSession,
  onNewWorktreeSession,
  onRenameStart,
  onClose,
  sentinelRef,
  children,
  showCreateButtons = true,
  hideHeader = false,
  mobileVariant,
  openSidebarMenuKey,
  setOpenSidebarMenuKey,
    isPinned,
    onTogglePin,
    onRefresh,
    serverId,
  serverHealthStatus,
  unavailable,
}) => {
  const { t } = useI18n();
  const { currentTheme } = useThemeSystem();
  const sshInstance = useDesktopSshStore((state) => serverId ? state.instances.find((entry) => entry.id === serverId) : undefined);
  const sshStatus = useDesktopSshStore((state) => serverId ? state.statusesById[serverId] : undefined);
  const serverLabel = serverId
    ? (sshInstance ? resolveInstanceLabel(sshInstance) : serverId)
    : undefined;
  const effectiveServerHealthStatus = serverHealthStatus
    || (sshStatus?.phase === 'ready'
      ? 'healthy'
      : sshStatus?.phase === 'error'
        ? 'unhealthy'
        : sshStatus && sshStatus.phase !== 'idle'
          ? 'connecting'
          : null);
  const dotColor = effectiveServerHealthStatus === 'healthy'
    ? currentTheme.colors.status.success
    : effectiveServerHealthStatus === 'unhealthy'
      ? currentTheme.colors.status.error
      : effectiveServerHealthStatus === 'connecting'
        ? currentTheme.colors.status.warning
        : currentTheme.colors.surface.subtle;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const [imageFailed, setImageFailed] = React.useState(false);
  const suppressNextToggleRef = React.useRef(false);
  const menuInstanceKey = `project:${id}`;
  const isMenuOpen = openSidebarMenuKey === menuInstanceKey;
  const [menuPosition, setMenuPosition] = React.useState<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    setImageFailed(false);
  }, [id, projectIconImage?.updatedAt]);

  const projectIconName = projectIcon ? PROJECT_ICON_MAP[projectIcon] : null;
  const iconColor = projectColor ? (PROJECT_COLOR_MAP[projectColor] ?? null) : null;
  const imageUrl = !imageFailed
    ? getProjectIconImageUrl({ id, iconImage: projectIconImage }, {
      themeVariant: currentTheme.metadata.variant,
      iconColor: currentTheme.colors.surface.foreground,
    })
    : null;

  const handleMenuOpenChange = React.useCallback((open: boolean) => {
    setOpenSidebarMenuKey(open ? menuInstanceKey : null);
  }, [menuInstanceKey, setOpenSidebarMenuKey]);

  const handleToggleMouseDown = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button === 2 || (event.button === 0 && event.ctrlKey)) {
      suppressNextToggleRef.current = true;
    }
  }, []);

  const handleToggleClick = React.useCallback(() => {
    if (suppressNextToggleRef.current) {
      suppressNextToggleRef.current = false;
      return;
    }
    onToggle();
  }, [onToggle]);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative', isDragging && 'opacity-30')}
    >
      {!hideHeader ? (
        <>
          {isDesktopShell && (
            <div
              ref={sentinelRef}
              data-project-id={id}
              className="absolute top-0 h-px w-full pointer-events-none"
              aria-hidden="true"
            />
          )}

          <div
            className={cn(
              'w-full text-left group/project select-none',
            )}
            style={{ backgroundColor: isDesktopShell && isStuck ? 'transparent' : undefined }}
            onContextMenu={!mobileVariant ? (e) => {
              e.preventDefault();
              setMenuPosition({ x: e.clientX, y: e.clientY });
              setOpenSidebarMenuKey(menuInstanceKey);
            } : undefined}
          >
            <div className="relative flex items-center gap-1 px-0.5 py-px" {...attributes}>
              <Tooltip>
                <TooltipTrigger asChild>
                    <button
                      type="button"
                      onMouseDown={handleToggleMouseDown}
                      onClick={handleToggleClick}
                      {...listeners}
                      className={cn(
                        'flex-1 min-w-0 flex items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-md cursor-grab active:cursor-grabbing transition-[padding]',
                        isRepo && !hideDirectoryControls && showCreateButtons && Boolean(onNewWorktreeSession) ? 'pr-12' : (showCreateButtons ? 'pr-8' : ''),
                      )}
                    >
                    <span className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                      {imageUrl ? (
                        <span
                          className={cn(
                            'h-3.5 w-3.5 inline-flex items-center justify-center overflow-hidden rounded-[3px]',
                            isCollapsed && 'opacity-40 grayscale',
                          )}
                          style={projectIconBackground ? { backgroundColor: projectIconBackground } : undefined}
                        >
                          <img
                            src={imageUrl}
                            alt=""
                            className="h-full w-full object-contain"
                            draggable={false}
                            onError={() => setImageFailed(true)}
                          />
                        </span>
                      ) : ProjectIcon ? (
                        <ProjectIcon
                          className={cn('h-3.5 w-3.5', isCollapsed && 'text-muted-foreground/40')}
                          style={(!isCollapsed && iconColor) ? { color: iconColor } : undefined}
                        />
                      ) : (
                        isCollapsed ? (
                          <Icon name="folder" className="h-3.5 w-3.5 text-muted-foreground/40"  />
                        ) : (
                          <Icon name="folder-open" className="h-3.5 w-3.5 text-muted-foreground/80"  />
                        )
                      )}
                    </span>
                    <span className={cn(
                      'text-[14px] font-normal truncate lowercase',
                      isActiveProject && isCollapsed ? 'text-[var(--status-warning)]' : isCollapsed ? 'text-muted-foreground' : isActiveProject ? 'text-foreground' : 'text-foreground group-hover/project:text-foreground',
                      unavailable && 'opacity-50',
                    )}>
                      {projectLabel}
                    </span>
                    {serverId && (
                      <span className="inline-flex items-center gap-1 flex-shrink-0">
                        {unavailable ? (
                          <Icon name="error-warning" className="h-2.5 w-2.5 flex-shrink-0" style={{ color: currentTheme.colors.status.warning }}  />
                        ) : (
                          <span
                            className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: dotColor, transition: 'background-color 0.2s' }}
                          />
                        )}
                        {serverId !== 'default' && (
                          <span className="text-[10px] leading-none text-muted-foreground max-w-[80px] truncate">
                            {serverLabel}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {projectDescription}
                </TooltipContent>
              </Tooltip>

              <DropdownMenu
                open={isMenuOpen}
                onOpenChange={handleMenuOpenChange}
              >
                <DropdownMenuTrigger asChild>
                  <div
                    className="fixed w-0 h-0 overflow-hidden"
                    style={menuPosition ? { left: menuPosition.x, top: menuPosition.y } : undefined}
                    aria-hidden="true"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[180px]">
                  {showCreateButtons && !isRepo && !hideDirectoryControls && onNewSession && (
                  <DropdownMenuItem onClick={onNewSession}>
                    <Icon name="add" className="mr-1.5 h-4 w-4"  />
                    {t('sessions.sidebar.project.actions.newSession')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onRenameStart}>
                  <Icon name="pencil-ai" className="mr-1.5 h-4 w-4"  />
                  {t('sessions.sidebar.session.menu.rename')}
                </DropdownMenuItem>
                {onTogglePin ? (
                  <DropdownMenuItem onClick={onTogglePin}>
                    <Icon name="pushpin" className="mr-1.5 h-4 w-4"  />
                    {isPinned ? t('directoryTree.actions.unpinDirectory') : t('directoryTree.actions.pinDirectory')}
                  </DropdownMenuItem>
                ) : null}
                {onRefresh ? (
                  <DropdownMenuItem onClick={onRefresh}>
                    <Icon name="refresh" className="mr-1.5 h-4 w-4"  />
                    {t('sessions.sidebar.project.actions.refresh')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onClick={onClose}
                  className="text-destructive focus:text-destructive"
                >
                  <Icon name="close" className="mr-1.5 h-4 w-4"  />
                  {t('sessions.sidebar.project.actions.closeProject')}
                </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="absolute right-0.5 top-1/2 z-10 flex flex-row-reverse -translate-y-1/2 items-center gap-0.5">
                {showCreateButtons && onNewSession ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNewSession();
                        }}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        aria-label={isRepo
                          ? t('sessions.sidebar.project.actions.newDraftSession')
                          : t('sessions.sidebar.project.actions.newSession')}
                      >
                        <Icon name="chat-new" className="h-3.5 w-3.5"  />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={4}>
                      <p>{isRepo
                        ? t('sessions.sidebar.project.actions.newDraftSession')
                        : t('sessions.sidebar.project.actions.newSession')}</p>
                    </TooltipContent>
                  </Tooltip>
                ) : null}

                {showCreateButtons && isRepo && !hideDirectoryControls && onNewWorktreeSession ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNewWorktreeSession();
                        }}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 hover:text-foreground"
                        aria-label={t('sessions.sidebar.project.actions.newWorktree')}
                      >
                        <Icon name="node-tree" className="h-3.5 w-3.5"  />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={4}>
                      <p>{t('sessions.sidebar.project.actions.newWorktreeEllipsis')}</p>
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {children}
    </div>
  );
};

const SortableGroupItemBase: React.FC<{
  id: string;
  disabled?: boolean;
  children: React.ReactNode | ((dragHandleProps: SortableDragHandleProps) => React.ReactNode);
}> = ({ id, disabled = false, children }) => {
  const {
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const dragHandleProps = React.useMemo<SortableDragHandleProps>(() => ({
    listeners,
    setActivatorNodeRef,
  }), [listeners, setActivatorNodeRef]);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'space-y-0.5 rounded-md',
        isDragging && 'opacity-50',
      )}
    >
      {typeof children === 'function' ? children(dragHandleProps) : children}
    </div>
  );
};

export const SortableGroupItem = React.memo(SortableGroupItemBase);

export const SortableSessionItem: React.FC<{
  id: string;
  children: React.ReactNode;
}> = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(isDragging && 'opacity-30')}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
};
