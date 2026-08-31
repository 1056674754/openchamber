import { useEffect } from 'react';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { I18nKey } from '@/lib/i18n';
import {
  retryFailedSettingsUpdate,
  type SettingsSaveFailure,
} from '@/lib/persistence';

const FAILURE_TOAST_ID = 'settings-save-failed';

const describeFailure = (failure: SettingsSaveFailure, t: (key: I18nKey) => string): string => {
  switch (failure.kind) {
    case 'lock-timeout':
      return t('settings.saveFailed.lockTimeoutDescription');
    case 'network':
      return t('settings.saveFailed.networkDescription');
    case 'http':
      return t('settings.saveFailed.httpDescription');
    default:
      return failure.message;
  }
};

export const useSettingsSaveFailureToast = (): void => {
  const { t } = useI18n();

  useEffect(() => {
    const onFailed = (event: Event) => {
      const failure = (event as CustomEvent<SettingsSaveFailure>).detail;
      toast.error(t('settings.saveFailed.title'), {
        id: FAILURE_TOAST_ID,
        description: describeFailure(failure, t),
        copyText: `${failure.kind}: ${failure.message}`,
        action: {
          label: t('settings.saveFailed.retry'),
          onClick: () => { void retryFailedSettingsUpdate(); },
        },
      });
    };
    const onRecovered = () => {
      toast.dismiss(FAILURE_TOAST_ID);
    };

    window.addEventListener('openchamber:settings-save-failed', onFailed);
    window.addEventListener('openchamber:settings-save-recovered', onRecovered);
    return () => {
      window.removeEventListener('openchamber:settings-save-failed', onFailed);
      window.removeEventListener('openchamber:settings-save-recovered', onRecovered);
    };
  }, [t]);
};
