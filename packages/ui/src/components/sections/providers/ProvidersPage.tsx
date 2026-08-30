import React from 'react';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { useConfigStore } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from "@/components/icon/Icon";
import type { IconName } from "@/components/icon/icons";
import { reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';
import { cn } from '@/lib/utils';
import type { ModelMetadata } from '@/types';
import { useI18n, type I18nKey, type I18nParams } from '@/lib/i18n';
import { resolveApiUrl } from '@/lib/api/serverUrl';
import { useSettingsServerBaseUrl } from '@/hooks/useSettingsServerBaseUrl';
import { useSettingsProviders } from './useSettingsProviders';
import { CustomProviderForm } from './CustomProviderForm';
import { ProviderOAuthMethods, type ProviderOAuthMethod } from './ProviderOAuthMethods';
import {
  getOAuthAuthMethods,
  parseAuthPayload,
  shouldShowApiKeyAuth,
  type AuthMethod,
  type OAuthAuthMethodEntry,
} from './providerAuth';
import {
  buildAuthSetRequest,
  buildProviderUpsertRequest,
  isConfigDefinedCustomProvider,
  providerToCustomFormState,
  resolveProviderConfigScope,
  type CustomProviderFormState,
  type CustomProviderPersistPlan,
} from './custom-provider-form';

const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

const formatTokens = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  if (value === 0) {
    return '0';
  }
  const formatted = COMPACT_NUMBER_FORMATTER.format(value);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
};

const ADD_PROVIDER_ID = '__add_provider__';

const toOAuthMethods = (
  entries: OAuthAuthMethodEntry[],
  t: (key: I18nKey, params?: I18nParams) => string,
): ProviderOAuthMethod[] =>
  entries.map(({ method, methodIndex }) => ({
    index: methodIndex,
    label: method.label || method.name || t('settings.providers.page.auth.oauthMethodFallback', { index: String(methodIndex + 1) }),
    prompts: method.prompts,
  }));

interface ProviderOption {
  id: string;
  name?: string;
}

interface ProviderSourceInfo {
  exists: boolean;
  path?: string | null;
}

