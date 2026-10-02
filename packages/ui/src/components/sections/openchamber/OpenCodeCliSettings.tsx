import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from "@/components/icon/Icon";
import { canUseDesktopNativeApi, isDesktopShell, requestFileAccess } from '@/lib/desktop';
import { BUILTIN_BROWSER_PROVIDER, browserProviderGuests } from '@/lib/guests/browser-providers';
import { loadGuestCatalog } from '@/lib/guests/load-catalog';
import { useGuestsStore } from '@/lib/guests/store';
import { flushPendingSettingsUpdates, updateDesktopSettings } from '@/lib/persistence';
import { refreshAfterOpenCodeRestart, reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/components/ui';
import { applyPendingRestart } from '@/lib/opencode/pendingRestart';

export const OpenCodeCliSettings: React.FC = () => {
  const { t } = useI18n();
  const [value, setValue] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [agentMemoryAvailable, setAgentMemoryAvailable] = React.useState(false);
  const [isAgentMemorySaving, setIsAgentMemorySaving] = React.useState(false);
  const showOpenCodeUpdateNotifications = useUIStore((state) => state.showOpenCodeUpdateNotifications);
  const setShowOpenCodeUpdateNotifications = useUIStore((state) => state.setShowOpenCodeUpdateNotifications);
  const agentControlToolEnabled = useUIStore((state) => state.agentControlToolEnabled);
  const setAgentControlToolEnabled = useUIStore((state) => state.setAgentControlToolEnabled);
  const browserProvider = useUIStore((state) => state.browserProvider);
  const setBrowserProvider = useUIStore((state) => state.setBrowserProvider);
  const guests = useGuestsStore((state) => state.guests);
  const agentMemoryToolEnabled = useUIStore((state) => state.agentMemoryToolEnabled);
  const setAgentMemoryToolEnabled = useUIStore((state) => state.setAgentMemoryToolEnabled);
  const agentNotifyToolEnabled = useUIStore((state) => state.agentNotifyToolEnabled);
  const setAgentNotifyToolEnabled = useUIStore((state) => state.setAgentNotifyToolEnabled);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/config/settings', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json().catch(() => null)) as null | {
          opencodeBinary?: unknown;
          agentMemoryAvailable?: unknown;
          agentMemoryToolEnabled?: unknown;
        };
        if (cancelled || !data) {
          return;
        }
        const next = typeof data.opencodeBinary === 'string' ? data.opencodeBinary.trim() : '';
        setValue(next);
        setAgentMemoryAvailable(data.agentMemoryAvailable === true);
        if (typeof data.agentMemoryToolEnabled === 'boolean') {
          setAgentMemoryToolEnabled(data.agentMemoryToolEnabled);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setAgentMemoryToolEnabled]);

  const handleBrowse = React.useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!isDesktopShell() || !canUseDesktopNativeApi()) {
      return;
    }

    try {
      const selected = await requestFileAccess({
        defaultPath: value,
      });
      if (selected.success && typeof selected.path === 'string' && selected.path.trim().length > 0) {
        setValue(selected.path.trim());
      }
    } catch {
      // ignore
    }
  }, [value]);

  const handleSaveAndReload = React.useCallback(async () => {
    setIsSaving(true);
    try {
      await updateDesktopSettings({ opencodeBinary: value.trim() });
      await reloadOpenCodeConfiguration({
        message: t('settings.openchamber.opencodeCli.actions.restartingOpenCode'),
        mode: 'projects',
        scopes: ['all'],
      });
    } finally {
      setIsSaving(false);
    }
  }, [t, value]);

  const handleAgentControlToolChange = React.useCallback((enabled: boolean) => {
    setAgentControlToolEnabled(enabled);
    void updateDesktopSettings({ agentControlToolEnabled: enabled });
  }, [setAgentControlToolEnabled]);

  // The dropdown lists installed extensions, so the catalog has to be loaded
  // here too: this page can be the first thing opened after a fresh start.
  React.useEffect(() => {
    void loadGuestCatalog();
  }, []);
  const providerGuests = React.useMemo(() => browserProviderGuests(guests), [guests]);
  // A selection whose extension is gone shows as the built-in: the server
  // already routes to it and resets the setting on the next action.
  const providerValue = providerGuests.some((guest) => guest.id === browserProvider)
    ? browserProvider
    : BUILTIN_BROWSER_PROVIDER;

  // Read by the server on the next browser action; no OpenCode restart involved.
  const handleBrowserProviderChange = React.useCallback((selected: string) => {
    setBrowserProvider(selected);
    void updateDesktopSettings({ browserProvider: selected });
  }, [setBrowserProvider]);

  const handleAgentNotifyToolChange = React.useCallback((enabled: boolean) => {
    setAgentNotifyToolEnabled(enabled);
    void updateDesktopSettings({ agentNotifyToolEnabled: enabled });
  }, [setAgentNotifyToolEnabled]);

  const handleAgentMemoryToolChange = React.useCallback(async (enabled: boolean) => {
    const previous = agentMemoryToolEnabled;
    let persisted = false;
    setAgentMemoryToolEnabled(enabled);
    setIsAgentMemorySaving(true);
    try {
      await updateDesktopSettings({ agentMemoryToolEnabled: enabled });
      const flushed = await flushPendingSettingsUpdates();
      if (!flushed) throw new Error('Failed to save the Agent Memory tool setting');
      persisted = true;
      const result = await applyPendingRestart('');
      if (result.appliedCount < 1) {
        throw new Error('OpenCode restart was not scheduled');
      }
      if (result.requiresManualRestart) {
        throw new Error('OpenCode must be restarted outside OpenChamber');
      }
      if (result.requiresReload) {
        await refreshAfterOpenCodeRestart({
          message: t('settings.openchamber.opencodeCli.actions.restartingOpenCode'),
          delayMs: result.reloadDelayMs,
          mode: 'projects',
          scopes: ['all'],
        });
      }
    } catch (error) {
      if (!persisted) setAgentMemoryToolEnabled(previous);
      toast.error(t('settings.openchamber.opencodeCli.field.agentMemoryToolSaveFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsAgentMemorySaving(false);
    }
  }, [agentMemoryToolEnabled, setAgentMemoryToolEnabled, t]);

  return (
    <div className="mb-8">
      <div className="mb-1 px-1">
        <div className="flex items-center gap-2">
          <h3 className="typography-ui-header font-medium text-foreground">
            {t('settings.openchamber.opencodeCli.title')}
          </h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Icon name="information" className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent sideOffset={8} className="max-w-xs">
              {t('settings.openchamber.opencodeCli.tooltipPrefix')}
              {' '}
              <code className="font-mono text-xs">opencode</code>
              {t('settings.openchamber.opencodeCli.tooltipSuffix')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <section className="px-2 pb-2 pt-0 space-y-0.5">
        <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 flex-col shrink-0">
            <span className="typography-ui-label text-foreground">{t('settings.openchamber.opencodeCli.field.binaryPath')}</span>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:w-[20rem]">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('settings.openchamber.opencodeCli.field.binaryPathPlaceholder')}
              disabled={isLoading || isSaving}
              className="h-7 min-w-0 flex-1 font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={handleBrowse}
              disabled={isLoading || isSaving || !isDesktopShell() || !canUseDesktopNativeApi()}
              className="h-7 w-7 p-0"
              aria-label={t('settings.openchamber.opencodeCli.actions.browseAria')}
              title={t('settings.openchamber.opencodeCli.actions.browse')}
            >
              <Icon name="folder" className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="py-1.5">
          <div className="typography-micro text-muted-foreground/70">
            {t('settings.openchamber.opencodeCli.tipPrefix')}
            {' '}
            <span className="font-mono">OPENCODE_BINARY</span>
            {' '}
            {t('settings.openchamber.opencodeCli.tipMiddle')}
            {' '}
            <span className="font-mono">~/.config/openchamber/settings.json</span>
            {'.'}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 py-1.5">
          <Checkbox
            checked={showOpenCodeUpdateNotifications}
            onChange={setShowOpenCodeUpdateNotifications}
            ariaLabel={t('settings.openchamber.opencodeCli.field.showUpdateNotificationsAria')}
          />
          <span className="typography-ui-label text-foreground">
            {t('settings.openchamber.opencodeCli.field.showUpdateNotifications')}
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2 py-1.5">
          <Checkbox
            checked={agentControlToolEnabled}
            onChange={handleAgentControlToolChange}
            ariaLabel={t('settings.openchamber.opencodeCli.field.agentControlToolAria')}
          />
          <span className="min-w-0">
            <span className="typography-ui-label block text-foreground">
              {t('settings.openchamber.opencodeCli.field.agentControlTool')}
            </span>
            <span className="typography-micro block text-muted-foreground/70">
              {t('settings.openchamber.opencodeCli.field.agentControlToolInfo')}
            </span>
          </span>
        </label>

        <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 flex-col shrink-0">
            <span className="typography-ui-label text-foreground">{t('settings.openchamber.tools.browserProvider.label')}</span>
            <span className="typography-micro block text-muted-foreground/70">
              {t('settings.openchamber.tools.browserProvider.info')}
            </span>
          </div>
          <div className="flex min-w-0 items-center sm:w-[20rem]">
            <Select<string>
              value={providerValue}
              onValueChange={handleBrowserProviderChange}
              disabled={providerGuests.length === 0}
            >
              <SelectTrigger
                className="h-7 min-w-0 flex-1"
                aria-label={t('settings.openchamber.tools.browserProvider.aria')}
              >
                <SelectValue>
                  {(selected) => (
                    selected === BUILTIN_BROWSER_PROVIDER
                      ? t('settings.openchamber.tools.browserProvider.option.builtin')
                      : providerGuests.find((guest) => guest.id === selected)?.name ?? null
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BUILTIN_BROWSER_PROVIDER}>
                  {t('settings.openchamber.tools.browserProvider.option.builtin')}
                </SelectItem>
                {providerGuests.map((guest) => (
                  <SelectItem key={guest.id} value={guest.id}>{guest.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2 py-1.5">
          <Checkbox
            checked={agentNotifyToolEnabled}
            onChange={handleAgentNotifyToolChange}
            ariaLabel={t('settings.openchamber.tools.field.agentNotifyToolAria')}
          />
          <span className="min-w-0">
            <span className="typography-ui-label block text-foreground">
              {t('settings.openchamber.tools.field.agentNotifyTool')}
            </span>
            <span className="typography-micro block text-muted-foreground/70">
              {t('settings.openchamber.tools.field.agentNotifyToolInfo')}
            </span>
          </span>
        </label>

        {agentMemoryAvailable ? (
          <label className="flex cursor-pointer items-start gap-2 py-1.5">
            <Checkbox
              checked={agentMemoryToolEnabled}
              onChange={(enabled) => { void handleAgentMemoryToolChange(enabled); }}
              disabled={isAgentMemorySaving}
              ariaLabel={t('settings.openchamber.opencodeCli.field.agentMemoryToolAria')}
            />
            <span className="min-w-0">
              <span className="typography-ui-label block text-foreground">
                {t('settings.openchamber.opencodeCli.field.agentMemoryTool')}
              </span>
              <span className="typography-micro block text-muted-foreground/70">
                {t('settings.openchamber.opencodeCli.field.agentMemoryToolInfo')}
              </span>
            </span>
          </label>
        ) : null}

        <div className="flex justify-start py-1.5">
          <Button
            type="button"
            size="xs"
            onClick={handleSaveAndReload}
            disabled={isLoading || isSaving}
            className="shrink-0 !font-normal"
          >
            {isSaving ? t('settings.common.actions.saving') : t('settings.openchamber.opencodeCli.actions.saveAndReload')}
          </Button>
        </div>
      </section>
    </div>
  );
};
