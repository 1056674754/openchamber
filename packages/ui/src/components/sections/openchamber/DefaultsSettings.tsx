import React from 'react';
import { ModelSelector } from '@/components/sections/agents/ModelSelector';
import { AgentSelector } from '@/components/sections/commands/AgentSelector';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { NumberInput } from '@/components/ui/number-input';
import { updateDesktopSettings } from '@/lib/persistence';
import { useConfigStore } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { parseModelIdentifier } from '@/lib/modelIdentifier';

const getDisplayModel = (
  storedModel: string | undefined
): { providerId: string; modelId: string } => {
  const parsed = parseModelIdentifier(storedModel);
  if (parsed) {
    return parsed;
  }

  return { providerId: '', modelId: '' };
};

export const DefaultsSettings: React.FC = () => {
  const { t } = useI18n();
  const setProvider = useConfigStore((state) => state.setProvider);
  const setModel = useConfigStore((state) => state.setModel);
  const setAgent = useConfigStore((state) => state.setAgent);
  const setCurrentVariant = useConfigStore((state) => state.setCurrentVariant);
  const setSettingsDefaultModel = useConfigStore((state) => state.setSettingsDefaultModel);
  const setSettingsDefaultVariant = useConfigStore((state) => state.setSettingsDefaultVariant);
  const setSettingsDefaultAgent = useConfigStore((state) => state.setSettingsDefaultAgent);
  const setSettingsDefaultFileViewerPreview = useConfigStore((state) => state.setSettingsDefaultFileViewerPreview);
  const settingsDefaultFileViewerPreview = useConfigStore((state) => state.settingsDefaultFileViewerPreview);
  const configDefaultModel = useConfigStore((state) => state.settingsDefaultModel);
  const configDefaultVariant = useConfigStore((state) => state.settingsDefaultVariant);
  const configDefaultAgent = useConfigStore((state) => state.settingsDefaultAgent);
  const showDeletionDialog = useUIStore((state) => state.showDeletionDialog);
  const setShowDeletionDialog = useUIStore((state) => state.setShowDeletionDialog);
  const sessionSortMode = useUIStore((state) => state.sessionSortMode);
  const setSessionSortMode = useUIStore((state) => state.setSessionSortMode);
  const sessionGroupMinVisible = useUIStore((state) => state.sessionGroupMinVisible);
  const setSessionGroupMinVisible = useUIStore((state) => state.setSessionGroupMinVisible);
  const sessionGroupRecentHours = useUIStore((state) => state.sessionGroupRecentHours);
  const setSessionGroupRecentHours = useUIStore((state) => state.setSessionGroupRecentHours);
  const providers = useConfigStore((state) => state.providers);

  const [defaultModel, setDefaultModel] = React.useState<string | undefined>(configDefaultModel);
  const [defaultVariant, setDefaultVariant] = React.useState<string | undefined>(configDefaultVariant);
  const [defaultAgent, setDefaultAgent] = React.useState<string | undefined>(configDefaultAgent);
  const [isLoading, setIsLoading] = React.useState(!configDefaultModel && !configDefaultAgent);

  const parsedModel = React.useMemo(() => getDisplayModel(defaultModel), [defaultModel]);

  React.useEffect(() => {
    if (configDefaultModel && !defaultModel) {
      setDefaultModel(configDefaultModel);
    }
  }, [configDefaultModel, defaultModel]);

  React.useEffect(() => {
    if (configDefaultAgent && !defaultAgent) {
      setDefaultAgent(configDefaultAgent);
    }
  }, [configDefaultAgent, defaultAgent]);

  React.useEffect(() => {
    if (configDefaultVariant) {
      setDefaultVariant(configDefaultVariant);
    }
  }, [configDefaultVariant]);

  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        let data: {
          defaultModel?: string;
          defaultVariant?: string;
          defaultAgent?: string;
        } | null = null;

        if (!data) {
          const runtimeSettings = getRegisteredRuntimeAPIs()?.settings;
          if (runtimeSettings) {
            try {
              const result = await runtimeSettings.load();
              const settings = result?.settings;
              if (settings) {
                data = {
                  defaultModel: typeof settings.defaultModel === 'string' ? settings.defaultModel : undefined,
                  defaultVariant:
                    typeof (settings as Record<string, unknown>).defaultVariant === 'string'
                      ? ((settings as Record<string, unknown>).defaultVariant as string)
                      : undefined,
                  defaultAgent: typeof settings.defaultAgent === 'string' ? settings.defaultAgent : undefined,
                };
              }
            } catch {
              // fall through
            }
          }
        }

        if (!data) {
          const response = await fetch('/api/config/settings', {
            method: 'GET',
            headers: { Accept: 'application/json' },
          });
          if (response.ok) {
            data = await response.json();
          }
        }

        if (data) {
          const model =
            typeof data.defaultModel === 'string' && data.defaultModel.trim().length > 0
              ? data.defaultModel.trim()
              : undefined;
          const variant =
            typeof data.defaultVariant === 'string' && data.defaultVariant.trim().length > 0
              ? data.defaultVariant.trim()
              : undefined;
          const agent =
            typeof data.defaultAgent === 'string' && data.defaultAgent.trim().length > 0
              ? data.defaultAgent.trim()
              : undefined;

          if (model !== undefined) setDefaultModel(model);
          if (variant !== undefined) setDefaultVariant(variant);
          if (agent !== undefined) setDefaultAgent(agent);
        }
      } catch (error) {
        console.warn('Failed to load defaults settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleModelChange = React.useCallback(
    async (providerId: string, modelId: string) => {
      const newValue = providerId && modelId ? `${providerId}/${modelId}` : undefined;
      setDefaultModel(newValue);
      setDefaultVariant(undefined);
      setSettingsDefaultVariant(undefined);
      setCurrentVariant(undefined);
      setSettingsDefaultModel(newValue);

      if (providerId && modelId) {
        const provider = providers.find((p) => p.id === providerId);
        if (provider) {
          setProvider(providerId);
          setModel(modelId);
        }
      }

      try {
        await updateDesktopSettings({ defaultModel: newValue ?? '', defaultVariant: '' });
        const response = await fetch('/api/config/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultModel: newValue }),
        });
        if (!response.ok) {
          console.warn('Failed to save default model to server:', response.status, response.statusText);
        }
      } catch (error) {
        console.warn('Failed to save default model:', error);
      }
    },
    [providers, setCurrentVariant, setModel, setProvider, setSettingsDefaultModel, setSettingsDefaultVariant]
  );

  const DEFAULT_VARIANT_VALUE = '__default__';

  const formatVariantLabel = React.useCallback((variant: string) => {
    if (variant === DEFAULT_VARIANT_VALUE) {
      return t('settings.openchamber.defaults.option.default');
    }
    return variant.charAt(0).toUpperCase() + variant.slice(1);
  }, [t]);

  const handleVariantChange = React.useCallback(
    async (variant: string) => {
      const newValue = variant === DEFAULT_VARIANT_VALUE ? undefined : variant || undefined;
      setDefaultVariant(newValue);
      setSettingsDefaultVariant(newValue);
      setCurrentVariant(newValue);

      try {
        await updateDesktopSettings({ defaultVariant: newValue ?? '' });
      } catch (error) {
        console.warn('Failed to save default variant:', error);
      }
    },
    [setCurrentVariant, setSettingsDefaultVariant]
  );

  const handleAgentChange = React.useCallback(
    async (agentName: string) => {
      const newValue = agentName || undefined;
      setDefaultAgent(newValue);
      setSettingsDefaultAgent(newValue);

      if (agentName) {
        setAgent(agentName);
      }

      try {
        await updateDesktopSettings({ defaultAgent: newValue ?? '' });
      } catch (error) {
        console.warn('Failed to save default agent:', error);
      }
    },
    [setAgent, setSettingsDefaultAgent]
  );

  const handleToggleFileViewerPreview = React.useCallback(() => {
    const next = !settingsDefaultFileViewerPreview;
    setSettingsDefaultFileViewerPreview(next);
    updateDesktopSettings({ defaultFileViewerPreview: next }).catch(console.warn);
  }, [settingsDefaultFileViewerPreview, setSettingsDefaultFileViewerPreview]);

  const availableVariants = React.useMemo(() => {
    if (!parsedModel.providerId || !parsedModel.modelId) return [];
    const provider = providers.find((p) => p.id === parsedModel.providerId);
    const model = provider?.models.find((m: Record<string, unknown>) => (m as { id?: string }).id === parsedModel.modelId) as
      | { variants?: Record<string, unknown> }
      | undefined;
    const variants = model?.variants;
    if (!variants) return [];
    return Object.keys(variants);
  }, [parsedModel.modelId, parsedModel.providerId, providers]);

  const supportsVariants = availableVariants.length > 0;

  React.useEffect(() => {
    if (!supportsVariants && defaultVariant) {
      setDefaultVariant(undefined);
      setSettingsDefaultVariant(undefined);
      setCurrentVariant(undefined);
      updateDesktopSettings({ defaultVariant: '' }).catch(() => {
        // best effort
      });
    }
  }, [defaultVariant, setCurrentVariant, setSettingsDefaultVariant, supportsVariants]);

  if (isLoading) {
    return null;
  }

  return (
    <div className="mb-6">
      <div className="mb-0.5 px-1">
        <div className="flex items-center gap-2">
          <h3 className="typography-ui-header font-medium text-foreground">{t('settings.openchamber.defaults.title')}</h3>
        </div>
      </div>

      <section className="px-2 pb-2 pt-0 space-y-0">
        <div className="mt-0 mb-1 typography-meta text-muted-foreground">
          {t('settings.openchamber.defaults.summaryPrefix')}
          {' '}
          {parsedModel.providerId ? (
            <span className="text-foreground">
              {parsedModel.providerId}/{parsedModel.modelId}
              {supportsVariants ? ` (${defaultVariant ?? t('settings.openchamber.defaults.option.defaultLowercase')})` : ''}
            </span>
          ) : (
            <span className="text-foreground">{t('settings.openchamber.defaults.summaryOpenCodeDefault')}</span>
          )}
          {defaultAgent && (
            <>
              {' / '}
              <span className="text-foreground">{defaultAgent}</span>
            </>
          )}
        </div>

        <div className={cn('flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:gap-8')}>
          <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
            <span className="typography-ui-label text-foreground">{t('settings.openchamber.defaults.field.defaultModel')}</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
            <ModelSelector providerId={parsedModel.providerId} modelId={parsedModel.modelId} onChange={handleModelChange} />
          </div>
        </div>

        <div className="flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:gap-8">
          <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
            <span className="typography-ui-label text-foreground">{t('settings.openchamber.defaults.field.defaultThinking')}</span>
          </div>
          <div className="flex items-center gap-2 sm:w-fit">
            <Select value={defaultVariant ?? DEFAULT_VARIANT_VALUE} onValueChange={handleVariantChange} disabled={!supportsVariants}>
              <SelectTrigger className="w-fit min-w-[120px]">
                <SelectValue placeholder={t('settings.openchamber.defaults.field.thinkingPlaceholder')}>
                  {formatVariantLabel(defaultVariant ?? DEFAULT_VARIANT_VALUE)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_VARIANT_VALUE}>{t('settings.openchamber.defaults.option.default')}</SelectItem>
                {availableVariants.map((variant) => (
                  <SelectItem key={variant} value={variant}>
                    {formatVariantLabel(variant)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:gap-8">
          <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
            <span className="typography-ui-label text-foreground">{t('settings.openchamber.defaults.field.defaultAgent')}</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
            <AgentSelector agentName={defaultAgent || ''} onChange={handleAgentChange} />
          </div>
        </div>

        <div className={cn('flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:gap-8')}>
          <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
            <span className="typography-ui-label text-foreground">{t('settings.openchamber.defaults.field.sessionSortMode')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {(['updated-desc', 'created-desc'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors border !min-h-0 leading-none select-none !font-normal',
                  sessionSortMode === mode
                    ? 'border-[var(--primary-base)]/60 text-[var(--primary-base)]/80 bg-[var(--primary-base)]/5'
                    : 'border-[var(--interactive-border)] text-[var(--surface-foreground)] bg-[var(--surface-elevated)] hover:bg-[var(--interactive-hover)]'
              )}
              onClick={() => { setSessionSortMode(mode); updateDesktopSettings({ sessionSortMode: mode }).catch(console.warn); }}
            >
              {t(`settings.openchamber.defaults.field.sessionSortMode${mode === 'updated-desc' ? 'Updated' : 'Created'}`)}
            </button>
          ))}
        </div>
      </div>

      <div className={cn('flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:gap-8')}>
        <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
          <span className="typography-ui-label text-foreground">{t('settings.openchamber.defaults.field.sessionGroupMinVisible')}</span>
          <span className="typography-meta text-muted-foreground">{t('settings.openchamber.defaults.field.sessionGroupMinVisibleDesc')}</span>
        </div>
        <div className="flex items-center gap-2 sm:w-fit">
          <NumberInput
            value={sessionGroupMinVisible}
            onValueChange={(v) => {
              setSessionGroupMinVisible(v);
              updateDesktopSettings({ sessionGroupMinVisible: v }).catch(console.warn);
            }}
            min={1}
            max={50}
            step={1}
          />
        </div>
      </div>

      <div className={cn('flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:gap-8')}>
        <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
          <span className="typography-ui-label text-foreground">{t('settings.openchamber.defaults.field.sessionGroupRecentHours')}</span>
          <span className="typography-meta text-muted-foreground">{t('settings.openchamber.defaults.field.sessionGroupRecentHoursDesc')}</span>
        </div>
        <div className="flex items-center gap-2 sm:w-fit">
          <NumberInput
            value={sessionGroupRecentHours}
            onValueChange={(v) => {
              setSessionGroupRecentHours(v);
              updateDesktopSettings({ sessionGroupRecentHours: v }).catch(console.warn);
            }}
            min={1}
            max={720}
            step={1}
          />
        </div>
      </div>

        <div
          className="group flex cursor-pointer items-center gap-2 py-1"
          role="button"
          tabIndex={0}
          aria-pressed={showDeletionDialog}
          onClick={() => setShowDeletionDialog(!showDeletionDialog)}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              setShowDeletionDialog(!showDeletionDialog);
            }
          }}
        >
          <Checkbox checked={showDeletionDialog} onChange={setShowDeletionDialog} ariaLabel={t('settings.openchamber.defaults.field.showDeletionDialogAria')} />
          <span className="typography-ui-label text-foreground">{t('settings.openchamber.defaults.field.showDeletionDialog')}</span>
        </div>

        <div
          className="group flex cursor-pointer items-center gap-2 py-1"
          role="button"
          tabIndex={0}
          aria-pressed={settingsDefaultFileViewerPreview}
          onClick={handleToggleFileViewerPreview}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              handleToggleFileViewerPreview();
            }
          }}
        >
          <Checkbox checked={settingsDefaultFileViewerPreview} onChange={setSettingsDefaultFileViewerPreview} ariaLabel={t('settings.openchamber.defaults.field.openFilesPreviewAria')} />
          <span className="typography-ui-label text-foreground">{t('settings.openchamber.defaults.field.openFilesPreview')}</span>
        </div>

      </section>
    </div>
  );
};
