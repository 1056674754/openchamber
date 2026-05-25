import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { Session } from "@opencode-ai/sdk/v2";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import type { PermissionRequest } from "@/types/permission";
import type { QuestionRequest } from "@/types/question";
import { getAllSyncStores, subscribeSyncStoresRegistry } from "./multi-server-registry";
import type { ChildStoreManager } from "./child-store";
import { useSyncSystem } from "./sync-context";
import { DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";
import {
  aggregateLiveSessions,
  aggregateLiveSessionStatuses,
} from "./live-aggregate";

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

type BlockingRequestKind = "permission" | "question";
type BlockingRequest = PermissionRequest | QuestionRequest;

function collectChildStoreManagers(defaultChildStores: ChildStoreManager): ChildStoreManager[] {
  const managers: ChildStoreManager[] = [];
  const seen = new Set<ChildStoreManager>();
  const push = (manager: ChildStoreManager) => {
    if (seen.has(manager)) return;
    seen.add(manager);
    managers.push(manager);
  };

  push(defaultChildStores);
  for (const entry of getAllSyncStores()) {
    push(entry.childStores);
  }
  return managers;
}

function collectBlockingRequests<T extends BlockingRequest>(
  kind: BlockingRequestKind,
  defaultChildStores: ChildStoreManager,
  sessionIds: readonly string[],
): T[] {
  const requestedSessionIds = sessionIds.filter(Boolean);
  if (requestedSessionIds.length === 0) return [];

  const seen = new Set<string>();
  const result: T[] = [];
  for (const manager of collectChildStoreManagers(defaultChildStores)) {
    for (const store of manager.children.values()) {
      const state = store.getState();
      const requestMap = kind === "permission" ? state.permission : state.question;
      for (const sessionId of requestedSessionIds) {
        const requests = requestMap[sessionId] as T[] | undefined;
        if (!requests || requests.length === 0) continue;
        for (const request of requests) {
          if (!request?.id) continue;
          const key = `${request.sessionID}:${request.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push(request);
        }
      }
    }
  }
  return result;
}

function blockingRequestSignature(requests: readonly BlockingRequest[]): string {
  if (requests.length === 0) return "";
  return requests
    .map((request) => `${request.sessionID}:${request.id}`)
    .sort()
    .join("|");
}

function useAllServersBlockingRequests<T extends BlockingRequest>(
  kind: BlockingRequestKind,
  sessionIds: readonly string[],
): T[] {
  const { childStores } = useSyncSystem();
  const cacheRef = useRef<{ signature: string; value: T[] } | null>(null);

  const getSnapshot = useCallback(() => {
    const value = collectBlockingRequests<T>(kind, childStores, sessionIds);
    const signature = blockingRequestSignature(value);
    if (cacheRef.current?.signature === signature) {
      return cacheRef.current.value;
    }
    cacheRef.current = { signature, value };
    return value;
  }, [childStores, kind, sessionIds]);

  const subscribe = useCallback((notify: () => void) => {
    let storeUnsubs: (() => void)[] = [];

    const syncStoreSubscriptions = () => {
      for (const unsubscribe of storeUnsubs) unsubscribe();
      storeUnsubs = [];
      for (const manager of collectChildStoreManagers(childStores)) {
        for (const store of manager.children.values()) {
          storeUnsubs.push(store.subscribe(notify));
        }
      }
    };

    syncStoreSubscriptions();
    const unsubscribeDefaultRegistry = childStores.subscribeRegistry(() => {
      syncStoreSubscriptions();
      notify();
    });
    const unsubscribeRemoteRegistry = subscribeSyncStoresRegistry(() => {
      syncStoreSubscriptions();
      notify();
    });

    return () => {
      unsubscribeDefaultRegistry();
      unsubscribeRemoteRegistry();
      for (const unsubscribe of storeUnsubs) unsubscribe();
      storeUnsubs = [];
    };
  }, [childStores]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAllServersSessionPermissions(sessionIds: readonly string[]): PermissionRequest[] {
  return useAllServersBlockingRequests<PermissionRequest>("permission", sessionIds);
}

export function useAllServersSessionQuestions(sessionIds: readonly string[]): QuestionRequest[] {
  return useAllServersBlockingRequests<QuestionRequest>("question", sessionIds);
}

export function useAllServersLiveSessions(): Session[] {
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
        unsubs.push(store.subscribe(updateDefault));
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
  }, [childStores, getDefaultSessions]);

  useEffect(() => {
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
          storeUnsubs.push(store.subscribe(updateExtra));
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
  }, []);

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

export function useAllServersSessionStatuses(): Record<string, SessionStatus> {
  const { childStores } = useSyncSystem();

  const getDefaultStatuses = useCallback(
    () => aggregateLiveSessionStatuses(Array.from(childStores.children.values(), (s) => s.getState())),
    [childStores],
  );

  const [defaultStatuses, setDefaultStatuses] = useState<Record<string, SessionStatus>>(getDefaultStatuses);
  const [extraStatuses, setExtraStatuses] = useState<Record<string, SessionStatus>>({});
  const defaultSigRef = useRef(statusStableSignature(defaultStatuses));
  const extraSigRef = useRef('');

  useEffect(() => {
    const updateDefault = () => {
      const next = getDefaultStatuses();
      const sig = statusStableSignature(next);
      if (sig !== defaultSigRef.current) {
        defaultSigRef.current = sig;
        setDefaultStatuses(next);
      }
    };
    const unsubs: (() => void)[] = [];

    const syncDefaultSubscriptions = () => {
      for (const unsubscribe of unsubs.splice(0)) {
        unsubscribe();
      }
      for (const store of childStores.children.values()) {
        unsubs.push(store.subscribe(updateDefault));
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
  }, [childStores, getDefaultStatuses]);

  useEffect(() => {
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
          storeUnsubs.push(store.subscribe(updateExtra));
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
  }, []);

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
