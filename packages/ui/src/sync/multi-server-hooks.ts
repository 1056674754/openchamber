import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { Session } from "@opencode-ai/sdk/v2";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import type { PermissionRequest } from "@/types/permission";
import type { FormRequest } from "@/types/form";
import {
  getAllSyncStores,
  getSyncStoresForServer,
  subscribeSyncStoresRegistry,
} from "./multi-server-registry";
import type { ChildStoreManager } from "./child-store";
import { useSyncSystem } from "./sync-context";
import { DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";
import {
  aggregateLiveSessions,
  aggregateLiveSessionStatuses,
} from "./live-aggregate";
import { createSessionActivityKey } from "./session-activity-key";

function collectExtraSessions(): Session[] {
  const entries = getAllSyncStores();
  const sessions: Session[] = [];
  for (const entry of entries) {
    if (entry.serverId === DEFAULT_SERVER_ID) continue;
    for (const store of entry.childStores.children.values()) {
      sessions.push(...store.getState().session);
    }
  }
  return sessions;
}

function sessionsStableSignature(sessions: Session[]): string {
  return sessions.map((s) => s.id + ':' + (s.time?.updated ?? s.time?.created ?? 0)).join('|');
}

function statusStableSignature(statuses: Record<string, SessionStatus>): string {
  return Object.entries(statuses)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, status]) => `${id}:${JSON.stringify(status)}`)
    .join('|');
}

function collectExtraStatuses(): Record<string, SessionStatus> {
  const entries = getAllSyncStores();
  const statuses: Record<string, SessionStatus> = {};
  for (const entry of entries) {
    if (entry.serverId === DEFAULT_SERVER_ID) continue;
    for (const store of entry.childStores.children.values()) {
      Object.assign(statuses, store.getState().session_status);
    }
  }
  return statuses;
}

function collectActiveSessionKeys(defaultChildStores: ChildStoreManager): Set<string> {
  const managers = new Map<string, ChildStoreManager>([[DEFAULT_SERVER_ID, defaultChildStores]]);
  for (const entry of getAllSyncStores()) {
    managers.set(entry.serverId, entry.childStores);
  }

  const keys = new Set<string>();
  for (const [serverId, manager] of managers) {
    for (const [directory, store] of manager.children) {
      for (const [sessionId, status] of Object.entries(store.getState().session_status)) {
        if (status.type === 'idle') continue;
        keys.add(createSessionActivityKey(serverId, directory, sessionId));
      }
    }
  }
  return keys;
}

