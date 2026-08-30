import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { toast } from '@/components/ui';
import { useSettingsServerBaseUrl } from '@/hooks/useSettingsServerBaseUrl';
import { finishConfigUpdate, startConfigUpdate } from '@/lib/configUpdate';
import { useI18n } from '@/lib/i18n';
import {
  fetchPendingRestart,
  parsePendingRestartSnapshot,
} from '@/lib/opencode/pendingRestart';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { subscribeOpenchamberEventEnvelopes } from '@/lib/openchamberEvents';
import { openExternalUrl } from '@/lib/url';
import { cn } from '@/lib/utils';
import { useInstanceContextStore } from '@/stores/useInstanceContextStore';

import {
  loadIntegrationCatalog,
  mutateIntegrationPlugin,
  type IntegrationCatalogSnapshot,
  type IntegrationMutation,
} from './integrationCatalogApi';
import {
  getCatalogPluginPresentation,
  getCatalogPluginPrimaryAction,
  getCatalogPluginState,
  getLatestNpmSpec,
  THIRD_PARTY_PLUGINS,
  type CatalogPluginPresentationStatus,
  type ThirdPartyPluginDefinition,
} from './thirdPartyPlugins';

type PendingAction = 'install' | 'update' | 'setup' | 'remove';

type ThirdPartyIntegrationsSectionProps = {
  onOpenProviderSetup: (providerId: string) => Promise<boolean>;
  onOpenPluginManager: () => void;
};

const EMPTY_CATALOG: IntegrationCatalogSnapshot = {
  entries: [],
  registryInfo: {},
  registryUnavailable: false,
};

const requiresRestart = (result: Awaited<ReturnType<typeof mutateIntegrationPlugin>>): boolean =>
  result.restartDeferred === true
  || result.requiresManualRestart === true
  || result.reloadFailed === true;

const hasPendingPluginRestart = (changes: readonly { scope?: string }[]): boolean =>
  changes.some((change) => change.scope === 'plugins');

const statusClassName = (status: CatalogPluginPresentationStatus): string => {
  if (status === 'installed-version') {
    return 'bg-[var(--status-success)]/15 text-[var(--status-success)]';
  }
  if (
    status === 'update-available'
    || status === 'ambiguous'
    || status === 'restart-required'
    || status === 'registry-unavailable'
    || status === 'provider-unavailable'
  ) {
    return 'bg-[var(--status-warning)]/15 text-[var(--status-warning)]';
  }
  return 'bg-[var(--surface-muted)] text-muted-foreground';
};

