import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { serverRegistry, DEFAULT_SERVER_ID, type ServerConnection } from '@/lib/opencode/server-registry';
import type { DesktopSshInstanceStatus } from '@/lib/desktopSsh';
import { useUIStore } from '@/stores/useUIStore';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import { redactSensitiveUrl } from '@/lib/desktopHosts';
import { useI18n } from '@/lib/i18n';
import pluginPackageJson from '../../../../plugin/package.json';

// --- Types ---

type HealthInfo = {
  version: string | null;
  loading: boolean;
  error: boolean;
};

type PluginSource = 'injected' | 'path';

type PluginMetadata = {
  spec: string;
  title: string;
  displayName: string;
  version: string | null;
  source: PluginSource | null;
};

type TranslateFn = ReturnType<typeof useI18n>['t'];

const OPENCHAMBER_PLUGIN_VERSION = pluginPackageJson.version;
const COMMON_BUILD_DIRS = new Set(['dist', 'build', 'lib', 'esm', 'cjs']);

// --- Helpers ---

const statusDotClass = (
  localHealthStatus: 'healthy' | 'unhealthy' | 'connecting' | null,
): string => {
  if (localHealthStatus === 'healthy') return 'bg-status-success';
  if (localHealthStatus === 'connecting') return 'bg-status-warning';
  if (localHealthStatus === 'unhealthy') return 'bg-status-error';
  return 'bg-muted-foreground/40';
};

const isPluginSpecEntry = (entry: unknown): entry is string | [string, unknown] => {
  if (typeof entry === 'string') {
    return true;
  }
  return Array.isArray(entry) && typeof entry[0] === 'string';
};

const isOpenChamberPluginSpec = (spec: string): boolean => {
  return spec === '@openchamber/plugin'
    || spec.includes('/packages/plugin/src/index.ts')
    || spec.includes('/openchamber/plugin/index.js')
    || spec.includes('/.config/openchamber/plugin/index.js');
};

const stripFileUrl = (spec: string): string => spec.replace(/^file:\/\//, '');

const isPathLikeSpec = (spec: string): boolean => {
  return spec.startsWith('file://')
    || spec.startsWith('/')
    || spec.startsWith('./')
    || spec.startsWith('../')
    || spec.includes('\\');
};

const getPackageCandidate = (spec: string): string | null => {
  const trimmed = spec.trim();
  if (!trimmed || isPathLikeSpec(trimmed)) {
    return null;
  }

  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  if (segments[0].startsWith('@')) {
    if (segments.length < 2) {
      return null;
    }
    return `${segments[0]}/${segments[1]}`;
  }

  return segments[0];
};

const parsePackageSpec = (spec: string): { name: string; version: string | null } | null => {
  const candidate = getPackageCandidate(spec);
  if (!candidate) {
    return null;
  }

  const lastAt = candidate.lastIndexOf('@');
  if (lastAt <= 0) {
    return { name: candidate, version: null };
  }

  const name = candidate.slice(0, lastAt);
  const version = candidate.slice(lastAt + 1).trim();
  if (!name || !version) {
    return null;
  }

  return { name, version };
};

const derivePathPluginName = (spec: string): string => {
  const normalized = stripFileUrl(spec).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) {
    return spec;
  }

  const nodeModulesIndex = normalized.lastIndexOf('/node_modules/');
  if (nodeModulesIndex !== -1) {
    const afterNodeModules = normalized.slice(nodeModulesIndex + '/node_modules/'.length);
    const parts = afterNodeModules.split('/').filter(Boolean);
    if (parts[0]?.startsWith('@') && parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0] ?? normalized;
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) {
    return normalized;
  }

  const lastSegment = parts[parts.length - 1];
  const baseName = lastSegment.includes('.')
    ? lastSegment.slice(0, lastSegment.lastIndexOf('.'))
    : lastSegment;
  if (baseName === 'index' || baseName === 'main' || baseName === 'plugin') {
    if (parts.length >= 3 && COMMON_BUILD_DIRS.has(parts[parts.length - 2])) {
      return parts[parts.length - 3];
    }
    if (parts.length >= 2) {
      return parts[parts.length - 2];
    }
  }

  return baseName;
};

