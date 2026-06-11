import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import {
  resolveInstanceLabel,
  type DesktopSshInstance,
  type DesktopSshInstanceStatus,
} from '@/lib/desktopSsh';

export type RemoteConnectionsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function statusLabel(phase: string | undefined, t: ReturnType<typeof useI18n>['t']): string {
  switch (phase) {
    case 'ready':
      return t('settings.instance.selector.status.connected');
    case 'master_connecting':
    case 'installing':
    case 'installing_opencode':
    case 'updating':
    case 'server_detecting':
    case 'server_starting':
    case 'forwarding':
      return t('settings.instance.selector.status.connecting');
    case 'error':
      return t('settings.instance.selector.status.error');
    default:
      return t('settings.instance.selector.status.disconnected');
  }
}

function statusDot(phase: string | undefined): string {
  switch (phase) {
    case 'ready':
      return 'var(--status-success)';
    case 'config_resolved':
    case 'auth_check':
    case 'master_connecting':
    case 'remote_probe':
    case 'installing':
    case 'installing_opencode':
    case 'updating':
    case 'server_detecting':
    case 'server_starting':
    case 'forwarding':
      return 'var(--status-warning)';
    case 'error':
      return 'var(--status-error)';
    default:
      return 'var(--surface-mutedForeground)';
  }
}

export function RemoteConnectionsModal({ open, onOpenChange }: RemoteConnectionsModalProps) {
  const { t } = useI18n();
  const sshStore = useDesktopSshStore();

  const instances = sshStore.instances;
  const statusesById = sshStore.statusesById;

  const [sshCommand, setSshCommand] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleAdd = async () => {
    if (!sshCommand.trim()) return;
    setAdding(true);
    try {
      const id = `ssh-${Date.now().toString(36)}`;
      await sshStore.createFromCommand(id, sshCommand.trim(), label.trim() || undefined);
      setSshCommand('');
      setLabel('');
    } finally {
      setAdding(false);
    }
  };

  const handleTest = async () => {
    if (!sshCommand.trim()) return;
    setTesting(true);
    try {
      const id = `test-${Date.now().toString(36)}`;
      await sshStore.createFromCommand(id, sshCommand.trim(), label.trim() || undefined);
      await sshStore.connect(id);
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = (id: string) => {
    void sshStore.connect(id);
  };

  const handleDisconnect = (id: string) => {
    void sshStore.disconnect(id);
  };

  const handleRemove = (id: string) => {
    void sshStore.removeInstance(id);
  };

  const handleRetry = (id: string) => {
    void sshStore.retry(id);
  };

  const getStatus = (id: string): DesktopSshInstanceStatus | null => {
    return statusesById[id] ?? null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[calc(100vw-48px)] max-h-[calc(100vh-48px)] w-[720px]"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>{t('settings.remoteConnections.title')}</DialogTitle>
          <DialogDescription>
            {t('settings.instance.selector.manageConnections')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 min-h-0">
          {/* Connection list */}
          <div className="flex flex-col gap-1 min-h-0">
            {instances.length === 0 ? (
              <div className="py-8 text-center typography-ui text-muted-foreground">
                {t('settings.remoteConnections.empty')}
              </div>
            ) : (
              instances.map((inst: DesktopSshInstance) => {
                const status = getStatus(inst.id);
                const phase = status?.phase;
                return (
                  <div
                    key={inst.id}
                    className="flex items-center gap-3 rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-3 py-2.5"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: statusDot(phase) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="typography-ui-label text-foreground truncate">
                        {resolveInstanceLabel(inst)}
                      </div>
                      <div className="typography-micro text-muted-foreground">
                        {statusLabel(phase, t)}
                        {status?.detail ? ` · ${status.detail}` : ''}
                        {inst.sshCommand ? ` · ${inst.sshCommand}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {phase === 'ready' ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleDisconnect(inst.id)}
                        >
                          {t('settings.remoteConnections.action.disconnect')}
                        </Button>
                      ) : phase === 'error' ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleRetry(inst.id)}
                        >
                          {t('settings.remoteConnections.action.retry')}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleConnect(inst.id)}
                        >
                          {t('settings.remoteConnections.action.connect')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-[var(--status-error)] hover:text-[var(--status-error)]"
                        onClick={() => handleRemove(inst.id)}
                      >
                        <Icon name="delete-bin" className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Add connection */}
          <div className="border-t border-[var(--interactive-border)] pt-4">
            <div className="typography-ui-label font-medium text-foreground mb-2">
              {t('settings.remoteConnections.addSection')}
            </div>
            <div className="flex flex-col gap-2">
              <Input
                className="h-8"
                placeholder={t('settings.remoteConnections.field.sshCommandPlaceholder')}
                value={sshCommand}
                onChange={(e) => setSshCommand(e.target.value)}
                aria-label={t('settings.remoteConnections.field.sshCommand')}
              />
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 flex-1"
                  placeholder={t('settings.remoteConnections.field.labelPlaceholder')}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  aria-label={t('settings.remoteConnections.field.label')}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!sshCommand.trim() || testing}
                  onClick={handleTest}
                >
                  {testing ? (
                    <Icon name="loader-4" className="h-4 w-4 animate-spin" />
                  ) : (
                    t('settings.remoteConnections.action.test')
                  )}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={!sshCommand.trim() || adding}
                  onClick={handleAdd}
                >
                  {adding ? (
                    <Icon name="loader-4" className="h-4 w-4 animate-spin" />
                  ) : (
                    t('settings.remoteConnections.action.add')
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