export function useAllServersActiveSessionKeys(options?: { enabled?: boolean }): ReadonlySet<string> {
  const enabled = options?.enabled !== false;
  const { childStores } = useSyncSystem();
  const cacheRef = useRef<{ signature: string; keys: Set<string> }>({ signature: '', keys: new Set() });

  const getSnapshot = useCallback(() => {
    if (!enabled) return cacheRef.current.keys;
    const keys = collectActiveSessionKeys(childStores);
    const signature = [...keys].sort().join('\n');
    if (cacheRef.current.signature === signature) return cacheRef.current.keys;
    cacheRef.current = { signature, keys };
    return keys;
  }, [childStores, enabled]);

  const subscribe = useCallback((notify: () => void) => {
    if (!enabled) return () => undefined;
    let storeUnsubs: Array<() => void> = [];
    let managerUnsubs: Array<() => void> = [];

    const syncSubscriptions = () => {
      for (const unsubscribe of storeUnsubs) unsubscribe();
      for (const unsubscribe of managerUnsubs) unsubscribe();
      storeUnsubs = [];
      managerUnsubs = [];

      const managers = new Map<string, ChildStoreManager>([[DEFAULT_SERVER_ID, childStores]]);
      for (const entry of getAllSyncStores()) managers.set(entry.serverId, entry.childStores);
      for (const manager of managers.values()) {
        for (const store of manager.children.values()) {
          storeUnsubs.push(store.subscribe((state, previous) => {
            if (state.session_status !== previous.session_status) notify();
          }));
        }
        managerUnsubs.push(manager.subscribeRegistry(() => {
          syncSubscriptions();
          notify();
        }));
      }
    };

    syncSubscriptions();
    const unsubscribeRegistry = subscribeSyncStoresRegistry(() => {
      syncSubscriptions();
      notify();
    });
    return () => {
      unsubscribeRegistry();
      for (const unsubscribe of storeUnsubs) unsubscribe();
      for (const unsubscribe of managerUnsubs) unsubscribe();
    };
  }, [childStores, enabled]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

type BlockingRequestKind = "permission" | "form";
type BlockingRequest = PermissionRequest | FormRequest;
export type BlockingRequestTarget = {
  sessionId: string;
  directory: string;
};

function resolveBlockingRequestStores(
  defaultChildStores: ChildStoreManager,
  serverId: string,
): ChildStoreManager | undefined {
  return serverId === DEFAULT_SERVER_ID
    ? defaultChildStores
    : getSyncStoresForServer(serverId);
}

export function collectServerSessions(
  defaultChildStores: ChildStoreManager,
  serverId: string,
): Session[] {
  const manager = resolveBlockingRequestStores(defaultChildStores, serverId);
  if (!manager) return [];
  return aggregateLiveSessions(Array.from(manager.children.values(), (store) => store.getState()));
}

export function useServerLiveSessions(serverId: string): Session[] {
  const { childStores } = useSyncSystem();
  const cacheRef = useRef<{ serverId: string; value: Session[] } | null>(null);

  const getSnapshot = useCallback(() => {
    const value = collectServerSessions(childStores, serverId);
    const cached = cacheRef.current;
    if (
      cached
      && cached.serverId === serverId
      && cached.value.length === value.length
      && cached.value.every((session, index) => session === value[index])
    ) {
      return cached.value;
    }
    cacheRef.current = { serverId, value };
    return value;
  }, [childStores, serverId]);

  const subscribe = useCallback((notify: () => void) => {
    let storeUnsubs: (() => void)[] = [];
    let managerRegistryUnsub: (() => void) | undefined;

    const syncStoreSubscriptions = () => {
      for (const unsubscribe of storeUnsubs) unsubscribe();
      storeUnsubs = [];
      managerRegistryUnsub?.();
      managerRegistryUnsub = undefined;

      const manager = resolveBlockingRequestStores(childStores, serverId);
      if (!manager) return;
      for (const store of manager.children.values()) {
        storeUnsubs.push(store.subscribe(notify));
      }
      managerRegistryUnsub = manager.subscribeRegistry(() => {
        syncStoreSubscriptions();
        notify();
      });
    };

    syncStoreSubscriptions();
    const unsubscribeRemoteRegistry = subscribeSyncStoresRegistry(() => {
      syncStoreSubscriptions();
      notify();
    });

    return () => {
      unsubscribeRemoteRegistry();
      managerRegistryUnsub?.();
      for (const unsubscribe of storeUnsubs) unsubscribe();
      storeUnsubs = [];
    };
  }, [childStores, serverId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function collectBlockingRequests<T extends BlockingRequest>(
  kind: BlockingRequestKind,
  defaultChildStores: ChildStoreManager,
  serverId: string,
  targets: readonly BlockingRequestTarget[],
): T[] {
  if (targets.length === 0) return [];

  const manager = resolveBlockingRequestStores(defaultChildStores, serverId);
  if (!manager) return [];

  const seen = new Set<string>();
  const result: T[] = [];
  for (const target of targets) {
    if (!target.sessionId || !target.directory) continue;
    const store = manager.getChild(target.directory);
    if (!store) continue;
    const state = store.getState();
    const requestMap = kind === "permission" ? state.permission : state.form;
    const requests = requestMap[target.sessionId] as T[] | undefined;
    if (!requests || requests.length === 0) continue;
    for (const request of requests) {
      if (!request?.id) continue;
      if (seen.has(request.id)) continue;
      seen.add(request.id);
      result.push(request);
    }
  }
  return result;
}

export function isSameBlockingRequestSnapshot<T>(
  previousServerId: string,
  previous: readonly T[],
  serverId: string,
  next: readonly T[],
): boolean {
  return previousServerId === serverId
    && previous.length === next.length
    && previous.every((request, index) => request === next[index]);
}

function useServerBlockingRequests<T extends BlockingRequest>(
  kind: BlockingRequestKind,
  serverId: string,
  targets: readonly BlockingRequestTarget[],
): T[] {
  const { childStores } = useSyncSystem();
  const cacheRef = useRef<{ serverId: string; value: T[] } | null>(null);

  const getSnapshot = useCallback(() => {
    const value = collectBlockingRequests<T>(kind, childStores, serverId, targets);
    const cached = cacheRef.current;
    if (cached && isSameBlockingRequestSnapshot(cached.serverId, cached.value, serverId, value)) {
      return cached.value;
    }
    cacheRef.current = { serverId, value };
    return value;
  }, [childStores, kind, serverId, targets]);

  const subscribe = useCallback((notify: () => void) => {
    let storeUnsubs: (() => void)[] = [];
    let managerRegistryUnsub: (() => void) | undefined;

    const syncStoreSubscriptions = () => {
      for (const unsubscribe of storeUnsubs) unsubscribe();
      storeUnsubs = [];
      managerRegistryUnsub?.();
      managerRegistryUnsub = undefined;

      const manager = resolveBlockingRequestStores(childStores, serverId);
      if (!manager) return;
      const subscribedStores = new Set<ReturnType<ChildStoreManager["getChild"]>>();
      for (const target of targets) {
        const store = manager.getChild(target.directory);
        if (!store || subscribedStores.has(store)) continue;
        subscribedStores.add(store);
        storeUnsubs.push(store.subscribe(notify));
      }
      managerRegistryUnsub = manager.subscribeRegistry(() => {
        syncStoreSubscriptions();
        notify();
      });
    };

    syncStoreSubscriptions();
    const unsubscribeRemoteRegistry = subscribeSyncStoresRegistry(() => {
      syncStoreSubscriptions();
      notify();
    });

    return () => {
      unsubscribeRemoteRegistry();
      managerRegistryUnsub?.();
      for (const unsubscribe of storeUnsubs) unsubscribe();
      storeUnsubs = [];
    };
  }, [childStores, serverId, targets]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useServerSessionPermissions(serverId: string, targets: readonly BlockingRequestTarget[]): PermissionRequest[] {
  return useServerBlockingRequests<PermissionRequest>("permission", serverId, targets);
}

export function useServerSessionForms(serverId: string, targets: readonly BlockingRequestTarget[]): FormRequest[] {
  return useServerBlockingRequests<FormRequest>("form", serverId, targets);
}

export function useAllServersLiveSessions(options?: { enabled?: boolean }): Session[] {
  const enabled = options?.enabled !== false;
  const { childStores } = useSyncSystem();

  const getDefaultSessions = useCallback(
    () => aggregateLiveSessions(Array.from(childStores.children.values(), (s) => s.getState())),
    [childStores],
  );

  const [defaultSessions, setDefaultSessions] = useState<Session[]>(getDefaultSessions);
  const [extraSessions, setExtraSessions] = useState<Session[]>([]);

  const defaultSigRef = useRef(sessionsStableSignature(defaultSessions));
  const extraSigRef = useRef('');
  const inflightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const updateDefault = () => {
      if (inflightRef.current) return;
      inflightRef.current = true;
      queueMicrotask(() => {
        const next = getDefaultSessions();
        const sig = sessionsStableSignature(next);
        if (sig !== defaultSigRef.current) {
          defaultSigRef.current = sig;
          setDefaultSessions(next);
        }
        inflightRef.current = false;
      });
    };
    const unsubs: (() => void)[] = [];

    const syncDefaultSubscriptions = () => {
      for (const unsubscribe of unsubs.splice(0)) {
        unsubscribe();
      }
      for (const store of childStores.children.values()) {
        unsubs.push(store.subscribe((state, prevState) => {
          if (state.session !== prevState.session) updateDefault();
        }));
      }
    };

    syncDefaultSubscriptions();
    const unsubRegistry = childStores.subscribeRegistry(() => {
      syncDefaultSubscriptions();
      updateDefault();
    });
    updateDefault();
    return () => {
      unsubRegistry();
      for (const u of unsubs) u();
    };
  }, [childStores, enabled, getDefaultSessions]);

  useEffect(() => {
    if (!enabled) return;
    const updateExtra = () => {
      const next = collectExtraSessions();
      const sig = sessionsStableSignature(next);
      if (sig !== extraSigRef.current) {
        extraSigRef.current = sig;
        setExtraSessions(next);
      }
    };

    updateExtra();
    const storeUnsubs: (() => void)[] = [];

    const syncExtraSubscriptions = () => {
      for (const unsubscribe of storeUnsubs.splice(0)) {
        unsubscribe();
      }
      for (const entry of getAllSyncStores()) {
        if (entry.serverId === DEFAULT_SERVER_ID) continue;
        for (const store of entry.childStores.children.values()) {
          storeUnsubs.push(store.subscribe((state, prevState) => {
            if (state.session !== prevState.session) updateExtra();
          }));
        }
      }
    };

    syncExtraSubscriptions();
    const unsubRegistry = subscribeSyncStoresRegistry(() => {
      syncExtraSubscriptions();
      updateExtra();
    });

    const interval = setInterval(updateExtra, 3000);

    return () => {
      clearInterval(interval);
      unsubRegistry();
      for (const u of storeUnsubs) u();
    };
  }, [enabled]);

  return useMemo(() => {
    if (extraSessions.length === 0) return defaultSessions;

    const all = [...defaultSessions, ...extraSessions];
    const seen = new Set<string>();
    return all.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }, [defaultSessions, extraSessions]);
}

export function useAllServersSessionStatuses(options?: { enabled?: boolean }): Record<string, SessionStatus> {
  const enabled = options?.enabled !== false;
  const { childStores } = useSyncSystem();

  const getDefaultStatuses = useCallback(
    () => aggregateLiveSessionStatuses(Array.from(childStores.children.values(), (s) => s.getState())),
    [childStores],
  );

  const [defaultStatuses, setDefaultStatuses] = useState<Record<string, SessionStatus>>(getDefaultStatuses);
  const [extraStatuses, setExtraStatuses] = useState<Record<string, SessionStatus>>({});
  const defaultSigRef = useRef(statusStableSignature(defaultStatuses));
  const extraSigRef = useRef('');
  const inflightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const updateDefault = () => {
      if (inflightRef.current) return;
      inflightRef.current = true;
      queueMicrotask(() => {
        const next = getDefaultStatuses();
        const sig = statusStableSignature(next);
        if (sig !== defaultSigRef.current) {
          defaultSigRef.current = sig;
          setDefaultStatuses(next);
        }
        inflightRef.current = false;
      });
    };
    const unsubs: (() => void)[] = [];

    const syncDefaultSubscriptions = () => {
      for (const unsubscribe of unsubs.splice(0)) {
        unsubscribe();
      }
      for (const store of childStores.children.values()) {
        unsubs.push(store.subscribe((state, prevState) => {
          if (state.session_status !== prevState.session_status || state.session !== prevState.session) updateDefault();
        }));
      }
    };

    syncDefaultSubscriptions();
    const unsubRegistry = childStores.subscribeRegistry(() => {
      syncDefaultSubscriptions();
      updateDefault();
    });
    updateDefault();
    return () => {
      unsubRegistry();
      for (const u of unsubs) u();
    };
  }, [childStores, enabled, getDefaultStatuses]);

  useEffect(() => {
    if (!enabled) return;
    const updateExtra = () => {
      const next = collectExtraStatuses();
      const sig = statusStableSignature(next);
      if (sig !== extraSigRef.current) {
        extraSigRef.current = sig;
        setExtraStatuses(next);
      }
    };

    const storeUnsubs: (() => void)[] = [];

    updateExtra();

    const syncExtraSubscriptions = () => {
      for (const unsubscribe of storeUnsubs.splice(0)) {
        unsubscribe();
      }
      for (const entry of getAllSyncStores()) {
        if (entry.serverId === DEFAULT_SERVER_ID) continue;
        for (const store of entry.childStores.children.values()) {
          storeUnsubs.push(store.subscribe((state, prevState) => {
            if (state.session_status !== prevState.session_status) updateExtra();
          }));
        }
      }
    };
    syncExtraSubscriptions();
    const unsubRegistry = subscribeSyncStoresRegistry(() => {
      syncExtraSubscriptions();
      updateExtra();
    });

    const interval = setInterval(updateExtra, 3000);

    return () => {
      clearInterval(interval);
      unsubRegistry();
      for (const u of storeUnsubs) u();
    };
  }, [enabled]);

  return useMemo(() => {
    if (Object.keys(extraStatuses).length === 0) return defaultStatuses;
    if (Object.keys(defaultStatuses).length === 0) return extraStatuses;
    return { ...defaultStatuses, ...extraStatuses };
  }, [defaultStatuses, extraStatuses]);
}

export function useAllServersLiveAgents(): { id: string; name: string }[] {
  const { childStores } = useSyncSystem();
  const getDefaultAgents = useCallback(
    () => {
      const states = Array.from(childStores.children.values(), (s) => s.getState());
      const map = new Map<string, { id: string; name: string }>();
      for (const state of states) {
        for (const agent of state.agent ?? []) {
          if (!map.has(agent.name)) map.set(agent.name, { id: agent.name, name: agent.name });
        }
      }
      return Array.from(map.values());
    },
    [childStores],
  );
  return getDefaultAgents();
}