const buildPluginMetadata = (rawSpec: string): PluginMetadata => {
  if (isOpenChamberPluginSpec(rawSpec)) {
    return {
      spec: rawSpec,
      title: rawSpec,
      displayName: '@openchamber/plugin',
      version: OPENCHAMBER_PLUGIN_VERSION,
      source: 'injected',
    };
  }

  const packageSpec = parsePackageSpec(rawSpec);
  if (packageSpec) {
    return {
      spec: rawSpec,
      title: rawSpec,
      displayName: packageSpec.name,
      version: packageSpec.version,
      source: null,
    };
  }

  return {
    spec: rawSpec,
    title: rawSpec,
    displayName: derivePathPluginName(rawSpec),
    version: null,
    source: 'path',
  };
};

const pluginSourceLabelKey = (source: PluginSource): 'instanceInfoPanel.plugins.source.injected' | 'instanceInfoPanel.plugins.source.path' => {
  if (source === 'injected') {
    return 'instanceInfoPanel.plugins.source.injected';
  }
  return 'instanceInfoPanel.plugins.source.path';
};

const pluginBadgeClassName = 'inline-flex items-center rounded px-1.5 py-0.5 leading-none border typography-micro';

const statusLabel = (
  localHealthStatus: 'healthy' | 'unhealthy' | 'connecting' | null,
  t: TranslateFn,
): string => {
  if (localHealthStatus === 'healthy') return t('instanceInfoPanel.status.healthy');
  if (localHealthStatus === 'connecting') return t('instanceInfoPanel.status.connecting');
  if (localHealthStatus === 'unhealthy') return t('instanceInfoPanel.status.unhealthy');
  return t('instanceInfoPanel.status.unknown');
};

const statusIcon = (localHealthStatus: 'healthy' | 'unhealthy' | 'connecting' | null) => {
  if (localHealthStatus === 'healthy') return <Icon name="check" className="h-3.5 w-3.5" />;
  if (localHealthStatus === 'connecting') return <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin" />;
  return <Icon name="error-warning" className="h-3.5 w-3.5" />;
};

const sshPhaseLabelKey = (phase: string | undefined):
  | 'instanceInfoPanel.sshPhase.ready'
  | 'instanceInfoPanel.sshPhase.error'
  | 'instanceInfoPanel.sshPhase.reconnecting'
  | 'instanceInfoPanel.sshPhase.resolvingConfig'
  | 'instanceInfoPanel.sshPhase.checkingAuth'
  | 'instanceInfoPanel.sshPhase.connectingSsh'
  | 'instanceInfoPanel.sshPhase.probingRemote'
  | 'instanceInfoPanel.sshPhase.installing'
  | 'instanceInfoPanel.sshPhase.installingOpenCode'
  | 'instanceInfoPanel.sshPhase.updating'
  | 'instanceInfoPanel.sshPhase.detectingServer'
  | 'instanceInfoPanel.sshPhase.startingServer'
  | 'instanceInfoPanel.sshPhase.forwardingPorts'
  | 'instanceInfoPanel.sshPhase.idle' => {
  switch (phase) {
    case 'ready':
      return 'instanceInfoPanel.sshPhase.ready';
    case 'error':
      return 'instanceInfoPanel.sshPhase.error';
    case 'degraded':
      return 'instanceInfoPanel.sshPhase.reconnecting';
    case 'config_resolved':
      return 'instanceInfoPanel.sshPhase.resolvingConfig';
    case 'auth_check':
      return 'instanceInfoPanel.sshPhase.checkingAuth';
    case 'master_connecting':
      return 'instanceInfoPanel.sshPhase.connectingSsh';
    case 'remote_probe':
      return 'instanceInfoPanel.sshPhase.probingRemote';
    case 'installing':
      return 'instanceInfoPanel.sshPhase.installing';
    case 'installing_opencode':
      return 'instanceInfoPanel.sshPhase.installingOpenCode';
    case 'updating':
      return 'instanceInfoPanel.sshPhase.updating';
    case 'server_detecting':
      return 'instanceInfoPanel.sshPhase.detectingServer';
    case 'server_starting':
      return 'instanceInfoPanel.sshPhase.startingServer';
    case 'forwarding':
      return 'instanceInfoPanel.sshPhase.forwardingPorts';
    default:
      return 'instanceInfoPanel.sshPhase.idle';
  }
};

