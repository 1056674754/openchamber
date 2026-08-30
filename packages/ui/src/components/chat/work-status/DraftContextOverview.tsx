import React from 'react';
import type { McpStatus } from '@opencode-ai/sdk/v2';

import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { resolveApiUrl } from '@/lib/api/serverUrl';
import { runBackgroundNetworkTask } from '@/lib/background-network';
import { mapWithConcurrency } from '@/lib/concurrency';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { computeMcpHealth } from '@/stores/useMcpStore';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { resolveSdkForDirectory } from '@/sync/session-actions';
import { useSessionUIStore } from '@/sync/session-ui-store';
import type { ProviderResult, QuotaProviderId } from '@/types/quota';

import {
  resolveDraftWorkStatusAuthority,
  summarizeDraftQuota,
  type DraftQuotaSummary,
} from './draftStatus';

type LoadState<T> =
  | { status: 'idle' | 'loading'; value: null }
  | { status: 'ready'; value: T }
  | { status: 'error'; value: null };

const EMPTY_LOAD_STATE: LoadState<never> = { status: 'idle', value: null };

const projectLabel = (project: { label?: string; path: string } | null): string => {
  if (!project) return '';
  return project.label?.trim()
    || project.path.split('/').filter(Boolean).pop()
    || project.path;
};

const isProviderResult = (value: unknown): value is ProviderResult => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProviderResult>;
  return typeof candidate.providerId === 'string'
    && typeof candidate.providerName === 'string'
    && typeof candidate.configured === 'boolean';
};

const DraftMetric: React.FC<{
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  value: React.ReactNode;
}> = ({ icon, label, value }) => (
  <div className="min-w-0 rounded-lg bg-[var(--surface-elevated)]/70 px-3 py-2.5">
    <div className="flex items-center gap-1.5 typography-micro text-muted-foreground/70">
      <Icon name={icon} className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </div>
    <div className="mt-1 truncate typography-ui-label text-foreground" title={typeof value === 'string' ? value : undefined}>
      {value}
    </div>
  </div>
);

