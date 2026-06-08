import { createUpstreamSseReader } from '../event-stream/upstream-reader.js';
import { buildRemoteEventAuthHeaders } from './sse-relay.js';

const DEFAULT_RECONCILE_INTERVAL_MS = 5_000;
const DEFAULT_REMOTE_EVENT_RECONNECT_DELAY_MS = 1_000;

const normalizeDirectory = (directory) => (
  typeof directory === 'string' && directory.length > 0 ? directory : 'global'
);

const normalizeReconnectDelayMs = (value) => {
  const numeric = Number.isFinite(value) ? value : DEFAULT_REMOTE_EVENT_RECONNECT_DELAY_MS;
  return Math.max(DEFAULT_REMOTE_EVENT_RECONNECT_DELAY_MS, numeric);
};

export function createRemoteGlobalEventFanout({
  remoteInstancesRuntime,
  fetchImpl = fetch,
  upstreamStallTimeoutMs,
  upstreamReconnectDelayMs,
  reconcileIntervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
  logger = console,
} = {}) {
  const subscribers = new Set();
  const streams = new Map();
  let reconcileTimer = null;
  let reconcileInFlight = false;
  let stopped = true;

  const reconnectDelayMs = normalizeReconnectDelayMs(upstreamReconnectDelayMs);

  const emit = (event) => {
    for (const subscriber of Array.from(subscribers)) {
      try {
        subscriber(event);
      } catch {
      }
    }
  };

  const stopStream = (instanceId) => {
    const entry = streams.get(instanceId);
    if (!entry) {
      return;
    }

    streams.delete(instanceId);
    try {
      entry.reader?.stop();
    } catch {
    }
    try {
      entry.controller.abort();
    } catch {
    }
    try {
      entry.releaseLane?.();
    } catch {
    }
  };

  const startStream = async (instance) => {
    if (!instance?.id || streams.has(instance.id) || stopped) {
      return;
    }

    let releaseLane = null;
    try {
      releaseLane = await remoteInstancesRuntime?.enterRequestLane?.(instance.id, 'stream');
    } catch (error) {
      logger?.warn?.(
        `[remote-event-fanout] Stream lane rejected for instance "${instance.id}":`,
        error?.message ?? error,
      );
      return;
    }

    if (stopped || streams.has(instance.id)) {
      try {
        releaseLane?.();
      } catch {
      }
      return;
    }

    const controller = new AbortController();
    const remoteBase = instance.url.replace(/\/$/, '');
    const entry = {
      controller,
      reader: null,
      releaseLane,
    };
    streams.set(instance.id, entry);

    entry.reader = createUpstreamSseReader({
      fetchImpl,
      signal: controller.signal,
      stallTimeoutMs: upstreamStallTimeoutMs,
      reconnectDelayMs,
      buildUrl: () => new URL(`${remoteBase}/api/global/event`),
      getHeaders: () => buildRemoteEventAuthHeaders(instance),
      onConnect() {
        remoteInstancesRuntime?.recordRemoteRequestSuccess?.(instance.id);
      },
      onEvent({ payload, eventId, directory }) {
        emit({
          serverId: instance.id,
          directory: normalizeDirectory(directory),
          eventId,
          payload,
        });
      },
      onError(error) {
        if (controller.signal.aborted) {
          return;
        }
        if (error?.type === 'upstream_unavailable') {
          remoteInstancesRuntime?.recordRemoteRequestFailure?.(instance.id, { status: error.status });
          return;
        }
        if (error?.type === 'stream_error') {
          remoteInstancesRuntime?.recordRemoteRequestFailure?.(instance.id, error.error);
        }
      },
    });

    void entry.reader.start().finally(() => {
      if (streams.get(instance.id) === entry) {
        stopStream(instance.id);
      }
    });
  };

  const reconcile = async () => {
    if (stopped || reconcileInFlight || !remoteInstancesRuntime) {
      return;
    }
    reconcileInFlight = true;
    try {
      const listed = typeof remoteInstancesRuntime.getInstances === 'function'
        ? await remoteInstancesRuntime.getInstances()
        : [];
      const eligibleIds = new Set();

      for (const listedInstance of listed) {
        const instanceId = typeof listedInstance?.id === 'string' ? listedInstance.id : '';
        if (!instanceId) {
          continue;
        }
        const instance = remoteInstancesRuntime.getInstanceSync?.(instanceId);
        if (!instance || instance.enabled === false || remoteInstancesRuntime.isHealthy?.(instanceId) !== true) {
          continue;
        }

        eligibleIds.add(instanceId);
        if (!streams.has(instanceId)) {
          void startStream(instance);
        }
      }

      for (const instanceId of Array.from(streams.keys())) {
        if (!eligibleIds.has(instanceId)) {
          stopStream(instanceId);
        }
      }
    } catch (error) {
      logger?.warn?.('[remote-event-fanout] Failed to reconcile remote event streams:', error?.message ?? error);
    } finally {
      reconcileInFlight = false;
    }
  };

  const start = () => {
    if (!stopped) {
      return;
    }
    stopped = false;
    void reconcile();
    reconcileTimer = setInterval(() => {
      void reconcile();
    }, Math.max(1_000, reconcileIntervalMs));
  };

  const stop = () => {
    stopped = true;
    if (reconcileTimer) {
      clearInterval(reconcileTimer);
      reconcileTimer = null;
    }
    for (const instanceId of Array.from(streams.keys())) {
      stopStream(instanceId);
    }
  };

  const subscribe = (subscriber) => {
    subscribers.add(subscriber);
    if (subscribers.size === 1) {
      start();
    }

    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        stop();
      }
    };
  };

  return {
    subscribe,
    close() {
      subscribers.clear();
      stop();
    },
  };
}
