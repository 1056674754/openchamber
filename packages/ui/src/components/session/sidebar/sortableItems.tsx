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
import { useSessionDisplayStore } from '@/stores/useSessionDisplayStore';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import { useRemoteInstancesStore } from '@/stores/useRemoteInstancesStore';
import { resolveInstanceLabel, type DesktopSshInstanceStatus, type DesktopSshPhase } from '@/lib/desktopSsh';
import { serverRegistry, type ServerConnection } from '@/lib/opencode/server-registry';
import type { RemoteInstanceStatus } from '@/lib/remote-instances/types';

export interface SortableProjectItemProps {
  id: string;
  disabled?: boolean;
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
  onManageWorktrees?: () => void;
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

function readServerRegistrySnapshot(serverId?: string): {
  label?: string;
  baseUrl?: string;
  healthStatus: ServerConnection['healthStatus'];
} {
  if (!serverId) {
    return { healthStatus: null };
  }
  const connection = serverRegistry.get(serverId);
  return {
    label: connection?.config.label,
    baseUrl: connection?.config.baseUrl,
    healthStatus: connection?.healthStatus ?? null,
  };
}

function useServerRegistrySnapshot(serverId?: string) {
  const [snapshot, setSnapshot] = React.useState(() => readServerRegistrySnapshot(serverId));

  React.useEffect(() => {
    setSnapshot(readServerRegistrySnapshot(serverId));
    if (!serverId) return;
    return serverRegistry.onHealthChange(serverId, () => {
      setSnapshot(readServerRegistrySnapshot(serverId));
    });
  }, [serverId]);

  return snapshot;
}

const formatHealthStatus = (
  status: ServerConnection['healthStatus'],
  unavailable: boolean | undefined,
  t: ReturnType<typeof useI18n>['t'],
): string => {
  if (unavailable) return t('common.unavailable');
  if (status === 'healthy') return t('instanceInfoPanel.status.healthy');
  if (status === 'unhealthy') return t('instanceInfoPanel.status.unhealthy');
  if (status === 'connecting') return t('instanceInfoPanel.status.connecting');
  return t('instanceInfoPanel.status.unknown');
};

const sshPhaseLabelKey = (phase?: DesktopSshPhase) => {
  switch (phase) {
    case 'ready':
      return 'instanceInfoPanel.sshPhase.ready';
    case 'error':
      return 'instanceInfoPanel.sshPhase.error';
    case 'degraded':
      return 'instanceInfoPanel.sshPhase.reconnecting';
    case 'config_resolved':
      return 'instanceInfoPanel.sshPhase.resolvingConfig';
    case 'auth_check':
      return 'instanceInfoPanel.sshPhase.checkingAuth';
    case 'master_connecting':
      return 'instanceInfoPanel.sshPhase.connectingSsh';
    case 'remote_probe':
      return 'instanceInfoPanel.sshPhase.probingRemote';
    case 'installing':
      return 'instanceInfoPanel.sshPhase.installing';
    case 'installing_opencode':
      return 'instanceInfoPanel.sshPhase.installingOpenCode';
    case 'updating':
      return 'instanceInfoPanel.sshPhase.updating';
    case 'server_detecting':
      return 'instanceInfoPanel.sshPhase.detectingServer';
    case 'server_starting':
      return 'instanceInfoPanel.sshPhase.startingServer';
    case 'forwarding':
      return 'instanceInfoPanel.sshPhase.forwardingPorts';
    case 'idle':
    default:
      return 'instanceInfoPanel.sshPhase.idle';
  }
};

function ProjectInfoRow({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
      <span className="truncate typography-meta text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right typography-meta text-foreground">{children}</div>
    </div>
  );
}

type DiagnosticTone = 'ok' | 'warn' | 'error' | 'unknown';

type DiagnosticRow = {
  label: string;
  value: string;
  tone: DiagnosticTone;
  detail?: string;
};

const diagnosticDotClass: Record<DiagnosticTone, string> = {
  ok: 'bg-status-success',
  warn: 'bg-status-warning',
  error: 'bg-status-error',
  unknown: 'bg-muted-foreground/40',
};

const isOpenCodeHealthError = (status?: RemoteInstanceStatus): boolean => {
  const text = `${status?.error ?? ''} ${status?.detail ?? ''}`.toLowerCase();
  return text.includes('opencode') || text.includes('open code');
};

const remotePhaseLabel = (
  status: RemoteInstanceStatus | undefined,
  healthStatus: ServerConnection['healthStatus'],
  t: ReturnType<typeof useI18n>['t'],
): string => {
  if (status?.phase === 'connected' || healthStatus === 'healthy') return t('instanceInfoPanel.status.healthy');
  if (status?.phase === 'error' || status?.healthy === false || healthStatus === 'unhealthy') {
    return t('instanceInfoPanel.status.unhealthy');
  }
  if (status?.phase === 'connecting' || healthStatus === 'connecting') return t('instanceInfoPanel.status.connecting');
  return t('instanceInfoPanel.status.unknown');
};

const buildProjectDiagnostics = ({
  sshStatus,
  remoteStatus,
  healthStatus,
  unavailable,
  t,
}: {
  sshStatus?: DesktopSshInstanceStatus;
  remoteStatus?: RemoteInstanceStatus;
  healthStatus: ServerConnection['healthStatus'];
  unavailable?: boolean;
  t: ReturnType<typeof useI18n>['t'];
}): DiagnosticRow[] => {
  const rows: DiagnosticRow[] = [];
  const sshReady = !sshStatus || sshStatus.phase === 'ready' || sshStatus.phase === 'degraded';
  const openCodeError = isOpenCodeHealthError(remoteStatus);
  const remoteStatusDetail = remoteStatus?.error || remoteStatus?.detail;

  if (sshStatus) {
    rows.push({
      label: t('instanceInfoPanel.row.sshStatus'),
      value: t(sshPhaseLabelKey(sshStatus.phase)),
      tone: sshStatus.phase === 'ready'
        ? 'ok'
        : sshStatus.phase === 'error'
          ? 'error'
          : sshStatus.phase === 'idle'
            ? 'unknown'
            : 'warn',
      detail: sshStatus.detail,
    });
  }

  rows.push({
    label: t('settings.remoteInstances.page.section.remoteServer'),
    value: unavailable
      ? t('common.unavailable')
      : !sshReady
        ? t('settings.remoteInstances.page.phase.establishingSsh')
        : openCodeError
          ? t('instanceInfoPanel.status.healthy')
          : remotePhaseLabel(remoteStatus, healthStatus, t),
    tone: unavailable
      ? 'error'
      : !sshReady
        ? 'warn'
        : openCodeError || remoteStatus?.healthy === true || healthStatus === 'healthy'
          ? 'ok'
          : remoteStatus?.healthy === false || healthStatus === 'unhealthy'
            ? 'error'
            : healthStatus === 'connecting'
              ? 'warn'
              : 'unknown',
    detail: !openCodeError ? remoteStatusDetail : undefined,
  });

  rows.push({
    label: t('settings.openchamber.opencodeServer.title'),
    value: unavailable
      ? t('common.unavailable')
      : !sshReady
        ? t('settings.remoteInstances.page.phase.establishingSsh')
        : openCodeError
          ? t('instanceInfoPanel.status.unhealthy')
          : remoteStatus?.healthy === true || healthStatus === 'healthy'
            ? t('instanceInfoPanel.status.healthy')
            : healthStatus === 'connecting'
              ? t('instanceInfoPanel.status.connecting')
              : t('instanceInfoPanel.status.unknown'),
    tone: unavailable
      ? 'error'
      : !sshReady
        ? 'warn'
        : openCodeError
          ? 'error'
          : remoteStatus?.healthy === true || healthStatus === 'healthy'
            ? 'ok'
            : healthStatus === 'connecting'
              ? 'warn'
              : 'unknown',
    detail: openCodeError ? remoteStatusDetail : undefined,
  });

  return rows;
};

function ProjectDiagnosticRow({ row }: { row: DiagnosticRow }) {
  return (
    <ProjectInfoRow label={row.label}>
      <div className="min-w-0">
        <span className="inline-flex min-w-0 items-center justify-end gap-1.5">
          <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', diagnosticDotClass[row.tone])} />
          <span className="truncate">{row.value}</span>
        </span>
        {row.detail ? (
          <div className="truncate text-[11px] leading-snug text-muted-foreground">{row.detail}</div>
        ) : null}
      </div>
    </ProjectInfoRow>
  );
}

function ProjectInfoTooltip({
  projectLabel,
  projectDescription,
  serverId,
  serverLabel,
  serverEndpoint,
  healthStatus,
  dotColor,
  sshStatus,
  remoteStatus,
  unavailable,
}: {
  projectLabel: string;
  projectDescription: string;
  serverId?: string;
  serverLabel?: string;
  serverEndpoint?: string;
  healthStatus: ServerConnection['healthStatus'];
  dotColor: string;
  sshStatus?: DesktopSshInstanceStatus;
  remoteStatus?: RemoteInstanceStatus;
  unavailable?: boolean;
}) {
  const { t } = useI18n();
  const statusLabel = formatHealthStatus(healthStatus, unavailable, t);
  const endpoint = remoteStatus?.url || sshStatus?.localUrl || serverEndpoint;
  const diagnosticRows = serverId
    ? buildProjectDiagnostics({
        sshStatus,
        remoteStatus,
        healthStatus,
        unavailable,
        t,
      })
    : [];

  return (
    <div className="w-[min(320px,calc(100vw-2rem))] space-y-2.5 p-2.5 text-left">
      <div className="min-w-0">
        <div className="truncate typography-ui-label font-medium text-foreground">{projectLabel}</div>
        <div className="mt-0.5 break-all font-mono text-[11px] leading-snug text-muted-foreground">
          {projectDescription}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-border/60 pt-2">
        <ProjectInfoRow label={t('instanceInfoPanel.row.status')}>
          <span className="inline-flex min-w-0 items-center justify-end gap-1.5">
            <span
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: dotColor }}
            />
            <span className="truncate">{statusLabel}</span>
          </span>
        </ProjectInfoRow>

