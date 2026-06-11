import { useI18n } from '@/lib/i18n';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import type { DesktopSshPortForward } from '@/lib/desktopSsh';

function portLabel(fwd: DesktopSshPortForward): string {
  const parts: string[] = [];
  if (fwd.localPort) parts.push(`localhost:${fwd.localPort}`);
  if (fwd.remoteHost) parts.push(fwd.remoteHost);
  if (fwd.remotePort) parts.push(`${fwd.remotePort}`);
  return parts.join(' → ') || '—';
}

export function RemotePortForwardingPage() {
  const { t } = useI18n();
  const store = useDesktopSshStore();
  const instances = store.instances;

  const allForwards: { instanceId: string; label: string; fwd: DesktopSshPortForward }[] = [];
  for (const inst of instances) {
    for (const fwd of inst.portForwards ?? []) {
      allForwards.push({ instanceId: inst.id, label: inst.nickname || inst.sshCommand, fwd });
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <h1 className="typography-ui-header font-semibold text-foreground">
          {t('settings.page.remotePortForwarding.title')}
        </h1>

        {allForwards.length === 0 ? (
          <p className="typography-ui text-muted-foreground py-4">
            No port forwards configured.
          </p>
        ) : (
          <div className="space-y-2">
            {allForwards.map((entry, i) => (
              <div
                key={`${entry.instanceId}-${i}`}
                className="flex items-center gap-3 rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-3 py-2.5"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: entry.fwd.enabled ? 'var(--status-success)' : 'var(--surface-mutedForeground)' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="typography-ui-label text-foreground text-sm">{portLabel(entry.fwd)}</div>
                  <div className="typography-micro text-muted-foreground">
                    {entry.label} · {entry.fwd.type}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className="typography-micro px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: entry.fwd.enabled ? 'var(--status-successBackground)' : 'var(--surface-muted)',
                      color: entry.fwd.enabled ? 'var(--status-successForeground)' : 'var(--surface-mutedForeground)',
                    }}
                  >
                    {entry.fwd.enabled ? 'active' : 'disabled'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
