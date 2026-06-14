import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useState } from 'react';
import type { DesktopSshInstanceStatus } from '@/lib/desktopSsh';
import { useInstanceContextStore } from '@/stores/useInstanceContextStore';

function statusLabel(phase: string | undefined): string {
  switch (phase) {
    case 'ready': return 'Connected';
    case 'error': return 'Error';
    case 'idle': return 'Disconnected';
    default: return 'Connecting';
  }
}

function statusDot(phase: string | undefined): string {
  switch (phase) {
    case 'ready': return 'var(--status-success)';
    case 'error': return 'var(--status-error)';
    case 'idle': return 'var(--surface-mutedForeground)';
    default: return 'var(--status-warning)';
  }
}

export function RemoteConnectionPage() {
  const { t } = useI18n();
  const store = useDesktopSshStore();
  const currentInstance = useInstanceContextStore((s) => s.currentInstance);
  const selectedRemoteId = currentInstance?.type === 'remote' ? currentInstance.id : null;
  const instances = selectedRemoteId
    ? store.instances.filter((inst) => inst.id === selectedRemoteId)
    : store.instances;
  const statusesById = store.statusesById;
  const isRestarting = store.isRestarting;

  const [logOpen, setLogOpen] = useState(false);
  const [logId, setLogId] = useState<string | null>(null);

  if (instances.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="typography-ui-header font-semibold text-foreground mb-2">
            {t('settings.page.remoteConnection.title')}
          </div>
          <p className="typography-ui text-muted-foreground">
            {selectedRemoteId
              ? 'The selected remote connection is not configured.'
              : 'No remote connections configured. Add one from the Remote Instances page.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <h1 className="typography-ui-header font-semibold text-foreground">
          {t('settings.page.remoteConnection.title')}
        </h1>

        {instances.map((inst) => {
          const status: DesktopSshInstanceStatus | null = statusesById[inst.id] ?? null;
          const phase = status?.phase;

          return (
            <div
              key={inst.id}
              className="rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-4"
            >
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: statusDot(phase) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="typography-ui-label text-foreground truncate">
                    {inst.nickname || inst.sshCommand}
                  </div>
                  <div className="typography-micro text-muted-foreground">
                    {statusLabel(phase)}
                    {status?.detail ? ` · ${status.detail}` : ''}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {phase === 'ready' ? (
                  <Button variant="outline" size="xs" onClick={() => store.disconnect(inst.id)}>
                    Disconnect
                  </Button>
                ) : (
                  <Button variant="default" size="xs" onClick={() => store.connect(inst.id)}>
                    Connect
                  </Button>
                )}
                {phase === 'error' && (
                  <Button variant="ghost" size="xs" onClick={() => store.retry(inst.id)}>
                    Retry
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={isRestarting}
                  onClick={() => store.restart(inst.id)}
                >
                  <Icon name="restart" className="h-3.5 w-3.5 mr-1" />
                  Restart
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setLogId(inst.id);
                    setLogOpen(true);
                  }}
                >
                  <Icon name="file" className="h-3.5 w-3.5 mr-1" />
                  Logs
                </Button>
              </div>
            </div>
          );
        })}

        <Dialog open={logOpen} onOpenChange={setLogOpen}>
          <DialogContent showCloseButton>
            <DialogHeader>
              <DialogTitle>Connection Logs</DialogTitle>
            </DialogHeader>
            <div className="min-h-[300px] max-h-[50vh] overflow-y-auto rounded-lg bg-[var(--surface-muted)] p-3 font-mono text-xs">
              <span className="text-muted-foreground">
                {statusesById[logId ?? '']?.detail ?? 'No log data available.'}
              </span>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
