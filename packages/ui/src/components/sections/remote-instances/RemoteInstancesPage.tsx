import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import { useRemoteInstancesStore } from '@/stores/useRemoteInstancesStore';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/useUIStore';
import { toast } from '@/components/ui';
import { copyTextToClipboard } from '@/lib/clipboard';
import { openExternalUrl } from '@/lib/url';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { hasDesktopInvoke } from '@/lib/desktop';
import {
  desktopSshLogsClear,
  desktopSshLogs,
  phaseDotClass,
  resolveInstanceLabel,
  type DesktopSshInstance,
  type DesktopSshPortForward,
} from '@/lib/desktopSsh';
import type { RemoteInstance, RemoteInstanceAuth, RemoteInstancePhase } from '@/lib/remote-instances/types';
import type { RemoteInstanceStatus } from '@/lib/remote-instances/types';
import { resolveRemoteLabel } from '@/lib/remote-instances/types';
import {
  createWebRemoteDraft,
  makeWebRemoteDraftSelectionId,
  parseWebRemoteDraftSelectionId,
} from './webRemoteDraft';
import {
  StatusCard,
  ConnectionCard,
  LogPanel,
  ConfigCard,
  ForwardCard,
  DangerCard,
  ImportCard,
  ChangeBar,
  type PhaseStep,
} from './cards';
// ─── module-level helpers ────────────────────────────────────

const CONNECTING_PHASE_ORDER = [
  'config_resolved',
  'auth_check',
  'master_connecting',
  'remote_probe',
  'installing',
  'updating',
  'server_detecting',
  'server_starting',
  'forwarding',
] as const;

const CONNECTING_PHASES = new Set<string>(CONNECTING_PHASE_ORDER);

const isConnectingPhase = (phase?: string): boolean =>
  Boolean(phase && CONNECTING_PHASES.has(phase));

const randomPort = (): number =>
  Math.floor(20000 + Math.random() * 30000);

const isPortInUseError = (error: unknown): boolean => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('address already in use') || message.includes('eaddrinuse') || message.includes('port already in use');
};

const phaseLabelKey = (phase?: string): I18nKey => {
  switch (phase) {
    case 'config_resolved': return 'settings.remoteInstances.page.phase.resolvingConfiguration';
    case 'auth_check': return 'settings.remoteInstances.page.phase.checkingAuth';
    case 'master_connecting': return 'settings.remoteInstances.page.phase.establishingSsh';
    case 'remote_probe': return 'settings.remoteInstances.page.phase.probingRemote';
    case 'installing': return 'settings.remoteInstances.page.phase.installingOpenChamber';
    case 'updating': return 'settings.remoteInstances.page.phase.updatingOpenChamber';
    case 'server_detecting': return 'settings.remoteInstances.page.phase.detectingServer';
    case 'server_starting': return 'settings.remoteInstances.page.phase.startingServer';
    case 'forwarding': return 'settings.remoteInstances.page.phase.forwardingPorts';
    case 'ready': return 'settings.remoteInstances.sidebar.phase.ready';
    case 'degraded': return 'settings.remoteInstances.page.phase.reconnecting';
    case 'error': return 'settings.remoteInstances.sidebar.phase.error';
    default: return 'settings.remoteInstances.sidebar.phase.idle';
  }
};

const webPhaseDotClass = (phase?: RemoteInstancePhase) => {
  if (phase === 'connected') return 'bg-[var(--status-success)]';
  if (phase === 'error') return 'bg-[var(--status-error)] animate-pulse';
  if (phase === 'connecting') return 'bg-[var(--status-warning)] animate-pulse';
  return 'bg-muted-foreground/40';
};

const webPhaseLabelKey = (phase?: RemoteInstancePhase): I18nKey => {
  switch (phase) {
    case 'connected': return 'settings.remoteInstances.sidebar.phase.ready';
    case 'error': return 'settings.remoteInstances.sidebar.phase.error';
    case 'connecting': return 'settings.remoteInstances.sidebar.phase.connecting';
    default: return 'settings.remoteInstances.sidebar.phase.idle';
  }
};

