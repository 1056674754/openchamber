import { create } from 'zustand';
import {
  desktopSshConnect,
  desktopSshDisconnect,
  desktopSshInstancesGet,
  desktopSshStatus,
  listenDesktopSshStatus,
  resolveInstanceLabel,
  type DesktopSshInstance,
  type DesktopSshInstanceStatus,
} from '@/lib/desktopSsh';
import { hasDesktopInvoke } from '@/lib/desktop';
import { serverRegistry } from '@/lib/opencode/server-registry';
import type {
  RemoteInstance,
  RemoteInstanceApiEntry,
  RemoteInstancePhase,
  RemoteInstanceStatus,
  RemoteInstancesApiResponse,
} from '@/lib/remote-instances/types';
import {
  mapSshPhaseToRemotePhase,
  resolveRemoteLabel,
} from '@/lib/remote-instances/types';
import { registerRemoteInstanceProxy } from '@/lib/remote-instances/registry';

type SetFn = (
  fnOrPartial:
    | ((state: RemoteInstancesState) => Partial<RemoteInstancesState>)
    | Partial<RemoteInstancesState>,
) => void;
type GetFn = () => RemoteInstancesState;

interface RemoteInstancesState {
  instances: RemoteInstance[];
  statuses: Record<string, RemoteInstanceStatus>;
  loading: boolean;
  initialized: boolean;
  error: string | null;

  loadInstances: () => Promise<void>;
  saveInstances: (instances: RemoteInstance[]) => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  refreshStatus: (id?: string) => Promise<void>;
  getStatus: (id: string) => RemoteInstanceStatus | undefined;
  clearError: () => void;
}

const isDesktop = hasDesktopInvoke();
const webHealthProbeInFlight = new Set<string>();
let desktopHealthPollTimer: ReturnType<typeof setInterval> | null = null;

type RemoteHealthOverlay = {
  url?: string;
  healthy?: boolean;
  latencyMs?: number;
  error?: string;
  updatedAtMs?: number;
};

function sshInstanceToRemote(raw: DesktopSshInstance): RemoteInstance {
  return {
    id: raw.id,
    label: resolveInstanceLabel(raw),
    enabled: true,
    connectionTimeoutSec: raw.connectionTimeoutSec,
    source: 'ssh',
  };
}

function applyHealthOverlay(
  status: RemoteInstanceStatus,
  overlay?: RemoteHealthOverlay,
): RemoteInstanceStatus {
  if (!overlay || status.phase !== 'connected') {
    return status;
  }

  const url = status.url || overlay.url;
  if (overlay.healthy === undefined) {
    return url && url !== status.url ? { ...status, url } : status;
  }

  if (overlay.healthy) {
    return {
      ...status,
      ...(url ? { url } : {}),
      healthy: true,
      latencyMs: overlay.latencyMs,
      detail: status.error && status.detail === status.error ? undefined : status.detail,
      error: undefined,
      updatedAtMs: overlay.updatedAtMs ?? status.updatedAtMs,
    };
  }

  const error = overlay.error || status.error || 'Remote health check failed';
  return {
    ...status,
    ...(url ? { url } : {}),
    healthy: false,
    latencyMs: overlay.latencyMs,
    detail: error,
    error,
    updatedAtMs: overlay.updatedAtMs ?? status.updatedAtMs,
  };
}

function sshStatusToRemote(
  raw: DesktopSshInstanceStatus,
  overlay?: RemoteHealthOverlay,
): RemoteInstanceStatus {
  const phase = mapSshPhaseToRemotePhase(raw.phase);
  const status: RemoteInstanceStatus = {
    id: raw.id,
    phase,
    detail: raw.detail,
    url: raw.localUrl,
    error: raw.phase === 'error' ? raw.detail : undefined,
    updatedAtMs: raw.updatedAtMs,
  };
  if (phase === 'error') {
    status.healthy = false;
  }
  return applyHealthOverlay(status, overlay);
}

function probeRegisteredWebInstance(id: string): void {
  if (webHealthProbeInFlight.has(id)) return;
  webHealthProbeInFlight.add(id);
  void serverRegistry.probeHealth(id).finally(() => {
    webHealthProbeInFlight.delete(id);
  });
}