const sshStatusIcon = (phase: string | undefined) => {
  if (phase === 'ready') return <Icon name="check" className="h-3.5 w-3.5" />;
  if (phase === 'error') return <Icon name="error-warning" className="h-3.5 w-3.5" />;
  return <Icon name="time" className="h-3.5 w-3.5" />;
};

// --- Component ---

interface InfoRowProps {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, icon, children }) => (
  <div className="flex items-center gap-2 py-1">
    <div className="flex items-center gap-1.5 min-w-0 flex-1">
      {icon && <span className="text-muted-foreground flex-shrink-0">{icon}</span>}
      <span className="typography-micro text-muted-foreground truncate">{label}</span>
    </div>
    <div className="typography-micro text-foreground truncate text-right">{children}</div>
  </div>
);

interface InstanceInfoPanelProps {
  serverId: string;
  className?: string;
}

export const InstanceInfoPanel = React.memo(function InstanceInfoPanel({
  serverId,
  className,
}: InstanceInfoPanelProps) {
  const { t } = useI18n();
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);

  const connection = useMemo(() => serverRegistry.get(serverId), [serverId]);
  const sshStatus = useDesktopSshStore(
    useCallback(
      (state): DesktopSshInstanceStatus | null =>
        serverId !== DEFAULT_SERVER_ID ? state.statusesById[serverId] ?? null : null,
      [serverId],
    ),
  );

  const [localHealthStatus, setLocalHealthStatus] = useState<ServerConnection["healthStatus"]>(
    connection?.healthStatus ?? null,
  );
  const [skillsCount, setSkillsCount] = useState(0);
  const [pluginMetadata, setPluginMetadata] = useState<PluginMetadata[]>([]);

  const [healthInfo, setHealthInfo] = useState<HealthInfo>({
    version: null,
    loading: false,
    error: false,
  });
  const abortRef = useRef<AbortController | null>(null);
  const pluginFetchSeqRef = useRef(0);

  useEffect(() => {
    if (!connection) return;
    setLocalHealthStatus(connection.healthStatus ?? null);
    return serverRegistry.onHealthChange(serverId, (status) => {
      setLocalHealthStatus(status);
    });
  }, [serverId, connection]);

  const isSshInstance = useMemo(() => {
    if (serverId === DEFAULT_SERVER_ID) return false;
    const sshInstances = useDesktopSshStore.getState().instances;
    return sshInstances.some((inst) => inst.id === serverId);
  }, [serverId]);

  const fetchVersion = useCallback(async () => {
    if (!connection?.client) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setHealthInfo({ version: null, loading: true, error: false });

    try {
      const result = await connection.client.global.health();
      const version = result.data?.version ?? null;
      setHealthInfo({ version, loading: false, error: false });
      return;
    } catch {
      if (controller.signal.aborted) return;
    }

    try {
      const baseUrl = connection.config.baseUrl.replace(/\/+$/, '');
      const healthUrl = baseUrl === '/api' ? '/global/health' : baseUrl.endsWith('/api')
        ? `${baseUrl.slice(0, -4)}/global/health`
        : `${baseUrl}/global/health`;

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (connection.config.authToken) {
        headers['Authorization'] = `Bearer ${connection.config.authToken}`;
      }

      const res = await fetch(healthUrl, { headers });
      if (res.ok) {
        const json = await res.json();
        const version = json?.version ?? null;
        setHealthInfo({ version, loading: false, error: false });
        return;
      }
    } catch {
      if (abortRef.current?.signal.aborted) return;
    }

    setHealthInfo({ version: null, loading: false, error: true });
  }, [connection]);

  const fetchSkills = useCallback(async () => {
    if (!connection) return;
    try {
      const baseUrl = connection.config.baseUrl.replace(/\/+$/, "");
      const skillsUrl = `${baseUrl}/skill`;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (connection.config.authToken) {
        headers["Authorization"] = `Bearer ${connection.config.authToken}`;
      }
      const res = await fetch(skillsUrl, { headers, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        setSkillsCount(Array.isArray(data) ? data.length : 0);
      }
    } catch (err) {
      void err;
    }
  }, [connection]);

  const fetchPlugins = useCallback(async () => {
    if (!connection) return;
    const requestId = ++pluginFetchSeqRef.current;
    setPluginMetadata([]);
    try {
      const baseUrl = connection.config.baseUrl.replace(/\/+$/, "");
      const configUrl = `${baseUrl}/global/config`;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (connection.config.authToken) {
        headers["Authorization"] = `Bearer ${connection.config.authToken}`;
      }
      const res = await fetch(configUrl, { headers, signal: AbortSignal.timeout(5000) });
      if (pluginFetchSeqRef.current !== requestId) {
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (pluginFetchSeqRef.current !== requestId) {
          return;
        }
        const plugins = data?.plugin;
        if (Array.isArray(plugins)) {
          const nextPlugins = plugins.reduce<PluginMetadata[]>((acc, plugin) => {
            if (!isPluginSpecEntry(plugin)) {
              return acc;
            }

            const rawSpec = (Array.isArray(plugin) ? plugin[0] : plugin).trim();
            if (!rawSpec) {
              return acc;
            }

            acc.push(buildPluginMetadata(rawSpec));
            return acc;
          }, []);
          if (pluginFetchSeqRef.current !== requestId) {
            return;
          }
          setPluginMetadata(nextPlugins);
          return;
        }
      }
    } catch (err) {
      if (pluginFetchSeqRef.current !== requestId) {
        return;
      }
      void err;
    }
    if (pluginFetchSeqRef.current !== requestId) {
      return;
    }
    setPluginMetadata([]);
  }, [connection]);

  useEffect(() => {
    if (!connection) return;
    void fetchVersion();
    void fetchSkills();
    void fetchPlugins();
    return () => {
      abortRef.current?.abort();
    };
  }, [connection, fetchVersion, fetchSkills, fetchPlugins]);

  const openRemoteInstancesSettings = useCallback(() => {
    setSettingsPage('remote-instances');
    setSettingsDialogOpen(true);
  }, [setSettingsDialogOpen, setSettingsPage]);

  if (!connection) {
    return (
      <div className={cn('w-full px-4 py-8 text-center', className)}>
        <Icon name="server" className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
        <div className="typography-ui-label text-muted-foreground">
          {t('instanceInfoPanel.empty.noServerFound')}
        </div>
        <div className="typography-micro mt-1 text-muted-foreground/70">
          {t('instanceInfoPanel.empty.hint')}
        </div>
      </div>
    );
  }

  const { config } = connection;
  const displayLabel = config.label || serverId;
  const displayUrl = redactSensitiveUrl(config.baseUrl);

  return (
    <div className={cn('w-full', className)}>
      <div className="border-b border-[var(--interactive-border)]">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0 flex items-baseline gap-2">
            <div className="typography-ui-header font-semibold text-foreground">
              {t('instanceInfoPanel.title')}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-7 w-7 p-0"
            onClick={fetchVersion}
            disabled={healthInfo.loading}
            aria-label={t('instanceInfoPanel.actions.refreshAria')}
          >
            <Icon name="refresh" className={cn('h-3.5 w-3.5', healthInfo.loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <div className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', statusDotClass(localHealthStatus))} />
          <span className="typography-ui-label font-medium text-foreground truncate">
            {displayLabel}
          </span>
          {isSshInstance && (
            <span className="typography-micro px-1.5 rounded leading-none pb-px text-[var(--status-info)] bg-[var(--status-info)]/10">
              SSH
            </span>
          )}
        </div>
        <div className="mt-1 typography-micro text-muted-foreground font-mono truncate" title={displayUrl}>
          {displayUrl}
        </div>
      </div>

      <div className="border-t border-[var(--interactive-border)]" />

      <div className="px-4 py-2.5">
        <InfoRow
          label={t('instanceInfoPanel.row.status')}
          icon={statusIcon(localHealthStatus)}
        >
          <span className={cn(
            'flex items-center gap-1 justify-end',
            localHealthStatus === 'healthy' && 'text-status-success',
            localHealthStatus === 'unhealthy' && 'text-status-error',
            localHealthStatus === 'connecting' && 'text-status-warning',
            !localHealthStatus && 'text-muted-foreground',
          )}>
            {statusLabel(localHealthStatus, t)}
          </span>
        </InfoRow>

        <InfoRow
          label={t('instanceInfoPanel.row.version')}
          icon={<Icon name="question" className="h-3.5 w-3.5" />}
        >
          {healthInfo.loading ? (
            <span className="text-muted-foreground">{t('instanceInfoPanel.version.fetching')}</span>
          ) : healthInfo.error ? (
            <span className="text-muted-foreground">{t('instanceInfoPanel.version.unknown')}</span>
          ) : healthInfo.version ? (
            <span className="font-mono">{healthInfo.version}</span>
          ) : (
            <span className="text-muted-foreground">{t('instanceInfoPanel.version.unknown')}</span>
          )}
        </InfoRow>

        <InfoRow
          label={t('instanceInfoPanel.row.skills')}
          icon={<Icon name="stack" className="h-3.5 w-3.5" />}
        >
          {t('instanceInfoPanel.skills.count', { count: skillsCount })}
        </InfoRow>

        <InfoRow
          label={t('instanceInfoPanel.row.plugins')}
          icon={<Icon name="plug" className="h-3.5 w-3.5" />}
        >
          {pluginMetadata.length > 0
            ? t('instanceInfoPanel.plugins.count', { count: pluginMetadata.length })
            : t('instanceInfoPanel.plugins.none')
          }
        </InfoRow>
        {pluginMetadata.length > 0 && (
          <div className="mt-0.5 ml-5 space-y-0.5">
            {pluginMetadata.map((plugin, index) => (
              <div key={`${plugin.spec}-${index}`} className="flex items-center gap-1.5 min-w-0" title={plugin.title}>
                <span className="h-1 w-1 rounded-full bg-[var(--status-info)] shrink-0" />
                <span className="typography-micro text-muted-foreground truncate min-w-0 flex-1">{plugin.displayName}</span>
                <span className={cn(
                  pluginBadgeClassName,
                  'shrink-0 border-[var(--interactive-border)] bg-[var(--surface-elevated)]',
                  plugin.version ? 'text-foreground' : 'text-muted-foreground',
                )}>
                  {plugin.version ?? t('instanceInfoPanel.plugins.version.unknown')}
                </span>
                {plugin.source && (
                  <span className={cn(pluginBadgeClassName, 'shrink-0 border-[var(--interactive-border)] bg-[var(--surface-muted)] text-muted-foreground')}>
                    {t(pluginSourceLabelKey(plugin.source))}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--interactive-border)]" />

      {isSshInstance && sshStatus && (
        <>
          <div className="px-4 py-2.5">
            <InfoRow
              label={t('instanceInfoPanel.row.sshStatus')}
              icon={sshStatusIcon(sshStatus.phase)}
            >
              <span className="flex items-center gap-1 justify-end">
                <span className={cn(
                  sshStatus.phase === 'ready' && 'text-status-success',
                  sshStatus.phase === 'error' && 'text-status-error',
                  sshStatus.phase !== 'error' && sshStatus.phase !== 'ready' && 'text-status-warning',
                )}>
                  {t(sshPhaseLabelKey(sshStatus.phase))}
                </span>
              </span>
            </InfoRow>
          </div>
          <div className="border-t border-[var(--interactive-border)]" />
        </>
      )}

      <div className="border-t border-[var(--interactive-border)] px-4 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-1.5"
          onClick={openRemoteInstancesSettings}
        >
          <Icon name="settings-3" className="h-4 w-4" />
          <span className="typography-ui-label truncate">
            {t('instanceInfoPanel.actions.manageSettings')}
          </span>
        </Button>
      </div>
    </div>
  );
});

export default InstanceInfoPanel;
