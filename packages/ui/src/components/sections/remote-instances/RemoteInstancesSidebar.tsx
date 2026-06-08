import React from 'react';
import { Icon } from "@/components/icon/Icon";
import { useI18n } from '@/lib/i18n';
import { hasDesktopInvoke } from '@/lib/desktop';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import { useRemoteInstancesStore } from '@/stores/useRemoteInstancesStore';
import { useUIStore } from '@/stores/useUIStore';
import { useShallow } from 'zustand/react/shallow';
import {
  phaseDotClass,
  resolveInstanceLabel,
  type DesktopSshInstance,
} from '@/lib/desktopSsh';
import { resolveRemoteLabel, type RemoteInstance, type RemoteInstancePhase } from '@/lib/remote-instances/types';
import { SettingsSidebarLayout } from '@/components/sections/shared/SettingsSidebarLayout';
import { SettingsSidebarItem } from '@/components/sections/shared/SettingsSidebarItem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';
import { makeWebRemoteDraftSelectionId, parseWebRemoteDraftSelectionId } from './webRemoteDraft';

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

const remotePhaseLabelKey = (phase?: RemoteInstancePhase) => {
  switch (phase) {
    case 'connected':
      return 'settings.remoteInstances.sidebar.phase.ready';
    case 'error':
      return 'settings.remoteInstances.sidebar.phase.error';
    case 'connecting':
      return 'settings.remoteInstances.sidebar.phase.connecting';
    case 'disconnected':
      return 'settings.remoteInstances.sidebar.phase.idle';
    default:
      return 'settings.remoteInstances.sidebar.phase.idle';
  }
};

const remotePhaseDotClass = (phase?: RemoteInstancePhase) => {
  if (phase === 'connected') return 'bg-[var(--status-success)] animate-pulse';
  if (phase === 'error') return 'bg-[var(--status-error)] animate-pulse';
  if (phase === 'connecting') return 'bg-[var(--status-warning)] animate-pulse';
  return 'bg-muted-foreground/40';
};