function syncRegistryForStatus(
  status: RemoteInstanceStatus,
  label: string,
  options?: { enabled?: boolean },
): void {
  if (isDesktop && status.phase === 'connected' && status.url) {
    const existing = serverRegistry.get(status.id);
    registerRemoteInstanceProxy({
      id: status.id,
      label,
      healthStatus: status.healthy === false
        ? 'unhealthy'
        : existing?.healthStatus === 'healthy'
          ? 'healthy'
          : 'connecting',
    });
    if (status.healthy !== false && existing?.healthStatus !== 'healthy') {
      probeRegisteredWebInstance(status.id);
    }
  } else if (!isDesktop && status.url && options?.enabled !== false) {
    registerRemoteInstanceProxy({
      id: status.id,
      label,
    });

    if (status.healthy === true) {
      serverRegistry.setHealthStatus(status.id, 'healthy');
    } else if (status.phase === 'connecting') {
      serverRegistry.setHealthStatus(status.id, 'connecting');
      probeRegisteredWebInstance(status.id);
    } else {
      serverRegistry.setHealthStatus(status.id, 'unhealthy');
      probeRegisteredWebInstance(status.id);
    }
  } else if (status.phase === 'error' || status.phase === 'idle' || status.phase === 'disconnected') {
    serverRegistry.unregister(status.id);
  }
}

function syncRegistryForInstance(instance: RemoteInstance, status?: RemoteInstanceStatus): void {
  if (!status) return;
  syncRegistryForStatus(status, resolveRemoteLabel(instance), { enabled: instance.enabled });
}

function syncRegistryForInstances(instances: RemoteInstance[], statuses: Record<string, RemoteInstanceStatus>): void {
  for (const inst of instances) {
    syncRegistryForInstance(inst, statuses[inst.id]);
  }
}

export function markRemoteInstanceTransportStatus(
  id: string,
  connected: boolean,
  detail?: string,
): void {
  const state = useRemoteInstancesStore.getState();
  const previous = state.statuses[id];
  if (!previous) return;

  const now = Date.now();
  const error = connected ? undefined : (detail || 'Remote event stream unavailable');
  const next: RemoteInstanceStatus = connected
    ? {
        ...previous,
        phase: 'connected',
        healthy: true,
        detail: previous.detail === previous.error ? undefined : previous.detail,
        error: undefined,
        updatedAtMs: now,
      }
    : {
        ...previous,
        phase: 'error',
        healthy: false,
        detail: error,
        error,
        updatedAtMs: now,
      };

  if (
    previous.phase === next.phase
    && previous.healthy === next.healthy
    && previous.detail === next.detail
    && previous.error === next.error
  ) {
    return;
  }

  useRemoteInstancesStore.setState({
    statuses: {
      ...state.statuses,
      [id]: next,
    },
  });

  const instance = state.instances.find((item) => item.id === id);
  syncRegistryForStatus(next, instance ? resolveRemoteLabel(instance) : id);
}

function statusPhaseFromHealth(health: RemoteInstanceApiEntry['health']): RemoteInstancePhase {
  if (!health) return 'connecting';
  return health.healthy ? 'connected' : 'error';
}

function statusHealthyFromHealth(health: RemoteInstanceApiEntry['health']): boolean | undefined {
  if (!health) return undefined;
  return health.healthy === true;
}

function statusDetailFromHealth(health: RemoteInstanceApiEntry['health']): string | undefined {
  if (!health) return 'Checking remote instance health';
  return health.error || undefined;
}

async function fetchWebInstances(): Promise<{
  instances: RemoteInstance[];
  statuses: Record<string, RemoteInstanceStatus>;
}> {
  const response = await fetch('/api/remote-instances');
  if (!response.ok) {
    throw new Error(`Failed to fetch remote instances: ${response.status}`);
  }
  const data: RemoteInstancesApiResponse = await response.json();
  const instances: RemoteInstance[] = [];
  const statuses: Record<string, RemoteInstanceStatus> = {};
  for (const entry of data.instances) {
    const { health, ...instance } = entry;
    instances.push(instance);
    if (entry.url) {
      statuses[entry.id] = {
        id: entry.id,
        phase: statusPhaseFromHealth(health),
        detail: statusDetailFromHealth(health),
        url: entry.url,
        healthy: statusHealthyFromHealth(health),
        latencyMs: health?.latencyMs,
        error: health?.error,
        updatedAtMs: typeof health?.lastCheck === 'number' ? health.lastCheck : Date.now(),
      };
    }
  }
  return { instances, statuses };
}

