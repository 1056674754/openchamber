import { createUpstreamSseReader } from '../event-stream/upstream-reader.js';
import { buildRemoteEventAuthHeaders } from './sse-relay.js';

const RECONCILE_INTERVAL_MS = 5_000;

export function createRemoteOpenChamberEventFanout({
  remoteInstancesRuntime,
  fetchImpl = fetch,
  createReader = createUpstreamSseReader,
  upstreamStallTimeoutMs,
  upstreamReconnectDelayMs,
  reconcileIntervalMs = RECONCILE_INTERVAL_MS,
  logger = console,
} = {}) {
  const subscribers = new Set();
  const streams = new Map();
  let timer = null;
  let stopped = true;
  let reconciling = false;

  const emit = (event) => {
    for (const subscriber of Array.from(subscribers)) {
      try { subscriber(event); } catch { /* one consumer must not stop fanout */ }
    }
  };

  const stopStream = (instanceId) => {
    const entry = streams.get(instanceId);
    if (!entry) return;
    streams.delete(instanceId);
    try { entry.reader?.stop(); } catch { /* already stopped */ }
    try { entry.controller.abort(); } catch { /* already aborted */ }
    try { entry.releaseLane?.(); } catch { /* already released */ }
  };

  const startStream = async (instance) => {
    if (!instance?.id || stopped || streams.has(instance.id)) return;
    let releaseLane = null;
    try {
      releaseLane = await remoteInstancesRuntime?.enterRequestLane?.(instance.id, 'stream');
    } catch (error) {
      logger.warn?.(`[remote-openchamber-events] stream lane rejected for "${instance.id}":`, error?.message ?? error);
      return;
    }
    if (stopped || streams.has(instance.id)) {
      releaseLane?.();
      return;
    }

    const controller = new AbortController();
    const remoteBase = instance.url.replace(/\/$/, '');
    const entry = { controller, reader: null, releaseLane };
    streams.set(instance.id, entry);
    entry.reader = createReader({
      fetchImpl,
      signal: controller.signal,
      stallTimeoutMs: upstreamStallTimeoutMs,
      reconnectDelayMs: upstreamReconnectDelayMs,
      buildUrl: () => new URL(`${remoteBase}/api/openchamber/events?browser=1`),
      getHeaders: () => buildRemoteEventAuthHeaders(instance),
      onConnect() {
        remoteInstancesRuntime?.recordRemoteRequestSuccess?.(instance.id);
      },
      onEvent({ payload }) {
        if (!payload || typeof payload !== 'object') return;
        emit({ serverId: instance.id, payload });
      },
      onError(error) {
        if (controller.signal.aborted) return;
        if (error?.type === 'upstream_unavailable' && [404, 405, 410].includes(error.status)) {
          stopStream(instance.id);
          return;
        }
        remoteInstancesRuntime?.recordRemoteRequestFailure?.(instance.id, error?.error ?? error);
      },
    });
    void entry.reader.start().finally(() => {
      if (streams.get(instance.id) === entry) stopStream(instance.id);
    });
  };

  const reconcile = async () => {
    if (stopped || reconciling || !remoteInstancesRuntime) return;
    reconciling = true;
    try {
      const instances = typeof remoteInstancesRuntime.getInstances === 'function'
        ? await remoteInstancesRuntime.getInstances()
        : [];
      const eligible = new Set();
      for (const listed of instances) {
        const id = typeof listed?.id === 'string' ? listed.id : '';
        if (!id) continue;
        const instance = remoteInstancesRuntime.getInstanceSync?.(id);
        if (!instance || instance.enabled === false || remoteInstancesRuntime.isHealthy?.(id) !== true) continue;
        eligible.add(id);
        if (!streams.has(id)) void startStream(instance);
      }
      for (const id of Array.from(streams.keys())) {
        if (!eligible.has(id)) stopStream(id);
      }
    } catch (error) {
      logger.warn?.('[remote-openchamber-events] reconcile failed:', error?.message ?? error);
    } finally {
      reconciling = false;
    }
  };

  const start = () => {
    if (!stopped) return;
    stopped = false;
    void reconcile();
    timer = setInterval(() => { void reconcile(); }, Math.max(1_000, reconcileIntervalMs));
    timer.unref?.();
  };

  const stop = () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    for (const id of Array.from(streams.keys())) stopStream(id);
  };

  return {
    subscribe(subscriber) {
      subscribers.add(subscriber);
      if (subscribers.size === 1) start();
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) stop();
      };
    },
    close() {
      subscribers.clear();
      stop();
    },
  };
}
