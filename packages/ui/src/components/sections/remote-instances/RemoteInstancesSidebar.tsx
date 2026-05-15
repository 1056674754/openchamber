import React from 'react';
import { Icon } from "@/components/icon/Icon";
import { useI18n } from '@/lib/i18n';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import { useUIStore } from '@/stores/useUIStore';
import { useShallow } from 'zustand/react/shallow';
import {
  phaseDotClass,
  resolveInstanceLabel,
  type DesktopSshInstance,
} from '@/lib/desktopSsh';
import { SettingsSidebarLayout } from '@/components/sections/shared/SettingsSidebarLayout';
import { SettingsSidebarItem } from '@/components/sections/shared/SettingsSidebarItem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';

type RemoteInstancesSidebarProps = {
  onItemSelect?: () => void;
};

const makeId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ssh-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const randomPort = (): number => {
  return Math.floor(20000 + Math.random() * 30000);
};

const isPortInUseError = (error: unknown): boolean => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('address already in use') || message.includes('eaddrinuse') || message.includes('port already in use');
};

const phaseLabelKey = (phase?: string) => {
  switch (phase) {
    case 'ready':
      return 'settings.remoteInstances.sidebar.phase.ready';
    case 'error':
      return 'settings.remoteInstances.sidebar.phase.error';
    case 'degraded':
      return 'settings.remoteInstances.sidebar.phase.reconnect';
    case 'installing':
      return 'settings.remoteInstances.sidebar.phase.installing';
    case 'updating':
      return 'settings.remoteInstances.sidebar.phase.updating';
    case 'forwarding':
      return 'settings.remoteInstances.sidebar.phase.forwarding';
    case 'server_starting':
      return 'settings.remoteInstances.sidebar.phase.starting';
    case 'master_connecting':
      return 'settings.remoteInstances.sidebar.phase.connecting';
    default:
      return 'settings.remoteInstances.sidebar.phase.idle';
  }
};

