/**
 * StatusCard — KPI tiles + phase checklist + local endpoint for a remote instance.
 */

import { cn } from '@/lib/utils';
import { Icon } from '@/components/icon/Icon';
import type { DesktopSshPhase } from '@/lib/desktopSsh';
import { phaseDotClass } from '@/lib/desktopSsh';
import type { KpiTileProps, PhaseChecklistProps, StatusCardProps } from './types';

// ─── KPI Tile ──────────────────────────────────────────────────────────────

const kpiVariantDotClass: Record<KpiTileProps['variant'], string> = {
  success: 'bg-[var(--status-success)]',
  error: 'bg-[var(--status-error)]',
  warning: 'bg-[var(--status-warning)]',
  muted: 'bg-muted-foreground/40',
  info: 'bg-[var(--status-info)]',
};

function KpiTile({ icon, label, value, variant, animate }: KpiTileProps) {
  const dotColor = kpiVariantDotClass[variant] ?? 'bg-muted-foreground/40';
  return (
    <div
      className="flex flex-1 flex-col items-start gap-1 rounded-md border border-border/40 bg-[var(--surface-elevated)] px-3 py-2"
      role="status"
      aria-label={label}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn('h-2 w-2 rounded-full', dotColor, animate && 'animate-pulse')} />
        <span className="typography-meta text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Icon name={icon} className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="typography-ui-label font-medium text-foreground tabular-nums">{value}</span>
      </div>
    </div>
  );
}

// ─── Phase Checklist ───────────────────────────────────────────────────────

function PhaseChecklist({ steps, connecting }: PhaseChecklistProps) {
  if (!connecting || steps.length === 0) return null;

  return (
    <div className="space-y-0.5" role="list" aria-label="Connection phases">
      {steps.map((step) => (
        <div
          key={step.key}
          className="flex items-center gap-2 py-1"
          role="listitem"
        >
          {step.completed ? (
            <Icon name="check" className="h-3.5 w-3.5 text-[var(--status-success)] shrink-0" />
          ) : step.current ? (
            <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin text-[var(--status-warning)] shrink-0" />
          ) : (
            <span className="h-3.5 w-3.5 rounded-full border border-border/40 shrink-0" />
          )}
          <span
            className={cn(
              'typography-meta',
              step.completed
                ? 'text-foreground'
                : step.current
                  ? 'text-foreground'
                  : 'text-muted-foreground/50',
            )}
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Progress Bar ──────────────────────────────────────────────────────────

function ProgressBar({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--interactive-border)]/30" role="progressbar" aria-label="Connection progress">
      <div className="h-full animate-pulse rounded-full bg-[var(--status-warning)]/70" style={{ width: '60%' }} />
    </div>
  );
}

// ─── StatusCard ────────────────────────────────────────────────────────────

export function StatusCard({
  phase,
  isReady,
  isConnecting,
  isError,
  isReconnecting,
  isRestarting,
  isDegraded,
  statusLabel,
  statusDetail,
  localUrl,
  latencyMs,
  uptimeMs,
  remoteServiceUnavailable,
  phaseSteps,
  onCopyEndpoint,
  onOpenEndpoint,
  isDesktop,
}: StatusCardProps) {
  const uptimeSec = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(uptimeSec / 60);
  const seconds = uptimeSec % 60;
  const uptimeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const showProgress = isConnecting || isReconnecting || isRestarting;

  let kpiVariant: KpiTileProps['variant'] = 'muted';
  if (isReady) kpiVariant = 'success';
  else if (isError || remoteServiceUnavailable) kpiVariant = 'error';
  else if (isDegraded) kpiVariant = 'warning';
  else if (isConnecting || isReconnecting) kpiVariant = 'warning';

  // Narrow phase for phaseDotClass (DesktopSshPhase only)
  const desktopPhase = phase as DesktopSshPhase | undefined;

  return (
    <div className="rounded-lg border border-border/60 bg-[var(--surface-elevated)] p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className={cn('h-2.5 w-2.5 rounded-full', phaseDotClass(desktopPhase))} />
        <h3 className="typography-ui-header font-medium text-foreground">Status</h3>
      </div>

      {/* KPI Tiles */}
      <div className="flex flex-wrap gap-2">
        <KpiTile
          icon="checkbox-blank-circle-fill"
          label="State"
          value={statusLabel}
          variant={kpiVariant}
          animate={isConnecting || isReconnecting}
        />
        <KpiTile
          icon="time"
          label="Uptime"
          value={uptimeStr}
          variant={isReady ? 'success' : 'muted'}
        />
        {latencyMs !== undefined && (
          <KpiTile
            icon="pulse"
            label="Latency"
            value={latencyMs < 1000 ? `${latencyMs}ms` : `${(latencyMs / 1000).toFixed(1)}s`}
            variant={latencyMs < 500 ? 'success' : latencyMs < 2000 ? 'warning' : 'error'}
          />
        )}
      </div>

      {/* Progress Bar */}
      <ProgressBar visible={showProgress} />

      {/* Phase Checklist */}
      <PhaseChecklist steps={phaseSteps} connecting={showProgress} />

      {/* Detail */}
      {statusDetail && (
        <p className="typography-meta text-muted-foreground">{statusDetail}</p>
      )}

      {/* Local Endpoint */}
      {localUrl && isDesktop && (
        <div className="space-y-1">
          <span className="typography-meta text-muted-foreground">Local Endpoint</span>
          <div className="flex items-center gap-2">
            <code className="typography-code flex-1 truncate rounded-md bg-[var(--surface-muted)] px-2 py-1 text-foreground">
              {localUrl}
            </code>
            <button
              type="button"
              onClick={onCopyEndpoint}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-[var(--surface-elevated)] text-muted-foreground hover:bg-[var(--interactive-hover)] hover:text-foreground"
              aria-label="Copy endpoint URL"
              title="Copy"
            >
              <Icon name="file-copy" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onOpenEndpoint}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-[var(--surface-elevated)] text-muted-foreground hover:bg-[var(--interactive-hover)] hover:text-foreground"
              aria-label="Open endpoint in browser"
              title="Open"
            >
              <Icon name="external-link" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
