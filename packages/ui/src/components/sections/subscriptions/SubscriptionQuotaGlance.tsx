import React from 'react';
import { Icon } from "@/components/icon/Icon";
import { useI18n } from '@/lib/i18n';
import { resolveApiUrl } from '@/lib/api/serverUrl';
import { useSettingsServerBaseUrl } from '@/hooks/useSettingsServerBaseUrl';
import type { UsageWindow } from '@/types';
import {
  formatQuotaResetLabel,
  formatQuotaValueLabel,
  formatWindowLabel,
} from '@/lib/quota';

interface SubscriptionQuotaGlanceProps {
  /** Quota provider id reported by /api/subscriptions (provider.quota.providerId). */
  quotaProviderId: string;
}

type GlanceState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; windows: Array<[string, UsageWindow]> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readNullableNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const readNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const parseUsageWindow = (value: unknown): UsageWindow | null => {
  if (!isRecord(value)) {
    return null;
  }
  return {
    usedPercent: readNullableNumber(value.usedPercent),
    remainingPercent: readNullableNumber(value.remainingPercent),
    windowSeconds: readNullableNumber(value.windowSeconds),
    resetAfterSeconds: readNullableNumber(value.resetAfterSeconds),
    resetAt: readNullableNumber(value.resetAt),
    resetAtFormatted: readNullableString(value.resetAtFormatted),
    resetAfterFormatted: readNullableString(value.resetAfterFormatted),
    valueLabel: readNullableString(value.valueLabel),
  };
};

/**
 * M7 quota glance: compact per-window summary for the selected subscription
 * provider. Fetch failures render as a subtle inline note, never a toast.
 */
export const SubscriptionQuotaGlance: React.FC<SubscriptionQuotaGlanceProps> = ({ quotaProviderId }) => {
  const { t } = useI18n();
  const { status: serverStatus, baseUrl } = useSettingsServerBaseUrl();
  const [state, setState] = React.useState<GlanceState>({ status: 'loading' });

  React.useEffect(() => {
    if (serverStatus !== 'ready') {
      return;
    }
    let isMounted = true;
    setState({ status: 'loading' });

    const load = async () => {
      try {
        const response = await fetch(resolveApiUrl(`/api/quota/${encodeURIComponent(quotaProviderId)}`, baseUrl), {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !isRecord(payload)) {
          throw new Error(`Quota request failed (${response.status})`);
        }
        if (payload.ok !== true || !isRecord(payload.usage) || !isRecord(payload.usage.windows)) {
          throw new Error('Quota payload has no usage windows');
        }
        const windows: Array<[string, UsageWindow]> = [];
        for (const [label, value] of Object.entries(payload.usage.windows)) {
          const window = parseUsageWindow(value);
          if (window) {
            windows.push([label, window]);
          }
        }
        if (!isMounted) return;
        setState(windows.length > 0 ? { status: 'ready', windows } : { status: 'unavailable' });
      } catch (error) {
        if (!isMounted) return;
        if (error instanceof Error) {
          console.error('Failed to load quota glance:', error);
        } else {
          console.error('Failed to load quota glance');
        }
        setState({ status: 'unavailable' });
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [serverStatus, baseUrl, quotaProviderId]);

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-1.5 py-1 text-muted-foreground">
        <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin opacity-60" />
        <span className="typography-meta">{t('settings.subscriptions.page.state.loading')}</span>
      </div>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <p className="typography-meta text-muted-foreground/70 py-1">
        {t('settings.subscriptions.page.quota.glance.unavailable')}
      </p>
    );
  }

  return (
    <div className="py-1">
      {state.windows.map(([key, window]) => {
        const showsRemaining = window.remainingPercent !== null;
        const percent = showsRemaining ? window.remainingPercent : window.usedPercent;
        const hasValueLabel = typeof window.valueLabel === 'string'
          && window.valueLabel.trim() !== ''
          && window.valueLabel.trim() !== '-';
        const hasValue = hasValueLabel || percent !== null;
        const value = hasValue
          ? formatQuotaValueLabel(hasValueLabel ? window.valueLabel : null, percent)
          : t('settings.subscriptions.page.quota.glance.notReported');
        const resetLabel = formatQuotaResetLabel(window.resetAt, window.resetAfterFormatted);
        return (
          <div key={key} className="flex flex-wrap items-center justify-between gap-2 py-1">
            <span className="typography-meta text-foreground">{formatWindowLabel(key)}</span>
            <span className="flex items-center gap-2 typography-meta text-muted-foreground">
              <span className="tabular-nums text-foreground">
                {hasValue
                  ? t(
                    showsRemaining
                      ? 'settings.subscriptions.page.quota.glance.remaining'
                      : 'settings.subscriptions.page.quota.glance.used',
                    { value },
                  )
                  : value}
              </span>
              {resetLabel && (
                <span>{t('settings.subscriptions.page.quota.glance.resetsAt', { time: resetLabel })}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
};
