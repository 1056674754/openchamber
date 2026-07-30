import * as React from 'react';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui/toast';
import { reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { getSafeStorage } from '@/stores/utils/safeStorage';
import {
  resolveOpenCodeUpdateVersion,
  resolveOpenCodeUpgradeStatusVersion,
  shouldShowOpenCodeUpdateToast,
  type OpenCodeUpgradeStatusLike,
} from './openCodeUpdateDedup';
import {
  formatOpenCodeUpgradeCopyText,
  isOpenCodeUpgradeResponseLike,
  resolveOpenCodeUpgradeError,
} from '@/lib/opencode/upgradeDiagnostics';

const UPDATE_TOAST_ID = 'opencode-update-available';
const UPGRADE_TOAST_ID = 'opencode-upgrade-progress';
const INITIAL_CHECK_DELAY_MS = 5_000;
const CHECK_RETRY_DELAYS_MS = [10_000, 60_000];
const UPDATE_TOAST_DISMISSED_VERSION_KEY = 'opencode-update-toast-dismissed-version';

export const OpenCodeUpdateToast: React.FC = () => {
  const { t } = useI18n();
  const showOpenCodeUpdateNotifications = useUIStore((state) => state.showOpenCodeUpdateNotifications);
  const seenVersionsRef = React.useRef(new Set<string>());
  const upgradingRef = React.useRef(false);

  React.useEffect(() => {
    if (!showOpenCodeUpdateNotifications) {
      toast.dismiss(UPDATE_TOAST_ID);
    }
  }, [showOpenCodeUpdateNotifications]);

  const reloadOpenCode = React.useCallback(() => {
    toast.dismiss(UPGRADE_TOAST_ID);
    void reloadOpenCodeConfiguration({
      message: t('opencodeUpdate.toast.reload.message'),
      mode: 'projects',
      scopes: ['all'],
    }).catch(() => undefined);
  }, [t]);

  const runUpgrade = React.useCallback(async () => {
    if (upgradingRef.current) return;
    upgradingRef.current = true;
    toast.dismiss(UPDATE_TOAST_ID);
    toast.message(t('opencodeUpdate.toast.upgrading.title'), {
      id: UPGRADE_TOAST_ID,
      description: t('opencodeUpdate.toast.upgrading.description'),
      duration: Infinity,
      icon: <Icon name="refresh" className="h-4 w-4 animate-spin text-muted-foreground" />,
    });

    try {
      const response = await runtimeFetch('/api/opencode/upgrade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({}),
      });
      const rawPayload = await response.json().catch(() => null);
      const payload = isOpenCodeUpgradeResponseLike(rawPayload) ? rawPayload : null;
      if (!response.ok || payload?.success === false) {
        const fallbackError = response.statusText || t('opencodeUpdate.toast.failed.description');
        const description = resolveOpenCodeUpgradeError(payload, fallbackError);
        toast.error(t('opencodeUpdate.toast.failed.title'), {
          id: UPGRADE_TOAST_ID,
          description,
          copyText: formatOpenCodeUpgradeCopyText(payload, description, {
            httpStatus: response.ok ? null : response.status,
            httpStatusText: response.ok ? null : response.statusText,
          }),
          duration: Infinity,
        });
        return;
      }

      toast.success(t('opencodeUpdate.toast.updated.title'), {
        id: UPGRADE_TOAST_ID,
        description: payload?.version
          ? t('opencodeUpdate.toast.updated.descriptionWithVersion', { version: payload.version })
          : t('opencodeUpdate.toast.updated.description'),
        duration: Infinity,
        icon: <Icon name="check" className="h-4 w-4 text-[var(--status-success)]" />,
        action: {
          label: t('opencodeUpdate.toast.actions.reload'),
          onClick: reloadOpenCode,
        },
      });
    } catch (error) {
      const description = error instanceof Error ? error.message : t('opencodeUpdate.toast.failed.description');
      toast.error(t('opencodeUpdate.toast.failed.title'), {
        id: UPGRADE_TOAST_ID,
        description,
        copyText: formatOpenCodeUpgradeCopyText(null, description),
        duration: Infinity,
      });
    } finally {
      upgradingRef.current = false;
    }
  }, [reloadOpenCode, t]);

  React.useEffect(() => {
    const showUpdateAvailableToast = (version: string) => {
      if (!useUIStore.getState().showOpenCodeUpdateNotifications) {
        toast.dismiss(UPDATE_TOAST_ID);
        return;
      }
      const decision = shouldShowOpenCodeUpdateToast({
        version,
        dismissedVersion: getSafeStorage().getItem(UPDATE_TOAST_DISMISSED_VERSION_KEY),
        seenVersions: seenVersionsRef.current,
      });
      if (!decision) {
        return;
      }
      seenVersionsRef.current.add(version);

      toast.info(t('opencodeUpdate.toast.available.title'), {
        id: UPDATE_TOAST_ID,
        description: t('opencodeUpdate.toast.available.description', { version }),
        duration: Infinity,
        action: {
          label: t('opencodeUpdate.toast.actions.update'),
          onClick: runUpgrade,
        },
        cancel: {
          label: t('opencodeUpdate.toast.actions.dismiss'),
          onClick: () => {
            getSafeStorage().setItem(UPDATE_TOAST_DISMISSED_VERSION_KEY, version);
            toast.dismiss(UPDATE_TOAST_ID);
          },
        },
      });
    };

    let cancelled = false;
    const timeoutIds: Array<ReturnType<typeof setTimeout>> = [];

    const checkForUpdate = async (attempt: number, runtimeKey = getRuntimeKey()) => {
      try {
        const response = await runtimeFetch('/api/opencode/upgrade-status', {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(response.statusText || 'OpenCode upgrade status check failed');
        const status = await response.json().catch(() => null) as OpenCodeUpgradeStatusLike | null;
        const version = resolveOpenCodeUpgradeStatusVersion(status);
        if (!cancelled && runtimeKey === getRuntimeKey() && version) {
          showUpdateAvailableToast(version);
        }
      } catch {
        const delay = CHECK_RETRY_DELAYS_MS[attempt];
        if (!cancelled && runtimeKey === getRuntimeKey() && delay !== undefined) {
          timeoutIds.push(setTimeout(() => { void checkForUpdate(attempt + 1, runtimeKey); }, delay));
        }
      }
    };

    const onUpdateAvailable = (event: Event) => {
      const version = resolveOpenCodeUpdateVersion((event as CustomEvent<unknown>).detail);
      if (version) {
        void checkForUpdate(0);
      }
    };

    if (showOpenCodeUpdateNotifications) {
      timeoutIds.push(setTimeout(() => { void checkForUpdate(0); }, INITIAL_CHECK_DELAY_MS));
    }

    const unsubscribeRuntime = subscribeRuntimeEndpointChanged(({ runtimeKey }) => {
      seenVersionsRef.current.clear();
      toast.dismiss(UPDATE_TOAST_ID);
      if (useUIStore.getState().showOpenCodeUpdateNotifications) {
        void checkForUpdate(0, runtimeKey);
      }
    });

    window.addEventListener('openchamber:opencode-update-available', onUpdateAvailable);
    return () => {
      cancelled = true;
      for (const timeoutId of timeoutIds) clearTimeout(timeoutId);
      unsubscribeRuntime();
      window.removeEventListener('openchamber:opencode-update-available', onUpdateAvailable);
    };
  }, [runUpgrade, showOpenCodeUpdateNotifications, t]);

  return null;
};
