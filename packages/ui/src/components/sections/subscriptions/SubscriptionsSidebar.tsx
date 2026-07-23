import React from 'react';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from "@/components/icon/Icon";
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useSubscriptions } from './useSubscriptions';

interface SubscriptionsSidebarProps {
  onItemSelect?: () => void;
}

export const SubscriptionsSidebar: React.FC<SubscriptionsSidebarProps> = ({ onItemSelect }) => {
  const { t } = useI18n();
  const {
    providers,
    fetchFailed,
    isLoading,
    instanceLoading,
    selectedProviderId,
    setSelectedProvider,
    refresh,
  } = useSubscriptions();

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b px-3 pt-4 pb-3">
        <h2 className="text-base font-semibold text-foreground mb-3">{t('settings.subscriptions.sidebar.title')}</h2>
        <div className="flex items-center justify-between gap-2">
          <span className="typography-meta text-muted-foreground">
            {t('settings.subscriptions.sidebar.total', { count: providers.length })}
          </span>
          <Button size="sm"
            variant="ghost"
            className="h-7 w-7 px-0 -my-1 text-muted-foreground"
            onClick={() => void refresh()}
            aria-label={t('settings.subscriptions.sidebar.actions.refreshAria')}
            title={t('settings.subscriptions.sidebar.actions.refreshTitle')}
            disabled={isLoading || instanceLoading}
          >
            <Icon name="refresh" className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <ScrollableOverlay outerClassName="flex-1 min-h-0" className="space-y-1 px-3 py-2 overflow-x-hidden">
        {instanceLoading || (isLoading && providers.length === 0) ? (
          <div className="py-12 px-4 text-center text-muted-foreground">
            <Icon name="loader-4" className="mx-auto mb-3 h-8 w-8 animate-spin opacity-60" />
            <p className="typography-ui-label font-medium">{t('settings.subscriptions.page.state.loading')}</p>
          </div>
        ) : providers.length === 0 ? (
          <div className="py-12 px-4 text-center text-muted-foreground">
            <Icon name={fetchFailed ? 'cloud-off' : 'stack'} className="mx-auto mb-3 h-10 w-10 opacity-50" />
            <p className="typography-ui-label font-medium">
              {fetchFailed
                ? t('settings.subscriptions.page.unavailable.title')
                : t('settings.subscriptions.sidebar.empty.title')}
            </p>
            <p className="typography-meta mt-1 opacity-75">
              {fetchFailed
                ? t('settings.subscriptions.page.unavailable.description')
                : t('settings.subscriptions.sidebar.empty.description')}
            </p>
          </div>
        ) : (
          providers.map((provider) => {
            const isSelected = provider.id === selectedProviderId;
            const configured = provider.auth.configured;
            return (
              <div
                key={provider.id}
                className={cn(
                  'group relative flex items-center rounded-md px-1.5 py-1 transition-all duration-200',
                  isSelected ? 'bg-interactive-selection' : 'hover:bg-interactive-hover'
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProvider(provider.id);
                    onItemSelect?.();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={configured
                      ? { backgroundColor: 'var(--status-success)' }
                      : { backgroundColor: 'var(--surface-muted-foreground)', opacity: 0.4 }}
                  />
                  <ProviderLogo providerId={provider.id} className="h-4 w-4 flex-shrink-0" />
                  <span className="typography-ui-label font-normal truncate flex-1 min-w-0 text-foreground">
                    {provider.name || provider.id}
                  </span>
                  {provider.quota.configured && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex flex-shrink-0 text-muted-foreground/70">
                          <Icon name="bar-chart-2" className="h-3.5 w-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={8}>
                        {t('settings.subscriptions.sidebar.quotaTrackedTooltip')}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {!configured && (
                    <span className="typography-micro text-muted-foreground/60 flex-shrink-0">
                      {t('settings.subscriptions.sidebar.status.notSet')}
                    </span>
                  )}
                </button>
              </div>
            );
          })
        )}
      </ScrollableOverlay>
    </div>
  );
};