export const RemoteInstancesSidebar: React.FC<RemoteInstancesSidebarProps> = ({ onItemSelect }) => {
  const { t } = useI18n();
  const instances = useDesktopSshStore((state) => state.instances);
  const statusesById = useDesktopSshStore(useShallow((state) => state.statusesById));
  const isLoading = useDesktopSshStore((state) => state.isLoading);
  const load = useDesktopSshStore((state) => state.load);
  const loadImports = useDesktopSshStore((state) => state.loadImports);
  const createFromCommand = useDesktopSshStore((state) => state.createFromCommand);
  const connect = useDesktopSshStore((state) => state.connect);
  const disconnect = useDesktopSshStore((state) => state.disconnect);
  const retry = useDesktopSshStore((state) => state.retry);
  const removeInstance = useDesktopSshStore((state) => state.removeInstance);
  const upsertInstance = useDesktopSshStore((state) => state.upsertInstance);

  const selectedId = useUIStore((state) => state.settingsRemoteInstancesSelectedId);
  const setSelectedId = useUIStore((state) => state.setSettingsRemoteInstancesSelectedId);

  React.useEffect(() => {
    void load();
    void loadImports();
  }, [load, loadImports]);

  React.useEffect(() => {
    if (isLoading) return;
    if (instances.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null);
      }
      return;
    }
    if (selectedId && instances.some((instance) => instance.id === selectedId)) {
      return;
    }
    setSelectedId(instances[0].id);
  }, [instances, isLoading, selectedId, setSelectedId]);

  const [searchQuery, setSearchQuery] = React.useState('');

  const filteredInstances = React.useMemo(() => {
    if (!searchQuery.trim()) return instances;
    const q = searchQuery.toLowerCase().trim();
    return instances.filter(
      (i) =>
        resolveInstanceLabel(i).toLowerCase().includes(q) ||
        i.sshCommand.toLowerCase().includes(q),
    );
  }, [instances, searchQuery]);

  const handleAdd = React.useCallback(async () => {
    const id = makeId();
    try {
      await createFromCommand(id, 'ssh user@example.com', t('settings.remoteInstances.sidebar.newSshInstanceName'));
      setSelectedId(id);
      onItemSelect?.();
    } catch (error) {
      toast.error(t('settings.remoteInstances.sidebar.toast.createFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [createFromCommand, onItemSelect, setSelectedId, t]);

  const connectWithPortRecovery = React.useCallback(async (instance: DesktopSshInstance) => {
    try {
      await connect(instance.id);
      return;
    } catch (error) {
      if (!isPortInUseError(error)) {
        throw error;
      }

      const allow = window.confirm(t('settings.remoteInstances.sidebar.confirm.localPortInUseRetry'));
      if (!allow) {
        throw error;
      }

      const nextInstance: DesktopSshInstance = {
        ...instance,
        localForward: {
          ...instance.localForward,
          preferredLocalPort: randomPort(),
        },
      };

      await upsertInstance(nextInstance);
      await connect(nextInstance.id);
      toast.success(t('settings.remoteInstances.sidebar.toast.retriedWithRandomPort'));
    }
  }, [connect, t, upsertInstance]);

  return (
    <SettingsSidebarLayout
      variant="background"
      header={
        <div className="border-b px-3 pt-4 pb-3">
          <h2 className="text-base font-semibold text-foreground mb-3">{t('settings.remoteInstances.sidebar.title')}</h2>
          <div className="flex items-center justify-between gap-2">
            <span className="typography-meta text-muted-foreground">{t('settings.remoteInstances.sidebar.total', { count: instances.length })}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 -my-1 text-muted-foreground"
              onClick={() => void handleAdd()}
              aria-label={t('settings.remoteInstances.sidebar.actions.addSshInstance')}
            >
              <Icon name="add" className="size-4" />
            </Button>
          </div>
          {instances.length > 5 && (
            <div className="mt-2 relative">
              <Icon name="search" className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50"  />
              <Input
                className="h-7 pl-7"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('settings.remoteInstances.sidebar.searchPlaceholder')}
              />
            </div>
          )}
        </div>
      }
    >
      {filteredInstances.map((instance) => {
        const status = statusesById[instance.id];
        const selected = instance.id === selectedId;
        const title = resolveInstanceLabel(instance);
        const metadata = `${t(phaseLabelKey(status?.phase))}${status?.localUrl ? ` · ${status.localUrl}` : ''}`;
        const isReady = status?.phase === 'ready';
        const canRetry = status?.phase === 'error' || status?.phase === 'degraded';

        return (
          <SettingsSidebarItem
            key={instance.id}
            title={title}
            metadata={metadata}
            selected={selected}
            icon={<span className={`h-2 w-2 rounded-full shrink-0 ${phaseDotClass(status?.phase)}`} />}
            onSelect={() => {
              setSelectedId(instance.id);
              onItemSelect?.();
            }}
            actions={[
              {
                label: isReady ? t('settings.remoteInstances.sidebar.actions.disconnect') : t('settings.remoteInstances.sidebar.actions.connect'),
                icon: isReady ? 'stop' : 'plug-2',
                onClick: () => {
                  const op = isReady ? disconnect(instance.id) : connectWithPortRecovery(instance);
                  void op.catch((error) => {
                    toast.error(
                      isReady
                        ? t('settings.remoteInstances.sidebar.toast.disconnectFailed')
                        : t('settings.remoteInstances.sidebar.toast.connectFailed'),
                      {
                      description: error instanceof Error ? error.message : String(error),
                      }
                    );
                  });
                },
              },
              {
                label: t('settings.remoteInstances.sidebar.actions.retry'),
                icon: "refresh",
                onClick: () => {
                  if (!canRetry) return;
                  void retry(instance.id).catch((error) => {
                    toast.error(t('settings.remoteInstances.sidebar.toast.retryFailed'), {
                      description: error instanceof Error ? error.message : String(error),
                    });
                  });
                },
              },
              {
                label: t('settings.remoteInstances.sidebar.actions.remove'),
                icon: "delete-bin",
                destructive: true,
                onClick: () => {
                  void removeInstance(instance.id).then(() => {
                    if (selectedId === instance.id) {
                      const next = instances.find((item) => item.id !== instance.id);
                      setSelectedId(next?.id || null);
                    }
                  }).catch((error) => {
                    toast.error(t('settings.remoteInstances.sidebar.toast.removeFailed'), {
                      description: error instanceof Error ? error.message : String(error),
                    });
                  });
                },
              },
            ]}
          />
        );
      })}
    </SettingsSidebarLayout>
  );
};