async function fetchRemoteHealthOverlays(): Promise<Record<string, RemoteHealthOverlay>> {
  const response = await fetch('/api/remote-instances');
  if (!response.ok) {
    throw new Error(`Failed to fetch remote instance health: ${response.status}`);
  }
  const data: RemoteInstancesApiResponse = await response.json();
  const overlays: Record<string, RemoteHealthOverlay> = {};
  for (const entry of data.instances) {
    const health = entry.health;
    overlays[entry.id] = {
      ...(entry.url ? { url: entry.url } : {}),
      ...(health
        ? {
            healthy: health.healthy === true,
            latencyMs: health.latencyMs,
            error: health.error,
            updatedAtMs: typeof health.lastCheck === 'number' ? health.lastCheck : Date.now(),
          }
        : {}),
    };
  }
  return overlays;
}

const POLL_INTERVAL_MS = 30_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startWebPolling(set: SetFn, get: GetFn): void {
  if (pollTimer) return;
  const poll = async () => {
    try {
      const { instances, statuses } = await fetchWebInstances();
      const prev = get().statuses;
      let changed = Object.keys(prev).length !== Object.keys(statuses).length;
      if (!changed) {
        for (const id of Object.keys(statuses)) {
          const p = prev[id];
          const n = statuses[id];
          if (!p || p.phase !== n.phase || p.healthy !== n.healthy || p.url !== n.url || p.updatedAtMs !== n.updatedAtMs) {
            changed = true;
            break;
          }
        }
      }
      if (!changed && get().instances.length === instances.length) return;

      set({ instances, statuses });

      syncRegistryForInstances(instances, statuses);
    } catch {
      // intentionally empty — next poll cycle retries
    }
  };
  void poll();
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

function mergeDesktopHealthOverlays(
  set: SetFn,
  get: GetFn,
  overlays: Record<string, RemoteHealthOverlay>,
): void {
  const prev = get().statuses;
  let changed = false;
  const next: Record<string, RemoteInstanceStatus> = {};

  for (const [id, status] of Object.entries(prev)) {
    const merged = applyHealthOverlay(status, overlays[id]);
    next[id] = merged;
    if (!changed && (
      status.url !== merged.url
      || status.healthy !== merged.healthy
      || status.latencyMs !== merged.latencyMs
      || status.detail !== merged.detail
      || status.error !== merged.error
      || status.updatedAtMs !== merged.updatedAtMs
    )) {
      changed = true;
    }
  }

  if (!changed) return;
  set({ statuses: next });

  const instances = get().instances;
  for (const status of Object.values(next)) {
    const instance = instances.find((i) => i.id === status.id);
    syncRegistryForStatus(status, instance ? resolveRemoteLabel(instance) : status.id);
  }
}

function startDesktopHealthPolling(set: SetFn, get: GetFn): void {
  if (desktopHealthPollTimer) return;
  const poll = async () => {
    try {
      mergeDesktopHealthOverlays(set, get, await fetchRemoteHealthOverlays());
    } catch {
      // intentionally empty — next poll cycle retries
    }
  };
  void poll();
  desktopHealthPollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

export function stopWebPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (desktopHealthPollTimer) {
    clearInterval(desktopHealthPollTimer);
    desktopHealthPollTimer = null;
  }
}

let electronListenerInstalled = false;

async function installElectronListener(set: SetFn, get: GetFn): Promise<void> {
  if (electronListenerInstalled) return;
  electronListenerInstalled = true;

  await listenDesktopSshStatus((raw) => {
    const status = sshStatusToRemote(raw);
    const prev = get().statuses[status.id];
    const changed = !prev
      || prev.phase !== status.phase
      || prev.url !== status.url
      || prev.detail !== status.detail
      || prev.updatedAtMs !== status.updatedAtMs;

    if (changed) {
      set((state) => ({
        statuses: { ...state.statuses, [status.id]: status },
      }));
    }

    const instance = get().instances.find((i) => i.id === status.id);
    const label = instance ? instance.label : status.id;
    syncRegistryForStatus(status, label);

    if (status.phase === 'connected') {
      void fetchRemoteHealthOverlays()
        .then((overlays) => mergeDesktopHealthOverlays(set, get, overlays))
        .catch(() => undefined);
    }
  });
}

export const useRemoteInstancesStore = create<RemoteInstancesState>((set, get) => ({
  instances: [],
  statuses: {},
  loading: false,
  initialized: false,
  error: null,

  loadInstances: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });

    try {
      if (isDesktop) {
        const [config, rawStatuses, healthOverlays] = await Promise.all([
          desktopSshInstancesGet(),
          desktopSshStatus(),
          fetchRemoteHealthOverlays().catch((): Record<string, RemoteHealthOverlay> => ({})),
        ]);

        const instances = config.instances.map(sshInstanceToRemote);
        const statuses: Record<string, RemoteInstanceStatus> = {};
        for (const raw of rawStatuses) {
          const mapped = sshStatusToRemote(raw, healthOverlays[raw.id]);
          statuses[mapped.id] = mapped;
        }

        await installElectronListener(set, get);

        set({ instances, statuses, loading: false, initialized: true });

        for (const inst of instances) {
          const s = statuses[inst.id];
          if (s) syncRegistryForStatus(s, inst.label);
        }
        startDesktopHealthPolling(set, get);
      } else {
        const { instances, statuses } = await fetchWebInstances();

        set({ instances, statuses, loading: false, initialized: true });
        syncRegistryForInstances(instances, statuses);

        startWebPolling(set, get);
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  saveInstances: async (instances) => {
    set({ error: null });
    try {
      if (isDesktop) {
        return;
      }

      const explicit = instances.filter((i) => i.source !== 'ssh');
      const response = await fetch('/api/remote-instances', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instances: explicit }),
      });
      if (!response.ok) {
        throw new Error(`Failed to save remote instances: ${response.status}`);
      }
      await get().loadInstances();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  connect: async (id) => {
    set({ error: null });
    try {
      if (isDesktop) {
        await desktopSshConnect(id);
        await get().refreshStatus(id);
      } else {
        const response = await fetch(`/api/remote-instances/${id}/connect`, {
          method: 'POST',
        });
        if (!response.ok) {
          throw new Error(`Connect failed: ${response.status}`);
        }
        await get().refreshStatus(id);

        const instance = get().instances.find((i) => i.id === id);
        const status = get().statuses[id];
        if (instance && status) {
          syncRegistryForInstance(instance, status);
        }
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  disconnect: async (id) => {
    set({ error: null });
    try {
      if (isDesktop) {
        await desktopSshDisconnect(id);
        serverRegistry.unregister(id);
        await get().refreshStatus(id);
      } else {
        const response = await fetch(`/api/remote-instances/${id}/disconnect`, {
          method: 'POST',
        });
        if (!response.ok) {
          throw new Error(`Disconnect failed: ${response.status}`);
        }
        serverRegistry.unregister(id);
        await get().refreshStatus(id);
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  refreshStatus: async (id) => {
    try {
      if (isDesktop) {
        const [rawStatuses, healthOverlays] = await Promise.all([
          desktopSshStatus(id),
          fetchRemoteHealthOverlays().catch((): Record<string, RemoteHealthOverlay> => ({})),
        ]);
        const prev = get().statuses;
        let changed = false;
        const updates: Record<string, RemoteInstanceStatus> = {};
        for (const raw of rawStatuses) {
          const mapped = sshStatusToRemote(raw, healthOverlays[raw.id]);
          updates[mapped.id] = mapped;
          const instance = get().instances.find((item) => item.id === mapped.id);
          syncRegistryForStatus(mapped, instance ? resolveRemoteLabel(instance) : mapped.id);
          const p = prev[mapped.id];
          if (!changed && (!p
            || p.phase !== mapped.phase
            || p.url !== mapped.url
            || p.healthy !== mapped.healthy
            || p.updatedAtMs !== mapped.updatedAtMs)) {
            changed = true;
          }
        }
        if (!changed && Object.keys(prev).length === Object.keys(updates).length) return;
        set((state) => ({ statuses: { ...state.statuses, ...updates } }));
      } else {
        const { instances, statuses } = await fetchWebInstances();
        const prev = get().statuses;
        let changed = Object.keys(prev).length !== Object.keys(statuses).length;
        if (!changed) {
          for (const key of Object.keys(statuses)) {
            const p = prev[key];
            const n = statuses[key];
            if (!p || p.phase !== n.phase || p.healthy !== n.healthy || p.updatedAtMs !== n.updatedAtMs) {
              changed = true;
              break;
            }
          }
        }
        syncRegistryForInstances(instances, statuses);
        if (!changed && get().instances.length === instances.length) return;
        set({ instances, statuses });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  getStatus: (id) => get().statuses[id],

  clearError: () => set({ error: null }),
}));
