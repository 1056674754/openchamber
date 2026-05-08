import React from 'react';
import { RiFolderLine, RiArchiveLine } from '@remixicon/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export type TempSessionEntry = {
  path: string;
  topic: string;
  date: string;
  createdAt: number;
  sessionId?: string;
  sessionDirectory?: string;
};

type Props = {
  tempSessions: TempSessionEntry[];
  currentSessionDirectory: string | null;
  onSelectTempSession: (session: TempSessionEntry) => void;
  onArchiveTempSession: (path: string) => void;
  onCreateTempSession: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  isSubmitting?: boolean;
};

export function TempSessionsSection(props: Props): React.ReactNode {
  const { t } = useI18n();
  const {
    tempSessions,
    currentSessionDirectory,
    onSelectTempSession,
    onArchiveTempSession,
    onCreateTempSession,
    collapsed = false,
    onToggleCollapse,
    isSubmitting = false,
  } = props;

  const [confirmingArchive, setConfirmingArchive] = React.useState<string | null>(null);
  const [contextMenu, setContextMenu] = React.useState<{ path: string; x: number; y: number } | null>(null);

  if (tempSessions.length === 0 && !isSubmitting) {
    return (
      <div className="px-2.5 py-2">
        <button
          type="button"
          onClick={onCreateTempSession}
          className="flex w-full items-center gap-1.5 rounded-md px-0.5 py-0.5 text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground"
        >
          <RiFolderLine className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/80" />
          <span className="text-[14px] font-normal lowercase">{t('sessions.sidebar.tempSession.empty')}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-2.5 py-1">
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex w-full items-center justify-between rounded-md px-0.5 py-0.5 transition-colors hover:bg-interactive-hover"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-normal text-foreground/95">{t('sessions.sidebar.tempSession.title')}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCreateTempSession();
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            aria-label={t('sessions.sidebar.tempSession.createNew')}
          >
            <span className="text-xs">+</span>
          </button>
        </div>
      </button>

      {!collapsed && (
        <div className="mt-0.5 space-y-0.5">
          {isSubmitting && (
            <div className="flex items-center gap-1.5 rounded-sm px-0.5 py-1 text-muted-foreground">
              <span className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                <RiFolderLine className="h-3.5 w-3.5 animate-pulse text-muted-foreground/60" />
              </span>
              <span className="truncate text-[14px] font-normal italic">{t('sessions.sidebar.tempSession.creating')}</span>
            </div>
          )}
          {tempSessions.map((session) => {
            const isActive = currentSessionDirectory === session.path;
            const isConfirming = confirmingArchive === session.path;
            const isOrphaned = !session.sessionId;
            return (
              <div
                key={session.path}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ path: session.path, x: event.clientX, y: event.clientY });
                }}
                className={cn(
                  'group relative flex items-center justify-between rounded-sm px-0.5 py-1 transition-colors',
                  isActive
                    ? 'bg-interactive-hover text-foreground'
                    : 'text-foreground hover:bg-interactive-hover',
                  isOrphaned ? 'text-muted-foreground/70' : null,
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectTempSession(session)}
                  className="flex flex-1 items-center gap-1.5 overflow-hidden text-left"
                >
                  <span className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                    <RiFolderLine className="h-3.5 w-3.5 text-muted-foreground/80" />
                  </span>
                  <span className="truncate text-[14px] font-normal lowercase">{session.topic}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isConfirming) {
                      onArchiveTempSession(session.path);
                      setConfirmingArchive(null);
                    } else {
                      setConfirmingArchive(session.path);
                    }
                  }}
                  className={cn(
                    'inline-flex flex-shrink-0 items-center justify-center rounded transition-opacity',
                    isConfirming
                      ? 'text-[11px] font-medium text-destructive hover:text-destructive/80'
                      : 'h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground',
                  )}
                  aria-label={isConfirming ? t('sessions.sidebar.tempSession.confirmArchive') : t('sessions.sidebar.tempSession.archive')}
                >
                  {isConfirming ? (
                    t('sessions.sidebar.tempSession.confirm')
                  ) : (
                    <RiArchiveLine className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <DropdownMenu open={Boolean(contextMenu)} onOpenChange={(open) => { if (!open) setContextMenu(null); }}>
        <DropdownMenuTrigger asChild>
          <div
            className="fixed h-0 w-0 overflow-hidden"
            style={contextMenu ? { left: contextMenu.x, top: contextMenu.y } : undefined}
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[160px]">
          <DropdownMenuItem
            className="[&>svg]:mr-1 text-destructive focus:text-destructive"
            onClick={() => {
              if (!contextMenu) return;
              onArchiveTempSession(contextMenu.path);
              setContextMenu(null);
            }}
          >
            <RiArchiveLine className="mr-1 h-4 w-4" />
            {t('sessions.sidebar.tempSession.archive')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