interface ProviderSources {
  auth: ProviderSourceInfo;
  user: ProviderSourceInfo;
  project: ProviderSourceInfo;
  custom?: ProviderSourceInfo;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeProviderEntry = (entry: unknown): ProviderOption | null => {
  if (typeof entry === 'string') {
    return { id: entry };
  }
  if (!isRecord(entry)) {
    return null;
  }
  const idCandidate =
    (typeof entry.id === 'string' && entry.id) ||
    (typeof entry.providerID === 'string' && entry.providerID) ||
    (typeof entry.slug === 'string' && entry.slug) ||
    (typeof entry.name === 'string' && entry.name);
  if (!idCandidate) {
    return null;
  }
  const nameCandidate = typeof entry.name === 'string' ? entry.name : undefined;
  return { id: idCandidate, name: nameCandidate };
};

const parseProvidersPayload = (payload: unknown): ProviderOption[] => {
  let entries: unknown[] = [];

  if (Array.isArray(payload)) {
    entries = payload;
  } else if (isRecord(payload)) {
    if (Array.isArray(payload.all)) {
      entries = payload.all;
    } else if (Array.isArray(payload.providers)) {
      entries = payload.providers;
    }
  }

  const mapped = entries
    .map((entry) => normalizeProviderEntry(entry))
    .filter((entry): entry is ProviderOption => Boolean(entry));

  const seen = new Set<string>();
  return mapped.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
};

export const ProvidersPage: React.FC = () => {
  const { t } = useI18n();
  const { providers } = useSettingsProviders();
  const selectedProviderId = useConfigStore((state) => state.selectedProviderId);
  const setSelectedProvider = useConfigStore((state) => state.setSelectedProvider);
  const getModelMetadata = useConfigStore((state) => state.getModelMetadata);
  const hiddenModels = useUIStore((state) => state.hiddenModels);
  const toggleHiddenModel = useUIStore((state) => state.toggleHiddenModel);
  const hideAllModels = useUIStore((state) => state.hideAllModels);
  const showAllModels = useUIStore((state) => state.showAllModels);

  const { status, baseUrl } = useSettingsServerBaseUrl();
  // Model visibility (hide/show) is a local UI preference. It must not be
  // applied to, or mutated for, a remote instance whose model set differs.
  const isRemote = status === 'ready' && Boolean(baseUrl);
  const effectiveHiddenModels = isRemote ? [] : hiddenModels;

  const [authMethodsByProvider, setAuthMethodsByProvider] = React.useState<Record<string, AuthMethod[]>>({});
  const [authLoading, setAuthLoading] = React.useState(false);
  const [apiKeyInputs, setApiKeyInputs] = React.useState<Record<string, string>>({});
  const [authBusyKey, setAuthBusyKey] = React.useState<string | null>(null);
  const [modelQuery, setModelQuery] = React.useState('');
  const [availableProviders, setAvailableProviders] = React.useState<ProviderOption[]>([]);
  const [availableLoading, setAvailableLoading] = React.useState(false);
  const [availableError, setAvailableError] = React.useState<string | null>(null);
  const [candidateProviderId, setCandidateProviderId] = React.useState('');
  const [providerSearchQuery, setProviderSearchQuery] = React.useState('');
  const [providerDropdownOpen, setProviderDropdownOpen] = React.useState(false);
  const [providerSources, setProviderSources] = React.useState<Record<string, ProviderSources>>({});
  const [showAuthPanel, setShowAuthPanel] = React.useState(false);
  const [customMode, setCustomMode] = React.useState<'idle' | 'create' | 'edit'>('idle');
  const [customInitial, setCustomInitial] = React.useState<CustomProviderFormState | null>(null);
  const [customEditProviderId, setCustomEditProviderId] = React.useState<string | null>(null);
  const [customAllowExistingAuth, setCustomAllowExistingAuth] = React.useState(false);
  const [customBusy, setCustomBusy] = React.useState(false);
  const [customAuthFailure, setCustomAuthFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!selectedProviderId && providers.length > 0) {
      setSelectedProvider(providers[0].id);
    }
  }, [providers, selectedProviderId, setSelectedProvider]);

  React.useEffect(() => {
    if (status === 'loading') return;
    let isMounted = true;

    const loadAuthMethods = async () => {
      setAuthLoading(true);
      try {
        const response = await fetch(resolveApiUrl('/api/provider/auth', baseUrl), {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Auth methods request failed (${response.status})`);
        }

        const payload = await response.json().catch(() => ({}));
        if (!isMounted) return;
        setAuthMethodsByProvider(parseAuthPayload(payload));
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to load provider auth methods:', error);
        toast.error(t('settings.providers.page.toast.authMethodsLoadFailed'));
      } finally {
        if (isMounted) {
          setAuthLoading(false);
        }
      }
    };

    loadAuthMethods();

    return () => {
      isMounted = false;
    };
  }, [t, status, baseUrl]);

  React.useEffect(() => {
    if (status === 'loading') return;
    let isMounted = true;

    const loadAvailableProviders = async () => {
      setAvailableLoading(true);
      setAvailableError(null);
      try {
        const response = await fetch(resolveApiUrl('/api/provider', baseUrl), {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Provider list request failed (${response.status})`);
        }

        const payload = await response.json().catch(() => ({}));
        if (!isMounted) return;
        setAvailableProviders(parseProvidersPayload(payload));
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to load available providers:', error);
        setAvailableError(t('settings.providers.page.state.unableToLoadProviderList'));
      } finally {
        if (isMounted) {
          setAvailableLoading(false);
        }
      }
    };

    loadAvailableProviders();

    return () => {
      isMounted = false;
    };
  }, [t, status, baseUrl]);

  const connectedProviderIds = React.useMemo(
    () => new Set(providers.map((provider) => provider.id)),
    [providers]
  );

  const unconnectedProviders = React.useMemo(
    () =>
      availableProviders
        .filter((provider) => !connectedProviderIds.has(provider.id))
        .sort((a, b) => {
          const labelA = (a.name || a.id).toLowerCase();
          const labelB = (b.name || b.id).toLowerCase();
          return labelA.localeCompare(labelB);
        }),
    [availableProviders, connectedProviderIds]
  );

  React.useEffect(() => {
    if (selectedProviderId !== ADD_PROVIDER_ID) {
      return;
    }

    if (candidateProviderId && !unconnectedProviders.some((provider) => provider.id === candidateProviderId)) {
      setCandidateProviderId('');
    }
  }, [selectedProviderId, candidateProviderId, unconnectedProviders]);

  React.useEffect(() => {
    if (selectedProviderId === ADD_PROVIDER_ID) {
      setShowAuthPanel(true);
      return;
    }

    setShowAuthPanel(false);
  }, [selectedProviderId, t]);

  // Unauthenticated providers (OAuth-only plugins before login) should open the
  // auth panel instead of a false "Connected" summary.
  React.useEffect(() => {
    if (!selectedProviderId || selectedProviderId === ADD_PROVIDER_ID) {
      return;
    }
    const sources = providerSources[selectedProviderId];
    if (!sources) {
      return;
    }
    const provider = providers.find((entry) => entry.id === selectedProviderId);
    const envEntries = Array.isArray(provider?.env)
      ? provider.env.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [];
    const hasCreds = Boolean(sources.auth.exists) || envEntries.length > 0;
    if (!hasCreds) {
      setShowAuthPanel(true);
    }
  }, [selectedProviderId, providerSources, providers]);

  React.useEffect(() => {
    if (!selectedProviderId || selectedProviderId === ADD_PROVIDER_ID) {
      return;
    }
    if (status === 'loading') return;

    let cancelled = false;

    const loadSources = async () => {
      try {
        const response = await fetch(resolveApiUrl(`/api/provider/${encodeURIComponent(selectedProviderId)}/source`, baseUrl), {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || t('settings.providers.page.toast.providerSourcesLoadFailed'));
        }

        const sources = (payload?.sources ?? payload?.data?.sources) as ProviderSources | undefined;
        if (!cancelled && sources) {
          setProviderSources((prev) => ({
            ...prev,
            [selectedProviderId]: sources,
          }));
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load provider sources:', error);
        }
      }
    };

    loadSources();

    return () => {
      cancelled = true;
    };
  }, [selectedProviderId, t, status, baseUrl]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const selectedSources = selectedProviderId ? providerSources[selectedProviderId] : undefined;

  const handleSaveApiKey = async (providerId: string) => {
    if (status !== 'ready') return;
    const apiKey = apiKeyInputs[providerId]?.trim() ?? '';
    if (!apiKey) {
      toast.error(t('settings.providers.page.toast.apiKeyRequired'));
      return;
    }

    const busyKey = `api:${providerId}`;
    setAuthBusyKey(busyKey);

    try {
      const response = await fetch(resolveApiUrl(`/api/auth/${encodeURIComponent(providerId)}`, baseUrl), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'api', key: apiKey }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error || t('settings.providers.page.toast.apiKeySaveFailed');
        throw new Error(message);
      }

      toast.success(t('settings.providers.page.toast.apiKeySaved'));
      setApiKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
      await reloadOpenCodeConfiguration({ scopes: ["providers"], mode: "active" });
      setSelectedProvider(providerId);
    } catch (error) {
      console.error('Failed to save API key:', error);
      toast.error(t('settings.providers.page.toast.apiKeySaveFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const handleOAuthConnected = async (providerId: string) => {
    await reloadOpenCodeConfiguration({ scopes: ["providers"], mode: "active" });
    setSelectedProvider(providerId);
  };

  const handleDisconnectProvider = async (providerId: string) => {
    if (status !== 'ready') return;
    const busyKey = `disconnect:${providerId}`;
    setAuthBusyKey(busyKey);

    try {
      const response = await fetch(resolveApiUrl(`/api/provider/${encodeURIComponent(providerId)}/auth?scope=all`, baseUrl), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error || t('settings.providers.page.toast.providerDisconnectFailed');
        throw new Error(message);
      }

      toast.success(t('settings.providers.page.toast.providerDisconnected'));
      await reloadOpenCodeConfiguration({ scopes: ["providers"], mode: "active" });
    } catch (error) {
      console.error('Failed to disconnect provider:', error);
      toast.error(t('settings.providers.page.toast.providerDisconnectFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const isAddMode = selectedProviderId === ADD_PROVIDER_ID;

  const openCreateCustomProvider = () => {
    setCustomMode('create');
    setCustomInitial(null);
    setCustomEditProviderId(null);
    setCustomAllowExistingAuth(false);
    setCustomAuthFailure(null);
  };

  const openEditCustomProvider = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;
    setCustomMode('edit');
    setCustomInitial(providerToCustomFormState(provider));
    setCustomEditProviderId(providerId);
    const sources = providerSources[providerId];
    setCustomAllowExistingAuth(Boolean(sources?.auth?.exists));
    setCustomAuthFailure(null);
    setSelectedProvider(providerId);
  };

  const closeCustomProvider = () => {
    setCustomMode('idle');
    setCustomInitial(null);
    setCustomEditProviderId(null);
    setCustomAllowExistingAuth(false);
    setCustomAuthFailure(null);
    setCustomBusy(false);
  };

  const submitCustomProvider = async (plan: CustomProviderPersistPlan) => {
    setCustomBusy(true);
    setCustomAuthFailure(null);
    try {
      const isEdit = customMode === 'edit';
      const editingId = isEdit ? customEditProviderId : null;
      const sources = editingId ? providerSources[editingId] : null;
      const scope = isEdit ? resolveProviderConfigScope(sources) : 'user';

      const authRequest = buildAuthSetRequest(plan);
      if (authRequest) {
        const authResponse = await fetch(resolveApiUrl('/api/provider/auth', baseUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(authRequest),
        });
        if (!authResponse.ok) {
          const payload = await authResponse.json().catch(() => null);
          throw new Error(payload?.error || `Auth save failed (${authResponse.status})`);
        }
      }

      let configSaveFailed = false;
      try {
        const upsert = buildProviderUpsertRequest(plan, { scope });
        const response = await fetch(resolveApiUrl('/api/provider', baseUrl), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(upsert),
        });
        if (!response.ok) {
          configSaveFailed = true;
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || `Provider config save failed (${response.status})`);
        }
      } catch (configError) {
        if (authRequest) {
          setCustomAuthFailure(t('settings.providers.page.custom.authFailure.configAfterAuth'));
          setCustomBusy(false);
          return;
        }
        throw configError;
      }

      if (configSaveFailed && authRequest) {
        setCustomAuthFailure(t('settings.providers.page.custom.authFailure.configAfterAuth'));
        setCustomBusy(false);
        return;
      }

      toast.success(
        isEdit
          ? t('settings.providers.page.toast.providerUpdated', { provider: plan.name })
          : t('settings.providers.page.toast.providerAdded', { provider: plan.name }),
      );
      await reloadOpenCodeConfiguration();
      closeCustomProvider();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.providers.page.toast.saveFailed'));
    } finally {
      setCustomBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Icon name="loader-4" className="mx-auto mb-3 h-8 w-8 animate-spin opacity-60" />
          <p className="typography-body">{t('settings.providers.page.state.loading')}</p>
        </div>
      </div>
    );
  }

  if (!isAddMode && providers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Icon name="stack" className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">{t('settings.providers.page.empty.noProvidersDetected')}</p>
          <p className="typography-meta mt-1 opacity-75">{t('settings.providers.page.empty.checkOpenCodeConfiguration')}</p>
        </div>
      </div>
    );
  }

  if (isAddMode) {
    if (customMode === 'create') {
      return (
        <ScrollableOverlay outerClassName="h-full" className="w-full">
          <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">
            <CustomProviderForm
              existingProviderIDs={new Set(providers.map((p) => p.id))}
              busy={customBusy}
              mode="create"
              authFailureHint={customAuthFailure}
              onSubmit={(plan) => void submitCustomProvider(plan)}
              onCancel={closeCustomProvider}
            />
          </div>
        </ScrollableOverlay>
      );
    }

    return (
      <ScrollableOverlay outerClassName="h-full" className="w-full">
        <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">
          <div className="mb-4">
            <h1 className="typography-ui-header font-semibold text-foreground">{t('settings.providers.page.connect.title')}</h1>
          </div>

          <div className="mb-8">
            <div className="mb-1 px-1">
              <h2 className="typography-ui-header font-medium text-foreground">{t('settings.providers.page.connect.selectProviderTitle')}</h2>
            </div>

            <section className="px-2 pb-2 pt-0">
              <div className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="typography-ui-label text-foreground">{t('settings.providers.page.connect.providerField')}</span>
                  {availableLoading ? (
                    <p className="typography-meta text-muted-foreground">{t('settings.providers.page.state.loading')}</p>
                  ) : availableError ? (
                    <p className="typography-meta text-muted-foreground">{availableError}</p>
                  ) : unconnectedProviders.length === 0 ? (
                    <p className="typography-meta text-muted-foreground">{t('settings.providers.page.connect.allProvidersConnected')}</p>
                  ) : (
                    <DropdownMenu open={providerDropdownOpen} onOpenChange={(open) => {
                      setProviderDropdownOpen(open);
                      if (!open) setProviderSearchQuery('');
                    }}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2 py-2 typography-ui-label whitespace-nowrap shadow-none outline-none hover:bg-interactive-hover h-6 w-fit",
                          )}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            {candidateProviderId ? <ProviderLogo providerId={candidateProviderId} className="h-3.5 w-3.5 flex-shrink-0" /> : null}
                            <span className={cn("truncate typography-ui-label font-normal", candidateProviderId ? "text-foreground" : "text-muted-foreground")}>
                              {candidateProviderId
                                ? (unconnectedProviders.find(p => p.id === candidateProviderId)?.name || candidateProviderId)
                                : t('settings.providers.page.connect.selectProviderPlaceholder')}
                            </span>
                          </span>
                          <Icon name="arrow-down-s" className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-[280px] p-0"
                        onCloseAutoFocus={(e) => e.preventDefault()}
                      >
                        <div
                          className="flex items-center gap-2 border-b border-[var(--surface-subtle)] px-3 py-2"
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Icon name="search" className="h-4 w-4 text-muted-foreground" />
                          <input
                            type="text"
                            value={providerSearchQuery}
                            onChange={(e) => setProviderSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder={t('settings.providers.page.connect.searchProvidersPlaceholder')}
                            className="flex-1 bg-transparent typography-meta outline-none placeholder:text-muted-foreground"
                            autoFocus
                          />
                        </div>
                        <ScrollableOverlay outerClassName="max-h-[240px]" className="p-1">
                          {(() => {
                            const filtered = unconnectedProviders.filter(p => {
                              const query = providerSearchQuery.toLowerCase();
                              return (p.name || p.id).toLowerCase().includes(query) || p.id.toLowerCase().includes(query);
                            });
                            if (filtered.length === 0) {
                              return <p className="py-4 text-center typography-meta text-muted-foreground">{t('settings.providers.page.connect.noProvidersFound')}</p>;
                            }
                            return filtered.map((provider) => (
                              <DropdownMenuItem
                                key={provider.id}
                                onSelect={() => {
                                  setCandidateProviderId(provider.id);
                                  setProviderDropdownOpen(false);
                                  setProviderSearchQuery('');
                                }}
                                className="flex items-center justify-between"
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <ProviderLogo providerId={provider.id} className="h-4 w-4 flex-shrink-0" />
                                  <span className="truncate">{provider.name || provider.id}</span>
                                </span>
                                {candidateProviderId === provider.id && (
                                  <Icon name="check" className="h-4 w-4 text-[var(--primary-base)]" />
                                )}
                              </DropdownMenuItem>
                            ));
                          })()}
                        </ScrollableOverlay>
                      </DropdownMenuContent>
                    </DropdownMenu>
                   )}
              </div>
            </section>

            <div className="px-2 pb-2">
              <button
                type="button"
                onClick={openCreateCustomProvider}
                className="typography-ui-label text-[var(--primary-base)] hover:underline"
              >
                {t('settings.providers.page.custom.optionLabel')}
              </button>
            </div>
          </div>

          {candidateProviderId && (
            <div className="mb-8">
              <div className="mb-1 px-1">
                <h2 className="typography-ui-header font-medium text-foreground">{t('settings.providers.page.auth.title')}</h2>
              </div>

              {authLoading ? (
                <p className="typography-meta text-muted-foreground px-2">{t('settings.providers.page.auth.loadingMethods')}</p>
              ) : (
                <section className="px-2 pb-2 pt-0 space-y-4">
                  {(() => {
                    const candidateAuthMethods = authMethodsByProvider[candidateProviderId] ?? [];
                    const candidateOAuthMethods = toOAuthMethods(
                      getOAuthAuthMethods(candidateAuthMethods),
                      t,
                    );
                    const showApiKey = shouldShowApiKeyAuth(candidateAuthMethods);

                    return (
                      <>
                        {showApiKey ? (
                          <div className="py-1.5">
                            <label className="typography-ui-label text-foreground flex items-center gap-1.5">
                              {t('settings.providers.page.auth.apiKeyLabel')}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Icon name="information" className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent sideOffset={8} className="max-w-xs">
                                  {t('settings.providers.page.auth.apiKeyTooltip')}
                                </TooltipContent>
                              </Tooltip>
                            </label>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-1.5">
                              <Input
                                type="password"
                                value={apiKeyInputs[candidateProviderId] ?? ''}
                                onChange={(event) =>
                                  setApiKeyInputs((prev) => ({
                                    ...prev,
                                    [candidateProviderId]: event.target.value,
                                  }))
                                }
                                placeholder={t('settings.providers.page.auth.apiKeyPlaceholder')}
                                className="flex-1 font-mono text-xs"
                              />
                              <Button
                                size="xs"
                                className="!font-normal shrink-0"
                                onClick={() => handleSaveApiKey(candidateProviderId)}
                                disabled={authBusyKey === `api:${candidateProviderId}`}
                              >
                                {authBusyKey === `api:${candidateProviderId}` ? t('settings.providers.page.actions.saving') : t('settings.providers.page.actions.saveKey')}
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        {candidateOAuthMethods.length > 0 ? (
                          <ProviderOAuthMethods
                            key={candidateProviderId}
                            providerId={candidateProviderId}
                            methods={candidateOAuthMethods}
                            serverBaseUrl={baseUrl}
                            onConnected={() => handleOAuthConnected(candidateProviderId)}
                            className={cn(showApiKey && 'border-t border-[var(--surface-subtle)] pt-2')}
                          />
                        ) : null}
                      </>
                    );
                  })()}
                </section>
              )}
            </div>
          )}
        </div>
      </ScrollableOverlay>
    );
  }

  if (!selectedProvider) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Icon name="stack" className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">{t('settings.providers.page.empty.selectProviderFromSidebar')}</p>
          <p className="typography-meta mt-1 opacity-75">{t('settings.providers.page.empty.reviewDetailsAndConfigureAuth')}</p>
        </div>
      </div>
    );
  }

  const providerModels = Array.isArray(selectedProvider.models) ? selectedProvider.models : [];
  const providerAuthMethods = authMethodsByProvider[selectedProvider.id] ?? [];
  const oauthAuthMethods = toOAuthMethods(
    getOAuthAuthMethods(providerAuthMethods),
    t,
  );
  const showApiKeyAuth = shouldShowApiKeyAuth(providerAuthMethods);
  const sourcesLoaded = Boolean(selectedSources);
  const providerEnv = Array.isArray(selectedProvider.env)
    ? selectedProvider.env.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const hasStoredAuth = Boolean(selectedSources?.auth.exists);
  const hasEnvCredentials = providerEnv.length > 0;
  const hasCredentials = hasStoredAuth || hasEnvCredentials;
  const authStatusIncomplete = sourcesLoaded && !hasCredentials;
  const showModelsSection = providerModels.length > 0 && (!sourcesLoaded || hasCredentials);

  const filteredModels = providerModels.filter((model) => {
    const name = typeof model?.name === 'string' ? model.name : '';
    const id = typeof model?.id === 'string' ? model.id : '';
    const query = modelQuery.trim().toLowerCase();
    if (!query) return true;
    return name.toLowerCase().includes(query) || id.toLowerCase().includes(query);
  });

  if (customMode === 'edit' && customEditProviderId) {
    return (
      <ScrollableOverlay outerClassName="h-full" className="w-full">
        <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">
          <CustomProviderForm
            existingProviderIDs={new Set(providers.map((p) => p.id))}
            disabledProviders={[customEditProviderId]}
            busy={customBusy}
            mode="edit"
            initialValues={customInitial ?? undefined}
            allowExistingAuth={customAllowExistingAuth}
            authFailureHint={customAuthFailure}
            onSubmit={(plan) => void submitCustomProvider(plan)}
            onCancel={closeCustomProvider}
            onDisconnect={() => handleDisconnectProvider(customEditProviderId)}
          />
        </div>
      </ScrollableOverlay>
    );
  }

  return (
    <ScrollableOverlay outerClassName="h-full" className="w-full">
      <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">

        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <ProviderLogo providerId={selectedProvider.id} className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <h2 className="typography-ui-header font-semibold text-foreground truncate">
              {selectedProvider.name || selectedProvider.id}
            </h2>
            <p className="typography-meta text-muted-foreground truncate">
              <span className="font-mono">{selectedProvider.id}</span>
            </p>
          </div>
        </div>

        {/* Authentication */}
        <div className="mb-8">
          <div className="mb-1 px-1 flex items-center justify-between gap-2">
            <h3 className="typography-ui-header font-medium text-foreground">{t('settings.providers.page.auth.title')}</h3>
            <Button
              variant="outline"
              size="xs"
              className="!font-normal"
              onClick={() => setShowAuthPanel((prev) => !prev)}
            >
              {showAuthPanel ? t('settings.providers.page.actions.hide') : t('settings.providers.page.actions.reconnect')}
            </Button>
          </div>

          <section className="px-2 pb-2 pt-0">
            {!showAuthPanel ? (
              authStatusIncomplete ? (
                <div className="flex items-center gap-1.5 py-1.5">
                  <Icon name="alert" className="w-4 h-4 text-[var(--status-warning)] shrink-0" />
                  <span className="typography-ui-label text-foreground">{t('settings.providers.page.auth.incomplete')}</span>
                  <span className="typography-meta text-muted-foreground ml-1">{t('settings.providers.page.auth.useReconnectHint')}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 py-1.5">
                  <Icon name="check" className="w-4 h-4 text-[var(--status-success)] shrink-0" />
                  <span className="typography-ui-label text-foreground">{t('settings.providers.page.auth.connected')}</span>
                  <span className="typography-meta text-muted-foreground ml-1">{t('settings.providers.page.auth.useReconnectHint')}</span>
                </div>
              )
            ) : authLoading ? (
              <div className="py-1.5 typography-meta text-muted-foreground">{t('settings.providers.page.auth.loadingMethods')}</div>
            ) : (
              <div className="space-y-4">
                {showApiKeyAuth ? (
                  <div className="py-1.5">
                    <label className="typography-ui-label text-foreground flex items-center gap-1.5">
                      {t('settings.providers.page.auth.apiKeyLabel')}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Icon name="information" className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent sideOffset={8} className="max-w-xs">
                          {t('settings.providers.page.auth.apiKeyTooltip')}
                        </TooltipContent>
                      </Tooltip>
                    </label>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-1.5">
                      <Input
                        type="password"
                        value={apiKeyInputs[selectedProvider.id] ?? ''}
                        onChange={(event) =>
                          setApiKeyInputs((prev) => ({
                            ...prev,
                            [selectedProvider.id]: event.target.value,
                          }))
                        }
                        placeholder={t('settings.providers.page.auth.apiKeyPlaceholder')}
                        className="flex-1 font-mono text-xs"
                      />
                      <Button
                        size="xs"
                        className="!font-normal shrink-0"
                        onClick={() => handleSaveApiKey(selectedProvider.id)}
                        disabled={authBusyKey === `api:${selectedProvider.id}`}
                      >
                        {authBusyKey === `api:${selectedProvider.id}` ? t('settings.providers.page.actions.saving') : t('settings.providers.page.actions.saveKey')}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {oauthAuthMethods.length > 0 && (
                  <ProviderOAuthMethods
                    key={selectedProvider.id}
                    providerId={selectedProvider.id}
                    methods={oauthAuthMethods}
                    serverBaseUrl={baseUrl}
                    onConnected={() => handleOAuthConnected(selectedProvider.id)}
                    className={cn(showApiKeyAuth && 'border-t border-[var(--surface-subtle)] pt-2')}
                  />
                )}
              </div>
            )}
          </section>
        </div>

        {/* Connection Details */}
        <div className="mb-8">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">{t('settings.providers.page.connectionDetails.title')}</h3>
          </div>

          <section className="px-2 pb-2 pt-0">
            <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
              <div className="flex min-w-0 flex-col">
                {selectedSources && (selectedSources.auth.exists || selectedSources.user.exists || selectedSources.project.exists || selectedSources.custom?.exists) ? (
                  <span className="typography-meta text-muted-foreground">
                    {t('settings.providers.page.connectionDetails.configuredIn')}{' '}
                    {[
                      selectedSources.auth.exists ? t('settings.providers.page.connectionDetails.source.authCredentials') : null,
                      selectedSources.user.exists ? t('settings.providers.page.connectionDetails.source.userConfig') : null,
                      selectedSources.project.exists ? t('settings.providers.page.connectionDetails.source.projectConfig') : null,
                      selectedSources.custom?.exists ? t('settings.providers.page.connectionDetails.source.customConfig') : null,
                    ].filter(Boolean).join(', ')}
                  </span>
                ) : (
                  <span className="typography-meta text-muted-foreground">{t('settings.providers.page.connectionDetails.noActiveSource')}</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {(() => {
                  const selected = providers.find((p) => p.id === selectedProviderId);
                  if (!selected || !isConfigDefinedCustomProvider(selected, selectedSources)) {
                    return null;
                  }
                  return (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="!font-normal"
                      onClick={() => openEditCustomProvider(selected.id)}
                    >
                      {t('settings.providers.page.actions.edit')}
                    </Button>
                  );
                })()}
                <Button
                  variant="ghost"
                  size="xs"
                  className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)]"
                  onClick={() => handleDisconnectProvider(selectedProvider.id)}
                  disabled={authBusyKey === `disconnect:${selectedProvider.id}`}
                >
                  {authBusyKey === `disconnect:${selectedProvider.id}` ? t('settings.providers.page.actions.disconnecting') : t('settings.providers.page.actions.disconnect')}
                </Button>
              </div>
            </div>
          </section>
        </div>

        {/* Models */}
        {showModelsSection && (
        <div className="mb-8">
          <div className="mb-1 px-1 flex items-center justify-between gap-2">
            <h3 className="typography-ui-header font-medium text-foreground">
              {t('settings.providers.page.models.title')}
              {providerModels.length > 0 && (
                <span className="ml-1.5 typography-micro text-muted-foreground font-normal">
                  ({providerModels.length})
                </span>
              )}
            </h3>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="xs"
                className="!font-normal"
                disabled={isRemote}
                onClick={() => {
                  const allIds = providerModels
                    .map((model) => (typeof model?.id === 'string' ? model.id : ''))
                    .filter((id) => id.length > 0);
                  hideAllModels(selectedProvider.id, allIds);
                }}
              >
                {t('settings.providers.page.actions.hideAll')}
              </Button>
              <Button
                variant="outline"
                size="xs"
                className="!font-normal"
                disabled={isRemote}
                onClick={() => showAllModels(selectedProvider.id)}
              >
                {t('settings.providers.page.actions.showAll')}
              </Button>
            </div>
          </div>

          <section className="px-2 pb-2 pt-0">
            <div className="relative mb-2">
              <Icon name="search" className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder={t('settings.providers.page.models.filterPlaceholder')}
                className="h-7 pl-8 w-full"
              />
            </div>

            {filteredModels.length === 0 ? (
              <p className="typography-meta text-muted-foreground py-4 text-center">{t('settings.providers.page.models.noModelsMatchFilter')}</p>
            ) : (
              <div className="divide-y divide-[var(--surface-subtle)]">
                {filteredModels.map((model) => {
                  const modelId = typeof model?.id === 'string' ? model.id : '';
                  const modelName = typeof model?.name === 'string' ? model.name : modelId;
                  const metadata = modelId ? getModelMetadata(selectedProvider.id, modelId) as ModelMetadata | undefined : undefined;
                  const isHidden = effectiveHiddenModels.some(
                    (item) => item.providerID === selectedProvider.id && item.modelID === modelId
                  );

                  const contextTokens = formatTokens(metadata?.limit?.context);
                  const outputTokens = formatTokens(metadata?.limit?.output);

                  const capabilityIcons: Array<{ key: string; icon: IconName; label: string }> = [];
                  if (metadata?.tool_call) capabilityIcons.push({ key: 'tools', icon: "tools", label: t('settings.providers.page.models.capability.toolCalling') });
                  if (metadata?.reasoning) capabilityIcons.push({ key: 'reasoning', icon: "brain-ai-3", label: t('settings.providers.page.models.capability.reasoning') });
                  if (metadata?.attachment) capabilityIcons.push({ key: 'image', icon: "file-image", label: t('settings.providers.page.models.capability.imageInput') });

                  return (
                    <div key={modelId} className="py-1.5">
                      <div
                        className={cn(
                          "flex items-center gap-3",
                          isHidden && 'opacity-50',
                        )}
                      >
                      <span className="typography-meta font-medium text-foreground truncate flex-1 min-w-0">
                        {modelName}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {(contextTokens || outputTokens) && (
                          <span className="typography-micro text-muted-foreground flex-shrink-0 bg-[var(--surface-muted)] px-1.5 py-0.5 rounded">
                            {contextTokens ? `${contextTokens} ${t('settings.providers.page.models.tokenBadge.context')}` : ''}
                            {contextTokens && outputTokens ? ' · ' : ''}
                            {outputTokens ? `${outputTokens} ${t('settings.providers.page.models.tokenBadge.output')}` : ''}
                          </span>
                        )}
                        {capabilityIcons.length > 0 && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {capabilityIcons.map(({ key, icon: iconName, label }) => (
                              <span
                                key={key}
                                className="flex h-5 w-5 rounded items-center justify-center text-muted-foreground bg-[var(--surface-muted)]"
                                title={label}
                                aria-label={label}
                              >
                                <Icon name={iconName} className="h-3 w-3" />
                              </span>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={isRemote}
                          onClick={() => toggleHiddenModel(selectedProvider.id, modelId)}
                          className={cn(
                            'flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--interactive-hover)]/50 disabled:opacity-40 disabled:pointer-events-none',
                            isHidden ? 'text-muted-foreground hover:text-foreground' : 'text-foreground',
                          )}
                          title={isHidden ? t('settings.providers.page.models.actions.showModelInSelectors') : t('settings.providers.page.models.actions.hideModelFromSelectors')}
                          aria-label={isHidden ? t('settings.providers.page.models.actions.showModel') : t('settings.providers.page.models.actions.hideModel')}
                        >
                          {isHidden ? <Icon name="eye-off" className="h-3.5 w-3.5" /> : <Icon name="eye" className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
        )}
      </div>
    </ScrollableOverlay>
  );
};
