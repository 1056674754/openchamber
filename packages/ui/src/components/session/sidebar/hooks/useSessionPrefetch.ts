import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { getSyncSessionMaterializationStatus } from '@/sync/sync-refs';
import { isVSCodeRuntime } from '@/lib/desktop';

const SESSION_PREFETCH_HOVER_DELAY_MS = 180;
const SESSION_PREFETCH_SETTLE_MS = 600;
const SESSION_PREFETCH_CONCURRENCY = 1;
const SESSION_PREFETCH_PENDING_LIMIT = 6;

type Args = {
  currentSessionId: string | null;
  sortedSessions: Session[];
  recentSessionIds?: string[];
  sidebarSessionIds?: string[];
  ensureSessionRenderable: (sessionId: string) => Promise<unknown>;
};

export const useSessionPrefetch = ({ currentSessionId, sortedSessions, recentSessionIds = [], sidebarSessionIds = [], ensureSessionRenderable }: Args): void => {
  const sessionPrefetchTimersRef = React.useRef<Map<string, number>>(new Map());
  const sessionPrefetchQueueRef = React.useRef<string[]>([]);
  const sessionPrefetchInFlightRef = React.useRef<Set<string>>(new Set());
  const prefetchDisabled = React.useMemo(() => isVSCodeRuntime(), []);

  const pumpSessionPrefetchQueue = React.useCallback(() => {
    if (prefetchDisabled || typeof window === 'undefined') {
      return;
    }

    while (sessionPrefetchInFlightRef.current.size < SESSION_PREFETCH_CONCURRENCY && sessionPrefetchQueueRef.current.length > 0) {
      const nextSessionId = sessionPrefetchQueueRef.current.shift();
      if (!nextSessionId) {
        break;
      }

      const state = useSessionUIStore.getState();
      if (state.currentSessionId === nextSessionId) {
        continue;
      }

      // Check if the session is already renderable in the sync child store.
      if (getSyncSessionMaterializationStatus(nextSessionId).renderable) {
        continue;
      }

      sessionPrefetchInFlightRef.current.add(nextSessionId);
      void ensureSessionRenderable(nextSessionId)
        .catch(() => undefined)
        .finally(() => {
          sessionPrefetchInFlightRef.current.delete(nextSessionId);
          pumpSessionPrefetchQueue();
        });
    }
  }, [ensureSessionRenderable, prefetchDisabled]);

  const shouldPrefetchSession = React.useCallback((sessionId: string | null | undefined) => {
    if (prefetchDisabled || !sessionId || sessionId === currentSessionId || typeof window === 'undefined') {
      return false;
    }

    if (getSyncSessionMaterializationStatus(sessionId).renderable) {
      return false;
    }

    if (sessionPrefetchInFlightRef.current.has(sessionId)) {
      return false;
    }

    if (sessionPrefetchQueueRef.current.includes(sessionId)) {
      return false;
    }

    return true;
  }, [currentSessionId, prefetchDisabled]);

  const enqueueSessionPrefetch = React.useCallback((sessionId: string | null | undefined, options?: { dropOldest?: boolean }) => {
    if (!sessionId || !shouldPrefetchSession(sessionId)) {
      return;
    }

    if (sessionPrefetchQueueRef.current.length >= SESSION_PREFETCH_PENDING_LIMIT) {
      if (!options?.dropOldest) return;
      sessionPrefetchQueueRef.current.shift();
    }

    sessionPrefetchQueueRef.current.push(sessionId);
    pumpSessionPrefetchQueue();
  }, [pumpSessionPrefetchQueue, shouldPrefetchSession]);

  const scheduleSessionPrefetch = React.useCallback((sessionId: string | null | undefined) => {
    if (prefetchDisabled || !sessionId || typeof window === 'undefined') {
      return;
    }

    const existingTimer = sessionPrefetchTimersRef.current.get(sessionId);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      sessionPrefetchTimersRef.current.delete(sessionId);
      enqueueSessionPrefetch(sessionId, { dropOldest: true });
    }, SESSION_PREFETCH_HOVER_DELAY_MS);
    sessionPrefetchTimersRef.current.set(sessionId, timer);
  }, [enqueueSessionPrefetch, prefetchDisabled]);

  const queueSidebarPrefetchOrder = React.useCallback((sessionIds: string[]) => {
    if (prefetchDisabled || typeof window === 'undefined') {
      return;
    }

    const nextQueue: string[] = [];
    const queued = new Set<string>();
    sessionPrefetchQueueRef.current = [];
    for (const sessionId of sessionIds) {
      if (queued.has(sessionId)) continue;
      if (!shouldPrefetchSession(sessionId)) continue;
      nextQueue.push(sessionId);
      queued.add(sessionId);
      if (nextQueue.length >= SESSION_PREFETCH_PENDING_LIMIT) break;
    }

    sessionPrefetchQueueRef.current = nextQueue;
    pumpSessionPrefetchQueue();
  }, [prefetchDisabled, pumpSessionPrefetchQueue, shouldPrefetchSession]);

  // Wait for the active session to finish loading before prefetching neighbors.
  // On rapid session switches the timer resets, so only the final session triggers prefetch.
  React.useEffect(() => {
    if (prefetchDisabled || !currentSessionId || sortedSessions.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      const currentIndex = sortedSessions.findIndex((session) => session.id === currentSessionId);
      if (currentIndex < 0) return;
      scheduleSessionPrefetch(sortedSessions[currentIndex - 1]?.id);
      scheduleSessionPrefetch(sortedSessions[currentIndex + 1]?.id);
    }, SESSION_PREFETCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [currentSessionId, prefetchDisabled, scheduleSessionPrefetch, sortedSessions]);

  React.useEffect(() => {
    if (prefetchDisabled) {
      return;
    }
    if (sidebarSessionIds.length === 0) {
      sessionPrefetchQueueRef.current = [];
      return;
    }
    const timer = window.setTimeout(() => {
      queueSidebarPrefetchOrder(sidebarSessionIds);
    }, SESSION_PREFETCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [prefetchDisabled, queueSidebarPrefetchOrder, sidebarSessionIds]);

  React.useEffect(() => {
    if (prefetchDisabled || !currentSessionId || recentSessionIds.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      const currentIndex = recentSessionIds.indexOf(currentSessionId);
      if (currentIndex < 0) return;
      scheduleSessionPrefetch(recentSessionIds[currentIndex - 1]);
      scheduleSessionPrefetch(recentSessionIds[currentIndex + 1]);
    }, SESSION_PREFETCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [currentSessionId, prefetchDisabled, recentSessionIds, scheduleSessionPrefetch]);

  React.useEffect(() => {
    const prefetchTimers = sessionPrefetchTimersRef.current;
    return () => {
      prefetchTimers.forEach((timer) => {
        clearTimeout(timer);
      });
      prefetchTimers.clear();
      sessionPrefetchQueueRef.current = [];
    };
  }, []);
};