const makeForward = (): DesktopSshPortForward => ({
  id: `forward-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  enabled: true,
  type: 'local',
  localHost: '127.0.0.1',
  localPort: randomPort(),
  remoteHost: '127.0.0.1',
  remotePort: 80,
});

const suggestConcreteHost = (pattern: string): string => {
  const value = pattern.trim().replace(/\*/g, 'host').replace(/\?/g, 'x');
  return value || 'user@host';
};

const toBrowserHost = (host: string | undefined): string => {
  const value = (host || '').trim();
  if (!value || value === '0.0.0.0' || value === '::') return '127.0.0.1';
  return value;
};

const formatLogLine = (line: string): string => {
  const match = line.match(/^\[(\d{10,})\]\s*(?:\[([A-Z]+)\]\s*)?(.*)$/);
  if (!match) return line;
  const millis = Number(match[1]);
  const iso = Number.isFinite(millis) ? new Date(millis).toISOString() : match[1];
  const level = (match[2] || 'INFO').toUpperCase();
  return `[${iso}] [${level}] ${match[3] || ''}`;
};

const navigateToUrl = (rawUrl: string): void => {
  const target = rawUrl.trim();
  if (!target) return;
  try { window.location.assign(target); } catch { window.location.href = target; }
};

const normalizeForSave = (instance: DesktopSshInstance): DesktopSshInstance => {
  const forwards = instance.portForwards.map((forward) => ({
    ...forward,
    localHost: forward.localHost?.trim() || '127.0.0.1',
    localPort: typeof forward.localPort === 'number' ? Math.max(1, Math.min(65535, Math.round(forward.localPort))) : undefined,
    remoteHost: forward.remoteHost?.trim(),
    remotePort: typeof forward.remotePort === 'number' ? Math.max(1, Math.min(65535, Math.round(forward.remotePort))) : undefined,
  }));
  return {
    ...instance,
    sshCommand: instance.sshCommand.trim(),
    nickname: instance.nickname?.trim() || undefined,
    connectionTimeoutSec: Math.max(5, Math.min(240, Math.round(instance.connectionTimeoutSec || 60))),
    localForward: {
      ...instance.localForward,
      bindHost: instance.localForward.bindHost === 'localhost' || instance.localForward.bindHost === '0.0.0.0' ? instance.localForward.bindHost : '127.0.0.1',
      preferredLocalPort: typeof instance.localForward.preferredLocalPort === 'number' ? Math.max(1, Math.min(65535, Math.round(instance.localForward.preferredLocalPort))) : undefined,
    },
    remoteOpenchamber: {
      ...instance.remoteOpenchamber,
      preferredPort: typeof instance.remoteOpenchamber.preferredPort === 'number' ? Math.max(1, Math.min(65535, Math.round(instance.remoteOpenchamber.preferredPort))) : undefined,
    },
    portForwards: forwards,
  };
};

// ─── WebRemoteInstancesPage ──────────────────────────────────

type WebPageProps = {
  instances: RemoteInstance[];
  statuses: Record<string, RemoteInstanceStatus>;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  webDraft: RemoteInstance | null;
  setWebDraft: React.Dispatch<React.SetStateAction<RemoteInstance | null>>;
  webLoad: () => Promise<void>;
  webSaveInstances: (instances: RemoteInstance[]) => Promise<void>;
  webConnect: (id: string) => Promise<void>;
  webDisconnect: (id: string) => Promise<void>;
  t: ReturnType<typeof useI18n>['t'];
};

const WebRemoteInstancesPage: React.FC<WebPageProps> = ({
  instances, statuses, loading, error, selectedId, setSelectedId,
  webDraft, setWebDraft, webLoad, webSaveInstances, webConnect, webDisconnect, t,
}) => {
  const [isActionPending, setIsActionPending] = React.useState(false);

  React.useEffect(() => {
    if (loading) return;
    if (parseWebRemoteDraftSelectionId(selectedId)) return;
    if (instances.length === 0) { if (selectedId !== null) setSelectedId(null); return; }
    if (selectedId && instances.some((i) => i.id === selectedId)) return;
    setSelectedId(instances[0].id);
  }, [instances, loading, selectedId, setSelectedId]);

  React.useEffect(() => { void webLoad(); }, [webLoad]);

  const webStatus = webDraft ? statuses[webDraft.id] : undefined;
  const isReady = webStatus?.phase === 'connected';

  const updateWebDraft = React.useCallback((updater: (current: RemoteInstance) => RemoteInstance) => {
    setWebDraft((current) => (current ? updater(current) : current));
  }, [setWebDraft]);

  const hasWebChanges = React.useMemo(() => {
    if (!webDraft || !selectedId) return false;
    const original = instances.find((i) => i.id === webDraft.id);
    if (!original) return true;
    return JSON.stringify(webDraft) !== JSON.stringify(original);
  }, [webDraft, selectedId, instances]);

  const handleWebSave = React.useCallback(async () => {
    if (!webDraft) return;
    if (!webDraft.url?.trim()) { toast.error(t('settings.remoteInstances.page.toast.sshCommandRequired')); return; }
    try {
      const original = instances.find((i) => i.id === webDraft.id);
      const next = original ? instances.map((i) => i.id === webDraft.id ? webDraft : i) : [...instances, webDraft];
      await webSaveInstances(next);
      setSelectedId(webDraft.id);
      toast.success(t('settings.remoteInstances.page.toast.instanceSaved'));
    } catch (err) {
      toast.error(t('settings.remoteInstances.page.toast.saveFailed'), { description: err instanceof Error ? err.message : String(err) });
    }
  }, [webDraft, instances, webSaveInstances, setSelectedId, t]);

  const handleWebPrimaryAction = React.useCallback(() => {
    if (!webDraft || !instances.some((instance) => instance.id === webDraft.id)) return;
    setIsActionPending(true);
    const op = isReady ? webDisconnect(webDraft.id) : webConnect(webDraft.id);
    void op
      .catch((err) => {
        toast.error(
          isReady ? t('settings.remoteInstances.sidebar.toast.disconnectFailed') : t('settings.remoteInstances.sidebar.toast.connectFailed'),
          { description: err instanceof Error ? err.message : String(err) },
        );
      })
      .finally(() => setIsActionPending(false));
  }, [webDraft, instances, isReady, webDisconnect, webConnect, t]);

  const handleWebRemove = React.useCallback(async () => {
    if (!webDraft) return;
    const ok = window.confirm(t('settings.remoteInstances.page.confirm.removeInstance'));
    if (!ok) return;
    if (!instances.some((i) => i.id === webDraft.id)) { setWebDraft(null); setSelectedId(null); return; }
    try {
      await webSaveInstances(instances.filter((i) => i.id !== webDraft.id));
      setSelectedId(null);
      toast.success(t('settings.remoteInstances.page.toast.instanceRemoved'));
    } catch (err) {
      toast.error(t('settings.remoteInstances.page.toast.removeInstanceFailed'), { description: err instanceof Error ? err.message : String(err) });
    }
  }, [webDraft, instances, webSaveInstances, setSelectedId, setWebDraft, t]);

  const handleAddWeb = React.useCallback(async () => {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setWebDraft(createWebRemoteDraft(id, t('settings.remoteInstances.sidebar.newSshInstanceName')));
    setSelectedId(makeWebRemoteDraftSelectionId(id));
  }, [setSelectedId, setWebDraft, t]);

  if (!webDraft) {
    return (
      <SettingsPageLayout>
        <div className="mb-8">
          <div className="mb-1 px-1 space-y-0.5">
            <h3 className="typography-ui-header font-medium text-foreground">{t('settings.remoteInstances.page.title')}</h3>
            <p className="typography-meta text-muted-foreground">{t('settings.remoteInstances.page.description')}</p>
          </div>
          <section className="px-2 pb-2 pt-0 space-y-3">
            {loading ? (
              <p className="typography-meta text-muted-foreground">{t('settings.remoteInstances.page.import.loading')}</p>
            ) : instances.length === 0 ? (
              <div className="space-y-2">
                <p className="typography-meta text-muted-foreground">{t('settings.remoteInstances.page.empty.selectInstance')}</p>
                <Button type="button" variant="outline" size="xs" className="!font-normal" onClick={() => void handleAddWeb()}>
                  <Icon name="add" className="h-3.5 w-3.5" />
                  {t('settings.remoteInstances.page.actions.create')}
                </Button>
              </div>
            ) : (
              <p className="typography-meta text-muted-foreground">{t('settings.remoteInstances.page.empty.selectInstance')}</p>
            )}
          </section>
        </div>
        {error ? <div className="typography-meta text-[var(--status-error)]">{error}</div> : null}
      </SettingsPageLayout>
    );
  }

  const instanceTitle = resolveRemoteLabel(webDraft);
  const phase = webStatus?.phase;
  const webLatencyMs = webStatus?.latencyMs;
  const webUptimeMs = webStatus ? Math.max(0, Date.now() - webStatus.updatedAtMs) : 0;

  return (
    <SettingsPageLayout>
      {/* Header */}
      <div className="mb-6 px-1">
        <h2 className="typography-ui-header font-semibold text-foreground truncate">{instanceTitle}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 typography-meta text-muted-foreground">
          <span className={`h-2.5 w-2.5 rounded-full ${webPhaseDotClass(phase)}`} />
          <span>{t(webPhaseLabelKey(phase))}</span>
          {webDraft.url ? <span className="font-mono text-foreground/80">{webDraft.url}</span> : null}
        </div>
      </div>

      {/* Status Card (web variant) */}
      <div className="mb-4">
        <StatusCard
          phase={phase}
          isReady={isReady}
          isConnecting={phase === 'connecting'}
          isError={phase === 'error'}
          isReconnecting={false}
          isRestarting={false}
          isDegraded={false}
          statusLabel={t(webPhaseLabelKey(phase))}
          statusDetail={webStatus?.detail}
          localUrl={webStatus?.url}
          latencyMs={webLatencyMs}
          uptimeMs={webUptimeMs}
          remoteServiceUnavailable={false}
          reconnectAppearsStuck={false}
          phaseSteps={[]}
          onCopyEndpoint={() => { if (webStatus?.url) void copyTextToClipboard(webStatus.url); }}
          onOpenEndpoint={() => { if (webStatus?.url) navigateToUrl(webStatus.url); }}
          isDesktop={false}
        />
      </div>

      {/* Connection actions (web — connect/disconnect only) */}
      <div className="mb-4">
        <div className="rounded-lg border border-border/60 bg-[var(--surface-elevated)] p-4 space-y-3">
          <h3 className="typography-ui-header font-medium text-foreground">{t('settings.remoteInstances.page.section.actions')}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={isReady ? 'outline' : 'default'}
              size="xs"
              className="!font-normal"
              onClick={handleWebPrimaryAction}
              disabled={isActionPending || !instances.some((instance) => instance.id === webDraft.id)}
            >
              {isReady ? <Icon name="stop" className="h-3.5 w-3.5" /> : <Icon name="plug-2" className="h-3.5 w-3.5" />}
              {isReady ? t('settings.remoteInstances.sidebar.actions.disconnect') : t('settings.remoteInstances.sidebar.actions.connect')}
            </Button>
          </div>
        </div>
      </div>

      {/* Config Card (web variant) */}
      <ConfigCard
        isDesktop={false}
        sshCommand=""
        onSshCommandChange={() => {}}
        nickname={webDraft.label || ''}
        onNicknameChange={(v) => updateWebDraft((c) => ({ ...c, label: v }))}
        connectionTimeoutSec={webDraft.connectionTimeoutSec ?? 60}
        onConnectionTimeoutChange={(v) => updateWebDraft((c) => ({ ...c, connectionTimeoutSec: Number.isFinite(v) ? v : c.connectionTimeoutSec }))}
        enabled={webDraft.enabled}
        onEnabledChange={(v) => updateWebDraft((c) => ({ ...c, enabled: v }))}
        authType={webDraft.auth?.type || 'none'}
        onAuthTypeChange={(value) => {
          const nextType = value as RemoteInstanceAuth['type'];
          updateWebDraft((current) => ({
            ...current,
            auth: nextType === 'none' ? { type: 'none' } : current.auth?.type === nextType ? current.auth : { type: nextType },
          }));
        }}
        authValue={webDraft.auth?.value || ''}
        onAuthValueChange={(v) => updateWebDraft((c) => ({ ...c, auth: { ...(c.auth || { type: 'password' }), value: v } }))}
        webUrl={webDraft.url || ''}
        onWebUrlChange={(v) => updateWebDraft((c) => ({ ...c, url: v }))}
        requestHeaderEntries={Object.entries(webDraft.requestHeaders ?? {}).map(([key, value]) => ({ key, value }))}
        onRequestHeaderEntriesChange={(entries) => {
          updateWebDraft((current) => {
            const requestHeaders: Record<string, string> = {};
            for (const entry of entries) {
              const name = entry.key.trim();
              if (!name) continue;
              requestHeaders[name] = entry.value;
            }
            return {
              ...current,
              requestHeaders,
              hasRequestHeaders: Object.keys(requestHeaders).length > 0 ? current.hasRequestHeaders : undefined,
            };
          });
        }}
      />

      {/* Danger Card */}
      <DangerCard onRemove={() => void handleWebRemove()} instanceLabel={instanceTitle} />

      {/* Change Bar */}
      <ChangeBar
        visible={hasWebChanges}
        changeCount={hasWebChanges ? 1 : 0}
        changeSummary=""
        onSave={() => void handleWebSave()}
        onDiscard={() => {
          const original = instances.find((i) => i.id === webDraft.id);
          if (original) setWebDraft(original);
        }}
        error={error}
        saving={false}
      />
    </SettingsPageLayout>
  );
};

// ─── RemoteInstancesPage (orchestrator) ──────────────────────

export const RemoteInstancesPage: React.FC = () => {
  const { t } = useI18n();
  const isDesktop = hasDesktopInvoke();

  // ── store selectors (web) ──
  const webInstances = useRemoteInstancesStore(useShallow((state) => state.instances));
  const webStatuses = useRemoteInstancesStore(useShallow((state) => state.statuses));
  const webLoading = useRemoteInstancesStore((state) => state.loading);
  const webError = useRemoteInstancesStore((state) => state.error);
  const webLoad = useRemoteInstancesStore((state) => state.loadInstances);
  const webSaveInstances = useRemoteInstancesStore((state) => state.saveInstances);
  const webConnect = useRemoteInstancesStore((state) => state.connect);
  const webDisconnect = useRemoteInstancesStore((state) => state.disconnect);

  // ── store selectors (desktop) ──
  const instances = useDesktopSshStore((state) => state.instances);
  const statusesById = useDesktopSshStore(useShallow((state) => state.statusesById));
  const importCandidates = useDesktopSshStore((state) => state.importCandidates);
  const isImportsLoading = useDesktopSshStore((state) => state.isImportsLoading);
  const isSaving = useDesktopSshStore((state) => state.isSaving);
  const isRestarting = useDesktopSshStore((state) => state.isRestarting);
  const error = useDesktopSshStore((state) => state.error);
  const load = useDesktopSshStore((state) => state.load);
  const loadImports = useDesktopSshStore((state) => state.loadImports);
  const refreshStatuses = useDesktopSshStore((state) => state.refreshStatuses);
  const upsertInstance = useDesktopSshStore((state) => state.upsertInstance);
  const createFromCommand = useDesktopSshStore((state) => state.createFromCommand);
  const removeInstance = useDesktopSshStore((state) => state.removeInstance);
  const connect = useDesktopSshStore((state) => state.connect);
  const disconnect = useDesktopSshStore((state) => state.disconnect);
  const retry = useDesktopSshStore((state) => state.retry);

  const selectedId = useUIStore((state) => state.settingsRemoteInstancesSelectedId);
  const setSelectedId = useUIStore((state) => state.setSettingsRemoteInstancesSelectedId);

  const selectedInstance = React.useMemo((): DesktopSshInstance | RemoteInstance | null => {
    if (!selectedId) return null;
    if (!isDesktop) return webInstances.find((instance) => instance.id === selectedId) || null;
    return instances.find((instance) => instance.id === selectedId) || null;
  }, [isDesktop, instances, webInstances, selectedId]);

  // ── local state ──
  const [draft, setDraft] = React.useState<DesktopSshInstance | null>(null);
  const [webDraft, setWebDraft] = React.useState<RemoteInstance | null>(null);
  const [logDialogOpen, setLogDialogOpen] = React.useState(false);
  const [logDialogLoading, setLogDialogLoading] = React.useState(false);
  const [logDialogError, setLogDialogError] = React.useState<string | null>(null);
  const [logDialogLines, setLogDialogLines] = React.useState<string[]>([]);
  const [patternHost, setPatternHost] = React.useState<string | null>(null);
  const [patternDestination, setPatternDestination] = React.useState('');
  const [patternCreating, setPatternCreating] = React.useState(false);
  const [expandedForwards, setExpandedForwards] = React.useState<Record<string, boolean>>({});
  const [isPrimaryActionPending, setIsPrimaryActionPending] = React.useState(false);
  const [isRetryPending, setIsRetryPending] = React.useState(false);
  const [isTesting, setIsTesting] = React.useState(false);
  const [clockMs, setClockMs] = React.useState(() => Date.now());

  // ── effects ──
  React.useEffect(() => {
    if (isDesktop) { void load(); void loadImports(); } else { void webLoad(); }
  }, [isDesktop, load, loadImports, webLoad]);

  React.useEffect(() => {
    if (!isDesktop) {
      const draftId = parseWebRemoteDraftSelectionId(selectedId);
      if (draftId) {
        setWebDraft((current) => current?.id === draftId ? current : createWebRemoteDraft(draftId, t('settings.remoteInstances.sidebar.newSshInstanceName')));
        return;
      }
      setWebDraft(selectedInstance as RemoteInstance | null);
    } else {
      setDraft(selectedInstance as DesktopSshInstance | null);
    }
  }, [isDesktop, selectedId, selectedInstance, t]);

  React.useEffect(() => {
    if (!selectedId) return;
    const interval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void refreshStatuses();
    }, 2_000);
    return () => { window.clearInterval(interval); };
  }, [refreshStatuses, selectedId]);

  React.useEffect(() => {
    let rafId: number | null = null;
    let lastTime = Date.now();
    const tick = () => {
      const now = Date.now();
      if (now - lastTime >= 1_000) { setClockMs(now); lastTime = now; }
      rafId = requestAnimationFrame(tick);
    };
    if (typeof document === 'undefined' || document.visibilityState === 'visible') rafId = requestAnimationFrame(tick);
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && rafId === null) rafId = requestAnimationFrame(tick);
      else if (document.visibilityState !== 'visible' && rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); if (rafId !== null) cancelAnimationFrame(rafId); };
  }, []);

  // ── derived status ──
  const status = selectedId ? statusesById[selectedId] : null;
  const remoteServiceStatus = selectedId ? webStatuses[selectedId] : undefined;
  const remoteServiceUnavailable = remoteServiceStatus?.healthy === false;
  const statusPhase = status?.phase;
  const displayStatusPhase = remoteServiceUnavailable ? 'error' : statusPhase;
  const displayStatusLabel = remoteServiceUnavailable ? t(webPhaseLabelKey('error')) : t(phaseLabelKey(statusPhase));
  const displayStatusDetail = remoteServiceUnavailable
    ? (remoteServiceStatus.error || remoteServiceStatus.detail || status?.localUrl || '')
    : (status?.localUrl || '');
  const isReady = statusPhase === 'ready';
  const isReconnecting = statusPhase === 'degraded';
  const isConnecting = isConnectingPhase(statusPhase);
  const isBusy = isConnecting || isReconnecting;
  const canDisconnect = isReady || isBusy;
  const statusAgeMs = status ? Math.max(0, clockMs - status.updatedAtMs) : 0;
  const reconnectAppearsStuck = isReconnecting && statusAgeMs > 12_000;
  const latencyMs = remoteServiceStatus?.latencyMs;

  const phaseSteps: PhaseStep[] = React.useMemo(() => {
    if (!statusPhase || !CONNECTING_PHASE_ORDER.includes(statusPhase as typeof CONNECTING_PHASE_ORDER[number])) return [];
    const idx = CONNECTING_PHASE_ORDER.indexOf(statusPhase as typeof CONNECTING_PHASE_ORDER[number]);
    return CONNECTING_PHASE_ORDER.map((phase, i) => ({
      key: phase,
      label: t(phaseLabelKey(phase)),
      completed: i < idx,
      current: i === idx,
    }));
  }, [statusPhase, t]);

  // ── draft / changes ──
  const hasChanges = React.useMemo(() => {
    if (!draft || !selectedInstance) return false;
    return JSON.stringify(draft) !== JSON.stringify(selectedInstance);
  }, [draft, selectedInstance]);

  const updateDraft = React.useCallback((updater: (current: DesktopSshInstance) => DesktopSshInstance) => {
    setDraft((current) => (current ? updater(current) : current));
  }, []);

  // ── callbacks ──
  const handleSave = React.useCallback(async () => {
    if (!draft) return;
    const normalized = normalizeForSave(draft);
    if (!normalized.sshCommand.trim()) { toast.error(t('settings.remoteInstances.page.toast.sshCommandRequired')); return; }
    if (normalized.localForward.bindHost === '0.0.0.0') {
      if (!window.confirm(t('settings.remoteInstances.page.confirm.bindAllInterfaces'))) return;
    }
    if (normalized.auth.sshPassword?.enabled && normalized.auth.sshPassword.value?.trim() && normalized.auth.sshPassword.store !== 'settings') {
      const store = window.confirm(t('settings.remoteInstances.page.confirm.storeSshPasswordPlaintext'));
      normalized.auth.sshPassword.store = store ? 'settings' : 'never';
      if (!store) normalized.auth.sshPassword.value = undefined;
    }
    if (normalized.auth.openchamberPassword?.enabled && normalized.auth.openchamberPassword.value?.trim() && normalized.auth.openchamberPassword.store !== 'settings') {
      const store = window.confirm(t('settings.remoteInstances.page.confirm.storeUiPasswordPlaintext'));
      normalized.auth.openchamberPassword.store = store ? 'settings' : 'never';
      if (!store) normalized.auth.openchamberPassword.value = undefined;
    }
    try {
      await upsertInstance(normalized);
      toast.success(t('settings.remoteInstances.page.toast.instanceSaved'));
    } catch (error) {
      toast.error(t('settings.remoteInstances.page.toast.saveFailed'), { description: error instanceof Error ? error.message : String(error) });
    }
  }, [draft, t, upsertInstance]);

  const createImportedInstance = React.useCallback(async (host: string, destination: string): Promise<boolean> => {
    const id = `ssh-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      await createFromCommand(id, `ssh ${destination}`, host);
      setSelectedId(id);
      toast.success(t('settings.remoteInstances.page.toast.instanceCreated'));
      return true;
    } catch (error) {
      toast.error(t('settings.remoteInstances.sidebar.toast.createFailed'), { description: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }, [createFromCommand, setSelectedId, t]);

  const closePatternDialog = React.useCallback(() => {
    if (patternCreating) return;
    setPatternHost(null);
    setPatternDestination('');
  }, [patternCreating]);

  const handleImportCandidate = React.useCallback((host: string, pattern: boolean) => {
    if (pattern) { setPatternHost(host); setPatternDestination(suggestConcreteHost(host)); return; }
    void createImportedInstance(host, host);
  }, [createImportedInstance]);

  const handlePatternCreate = React.useCallback(async () => {
    const host = patternHost;
    const destination = patternDestination.trim();
    if (!host || !destination) { if (destination) return; toast.error(t('settings.remoteInstances.page.toast.destinationRequired')); return; }
    setPatternCreating(true);
    try {
      if (await createImportedInstance(host, destination)) { setPatternHost(null); setPatternDestination(''); }
    } finally { setPatternCreating(false); }
  }, [createImportedInstance, patternDestination, patternHost, t]);

  const handleQuickAdd = React.useCallback((sshCommand: string) => {
    const id = `ssh-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    void createFromCommand(id, sshCommand).then(() => setSelectedId(id)).catch((err) => {
      toast.error(t('settings.remoteInstances.sidebar.toast.createFailed'), { description: err instanceof Error ? err.message : String(err) });
    });
  }, [createFromCommand, setSelectedId, t]);

  const connectWithPortRecovery = React.useCallback(async () => {
    if (!selectedInstance) return;
    try { await connect(selectedInstance.id); return; } catch (error) {
      if (!isPortInUseError(error)) throw error;
      const allow = window.confirm(t('settings.remoteInstances.sidebar.confirm.localPortInUseRetry'));
      if (!allow) throw error;
      const nextInstance: DesktopSshInstance = {
        ...(selectedInstance as DesktopSshInstance),
        localForward: { ...(selectedInstance as DesktopSshInstance).localForward, preferredLocalPort: randomPort() },
      };
      await upsertInstance(nextInstance);
      await connect(nextInstance.id);
      toast.success(t('settings.remoteInstances.sidebar.toast.retriedWithRandomPort'));
    }
  }, [connect, selectedInstance, t, upsertInstance]);

  const readLogsForInstance = React.useCallback(async (id: string) => {
    return (await desktopSshLogs(id, 600)).map(formatLogLine);
  }, []);

  const handleOpenLogs = React.useCallback(async () => {
    if (!draft) return;
    setLogDialogOpen(true); setLogDialogLoading(true); setLogDialogError(null);
    try { setLogDialogLines(await readLogsForInstance(draft.id)); }
    catch (error) { setLogDialogLines([]); setLogDialogError(error instanceof Error ? error.message : String(error)); }
    finally { setLogDialogLoading(false); }
  }, [draft, readLogsForInstance]);

  React.useEffect(() => {
    if (!logDialogOpen || !draft) return;
    let disposed = false;
    const run = async () => {
      try {
        const lines = await readLogsForInstance(draft.id);
        if (!disposed) { setLogDialogLines(lines); setLogDialogError(null); }
      } catch (error) { if (!disposed) setLogDialogError(error instanceof Error ? error.message : String(error)); }
    };
    void run();
    const interval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void run();
    }, 1_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [draft, logDialogOpen, readLogsForInstance]);

  const logLinesText = React.useMemo(() => logDialogLines.join('\n'), [logDialogLines]);

  const handleCopyAllLogs = React.useCallback(() => {
    if (!logLinesText.trim()) { toast.error(t('settings.remoteInstances.page.toast.noLogsToCopy')); return; }
    void copyTextToClipboard(logLinesText).then((result) => { if (result.ok) toast.success(t('settings.remoteInstances.page.toast.logsCopied')); });
  }, [logLinesText, t]);

  const handleClearLogs = React.useCallback(async () => {
    if (!draft) return;
    try { await desktopSshLogsClear(draft.id); setLogDialogLines([]); toast.success(t('settings.remoteInstances.page.toast.logsCleared')); }
    catch (error) { toast.error(t('settings.remoteInstances.page.toast.clearLogsFailed'), { description: error instanceof Error ? error.message : String(error) }); }
  }, [draft, t]);

  const handleOpenCurrentInstance = React.useCallback(async () => {
    if (!status?.localUrl) { toast.error(t('settings.remoteInstances.page.toast.instanceUrlUnavailable')); return; }
    navigateToUrl(status.localUrl.trim());
  }, [status?.localUrl, t]);

  const handlePrimaryConnectionAction = React.useCallback(() => {
    if (!draft) return;
    setIsPrimaryActionPending(true);
    const operation = canDisconnect ? disconnect(draft.id) : connectWithPortRecovery();
    void operation
      .catch((error) => {
        const key = canDisconnect
          ? (isReady ? 'settings.remoteInstances.page.toast.disconnectFailed' : 'settings.remoteInstances.page.toast.cancelConnectionFailed')
          : 'settings.remoteInstances.page.toast.connectFailed';
        toast.error(t(key), { description: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => setIsPrimaryActionPending(false));
  }, [canDisconnect, connectWithPortRecovery, disconnect, draft, isReady, t]);

  const handleRetryAction = React.useCallback(() => {
    if (!draft || isConnecting) return;
    setIsRetryPending(true);
    const operation = isReconnecting ? disconnect(draft.id).then(() => connectWithPortRecovery()) : retry(draft.id);
    void operation
      .catch((error) => { toast.error(t('settings.remoteInstances.page.toast.retryFailed'), { description: error instanceof Error ? error.message : String(error) }); })
      .finally(() => setIsRetryPending(false));
  }, [connectWithPortRecovery, disconnect, draft, isConnecting, isReconnecting, retry, t]);

  const handleRestartAction = React.useCallback(() => {
    if (!draft) return;
    void useDesktopSshStore.getState().restart(draft.id).catch((error) => {
      toast.error(t('settings.remoteInstances.page.toast.retryFailed'), { description: error instanceof Error ? error.message : String(error) });
    });
  }, [draft, t]);

  const handleTestConnection = React.useCallback(async () => {
    if (!draft) return;
    const instanceId = draft.id;

    // Already connected — just report success without touching the live connection
    const currentStatus = useDesktopSshStore.getState().statusesById[instanceId];
    if (currentStatus?.phase === 'ready') {
      toast.success(t('settings.remoteInstances.page.toast.testConnectionSuccess'));
      return;
    }

    setIsTesting(true);
    try { await connect(instanceId); } catch { setIsTesting(false); toast.error(t('settings.remoteInstances.page.toast.testConnectionFailed')); return; }
    const maxAttempts = 100;
    let attempts = 0;
    const check = () => {
      attempts++;
      const s = useDesktopSshStore.getState().statusesById[instanceId];
      if (!s || s.phase === 'idle') {
        if (attempts < maxAttempts) setTimeout(check, 200);
        else { void disconnect(instanceId); setIsTesting(false); toast.error(t('settings.remoteInstances.page.toast.testConnectionTimeout')); }
        return;
      }
      if (s.phase === 'error') { setIsTesting(false); toast.error(t('settings.remoteInstances.page.toast.testConnectionFailed'), { description: s.detail }); return; }
      void disconnect(instanceId).then(() => { setIsTesting(false); toast.success(t('settings.remoteInstances.page.toast.testConnectionSuccess')); });
    };
    setTimeout(check, 200);
  }, [connect, disconnect, draft, t]);

  const handleRemoveInstance = React.useCallback(() => {
    if (!draft) return;
    const ok = window.confirm(t('settings.remoteInstances.page.confirm.removeInstance'));
    if (!ok) return;
    void removeInstance(draft.id)
      .then(() => { setSelectedId(null); toast.success(t('settings.remoteInstances.page.toast.instanceRemoved')); })
      .catch((err) => { toast.error(t('settings.remoteInstances.page.toast.removeInstanceFailed'), { description: err instanceof Error ? err.message : String(err) }); });
  }, [draft, removeInstance, setSelectedId, t]);

  const handleOpenForward = React.useCallback((forward: DesktopSshPortForward) => {
    if (forward.type === 'local' && typeof forward.localPort === 'number' && forward.localPort > 0) {
      void openExternalUrl(`http://${toBrowserHost(forward.localHost)}:${forward.localPort}`).then((opened) => {
        if (!opened) toast.error(t('settings.remoteInstances.page.toast.openLocalEndpointFailed'));
      });
    }
  }, [t]);

  const handleCopyEndpoint = React.useCallback(() => {
    if (!status?.localUrl) return;
    void copyTextToClipboard(status.localUrl).then((result) => {
      if (result.ok) toast.success(t('settings.remoteInstances.page.toast.localUrlCopied'));
    });
  }, [status?.localUrl, t]);

  // ── computed labels ──
  const retryButtonLabel = isConnecting
    ? t('settings.remoteInstances.page.actions.connecting')
    : isReconnecting
      ? reconnectAppearsStuck ? t('settings.remoteInstances.page.actions.reconnectNow') : t('settings.remoteInstances.page.actions.reconnecting')
      : t('settings.remoteInstances.sidebar.actions.retry');

  const canRetry = !isPrimaryActionPending && !isRetryPending &&
    (statusPhase === 'error' || statusPhase === 'idle' || !statusPhase || (isReconnecting && reconnectAppearsStuck)) && !isConnecting;

  const primaryButtonLabel = isReady
    ? t('settings.remoteInstances.sidebar.actions.disconnect')
    : canDisconnect ? t('settings.remoteInstances.page.actions.cancel') : t('settings.remoteInstances.sidebar.actions.connect');

  // ── web branch ──
  if (!isDesktop) {
    return (
      <WebRemoteInstancesPage
        instances={webInstances}
        statuses={webStatuses}
        loading={webLoading}
        error={webError}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        webDraft={webDraft}
        setWebDraft={setWebDraft}
        webLoad={webLoad}
        webSaveInstances={webSaveInstances}
        webConnect={webConnect}
        webDisconnect={webDisconnect}
        t={t}
      />
    );
  }

  // ── desktop: no instance selected → ImportCard + empty state ──
  if (!draft) {
    return (
      <SettingsPageLayout>
        <div className="mb-8">
          <div className="mb-1 px-1 space-y-0.5">
            <h3 className="typography-ui-header font-medium text-foreground">{t('settings.remoteInstances.page.title')}</h3>
            <p className="typography-meta text-muted-foreground">{t('settings.remoteInstances.page.description')}</p>
          </div>
          <section className="px-2 pb-2 pt-0">
            <p className="typography-meta text-muted-foreground mb-4">{t('settings.remoteInstances.page.empty.selectInstance')}</p>
          </section>
        </div>

        <div className="mb-8 border-t border-[var(--surface-subtle)] pt-8">
          <div className="mb-1 px-1 space-y-0.5">
            <h3 className="typography-ui-header font-medium text-foreground">{t('settings.remoteInstances.page.import.sectionTitle')}</h3>
          </div>
          <section className="px-2 pb-2 pt-0">
            <ImportCard
              loading={isImportsLoading}
              candidates={importCandidates.map((c) => ({ host: c.host, pattern: c.pattern, source: c.source, sshCommand: `ssh ${c.host}` }))}
              patternHost={patternHost}
              patternDestination={patternDestination}
              patternCreating={patternCreating}
              onImport={handleImportCandidate}
              onPatternDestinationChange={setPatternDestination}
              onPatternCreate={() => void handlePatternCreate()}
              onPatternClose={closePatternDialog}
              onQuickAdd={handleQuickAdd}
            />
          </section>
        </div>

      </SettingsPageLayout>
    );
  }

  // ── desktop: instance selected → card composition ──
  const instanceTitle = resolveInstanceLabel(draft);

  return (
    <SettingsPageLayout>
      {/* Header */}
      <div className="mb-6 px-1">
        <h2 className="typography-ui-header font-semibold text-foreground truncate">{instanceTitle}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 typography-meta text-muted-foreground">
          <span className={`h-2.5 w-2.5 rounded-full ${phaseDotClass(displayStatusPhase)}`} />
          <span>{displayStatusLabel}</span>
          {displayStatusDetail ? <span className="font-mono text-foreground/80">{displayStatusDetail}</span> : null}
          {reconnectAppearsStuck ? <span>{t('settings.remoteInstances.page.status.reconnectStale')}</span> : null}
          {!remoteServiceUnavailable && statusPhase === 'ready' && status ? (() => {
            const elapsed = Math.floor(statusAgeMs / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            const duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
            return <span className="typography-meta text-muted-foreground">{t('settings.remoteInstances.page.status.uptime', { duration })}</span>;
          })() : null}
        </div>
      </div>

      <div className="space-y-4">
        {/* Status Card */}
        <StatusCard
          phase={displayStatusPhase}
          isReady={isReady}
          isConnecting={isConnecting}
          isError={displayStatusPhase === 'error'}
          isReconnecting={isReconnecting}
          isRestarting={isRestarting}
          isDegraded={statusPhase === 'degraded'}
          statusLabel={displayStatusLabel}
          statusDetail={status?.detail}
          localUrl={status?.localUrl}
          latencyMs={latencyMs}
          uptimeMs={statusAgeMs}
          remoteServiceUnavailable={remoteServiceUnavailable}
          reconnectAppearsStuck={reconnectAppearsStuck}
          phaseSteps={phaseSteps}
          onCopyEndpoint={handleCopyEndpoint}
          onOpenEndpoint={() => void handleOpenCurrentInstance()}
          isDesktop={true}
        />

        {/* Connection Card */}
        <ConnectionCard
          isReady={isReady}
          isConnecting={isConnecting}
          isReconnecting={isReconnecting}
          isError={displayStatusPhase === 'error'}
          isRestarting={isRestarting}
          isDegraded={statusPhase === 'degraded'}
          isIdle={statusPhase === 'idle' || !statusPhase}
          reconnectAppearsStuck={reconnectAppearsStuck}
          canDisconnect={canDisconnect}
          canRetry={canRetry}
          isPrimaryActionPending={isPrimaryActionPending}
          isRetryPending={isRetryPending}
          isRestartPending={isRestarting}
          isTesting={isTesting}
          primaryButtonLabel={primaryButtonLabel}
          retryButtonLabel={retryButtonLabel}
          logDialogOpen={false}
          onConnect={handlePrimaryConnectionAction}
          onDisconnect={handlePrimaryConnectionAction}
          onRetry={handleRetryAction}
          onRestart={handleRestartAction}
          onTestConnection={() => void handleTestConnection()}
          onOpenLogs={() => void handleOpenLogs()}
          onCloseLogs={() => {}}
          isDesktop={true}
        />

        {/* Log Panel (modal dialog) */}
        <Dialog open={logDialogOpen} onOpenChange={(open) => { if (!open) setLogDialogOpen(false); }}>
          <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>{t('settings.remoteInstances.page.logsDialog.title')}</DialogTitle>
              <DialogDescription>{resolveInstanceLabel(draft)}</DialogDescription>
            </DialogHeader>
            <LogPanel
              open={logDialogOpen}
              loading={logDialogLoading}
              error={logDialogError}
              lines={logDialogLines}
              onCopyAll={handleCopyAllLogs}
              onClear={() => void handleClearLogs()}
            />
          </DialogContent>
        </Dialog>

        {/* Config Card */}
        <ConfigCard
          isDesktop={true}
          sshCommand={draft.sshCommand}
          onSshCommandChange={(v) => updateDraft((d) => ({ ...d, sshCommand: v }))}
          nickname={draft.nickname || ''}
          onNicknameChange={(v) => updateDraft((d) => ({ ...d, nickname: v }))}
          connectionTimeoutSec={draft.connectionTimeoutSec}
          onConnectionTimeoutChange={(v) => updateDraft((d) => ({ ...d, connectionTimeoutSec: Number.isFinite(v) ? v : d.connectionTimeoutSec }))}
          enabled={true}
          onEnabledChange={() => {}}
          remoteMode={draft.remoteOpenchamber.mode}
          onRemoteModeChange={(v) => updateDraft((d) => ({ ...d, remoteOpenchamber: { ...d.remoteOpenchamber, mode: v === 'external' ? 'external' : 'managed' } }))}
          keepRunning={draft.remoteOpenchamber.keepRunning}
          onKeepRunningChange={(v) => updateDraft((d) => ({ ...d, remoteOpenchamber: { ...d.remoteOpenchamber, keepRunning: v } }))}
          preferredRemotePort={draft.remoteOpenchamber.preferredPort}
          onPreferredRemotePortChange={(v) => updateDraft((d) => ({ ...d, remoteOpenchamber: { ...d.remoteOpenchamber, preferredPort: v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined } }))}
          installMethod={draft.remoteOpenchamber.installMethod}
          onInstallMethodChange={(v) => updateDraft((d) => ({
            ...d,
            remoteOpenchamber: { ...d.remoteOpenchamber, installMethod: v === 'npm' || v === 'download_release' || v === 'upload_bundle' ? v : 'bun' },
          }))}
          releaseDownloadUrl={draft.remoteOpenchamber.releaseDownloadUrl}
          onReleaseDownloadUrlChange={(v) => updateDraft((d) => ({ ...d, remoteOpenchamber: { ...d.remoteOpenchamber, releaseDownloadUrl: v } }))}
          bindHost={draft.localForward.bindHost}
          onBindHostChange={(v) => {
            if (v === '0.0.0.0' && !window.confirm(t('settings.remoteInstances.page.confirm.bindAllInterfaces'))) return;
            updateDraft((d) => ({ ...d, localForward: { ...d.localForward, bindHost: v === 'localhost' || v === '0.0.0.0' ? v : '127.0.0.1' } }));
          }}
          preferredLocalPort={draft.localForward.preferredLocalPort}
          onPreferredLocalPortChange={(v) => updateDraft((d) => ({ ...d, localForward: { ...d.localForward, preferredLocalPort: v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined } }))}
          authType={draft.auth.sshPassword?.enabled ? 'ssh-password' : draft.auth.openchamberPassword?.enabled ? 'openchamber-password' : 'none'}
          onAuthTypeChange={(v) => {
            updateDraft((d) => {
              if (v === 'ssh-password') return { ...d, auth: { ...d.auth, sshPassword: { enabled: true, value: d.auth.sshPassword?.value || '', store: d.auth.sshPassword?.store || 'never' } } };
              if (v === 'openchamber-password') return { ...d, auth: { ...d.auth, openchamberPassword: { enabled: true, value: d.auth.openchamberPassword?.value || '', store: d.auth.openchamberPassword?.store || 'never' } } };
              return { ...d, auth: { ...d.auth, sshPassword: { enabled: false, value: undefined, store: 'never' }, openchamberPassword: { enabled: false, value: undefined, store: 'never' } } };
            });
          }}
          authValue=""
          onAuthValueChange={() => {}}
          sshPasswordEnabled={draft.auth.sshPassword?.store === 'settings'}
          onSshPasswordEnabledChange={(v) => updateDraft((d) => ({ ...d, auth: { ...d.auth, sshPassword: { enabled: Boolean(d.auth.sshPassword?.value?.trim()), value: d.auth.sshPassword?.value || '', store: v ? 'settings' : 'never' } } }))}
          sshPasswordValue={draft.auth.sshPassword?.value || ''}
          onSshPasswordValueChange={(v) => updateDraft((d) => ({ ...d, auth: { ...d.auth, sshPassword: { enabled: v.trim().length > 0, value: v, store: d.auth.sshPassword?.store || 'never' } } }))}
          uiPasswordEnabled={draft.auth.openchamberPassword?.store === 'settings'}
          onUiPasswordEnabledChange={(v) => updateDraft((d) => ({ ...d, auth: { ...d.auth, openchamberPassword: { enabled: Boolean(d.auth.openchamberPassword?.value?.trim()), value: d.auth.openchamberPassword?.value || '', store: v ? 'settings' : 'never' } } }))}
          uiPasswordValue={draft.auth.openchamberPassword?.value || ''}
          onUiPasswordValueChange={(v) => updateDraft((d) => ({ ...d, auth: { ...d.auth, openchamberPassword: { enabled: v.trim().length > 0, value: v, store: d.auth.openchamberPassword?.store || 'never' } } }))}
          webUrl=""
          onWebUrlChange={() => {}}
        />

        {/* Forward Card (desktop only) */}
        <ForwardCard
          forwards={draft.portForwards}
          expandedForwards={expandedForwards}
          onToggleExpand={(id) => setExpandedForwards((prev) => ({ ...prev, [id]: !prev[id] }))}
          onUpdateForward={(id, updater) => updateDraft((d) => ({ ...d, portForwards: d.portForwards.map((f) => f.id === id ? updater(f) : f) }))}
          onRemoveForward={(id) => updateDraft((d) => ({ ...d, portForwards: d.portForwards.filter((f) => f.id !== id) }))}
          onAddForward={() => {
            const f = makeForward();
            updateDraft((d) => ({ ...d, portForwards: [...d.portForwards, f] }));
            setExpandedForwards((prev) => ({ ...prev, [f.id]: true }));
          }}
          onOpenLocal={handleOpenForward}
          isDesktop={true}
        />

        {/* Danger Card */}
        <DangerCard onRemove={handleRemoveInstance} instanceLabel={instanceTitle} />
      </div>

      {/* Change Bar */}
      <ChangeBar
        visible={hasChanges}
        changeCount={hasChanges ? 1 : 0}
        changeSummary=""
        onSave={() => void handleSave()}
        onDiscard={() => setDraft(selectedInstance as DesktopSshInstance)}
        error={error}
        saving={isSaving}
      />
    </SettingsPageLayout>
  );
};