        {serverId ? (
          <ProjectInfoRow label={t('instanceInfoPanel.title')}>
            <div className="min-w-0">
              <div className="truncate">{serverLabel || serverId}</div>
              {serverLabel && serverLabel !== serverId ? (
                <div className="truncate font-mono text-[11px] leading-snug text-muted-foreground">{serverId}</div>
              ) : null}
            </div>
          </ProjectInfoRow>
        ) : null}

        {diagnosticRows.length > 0 ? (
          diagnosticRows.map((row) => <ProjectDiagnosticRow key={row.label} row={row} />)
        ) : null}

        {endpoint ? (
          <ProjectInfoRow label={t('settings.remoteInstances.page.status.currentLocalUrl')}>
            <span className="block truncate font-mono text-[11px] leading-snug">{endpoint}</span>
          </ProjectInfoRow>
        ) : null}
      </div>
    </div>
  );
}

export const SortableProjectItem: React.FC<SortableProjectItemProps> = ({
  id,
  disabled = false,
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
  onManageWorktrees,
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
  const stickyZoneHeaders = useSessionDisplayStore((state) => state.stickyZoneHeaders);
  const registrySnapshot = useServerRegistrySnapshot(serverId);
  const sshInstance = useDesktopSshStore((state) => serverId ? state.instances.find((entry) => entry.id === serverId) : undefined);
  const sshStatus = useDesktopSshStore((state) => serverId ? state.statusesById[serverId] : undefined);
  const remoteStatus = useRemoteInstancesStore((state) => serverId ? state.statuses[serverId] : undefined);
  const serverLabel = serverId
    ? (sshInstance ? resolveInstanceLabel(sshInstance) : registrySnapshot.label ?? serverId)
    : undefined;
  const remoteHealthStatus = remoteStatus?.healthy === true
    ? 'healthy'
    : remoteStatus?.healthy === false
      ? 'unhealthy'
      : null;
  const effectiveServerHealthStatus = remoteHealthStatus
    || registrySnapshot.healthStatus
    || serverHealthStatus
    || (sshStatus?.phase === 'ready'
      ? 'healthy'
      : sshStatus?.phase === 'error'
        ? 'unhealthy'
        : sshStatus && sshStatus.phase !== 'idle'
          ? 'connecting'
          : null);
  const serverEndpoint = remoteStatus?.url || sshStatus?.localUrl || registrySnapshot.baseUrl;
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
  } = useSortable({ id, disabled });

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
              stickyZoneHeaders && 'sticky top-0 z-20 bg-sidebar',
              stickyZoneHeaders && isStuck && 'oc-zone-header-backing shadow-md',
            )}
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
                      ) : projectIconName ? (
                        <Icon
                          name={projectIconName}
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
                <TooltipContent
                  side="right"
                  sideOffset={8}
                  align="start"
                  className="rounded-lg border-border/70 bg-[var(--surface-elevated)] p-0 text-foreground shadow-xl"
                >
                  <ProjectInfoTooltip
                    projectLabel={projectLabel}
                    projectDescription={projectDescription}
                    serverId={serverId}
                    serverLabel={serverLabel}
                    serverEndpoint={serverEndpoint}
                    healthStatus={effectiveServerHealthStatus}
                    dotColor={dotColor}
                    sshStatus={sshStatus}
                    unavailable={unavailable}
                  />
                </TooltipContent>
              </Tooltip>

              <DropdownMenu
                open={isMenuOpen}
                onOpenChange={handleMenuOpenChange}
              >
                <DropdownMenuTrigger asChild nativeButton={false}>
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
                {isRepo && onManageWorktrees ? (
                  <DropdownMenuItem onClick={onManageWorktrees}>
                    <Icon name="node-tree" className="mr-1.5 h-4 w-4" />
                    {t('sessions.sidebar.project.actions.manageWorktrees')}
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
