import React from 'react';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { Button } from '@/components/ui/button';
import { Icon } from "@/components/icon/Icon";
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';
import type { SubscriptionProvider } from './useSubscriptions';
import { useSubscriptions } from './useSubscriptions';
import { SubscriptionAuthActions } from './SubscriptionAuthActions';
import { SubscriptionQuotaGlance } from './SubscriptionQuotaGlance';

const Badge: React.FC<{ children: React.ReactNode; tone?: 'default' | 'muted' | 'success' | 'warning' }> = ({
  children,
  tone = 'default',
}) => {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 typography-micro',
        tone === 'default' && 'bg-[var(--surface-muted)] text-foreground',
        tone === 'muted' && 'bg-[var(--surface-muted)] text-muted-foreground',
        tone === 'success' && 'bg-[var(--status-success)]/10 text-[var(--status-success)]',
        tone === 'warning' && 'bg-[var(--status-warning)]/10 text-[var(--status-warning)]',
      )}
    >
      {children}
    </span>
  );
};

const AuthSourceBadge: React.FC<{ provider: SubscriptionProvider }> = ({ provider }) => {
  const { t } = useI18n();
  const { configured, source } = provider.auth;

  if (!configured || source === 'none') {
    return <Badge tone="muted">{t('settings.subscriptions.page.auth.source.none')}</Badge>;
  }
  switch (source) {
    case 'api':
      return <Badge tone="success">{t('settings.subscriptions.page.auth.source.api')}</Badge>;
    case 'env':
      return <Badge tone="success">{t('settings.subscriptions.page.auth.source.env')}</Badge>;
    case 'config':
      return <Badge tone="success">{t('settings.subscriptions.page.auth.source.config')}</Badge>;
    case 'custom':
      return <Badge tone="success">{t('settings.subscriptions.page.auth.source.custom')}</Badge>;
    default:
      return <Badge tone="muted">{t('settings.subscriptions.page.auth.type.unknown')}</Badge>;
  }
};

const AuthTypeBadge: React.FC<{ provider: SubscriptionProvider }> = ({ provider }) => {
  const { t } = useI18n();
  const { type } = provider.auth;
  if (type === 'api') {
    return <Badge>{t('settings.subscriptions.page.auth.type.api')}</Badge>;
  }
  if (type === 'oauth') {
    return <Badge>{t('settings.subscriptions.page.auth.type.oauth')}</Badge>;
  }
  return <Badge tone="muted">{t('settings.subscriptions.page.auth.type.unknown')}</Badge>;
};

const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
  <div className="mb-1 px-1">
    <h3 className="typography-ui-header font-medium text-foreground">{title}</h3>
  </div>
);