export const RemoteInstancesSidebar: React.FC<RemoteInstancesSidebarProps> = ({ onItemSelect }) => {
  const { t } = useI18n();
  const isDesktop = hasDesktopInvoke();

  const desktopInstances = useDesktopSshStore((state) => state.instances);
  const desktopStatusesById = useDesktopSshStore(useShallow((state) => state.statusesById));
  const desktopIsLoading = useDesktopSshStore((state) => state.isLoading);
  const desktopLoad = useDesktopSshStore((state) => state.load);
  const desktopLoadImports = useDesktopSshStore((state) => state.loadImports);
  const desktopCreateFromCommand = useDesktopSshStore((state) => state.createFromCommand);
  const desktopConnect = useDesktopSshStore((state) => state.connect);
  const desktopDisconnect = useDesktopSshStore((state) => state.disconnect);
  const desktopRetry = useDesktopSshStore((state) => state.retry);
  const desktopRemoveInstance = useDesktopSshStore((state) => state.removeInstance);
  const desktopUpsertInstance = useDesktopSshStore((state) => state.upsertInstance);

  const webInstances = useRemoteInstancesStore(useShallow((state) => state.instances));
  const webStatuses = useRemoteInstancesStore(useShallow((state) => state.statuses));
  const webLoading = useRemoteInstancesStore((state) => state.loading);
  const webLoad = useRemoteInstancesStore((state) => state.loadInstances);
  const webConnect = useRemoteInstancesStore((state) => state.connect);
  const webDisconnect = useRemoteInstancesStore((state) => state.disconnect);

  const selectedId = useUIStore((state) => state.settingsRemoteInstancesSelectedId);
  const setSelectedId = useUIStore((state) => state.setSettingsRemoteInstancesSelectedId);

  React.useEffect(() => {
    if (isDesktop) {
      void desktopLoad();
      void desktopLoadImports();
    } else {
      void webLoad();
    }
  }, [isDesktop, desktopLoad, desktopLoadImports, webLoad]);

  const isLoading = isDesktop ? desktopIsLoading : webLoading;

  const instances = isDesktop ? desktopInstances : webInstances;

  React.useEffect(() => {
    if (isLoading) return;
    if (!isDesktop && parseWebRemoteDraftSelectionId(selectedId)) return;
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
  }, [instances, isDesktop, isLoading, selectedId, setSelectedId]);

  const [searchQuery, setSearchQuery] = React.useState('');

  const filteredInstances = React.useMemo(() => {
    if (!searchQuery.trim()) return instances;
    const q = searchQuery.toLowerCase().trim();
    if (isDesktop) {
      return (instances as DesktopSshInstance[]).filter(
        (i) =>
          resolveInstanceLabel(i).toLowerCase().includes(q) ||
          i.sshCommand.toLowerCase().includes(q),
      );
    }
    return (instances as RemoteInstance[]).filter(
      (i) =>
        resolveRemoteLabel(i).toLowerCase().includes(q) ||
        (i.url || '').toLowerCase().includes(q),
    );
  }, [instances, searchQuery, isDesktop]);

  const handleAdd = React.useCallback(async () => {
    const id = makeId();
    try {
      if (isDesktop) {
        await desktopCreateFromCommand(id, 'ssh user@example.com', t('settings.remoteInstances.sidebar.newSshInstanceName'));
      } else {
        setSelectedId(makeWebRemoteDraftSelectionId(id));
        onItemSelect?.();
        return;
      }
      setSelectedId(id);
      onItemSelect?.();
    } catch (error) {
      toast.error(t('settings.remoteInstances.sidebar.toast.createFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [isDesktop, desktopCreateFromCommand, onItemSelect, setSelectedId, t]);

  const connectWithPortRecovery = React.useCallback(async (instance: DesktopSshInstance) => {
    try {
      await desktopConnect(instance.id);
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

      await desktopUpsertInstance(nextInstance);
      await desktopConnect(nextInstance.id);
      toast.success(t('settings.remoteInstances.sidebar.toast.retriedWithRandomPort'));
    }
  }, [desktopConnect, t, desktopUpsertInstance]);

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
        if (isDesktop) {
          const sshInstance = instance as DesktopSshInstance;
          const status = desktopStatusesById[sshInstance.id];
          const remoteStatus = webStatuses[sshInstance.id];
          const remoteServiceUnavailable = remoteStatus?.healthy === false;
          const selected = sshInstance.id === selectedId;
          const title = resolveInstanceLabel(sshInstance);
          const effectivePhase = remoteServiceUnavailable ? 'error' : status?.phase;
          const statusLabel = remoteServiceUnavailable
            ? t(remotePhaseLabelKey('error'))
            : t(phaseLabelKey(status?.phase));
          const statusDetail = remoteServiceUnavailable
            ? (remoteStatus.error || remoteStatus.detail || status?.localUrl || '')
            : (status?.localUrl || '');
          const metadata = `${statusLabel}${statusDetail ? ` · ${statusDetail}` : ''}`;
          const isReady = status?.phase === 'ready';
          const canRetry = status?.phase === 'error' || status?.phase === 'degraded';

          return (
            <SettingsSidebarItem
              key={sshInstance.id}
              title={title}
              metadata={metadata}
              selected={selected}
              icon={<span className={`h-2 w-2 rounded-full shrink-0 ${phaseDotClass(effectivePhase)}`} />}
              onSelect={() => {
                setSelectedId(sshInstance.id);
                onItemSelect?.();
              }}
              actions={[
                {
                  label: isReady ? t('settings.remoteInstances.sidebar.actions.disconnect') : t('settings.remoteInstances.sidebar.actions.connect'),
                  icon: isReady ? 'stop' : 'plug-2',
                  onClick: () => {
                    const op = isReady ? desktopDisconnect(sshInstance.id) : connectWithPortRecovery(sshInstance);
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
                    void desktopRetry(sshInstance.id).catch((error) => {
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
                    void desktopRemoveInstance(sshInstance.id).then(() => {
                      if (selectedId === sshInstance.id) {
                        const next = instances.find((item) => item.id !== sshInstance.id);
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
        }

        const webInstance = instance as RemoteInstance;
        const webStatus = webStatuses[webInstance.id];
        const selected = webInstance.id === selectedId;
        const title = resolveRemoteLabel(webInstance);
        const phase = webStatus?.phase;
        const isReady = phase === 'connected';

        return (
          <SettingsSidebarItem
            key={webInstance.id}
            title={title}
            metadata={`${t(remotePhaseLabelKey(phase))}${webInstance.url ? ` · ${webInstance.url}` : ''}`}
            selected={selected}
            icon={<span className={`h-2 w-2 rounded-full shrink-0 ${remotePhaseDotClass(phase)}`} />}
            onSelect={() => {
              setSelectedId(webInstance.id);
              onItemSelect?.();
            }}
            actions={[
              {
                label: isReady ? t('settings.remoteInstances.sidebar.actions.disconnect') : t('settings.remoteInstances.sidebar.actions.connect'),
                icon: isReady ? 'stop' : 'plug-2',
                onClick: () => {
                  const op = isReady ? webDisconnect(webInstance.id) : webConnect(webInstance.id);
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
                label: t('settings.remoteInstances.sidebar.actions.remove'),
                icon: "delete-bin",
                destructive: true,
                onClick: () => {
                  const current = useRemoteInstancesStore.getState().instances;
                  const next = current.filter((i) => i.id !== webInstance.id);
                  void useRemoteInstancesStore.getState().saveInstances(next).then(() => {
                    if (selectedId === webInstance.id) {
                      const nextItem = next[0];
                      setSelectedId(nextItem?.id || null);
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
