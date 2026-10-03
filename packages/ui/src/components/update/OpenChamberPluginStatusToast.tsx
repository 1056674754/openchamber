import * as React from 'react';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui/toast';
import { useI18n } from '@/lib/i18n';
import {
    normalizeOpenChamberPluginStatus,
    resolveOpenChamberPluginStatusDecision,
    type OpenChamberPluginStatus,
} from './openChamberPluginStatus';
import { useConfigStore } from '@/stores/useConfigStore';

const PLUGIN_STATUS_TOAST_ID = 'openchamber-plugin-status';
const INITIAL_CHECK_DELAY_MS = 1_000;
const CHECK_INTERVAL_MS = 1_000;
// OpenCode 2 boots location services lazily (13s+ observed with large configs)
// and plugin probes hang until that finishes; the status route re-probes on
// demand, so keep polling long enough to observe the recovery.
const MAX_STATUS_CHECK_ATTEMPTS = 60;

let statusToastShown = false;

export const OpenChamberPluginStatusToast: React.FC = () => {
    const { t } = useI18n();

    React.useEffect(() => {
        if (statusToastShown) return;

        let cancelled = false;
        const timeoutIds: Array<ReturnType<typeof setTimeout>> = [];

        const schedule = (attempt: number, delay: number) => {
            timeoutIds.push(setTimeout(() => { void checkStatus(attempt); }, delay));
        };

        const showFailure = (reason: string, copyText: string) => {
            statusToastShown = true;
            toast.warning(t('openchamberPlugin.toast.failed.title'), {
                id: PLUGIN_STATUS_TOAST_ID,
                description: t('openchamberPlugin.toast.failed.description', { reason }),
                copyText,
                duration: Infinity,
                icon: <Icon name="error-warning" className="h-4 w-4 text-[var(--status-warning)]" />,
            });
        };

        const showLoaded = () => {
            statusToastShown = true;
            void useConfigStore.getState().loadAgents({ source: 'pluginStatus:loaded' }).catch((error: unknown) => {
                console.warn('Failed to refresh agents after OpenChamber plugin loaded', error);
            });
            toast.success(t('openchamberPlugin.toast.loaded.title'), {
                id: PLUGIN_STATUS_TOAST_ID,
                description: t('openchamberPlugin.toast.loaded.description'),
                duration: 6_000,
                icon: <Icon name="check" className="h-4 w-4 text-[var(--status-success)]" />,
            });
        };

        const showDegraded = (reason: string, copyText: string) => {
            statusToastShown = true;
            toast.warning(t('openchamberPlugin.toast.degraded.title'), {
                id: PLUGIN_STATUS_TOAST_ID,
                description: t('openchamberPlugin.toast.degraded.description', { reason }),
                copyText,
                duration: Infinity,
                icon: <Icon name="error-warning" className="h-4 w-4 text-[var(--status-warning)]" />,
            });
        };

        const handleStatus = (status: OpenChamberPluginStatus, attempt: number) => {
            const decision = resolveOpenChamberPluginStatusDecision(status);
            if (decision.kind === 'loaded') {
                showLoaded();
                return;
            }
            if (decision.kind === 'degraded') {
                showDegraded(decision.reason, decision.copyText);
                return;
            }
            if (decision.kind === 'failed') {
                showFailure(decision.reason, decision.copyText);
                return;
            }
            if (attempt >= MAX_STATUS_CHECK_ATTEMPTS) {
                showFailure(
                    t('openchamberPlugin.toast.failed.timeoutReason'),
                    JSON.stringify(status, null, 2),
                );
                return;
            }
            schedule(attempt + 1, CHECK_INTERVAL_MS);
        };

        const checkStatus = async (attempt: number) => {
            if (cancelled || statusToastShown) return;
            try {
                const response = await fetch('/api/openchamber/plugin-status', {
                    headers: { Accept: 'application/json' },
                });
                if (response.status === 404) return;
                if (!response.ok) throw new Error(response.statusText || `HTTP ${response.status}`);
                const status = normalizeOpenChamberPluginStatus(await response.json().catch(() => null));
                if (!status) return;
                if (!cancelled) handleStatus(status, attempt);
            } catch {
                // Missing or unreachable status endpoints are ignored here; supported runtimes return JSON.
                if (!cancelled && attempt < MAX_STATUS_CHECK_ATTEMPTS) {
                    schedule(attempt + 1, CHECK_INTERVAL_MS);
                }
            }
        };

        schedule(0, INITIAL_CHECK_DELAY_MS);

        return () => {
            cancelled = true;
            for (const timeoutId of timeoutIds) clearTimeout(timeoutId);
        };
    }, [t]);

    return null;
};
