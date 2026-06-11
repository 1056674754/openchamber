/**
 * ConnectionCard — Connect/Disconnect/Retry/Test/Restart action buttons + log toggle.
 * All actions in a single row.
 */

import { cn } from '@/lib/utils';
import { Icon } from '@/components/icon/Icon';
import type { ConnectionCardProps } from './types';

export function ConnectionCard({
  isReady,
  isConnecting,
  isReconnecting,
  isRestarting,
  reconnectAppearsStuck,
  canRetry,
  isPrimaryActionPending,
  isRetryPending,
  isRestartPending,
  isTesting,
  primaryButtonLabel,
  retryButtonLabel,
  logDialogOpen: _logDialogOpen,
  onConnect,
  onDisconnect,
  onRetry,
  onRestart,
  onTestConnection,
  onOpenLogs,
  onCloseLogs: _onCloseLogs,
}: ConnectionCardProps) {
  void _logDialogOpen;
  void _onCloseLogs;
  const primaryDisabled = isPrimaryActionPending || isRestarting;
  const secondaryDisabled = isPrimaryActionPending || isRestarting;

  return (
    <div className="rounded-lg border border-border/60 bg-[var(--surface-elevated)] p-4 space-y-3">
      <h3 className="typography-ui-header font-medium text-foreground">Connection</h3>

      {/* All actions in one row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Connect / Disconnect */}
        <button
          type="button"
          onClick={isReady ? onDisconnect : onConnect}
          disabled={primaryDisabled}
          className={cn(
            'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] px-2 typography-micro font-medium select-none transition-[background-color,border-color,color,opacity] duration-150 ease-out outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50',
            isReady
              ? 'bg-[color-mix(in_srgb,var(--status-error)_7%,var(--background))] text-[var(--status-error)] border border-[color-mix(in_srgb,var(--status-error)_9%,transparent)] hover:bg-[color-mix(in_srgb,var(--status-error)_11%,var(--background))]'
              : 'bg-[color-mix(in_srgb,var(--primary-base)_10%,var(--background))] text-[var(--primary-base)] border border-[color-mix(in_srgb,var(--primary-base)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--primary-base)_16%,var(--background))]',
          )}
          aria-label={primaryButtonLabel}
        >
          {(isConnecting || isReconnecting) && (
            <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin" />
          )}
          {!isConnecting && !isReconnecting && (
            <Icon name={isReady ? 'stop' : 'play'} className="h-3.5 w-3.5" />
          )}
          {primaryButtonLabel}
        </button>

        {/* Retry */}
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={secondaryDisabled || isRetryPending}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] border border-border/60 bg-[var(--surface-elevated)] px-2 typography-micro font-medium text-foreground transition-[background-color,border-color,color,opacity] duration-150 ease-out outline-none hover:bg-[var(--interactive-hover)] hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
            aria-label={retryButtonLabel}
          >
            {isRetryPending ? (
              <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Icon name="refresh" className="h-3.5 w-3.5" />
            )}
            {retryButtonLabel}
          </button>
        )}

        {/* Restart */}
        <button
          type="button"
          onClick={onRestart}
          disabled={secondaryDisabled || isRestartPending}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] border border-border/60 bg-[var(--surface-elevated)] px-2 typography-micro font-medium text-foreground transition-[background-color,border-color,color,opacity] duration-150 ease-out outline-none hover:bg-[var(--interactive-hover)] hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
          aria-label="Restart"
        >
          {isRestartPending ? (
            <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Icon name="restart" className="h-3.5 w-3.5" />
          )}
          Restart
        </button>

        {/* Test Connection */}
        <button
          type="button"
          onClick={onTestConnection}
          disabled={secondaryDisabled || isTesting || isReady}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] border border-border/60 bg-[var(--surface-elevated)] px-2 typography-micro font-medium text-foreground transition-[background-color,border-color,color,opacity] duration-150 ease-out outline-none hover:bg-[var(--interactive-hover)] hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
          aria-label="Test Connection"
        >
          {isTesting ? (
            <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Icon name="eye" className="h-3.5 w-3.5" />
          )}
          Test Connection
        </button>

        {/* View Logs opens a dialog */}
        <button
          type="button"
          onClick={onOpenLogs}
          disabled={secondaryDisabled}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] border border-border/60 bg-[var(--surface-elevated)] px-2 typography-micro font-medium text-foreground transition-[background-color,border-color,color,opacity] duration-150 ease-out outline-none hover:bg-[var(--interactive-hover)] hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
          aria-label="View Logs"
        >
          <Icon name="terminal-box" className="h-3.5 w-3.5" />
          View Logs
        </button>
      </div>

      {/* Stuck reconnect hint */}
      {reconnectAppearsStuck && (
        <p className="typography-meta text-[var(--status-warning)]">
          Reconnect appears stuck — try Restart or Retry.
        </p>
      )}
    </div>
  );
}
