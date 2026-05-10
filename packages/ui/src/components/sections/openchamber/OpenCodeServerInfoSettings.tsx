import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RiArrowUpLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiRefreshLine,
  RiServerLine,
} from '@remixicon/react';
import { cn } from '@/lib/utils';
import { useSkillsStore, type DiscoveredSkill } from '@/stores/useSkillsStore';
import { useActiveServerId } from '@/hooks/useActiveServerId';
import { serverRegistry, DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/components/ui';

type OpenCodeVersionState = {
  version: string | null;
  loading: boolean;
  error: string | null;
};

type UpgradeState = {
  upgrading: boolean;
  target: string | null;
  result: { success: boolean; version?: string; error?: string } | null;
};

type AvailableVersion = {
  tag: string;
  current: boolean;
};

const SKILLS_CACHE_TTL_MS = 15_000;
const VERSION_CACHE_TTL_MS = 30_000;

let lastSkillsFetchAt = 0;
let lastVersionFetchAt = 0;

async function fetchAvailableVersions(currentVersion: string): Promise<AvailableVersion[]> {
  try {
    const response = await fetch('https://api.github.com/repos/opencode-ai/opencode/releases?per_page=10', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return [{ tag: currentVersion, current: true }];
    }
    const releases = await response.json() as Array<{ tag_name: string; prerelease: boolean }>;
    const versions: AvailableVersion[] = [];
    let foundCurrent = false;
    for (const release of releases) {
      if (release.prerelease) continue;
      const isCurrent = release.tag_name === currentVersion || release.tag_name === `v${currentVersion}`;
      if (isCurrent) foundCurrent = true;
      versions.push({ tag: release.tag_name.replace(/^v/, ''), current: isCurrent });
    }
    if (!foundCurrent) {
      versions.push({ tag: currentVersion, current: true });
    }
    return versions;
  } catch {
    return [{ tag: currentVersion, current: true }];
  }
}

export const OpenCodeServerInfoSettings: React.FC = () => {
  const { t } = useI18n();
  const serverId = useActiveServerId();
  const connection = serverRegistry.get(serverId);

  const [versionState, setVersionState] = React.useState<OpenCodeVersionState>({
    version: null,
    loading: false,
    error: null,
  });

  const skills = useSkillsStore((s) => s.skills);
  const [skillsLoading, setSkillsLoading] = React.useState(false);

  const [upgradeState, setUpgradeState] = React.useState<UpgradeState>({
    upgrading: false,
    target: null,
    result: null,
  });

  const [availableVersions, setAvailableVersions] = React.useState<AvailableVersion[]>([]);
  const [selectedTarget, setSelectedTarget] = React.useState<string | null>(null);

  const fetchVersion = React.useCallback(async () => {
    if (!connection) return;
    const now = Date.now();
    if (versionState.version && now - lastVersionFetchAt < VERSION_CACHE_TTL_MS) return;

    setVersionState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const client = connection.client;
      const response = await client.global.health();
      const version = response.data?.version ?? null;
      setVersionState({ version, loading: false, error: null });
      lastVersionFetchAt = Date.now();

      if (version) {
        const versions = await fetchAvailableVersions(version);
        setAvailableVersions(versions);
      }
    } catch (err) {
      setVersionState({
        version: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch version',
      });
    }
  }, [connection, versionState.version]);

  const fetchSkills = React.useCallback(async () => {
    const now = Date.now();
    if (skills.length > 0 && now - lastSkillsFetchAt < SKILLS_CACHE_TTL_MS) return;

    setSkillsLoading(true);
    try {
      await useSkillsStore.getState().loadSkills();
      lastSkillsFetchAt = Date.now();
    } catch (err) {
      void err;
    } finally {
      setSkillsLoading(false);
    }
  }, [skills.length]);

  React.useEffect(() => {
    void fetchVersion();
    void fetchSkills();
  }, [fetchVersion, fetchSkills]);

  const handleUpgrade = React.useCallback(async () => {
    if (!connection || !selectedTarget) return;

    setUpgradeState({ upgrading: true, target: selectedTarget, result: null });
    try {
      const client = connection.client;
      const response = await client.global.upgrade({
        target: selectedTarget,
      });
      const data = response.data;
      if (data && typeof data === 'object' && 'success' in data) {
        if (data.success) {
          setUpgradeState({
            upgrading: false,
            target: selectedTarget,
            result: { success: true, version: (data as { version?: string }).version },
          });
          toast.success(
            t('settings.openchamber.opencodeServer.upgrade.success', {
              version: (data as { version?: string }).version || selectedTarget,
            })
          );
          lastVersionFetchAt = 0;
          void fetchVersion();
        } else {
          setUpgradeState({
            upgrading: false,
            target: selectedTarget,
            result: { success: false, error: (data as { error?: string }).error || 'Upgrade failed' },
          });
        }
      }
    } catch (err) {
      setUpgradeState({
        upgrading: false,
        target: selectedTarget,
        result: { success: false, error: err instanceof Error ? err.message : 'Upgrade failed' },
      });
    }
  }, [connection, selectedTarget, fetchVersion, t]);

  if (!connection) {
    return (
      <div className="p-2">
        <div className="mb-3 px-1">
          <h3 className="typography-ui-header font-medium text-foreground">
            {t('settings.openchamber.opencodeServer.title')}
          </h3>
        </div>
        <div className="rounded-lg bg-[var(--surface-elevated)]/70 px-4 py-3">
          <p className="typography-meta text-muted-foreground">
            {t('settings.openchamber.opencodeServer.state.noConnection')}
          </p>
        </div>
      </div>
    );
  }

  const isDefaultServer = serverId === DEFAULT_SERVER_ID;
  const serverLabel = connection.config.label || serverId;
  const displayUrl = isDefaultServer
    ? 'Local'
    : connection.config.baseUrl;

  return (
    <div className="p-2">
      <div className="mb-3 px-1">
        <h3 className="typography-ui-header font-medium text-foreground">
          {t('settings.openchamber.opencodeServer.title')}
        </h3>
      </div>

      <div className="rounded-lg bg-[var(--surface-elevated)]/70 overflow-hidden flex flex-col">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--surface-subtle)]">
          <RiServerLine className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="typography-ui-label text-foreground truncate block">{serverLabel}</span>
            <span className="typography-micro text-muted-foreground font-mono truncate block">{displayUrl}</span>
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => { lastVersionFetchAt = 0; void fetchVersion(); }}
            disabled={versionState.loading}
            aria-label={t('settings.openchamber.opencodeServer.actions.refresh')}
          >
            <RiRefreshLine className={cn('h-3.5 w-3.5', versionState.loading && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-[var(--surface-subtle)]">
          <div className="flex flex-col min-w-0">
            <span className="typography-ui-label text-foreground">
              {t('settings.openchamber.opencodeServer.field.version')}
            </span>
            {versionState.loading && !versionState.version ? (
              <span className="typography-micro text-muted-foreground">
                {t('settings.openchamber.opencodeServer.state.fetching')}
              </span>
            ) : versionState.error ? (
              <span className="typography-micro text-[var(--status-error)]">{versionState.error}</span>
            ) : (
              <span className="typography-micro text-muted-foreground font-mono tabular-nums">
                {versionState.version ?? '—'}
              </span>
            )}
          </div>

          {versionState.version && availableVersions.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <Select
                value={selectedTarget ?? ''}
                onValueChange={setSelectedTarget}
              >
                <SelectTrigger className="h-7 w-36 typography-micro">
                  <SelectValue placeholder={t('settings.openchamber.opencodeServer.field.selectVersion')} />
                </SelectTrigger>
                <SelectContent>
                  {availableVersions.map((v) => (
                    <SelectItem key={v.tag} value={v.tag} disabled={v.current}>
                      <span className="flex items-center gap-1.5">
                        {v.tag}
                        {v.current && (
                          <span className="typography-micro text-muted-foreground">
                            ({t('settings.openchamber.opencodeServer.state.current')})
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="xs"
                onClick={handleUpgrade}
                disabled={!selectedTarget || upgradeState.upgrading || availableVersions.find((v) => v.tag === selectedTarget)?.current}
              >
                {upgradeState.upgrading ? (
                  <RiLoader4Line className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RiArrowUpLine className="h-3.5 w-3.5" />
                )}
                {t('settings.openchamber.opencodeServer.actions.upgrade')}
              </Button>
            </div>
          )}
        </div>

        {upgradeState.result && (
          <div className={cn(
            'px-4 py-2 border-b border-[var(--surface-subtle)]',
            upgradeState.result.success ? 'bg-[var(--status-success)]/5' : 'bg-[var(--status-error)]/5',
          )}>
            <div className="flex items-center gap-2">
              {upgradeState.result.success ? (
                <RiCheckLine className="h-4 w-4 text-[var(--status-success)]" />
              ) : (
                <RiErrorWarningLine className="h-4 w-4 text-[var(--status-error)]" />
              )}
              <span className={cn(
                'typography-meta',
                upgradeState.result.success ? 'text-[var(--status-success)]' : 'text-[var(--status-error)]',
              )}>
                {upgradeState.result.success
                  ? t('settings.openchamber.opencodeServer.upgrade.success', { version: upgradeState.result.version || '' })
                  : upgradeState.result.error || t('settings.openchamber.opencodeServer.upgrade.failed')
                }
              </span>
            </div>
          </div>
        )}

        <div className="px-4 py-2.5 border-b border-[var(--surface-subtle)]">
          <div className="flex items-center justify-between mb-1">
            <span className="typography-ui-label text-foreground">
              {t('settings.openchamber.opencodeServer.field.skills')}
            </span>
            <span className="typography-micro text-muted-foreground tabular-nums">
              {skillsLoading
                ? t('settings.openchamber.opencodeServer.state.loading')
                : t('settings.openchamber.opencodeServer.state.skillsCount', { count: skills.length })
              }
            </span>
          </div>
          {skills.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {skills.slice(0, 8).map((skill: DiscoveredSkill) => (
                <div key={skill.name} className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-[var(--status-success)] shrink-0" />
                  <span className="typography-micro text-muted-foreground truncate">{skill.name}</span>
                  <span className="typography-micro text-muted-foreground/50 shrink-0">{skill.scope}</span>
                </div>
              ))}
              {skills.length > 8 && (
                <span className="typography-micro text-muted-foreground/50">
                  {t('settings.openchamber.opencodeServer.state.moreSkills', { count: skills.length - 8 })}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className={cn(
              'h-2 w-2 rounded-full shrink-0',
              connection.healthStatus === 'healthy' && 'bg-status-success',
              connection.healthStatus === 'unhealthy' && 'bg-status-error',
              connection.healthStatus === 'connecting' && 'bg-status-warning',
              !connection.healthStatus && 'bg-muted-foreground/40',
            )} />
            <span className="typography-micro text-muted-foreground">
              {connection.healthStatus === 'healthy' && t('settings.openchamber.opencodeServer.state.healthy')}
              {connection.healthStatus === 'unhealthy' && t('settings.openchamber.opencodeServer.state.unhealthy')}
              {connection.healthStatus === 'connecting' && t('settings.openchamber.opencodeServer.state.connecting')}
              {!connection.healthStatus && t('settings.openchamber.opencodeServer.state.unknown')}
            </span>
            {connection.lastHealthCheckAt && (
              <span className="typography-micro text-muted-foreground/50">
                {t('settings.openchamber.opencodeServer.state.lastChecked', {
                  time: new Date(connection.lastHealthCheckAt).toLocaleTimeString(),
                })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