export const SubscriptionsPage: React.FC = () => {
  const { t } = useI18n();
  const {
    providers,
    degraded,
    fetchFailed,
    isLoading,
    instanceLoading,
    selectedProviderId,
    setSelectedProvider,
    refresh,
  } = useSubscriptions();
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);

  React.useEffect(() => {
    if (providers.length === 0) {
      return;
    }
    if (selectedProviderId && providers.some((provider) => provider.id === selectedProviderId)) {
      return;
    }
    const firstConfigured = providers.find((provider) => provider.auth.configured)?.id;
    setSelectedProvider(firstConfigured ?? providers[0]?.id ?? null);
  }, [providers, selectedProviderId, setSelectedProvider]);

  if (instanceLoading || (isLoading && providers.length === 0)) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Icon name="loader-4" className="mx-auto mb-3 h-8 w-8 animate-spin opacity-60" />
          <p className="typography-body">{t('settings.subscriptions.page.state.loading')}</p>
        </div>
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Icon name={fetchFailed ? 'cloud-off' : 'stack'} className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">
            {fetchFailed
              ? t('settings.subscriptions.page.unavailable.title')
              : t('settings.subscriptions.page.empty.noProviders')}
          </p>
          <p className="typography-meta mt-1 opacity-75">
            {fetchFailed
              ? t('settings.subscriptions.page.unavailable.description')
              : t('settings.subscriptions.page.empty.checkConfiguration')}
          </p>
        </div>
      </div>
    );
  }

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);

  if (!selectedProvider) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Icon name="stack" className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">{t('settings.subscriptions.page.empty.selectProvider')}</p>
        </div>
      </div>
    );
  }

  const showDegradedNotice = degraded || fetchFailed;
  const configSources: string[] = [];
  if (selectedProvider.config.user) configSources.push(t('settings.subscriptions.page.configSource.user'));
  if (selectedProvider.config.project) configSources.push(t('settings.subscriptions.page.configSource.project'));
  if (selectedProvider.config.custom) configSources.push(t('settings.subscriptions.page.configSource.custom'));

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

        {/* Degraded / partial data notice */}
        {showDegradedNotice && (
          <div className="mb-8 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] px-4 py-3">
            <p className="typography-ui-label font-medium text-[var(--status-warning)]">
              {t('settings.subscriptions.page.degraded.title')}
            </p>
            <p className="typography-meta text-[var(--status-warning)]/80 mt-1">
              {t('settings.subscriptions.page.degraded.description')}
            </p>
          </div>
        )}

        {/* Authentication */}
        <div className="mb-8">
          <SectionHeader title={t('settings.subscriptions.page.section.auth')} />
          <section className="px-2 pb-2 pt-0">
            <div className="flex flex-wrap items-center gap-1.5 py-1.5">
              <AuthSourceBadge provider={selectedProvider} />
              {/* AuthTypeBadge is only meaningful when it adds information beyond the
                  source badge: i.e. when a credential is stored via a subscription/plugin
                  (source 'custom') and its type is known to be OAuth. For source 'api'/'env'
                  the type is already implied by the source badge, so we omit it to avoid a
                  duplicate-looking pair like "API key / API key". */}
              {selectedProvider.auth.configured
                && selectedProvider.auth.source === 'custom'
                && selectedProvider.auth.type !== 'unknown'
                && <AuthTypeBadge provider={selectedProvider} />}
            </div>
            {selectedProvider.auth.envVars.length > 0 && (
              <div className="py-1.5">
                <span className="typography-meta text-muted-foreground">
                  {t('settings.subscriptions.page.auth.envVarsLabel')}
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {selectedProvider.auth.envVars.map((envVar) => (
                    <span
                      key={envVar}
                      className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono typography-micro text-foreground"
                    >
                      {envVar}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <SubscriptionAuthActions provider={selectedProvider} onChanged={refresh} />
          </section>
        </div>

        {/* Quota */}
        <div className="mb-8">
          <SectionHeader title={t('settings.subscriptions.page.section.quota')} />
          <section className="px-2 pb-2 pt-0">
            {selectedProvider.quota.configured ? (
              <div className="py-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="typography-ui-label text-foreground">
                    {t('settings.subscriptions.page.quota.configured')}
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    className="!font-normal"
                    onClick={() => setSettingsPage('usage')}
                  >
                    {t('settings.subscriptions.page.quota.openUsage')}
                  </Button>
                </div>
                {selectedProvider.quota.providerId && (
                  <SubscriptionQuotaGlance quotaProviderId={selectedProvider.quota.providerId} />
                )}
              </div>
            ) : (
              <p className="typography-meta text-muted-foreground py-1.5">
                {t('settings.subscriptions.page.quota.notConfigured')}
              </p>
            )}
          </section>
        </div>

        {/* Config source */}
        <div className="mb-8">
          <SectionHeader title={t('settings.subscriptions.page.section.configSource')} />
          <section className="px-2 pb-2 pt-0">
            {configSources.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 py-1.5">
                {configSources.map((label) => (
                  <Badge key={label}>{label}</Badge>
                ))}
              </div>
            ) : (
              <p className="typography-meta text-muted-foreground py-1.5">
                {t('settings.subscriptions.page.configSource.none')}
              </p>
            )}
          </section>
        </div>

        {/* Egress (read-only) */}
        <div className="mb-8">
          <SectionHeader title={t('settings.subscriptions.page.section.egress')} />
          <section className="px-2 pb-2 pt-0">
            <div className="flex flex-wrap items-center gap-1.5 py-1.5">
              <Badge>{t('settings.subscriptions.page.egress.direct')}</Badge>
            </div>
            <p className="typography-meta text-muted-foreground">
              {t('settings.subscriptions.page.egress.description')}
            </p>
          </section>
        </div>

        {/* Conflicts */}
        {selectedProvider.conflicts.length > 0 && (
          <div className="mb-8">
            <SectionHeader title={t('settings.subscriptions.page.section.conflicts')} />
            <section className="px-2 pb-2 pt-0 space-y-2">
              {selectedProvider.conflicts.map((conflict, index) => (
                <div
                  key={`${conflict.type}-${index}`}
                  className="flex items-start gap-2 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] px-3 py-2"
                >
                  <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" />
                  <p className="typography-meta text-[var(--status-warning)]/90">{conflict.message}</p>
                </div>
              ))}
            </section>
          </div>
        )}

      </div>
    </ScrollableOverlay>
  );
};