export const DraftContextOverview: React.FC = () => {
  const { t } = useI18n();
  const draftOpen = useSessionUIStore((state) => state.newSessionDraft.open);
  const selectedProjectId = useSessionUIStore((state) => state.newSessionDraft.selectedProjectId ?? null);
  const directoryOverride = useSessionUIStore((state) => state.newSessionDraft.directoryOverride);
  const bootstrapPendingDirectory = useSessionUIStore((state) => state.newSessionDraft.bootstrapPendingDirectory ?? null);
  const pendingWorktreeRequestId = useSessionUIStore((state) => state.newSessionDraft.pendingWorktreeRequestId ?? null);
  const availableWorktreesByProject = useSessionUIStore((state) => state.availableWorktreesByProject);
  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const quotaProviderIds = useQuotaStore((state) => state.dropdownProviderIds);

  const authority = React.useMemo(
    () => resolveDraftWorkStatusAuthority({
      draft: {
        open: draftOpen,
        selectedProjectId,
        directoryOverride,
        bootstrapPendingDirectory,
      },
      projects,
      availableWorktreesByProject,
      activeProjectId,
    }),
    [activeProjectId, availableWorktreesByProject, bootstrapPendingDirectory, directoryOverride, draftOpen, projects, selectedProjectId],
  );

  const serverConnection = authority?.serverId && authority.serverId !== DEFAULT_SERVER_ID
    ? serverRegistry.get(authority.serverId)
    : null;
  const serverBaseUrl = authority?.serverId === DEFAULT_SERVER_ID
    ? ''
    : serverConnection?.config.baseUrl ?? null;
  const serverLabel = authority?.serverId === DEFAULT_SERVER_ID
    ? t('contextSidebar.draft.localInstance')
    : serverConnection?.config.label || authority?.serverId || t('contextSidebar.draft.unavailable');
  const authorityKey = authority
    ? `${authority.serverId ?? 'unresolved'}::${authority.directory}`
    : null;

  const [mcp, setMcp] = React.useState<LoadState<ReturnType<typeof computeMcpHealth>>>(EMPTY_LOAD_STATE);
  const [quota, setQuota] = React.useState<LoadState<DraftQuotaSummary>>(EMPTY_LOAD_STATE);

  React.useEffect(() => {
    if (!authorityKey || !authority?.serverId || !authority.directory) {
      setMcp(EMPTY_LOAD_STATE);
      return undefined;
    }

    let current = true;
    setMcp({ status: 'loading', value: null });
    void runBackgroundNetworkTask(async () => {
      const client = resolveSdkForDirectory(authority.directory, undefined, authority.serverId ?? undefined);
      const response = await client.mcp.status({ directory: authority.directory });
      if (response.error) throw new Error('MCP status request failed');
      return computeMcpHealth((response.data ?? {}) as Record<string, McpStatus>);
    }).then((value) => {
      if (current) setMcp({ status: 'ready', value });
    }).catch(() => {
      if (current) setMcp({ status: 'error', value: null });
    });

    return () => {
      current = false;
    };
  }, [authority?.directory, authority?.serverId, authorityKey]);

  React.useEffect(() => {
    if (!authorityKey || serverBaseUrl === null || quotaProviderIds.length === 0) {
      setQuota(EMPTY_LOAD_STATE);
      return undefined;
    }

    const controller = new AbortController();
    let current = true;
    setQuota({ status: 'loading', value: null });
    void runBackgroundNetworkTask(async () => {
      const results = await mapWithConcurrency<QuotaProviderId, ProviderResult | null>(
        quotaProviderIds,
        4,
        async (providerId) => {
          const response = await fetch(
            resolveApiUrl(`/api/quota/${encodeURIComponent(providerId)}`, serverBaseUrl),
            { signal: controller.signal, headers: { Accept: 'application/json' } },
          );
          const payload: unknown = await response.json().catch(() => null);
          return response.ok && isProviderResult(payload) ? payload : null;
        },
      );
      return summarizeDraftQuota(results.filter((result): result is ProviderResult => result !== null));
    }).then((value) => {
      if (current) setQuota({ status: 'ready', value });
    }).catch(() => {
      if (current && !controller.signal.aborted) setQuota({ status: 'error', value: null });
    });

    return () => {
      current = false;
      controller.abort();
    };
  }, [authorityKey, quotaProviderIds, serverBaseUrl]);

  if (!authority) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center typography-ui-label text-muted-foreground">
        {t('contextSidebar.draft.targetUnavailable')}
      </div>
    );
  }

  const mcpValue = mcp.status === 'loading'
    ? t('common.loading')
    : mcp.status === 'ready' && mcp.value
      ? mcp.value.total > 0
        ? t('contextSidebar.draft.mcpSummary', { connected: mcp.value.connected, total: mcp.value.total })
        : t('contextSidebar.draft.noneReported')
      : t('contextSidebar.draft.unavailable');
  const quotaValue = quota.status === 'loading'
    ? t('common.loading')
    : quota.status === 'ready' && quota.value
      ? quota.value.lowestRemainingPercent !== null
        ? t('contextSidebar.draft.usageSummary', {
            count: quota.value.configuredProviders,
            percent: Math.round(quota.value.lowestRemainingPercent),
          })
        : quota.value.configuredProviders > 0
          ? t('contextSidebar.draft.usageProviders', { count: quota.value.configuredProviders })
          : t('contextSidebar.draft.noneReported')
      : t('contextSidebar.draft.unavailable');

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[52rem] px-5 py-6">
        <div className="mb-6">
          <h2 className="typography-ui-header font-semibold text-foreground">
            {t('contextSidebar.draft.title')}
          </h2>
          <p className="mt-1 typography-micro text-muted-foreground/70">
            {t('contextSidebar.draft.description')}
          </p>
        </div>

        {pendingWorktreeRequestId || bootstrapPendingDirectory ? (
          <div className="mb-4 rounded-lg border border-[var(--status-warning)]/35 bg-[var(--status-warning)]/10 px-3 py-2.5 typography-ui-label text-foreground">
            {t('contextSidebar.draft.pendingWorktree')}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <DraftMetric icon="folder" label={t('contextSidebar.draft.project')} value={projectLabel(authority.project) || t('contextSidebar.draft.unavailable')} />
          <DraftMetric icon="server" label={t('contextSidebar.draft.instance')} value={serverLabel} />
          <DraftMetric icon="plug" label={t('settings.mcp.sidebar.title')} value={mcpValue} />
          <DraftMetric icon="timer" label={t('settings.usage.sidebar.title')} value={quotaValue} />
        </div>

        <div className="mt-4 rounded-lg bg-[var(--surface-elevated)]/70 px-4 py-3.5">
          <div className="typography-micro text-muted-foreground/70">{t('contextSidebar.draft.directory')}</div>
          <div className="mt-1 break-all font-mono typography-micro text-foreground">{authority.directory}</div>
        </div>
      </div>
    </div>
  );
};
