import { useState, useEffect, useCallback } from "react";
import type { Session } from "@opencode-ai/sdk/v2";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { getAllSyncStores, subscribeSyncStoresRegistry } from "./multi-server-registry";
import { useSyncSystem } from "./sync-context";
import {
  aggregateLiveSessions,
  aggregateLiveSessionStatuses,
} from "./live-aggregate";

function collectExtraSessions(): Session[] {
  const entries = getAllSyncStores();
  const sessions: Session[] = [];
  for (const entry of entries) {
    for (const store of entry.childStores.children.values()) {
      sessions.push(...store.getState().session);
    }
  }
  return sessions;
}

function collectExtraStatuses(): Record<string, SessionStatus> {
  const entries = getAllSyncStores();
  const statuses: Record<string, SessionStatus> = {};
  for (const entry of entries) {
    for (const store of entry.childStores.children.values()) {
      Object.assign(statuses, store.getState().session_status);
    }
  }
  return statuses;
}

export function useAllServersLiveSessions(): Session[] {
  const { childStores } = useSyncSystem();

  const getDefaultSessions = useCallback(
    () => aggregateLiveSessions(Array.from(childStores.children.values(), (s) => s.getState())),
    [childStores],
  );

  const [defaultSessions, setDefaultSessions] = useState<Session[]>(getDefaultSessions);
  const [extraSessions, setExtraSessions] = useState<Session[]>([]);

  useEffect(() => {
    const updateDefault = () => setDefaultSessions(getDefaultSessions());
    const unsubs: (() => void)[] = [];
    for (const store of childStores.children.values()) {
      unsubs.push(store.subscribe(updateDefault));
    }
    const unsubRegistry = childStores.subscribeRegistry(() => {
      updateDefault();
      unsubs.length = 0;
      for (const store of childStores.children.values()) {
        unsubs.push(store.subscribe(updateDefault));
      }
      updateDefault();
    });
    updateDefault();
    return () => {
      unsubRegistry();
      for (const u of unsubs) u();
    };
  }, [childStores, getDefaultSessions]);

  useEffect(() => {
    const updateExtra = () => setExtraSessions(collectExtraSessions());

    updateExtra();
    const unsubRegistry = subscribeSyncStoresRegistry(updateExtra);

    const storeUnsubs: (() => void)[] = [];
    for (const entry of getAllSyncStores()) {
      for (const store of entry.childStores.children.values()) {
        storeUnsubs.push(store.subscribe(updateExtra));
      }
    }

    return () => {
      unsubRegistry();
      for (const u of storeUnsubs) u();
    };
  }, []);

  if (extraSessions.length === 0) return defaultSessions;

  const all = [...defaultSessions, ...extraSessions];
  const seen = new Set<string>();
  return all.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

export function useAllServersSessionStatuses(): Record<string, SessionStatus> {
  const { childStores } = useSyncSystem();

  const getDefaultStatuses = useCallback(
    () => aggregateLiveSessionStatuses(Array.from(childStores.children.values(), (s) => s.getState())),
    [childStores],
  );

  const [defaultStatuses, setDefaultStatuses] = useState<Record<string, SessionStatus>>(getDefaultStatuses);
  const [extraStatuses, setExtraStatuses] = useState<Record<string, SessionStatus>>({});

  useEffect(() => {
    const updateDefault = () => setDefaultStatuses(getDefaultStatuses());
    const unsubs: (() => void)[] = [];
    for (const store of childStores.children.values()) {
      unsubs.push(store.subscribe(updateDefault));
    }
    const unsubRegistry = childStores.subscribeRegistry(() => {
      updateDefault();
      unsubs.length = 0;
      for (const store of childStores.children.values()) {
        unsubs.push(store.subscribe(updateDefault));
      }
      updateDefault();
    });
    updateDefault();
    return () => {
      unsubRegistry();
      for (const u of unsubs) u();
    };
  }, [childStores, getDefaultStatuses]);

  useEffect(() => {
    const updateExtra = () => setExtraStatuses(collectExtraStatuses());

    updateExtra();
    const unsubRegistry = subscribeSyncStoresRegistry(updateExtra);

    const storeUnsubs: (() => void)[] = [];
    for (const entry of getAllSyncStores()) {
      for (const store of entry.childStores.children.values()) {
        storeUnsubs.push(store.subscribe(updateExtra));
      }
    }

    return () => {
      unsubRegistry();
      for (const u of storeUnsubs) u();
    };
  }, []);

  return { ...defaultStatuses, ...extraStatuses };
}