export const ThirdPartyIntegrationsSection: React.FC<ThirdPartyIntegrationsSectionProps> = ({
  onOpenProviderSetup,
  onOpenPluginManager,
}) => {
  const { t } = useI18n();
  const server = useSettingsServerBaseUrl();
  const currentInstance = useInstanceContextStore((state) => state.currentInstance);
  const serverId = currentInstance?.type === 'remote' ? currentInstance.id : DEFAULT_SERVER_ID;
  const [catalog, setCatalog] = React.useState<IntegrationCatalogSnapshot>(EMPTY_CATALOG);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pendingAction, setPendingAction] = React.useState<{ pluginId: string; action: PendingAction } | null>(null);
  const [restartRequiredIds, setRestartRequiredIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [providerUnavailableIds, setProviderUnavailableIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [openPluginIds, setOpenPluginIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [removeTarget, setRemoveTarget] = React.useState<ThirdPartyPluginDefinition | null>(null);
  const [pendingPluginRestart, setPendingPluginRestart] = React.useState(false);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    if (server.status !== 'ready') return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [next, pending] = await Promise.all([
        loadIntegrationCatalog(
          server.baseUrl,
          THIRD_PARTY_PLUGINS.map((plugin) => plugin.packageName),
          { signal },
        ),
        fetchPendingRestart(server.baseUrl).catch(() => null),
      ]);
      if (signal?.aborted) return;
      setCatalog(next);
      if (pending) setPendingPluginRestart(hasPendingPluginRestart(pending.changes));
    } catch (error) {
      if (signal?.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [server.baseUrl, server.status]);

  React.useEffect(() => {
    setCatalog(EMPTY_CATALOG);
    setRestartRequiredIds(new Set());
    setProviderUnavailableIds(new Set());
    setOpenPluginIds(new Set());
    setRemoveTarget(null);
    setPendingPluginRestart(false);
    if (server.status !== 'ready') {
      setIsLoading(true);
      return undefined;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, server.status]);

  React.useEffect(() => subscribeOpenchamberEventEnvelopes((event) => {
    if (event.type !== 'openchamber:pending-config-restart' || event.serverId !== serverId) return;
    const pending = parsePendingRestartSnapshot(event.properties);
    if (!pending) return;
    const hasPluginChange = hasPendingPluginRestart(pending.changes);
    setPendingPluginRestart(hasPluginChange);
    if (!hasPluginChange) setRestartRequiredIds(new Set());
  }), [serverId]);

  const setPluginFlag = React.useCallback((
    setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
    pluginId: string,
    enabled: boolean,
  ) => {
    setter((current) => {
      const next = new Set(current);
      if (enabled) next.add(pluginId);
      else next.delete(pluginId);
      return next;
    });
  }, []);

  const runMutation = React.useCallback(async (
    plugin: ThirdPartyPluginDefinition,
    action: Exclude<PendingAction, 'setup'>,
    mutation: IntegrationMutation,
  ) => {
    setPendingAction({ pluginId: plugin.id, action });
    startConfigUpdate(t('settings.integrations.thirdParty.title'));
    try {
      const result = await mutateIntegrationPlugin(server.baseUrl, mutation);
      setPluginFlag(setProviderUnavailableIds, plugin.id, false);
      const restartRequired = requiresRestart(result);
      setPluginFlag(setRestartRequiredIds, plugin.id, restartRequired);
      const description = restartRequired
        ? t('settings.integrations.thirdParty.toast.restartRequired')
        : undefined;
      const name = t(plugin.nameKey);
      const message = action === 'install'
        ? t('settings.integrations.thirdParty.toast.installed', { name })
        : action === 'update'
          ? t('settings.integrations.thirdParty.toast.updated', { name })
          : t('settings.integrations.thirdParty.toast.removed', { name });
      toast.success(message, description ? { description } : undefined);
      await load();
    } catch (error) {
      toast.error(t('settings.integrations.thirdParty.toast.actionFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      finishConfigUpdate();
      setPendingAction(null);
    }
  }, [load, server.baseUrl, setPluginFlag, t]);

  const handlePrimaryAction = React.useCallback(async (plugin: ThirdPartyPluginDefinition) => {
    const state = getCatalogPluginState(catalog.entries, plugin.packageName, catalog.registryInfo);
    const action = getCatalogPluginPrimaryAction(state, plugin.packageName);

    if (action === 'manage') {
      onOpenPluginManager();
      return;
    }
    if (action === 'setup') {
      setPendingAction({ pluginId: plugin.id, action });
      try {
        const opened = await onOpenProviderSetup(plugin.providerId);
        setPluginFlag(setProviderUnavailableIds, plugin.id, !opened);
        if (!opened) toast.error(t('settings.integrations.thirdParty.toast.providerUnavailable'));
      } finally {
        setPendingAction(null);
      }
      return;
    }

    const latestSpec = getLatestNpmSpec(plugin.packageName, state.registry);
    if (!latestSpec) return;
    if (action === 'install') {
      await runMutation(plugin, action, { type: 'install', spec: latestSpec });
      return;
    }
    if (state.userEntry) {
      await runMutation(plugin, action, {
        type: 'update',
        entryId: state.userEntry.id,
        spec: latestSpec,
      });
    }
  }, [catalog.entries, catalog.registryInfo, onOpenPluginManager, onOpenProviderSetup, runMutation, setPluginFlag, t]);

  const handleRemove = React.useCallback(async () => {
    const plugin = removeTarget;
    if (!plugin) return;
    const state = getCatalogPluginState(catalog.entries, plugin.packageName, catalog.registryInfo);
    setRemoveTarget(null);
    if (!state.userEntry || state.userEntryIsAmbiguous) {
      onOpenPluginManager();
      return;
    }
    await runMutation(plugin, 'remove', { type: 'remove', entryId: state.userEntry.id });
  }, [catalog.entries, catalog.registryInfo, onOpenPluginManager, removeTarget, runMutation]);

  const renderStatus = React.useCallback((plugin: ThirdPartyPluginDefinition) => {
    const state = getCatalogPluginState(catalog.entries, plugin.packageName, catalog.registryInfo);
    const presentation = getCatalogPluginPresentation(state, {
      registryUnavailable: catalog.registryUnavailable,
      restartRequired: restartRequiredIds.has(plugin.id),
      providerUnavailable: providerUnavailableIds.has(plugin.id),
    });
    switch (presentation.status) {
      case 'installed-version':
        return presentation.latestVersion
          ? t('settings.integrations.thirdParty.status.installedVersion', { version: presentation.latestVersion })
          : t('settings.integrations.thirdParty.status.installed');
      case 'update-available':
        return presentation.latestVersion
          ? t('settings.integrations.thirdParty.status.updateAvailable', { version: presentation.latestVersion })
          : t('settings.integrations.thirdParty.status.unpinned');
      case 'not-installed': return t('settings.integrations.thirdParty.status.notInstalled');
      case 'installed': return t('settings.integrations.thirdParty.status.installed');
      case 'unpinned': return t('settings.integrations.thirdParty.status.unpinned');
      case 'ambiguous': return t('settings.integrations.thirdParty.status.ambiguous');
      case 'restart-required': return t('settings.integrations.thirdParty.status.restartRequired');
      case 'registry-unavailable': return t('settings.integrations.thirdParty.status.registryUnavailable');
      case 'provider-unavailable': return t('settings.integrations.thirdParty.status.providerUnavailable');
    }
  }, [catalog.entries, catalog.registryInfo, catalog.registryUnavailable, providerUnavailableIds, restartRequiredIds, t]);

  return (
    <SettingsSection
      title={t('settings.integrations.thirdParty.title')}
      description={t('settings.integrations.thirdParty.info')}
      divider={false}
      className="space-y-3"
    >
      {server.status !== 'ready' || isLoading ? (
        <div className="flex items-center gap-2 py-8 typography-ui-label text-muted-foreground">
          <Icon name="loader-4" className="size-4 animate-spin" aria-hidden="true" />
          {t('common.loading')}
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
          <div className="typography-ui-label text-[var(--status-error)]">{t('settings.integrations.thirdParty.toast.actionFailed')}</div>
          <div className="mt-1 break-words typography-micro text-muted-foreground">{loadError}</div>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
            <Icon name="refresh" className="size-3.5" aria-hidden="true" />
            {t('directoryExplorerDialog.browse.retry')}
          </Button>
        </div>
      ) : (
        <>
          {pendingPluginRestart ? (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] p-3 typography-meta text-[var(--status-warning)]">
              <Icon name="restart" className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('settings.integrations.thirdParty.toast.restartRequired')}
            </div>
          ) : null}
          {THIRD_PARTY_PLUGINS.map((plugin) => {
          const state = getCatalogPluginState(catalog.entries, plugin.packageName, catalog.registryInfo);
          const primaryAction = getCatalogPluginPrimaryAction(state, plugin.packageName);
          const latestSpec = getLatestNpmSpec(plugin.packageName, state.registry);
          const isPending = pendingAction?.pluginId === plugin.id;
          const restartRequired = restartRequiredIds.has(plugin.id);
          const registryUnavailable = catalog.registryUnavailable || state.registry?.kind === 'npm-network';
          const actionDisabled = isPending
            || restartRequired
            || (pendingPluginRestart && primaryAction === 'setup')
            || ((primaryAction === 'install' || primaryAction === 'update') && (registryUnavailable || !latestSpec));
          const presentation = getCatalogPluginPresentation(state, {
            registryUnavailable,
            restartRequired,
            providerUnavailable: providerUnavailableIds.has(plugin.id),
          });
          const primaryLabel = {
            install: t('settings.integrations.thirdParty.actions.install'),
            update: t('settings.integrations.thirdParty.actions.update'),
            setup: t('settings.integrations.thirdParty.actions.setup'),
            manage: t('settings.integrations.thirdParty.actions.managePlugins'),
          }[primaryAction];
          const open = openPluginIds.has(plugin.id);

            return (
            <Collapsible
              key={plugin.id}
              open={open}
              onOpenChange={(nextOpen) => setPluginFlag(setOpenPluginIds, plugin.id, nextOpen)}
            >
              <div
                data-settings-item={`integrations.third-party.${plugin.id}`}
                className="overflow-hidden rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)]"
              >
                <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-[var(--interactive-hover)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--interactive-focus-ring)]">
                  <div className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)]">
                    <Icon name="plug" className="size-5 text-muted-foreground/45" aria-hidden="true" />
                    <ProviderLogo providerId={plugin.logoProviderId} alt="" className="absolute inset-2 size-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate typography-ui-label font-semibold text-foreground">{t(plugin.nameKey)}</div>
                    <p className="mt-0.5 line-clamp-1 typography-micro leading-snug text-muted-foreground">
                      {t(plugin.descriptionKey)}
                    </p>
                  </div>
                  <span
                    aria-live="polite"
                    className={cn(
                      'max-w-40 shrink-0 truncate rounded-full px-2 py-0.5 typography-micro font-medium',
                      statusClassName(presentation.status),
                    )}
                  >
                    {renderStatus(plugin)}
                  </span>
                  <Icon
                    name="arrow-down-s"
                    className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')}
                    aria-hidden="true"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t border-[var(--interactive-border)] px-4 py-4">
                  <div className="space-y-3">
                    {state.projectEntries.length > 0 ? (
                      <p className="typography-micro text-muted-foreground">
                        {t('settings.integrations.thirdParty.status.projectInstalled')}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={primaryAction === 'manage' ? 'outline' : 'default'}
                        onClick={() => void handlePrimaryAction(plugin)}
                        disabled={actionDisabled}
                      >
                        {isPending ? <Icon name="loader-4" className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                        {primaryLabel}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void openExternalUrl(plugin.homepage)}>
                        <Icon name="external-link" className="size-3.5" aria-hidden="true" />
                        {t('settings.integrations.thirdParty.actions.docs')}
                      </Button>
                      {state.userEntry && !state.userEntryIsAmbiguous ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-[var(--status-error)] hover:text-[var(--status-error)]"
                          onClick={() => setRemoveTarget(plugin)}
                          disabled={isPending}
                        >
                          <Icon name="delete-bin" className="size-3.5" aria-hidden="true" />
                          {t('settings.integrations.thirdParty.actions.remove')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
            );
          })}
        </>
      )}

      <Dialog open={removeTarget !== null} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.integrations.thirdParty.dialog.remove.title')}</DialogTitle>
            <DialogDescription>
              {removeTarget
                ? t('settings.integrations.thirdParty.dialog.remove.description', { name: t(removeTarget.nameKey) })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoveTarget(null)}>
              {t('directoryTree.actions.cancel')}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleRemove()}>
              {t('settings.integrations.thirdParty.actions.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
};
