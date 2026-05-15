import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Icon } from "@/components/icon/Icon";
import {
  RiAddLine,
  RiCheckLine,
  RiCloudOffLine,
  RiEarthLine,
  RiLoader4Line,
  RiMore2Line,
  RiPencilLine,
  RiPlug2Line,
  RiRefreshLine,
  RiServerLine,
  RiSettings3Line,
  RiShieldKeyholeLine,
  RiDeleteBinLine,
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {tauriAvailable && editingId && editingId !== LOCAL_HOST_ID && (
          <div className="flex-shrink-0 rounded-lg border border-border/50 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="typography-ui-label font-medium text-foreground">{t('desktopHostSwitcher.edit.title')}</div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={isSaving}>
                  {t('desktopHostSwitcher.actions.cancel')}
                </Button>
                <Button type="button" size="sm" onClick={() => void commitEdit()} disabled={isSaving}>
                  {isSaving ? <Icon name="loader-4" className="h-4 w-4 animate-spin" /> : null}
                  {t('desktopHostSwitcher.actions.save')}
                </Button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                onKeyDown={stopDropdownTypeahead}
                placeholder={t('desktopHostSwitcher.field.labelPlaceholder')}
                disabled={isSaving}
              />
              <Input
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                onKeyDown={stopDropdownTypeahead}
                placeholder={t('desktopHostSwitcher.field.urlPlaceholder')}
                disabled={isSaving}
              />
            </div>
          </div>
        )}

        {embedded && !isAddFormOpen ? (
          <div className="flex-shrink-0 border-t border-[var(--interactive-border)]">
            <button
              type="button"
              className="w-full flex items-center gap-2 px-2 py-2 text-left text-muted-foreground hover:text-foreground hover:bg-interactive-hover/30 transition-colors"
              onClick={() => setIsAddFormOpen(true)}
              disabled={!tauriAvailable || isSaving}
            >
              <Icon name="add" className="h-4 w-4" />
              <span className="typography-ui-label">{t('desktopHostSwitcher.actions.addInstance')}</span>
            </button>
          </div>
        ) : (
          <div className={cn(
            'flex-shrink-0',
            embedded
              ? 'border-t border-[var(--interactive-border)] px-2 py-2'
              : 'rounded-md border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-2.5'
          )}>
            <div className="flex items-center justify-between gap-2">
              <div className="typography-ui-label font-medium text-foreground">{t('desktopHostSwitcher.add.title')}</div>
              <div className="flex items-center gap-2">
                {embedded && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAddFormOpen(false)}
                    disabled={isSaving}
                  >
                    {t('desktopHostSwitcher.actions.cancel')}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void addHost()}
                  disabled={!tauriAvailable || isSaving || !newUrl.trim()}
                >
                  {isSaving ? <Icon name="loader-4" className="h-4 w-4 animate-spin" /> : null}
                  {t('desktopHostSwitcher.actions.add')}
                </Button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={stopDropdownTypeahead}
                placeholder={t('desktopHostSwitcher.field.labelOptionalPlaceholder')}
                disabled={!tauriAvailable || isSaving}
              />
              <Input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={stopDropdownTypeahead}
                placeholder={t('desktopHostSwitcher.field.urlPlaceholder')}
                disabled={!tauriAvailable || isSaving}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="flex-shrink-0 typography-meta text-status-error">{error}</div>
        )}
    </>
  );

  const sshSwitchDialog = (
    <Dialog
      open={sshSwitchModal.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && switchingHostId) {
          void cancelSshSwitch();
          return;
        }
        setSshSwitchModal((prev) => ({
          ...prev,
          open: nextOpen,
          ...(nextOpen ? {} : { hostId: null, error: null, detail: null, phase: 'idle' as const }),
        }));
      }}
    >
      <DialogContent className="w-[min(28rem,calc(100vw-2rem))] max-w-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="loader-4" className={cn('h-4 w-4', !sshSwitchModal.error && 'animate-spin')} />
            {t('desktopHostSwitcher.ssh.connectingTo', { host: sshSwitchModal.hostLabel || t('desktopHostSwitcher.ssh.instanceFallback') })}
          </DialogTitle>
          <DialogDescription>
            {sshSwitchModal.error
              ? sshSwitchModal.error
              : sshSwitchModal.detail || t(sshPhaseLabelKey(sshSwitchModal.phase))}
          </DialogDescription>
        </DialogHeader>
        {sshSwitchModal.error ? (
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={switchToLocal}
            >
              {t('desktopHostSwitcher.actions.switchToLocal')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={retrySshSwitch}
              disabled={!sshSwitchModal.hostId}
            >
              {t('desktopHostSwitcher.actions.retry')}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );

  if (embedded) {
    return (
      <>
        <div className="w-full max-h-[70vh] flex flex-col overflow-hidden gap-2">
          {content}
        </div>
        {sshSwitchDialog}
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(42rem,calc(100vw-2rem))] max-w-none max-h-[70vh] flex flex-col overflow-hidden gap-3">
          {content}
        </DialogContent>
      </Dialog>
      {sshSwitchDialog}
    </>
  );
}

type DesktopHostSwitcherButtonProps = {
  headerIconButtonClass: string;
};

export function DesktopHostSwitcherButton({ headerIconButtonClass }: DesktopHostSwitcherButtonProps) {
  const { t } = useI18n();
  const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState('Local');
  const [status, setStatus] = React.useState<HostProbeResult['status'] | null>(null);
  const attemptedDefaultSshConnectRef = React.useRef(false);
  const [startupSshModal, setStartupSshModal] = React.useState<{
    open: boolean;
    hostId: string | null;
    hostLabel: string;
    error: string | null;
    connecting: boolean;
  }>({
    open: false,
    hostId: null,
    hostLabel: '',
    error: null,
    connecting: false,
  });

  const connectDefaultSshInstance = React.useCallback(async (
    hostId: string,
    hostLabel: string,
    options?: { showProgress?: boolean },
  ): Promise<boolean> => {
    const showProgress = Boolean(options?.showProgress);
    if (showProgress) {
      setStartupSshModal({
        open: true,
        hostId,
        hostLabel,
        error: null,
        connecting: true,
      });
    }

    try {
      await desktopSshConnect(hostId);
      const ready = await waitForSshReady(hostId, 45_000, () => {});
      const localUrl = normalizeHostUrl(ready.localUrl || '');
      if (!localUrl) {
        throw new Error('Connected but missing forwarded URL');
      }
      serverRegistry.register({ id: hostId, label: hostLabel, baseUrl: localUrl });
      setStartupSshModal({ open: false, hostId: null, hostLabel: '', error: null, connecting: false });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStartupSshModal({
        open: true,
        hostId,
        hostLabel,
        error: message,
        connecting: false,
      });
      return false;
    }
  }, []);

  const switchStartupToLocal = React.useCallback(async () => {
    setStartupSshModal({
      open: false,
      hostId: null,
      hostLabel: '',
      error: null,
      connecting: false,
    });

    await desktopHostsGet()
      .then((cfg) => desktopHostsSet({ hosts: cfg.hosts, defaultHostId: LOCAL_HOST_ID }))
      .catch(() => undefined);

    window.location.assign(toNavigationUrl(getLocalOrigin()));
  }, []);

  const retryStartupSsh = React.useCallback(() => {
    const hostId = startupSshModal.hostId;
    if (!hostId) return;
    void connectDefaultSshInstance(hostId, startupSshModal.hostLabel || 'SSH instance', {
      showProgress: true,
    });
  }, [connectDefaultSshInstance, startupSshModal.hostId, startupSshModal.hostLabel]);

  React.useEffect(() => {
    if (!isTauriShell()) return;

    let cancelled = false;
    const run = async () => {
      try {
        const cfg = await desktopHostsGet();
        const local = buildLocalHost();
        const all = [local, ...(cfg.hosts || [])];
        const current = resolveCurrentHost(all, currentSessionId);

        if (
          !attemptedDefaultSshConnectRef.current &&
          current.id === LOCAL_HOST_ID &&
          cfg.defaultHostId &&
          cfg.defaultHostId !== LOCAL_HOST_ID
        ) {
          const sshCfg = await desktopSshInstancesGet().catch(() => ({ instances: [] }));
          const defaultSsh = sshCfg.instances.find((instance) => instance.id === cfg.defaultHostId);
          if (defaultSsh) {
            attemptedDefaultSshConnectRef.current = true;
            const hostLabel = redactSensitiveUrl(resolveInstanceLabel(defaultSsh));
            const connected = await connectDefaultSshInstance(cfg.defaultHostId, hostLabel);
            if (connected || cancelled) {
              return;
            }
          }
        }

        if (cancelled) return;
        setLabel(redactSensitiveUrl(current.label || t('desktopHostSwitcher.instance.fallback')));
        const normalized = normalizeHostUrl(current.url);
        if (!normalized) {
          setStatus(null);
          return;
        }
        const res = await desktopHostProbe(normalized).catch((): HostProbeResult => ({ status: 'unreachable', latencyMs: 0 }));
        if (cancelled) return;
        setStatus(res.status);
      } catch {
        if (!cancelled) {
          setLabel(t('desktopHostSwitcher.instance.fallback'));
          setStatus(null);
        }
      }
    };

    void run();
    const interval = window.setInterval(() => {
      // Skip polling when tab is hidden to reduce background work
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      void run();
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [connectDefaultSshInstance, currentSessionId, t]);

  if (!isDesktopShell()) {
    return null;
  }

  const isCurrentlyLocal = locationMatchesHost(window.location.href, getLocalOrigin());

  const fallbackLabel = typeof window !== 'undefined' && window.location.hostname
    ? window.location.hostname
    : t('desktopHostSwitcher.instance.fallback');

  const effectiveLabel = isCurrentlyLocal
      ? t('desktopHostSwitcher.instance.local')
      : label === 'Local'
        ? fallbackLabel
        : label;
  const safeEffectiveLabel = redactSensitiveUrl(effectiveLabel);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t('desktopHostSwitcher.actions.switchInstanceAria')}
            data-oc-host-switcher
            className={cn(headerIconButtonClass, 'relative w-auto px-3')}
          >
            <Icon name="server" className="h-5 w-5" />
            <span className="hidden sm:inline typography-ui-label font-medium text-muted-foreground truncate max-w-[11rem]">
              {safeEffectiveLabel}
            </span>
            <span
              className={cn(
                'pointer-events-none absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full',
                statusDotClass(status)
              )}
              aria-label={t('desktopHostSwitcher.statusAria')}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('desktopHostSwitcher.title')}</p>
        </TooltipContent>
      </Tooltip>
      <DesktopHostSwitcherDialog open={open} onOpenChange={setOpen} />
      <Dialog
        open={startupSshModal.open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && startupSshModal.connecting) {
            return;
          }
          if (!nextOpen) {
            setStartupSshModal((prev) => ({
              ...prev,
              open: false,
              connecting: false,
            }));
            return;
          }
          setStartupSshModal((prev) => ({ ...prev, open: true }));
        }}
      >
        <DialogContent className="w-[min(30rem,calc(100vw-2rem))] max-w-none">
          <DialogHeader>
            <DialogTitle>{t('desktopHostSwitcher.startup.title')}</DialogTitle>
            <DialogDescription>
              {startupSshModal.connecting
                ? t('desktopHostSwitcher.startup.connectingTo', { host: startupSshModal.hostLabel || t('desktopHostSwitcher.ssh.instanceFallback') })
                : startupSshModal.error || t('desktopHostSwitcher.startup.failed')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void switchStartupToLocal()}
              disabled={startupSshModal.connecting}
            >
              {t('desktopHostSwitcher.actions.switchToLocal')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={retryStartupSsh}
              disabled={startupSshModal.connecting || !startupSshModal.hostId}
            >
              {startupSshModal.connecting ? <Icon name="loader-4" className="h-4 w-4 animate-spin" /> : null}
              {t('desktopHostSwitcher.actions.retry')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DesktopHostSwitcherInline() {
  const [open, setOpen] = React.useState(false);
  const { t } = useI18n();

  if (!isDesktopShell()) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-oc-host-switcher
        className="w-full justify-center"
        onClick={() => setOpen(true)}
      >
        <Icon name="server" className="h-4 w-4" />
        {t('desktopHostSwitcher.actions.switchInstance')}
      </Button>
      <DesktopHostSwitcherDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
