import { WebSocketServer } from 'ws';

import { parseRequestPathname } from '../terminal/index.js';
import { parseRemoteWsPath, pipeRemoteWs } from '../remote-instances/sse-relay.js';
import { createRemoteGlobalEventFanout } from '../remote-instances/global-event-fanout.js';
import {
  MESSAGE_STREAM_DIRECTORY_WS_PATH,
  MESSAGE_STREAM_GLOBAL_WS_PATH,
  MESSAGE_STREAM_WS_HEARTBEAT_INTERVAL_MS,
  sendMessageStreamWsEvent,
} from './protocol.js';
import { createGlobalMessageStreamHub } from './global-hub.js';
import { createGlobalMessageStreamWsBridge } from './global-ws-bridge.js';
import { acceptDirectoryMessageStreamWsConnection } from './directory-ws-bridge.js';
import {
  DEFAULT_UPSTREAM_RECONNECT_DELAY_MS,
  DEFAULT_UPSTREAM_STALL_TIMEOUT_MS,
} from './upstream-reader.js';

export function createGlobalUiEventBroadcaster({
  sseClients,
  wsClients,
  writeSseEvent,
}) {
  return (payload, options = {}) => {
    const hasSseClients = sseClients.size > 0;
    const hasWsClients = wsClients.size > 0;
    if (!hasSseClients && !hasWsClients) {
      return;
    }

    if (hasSseClients) {
      for (const res of sseClients) {
        try {
          writeSseEvent(res, payload);
        } catch {
        }
      }
    }

    if (hasWsClients) {
      for (const socket of Array.from(wsClients)) {
        const sent = sendMessageStreamWsEvent(socket, payload, {
          directory: typeof options.directory === 'string' && options.directory.length > 0 ? options.directory : 'global',
          eventId: typeof options.eventId === 'string' && options.eventId.length > 0 ? options.eventId : undefined,
          serverId: typeof options.serverId === 'string' && options.serverId.length > 0 ? options.serverId : undefined,
        });
        if (!sent) {
          wsClients.delete(socket);
        }
      }
    }
  };
}

export function createMessageStreamWsRuntime({
  server,
  uiAuthController,
  isRequestOriginAllowed,
  rejectWebSocketUpgrade,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  processForwardedEventPayload,
  wsClients,
  triggerHealthCheck,
  heartbeatIntervalMs = MESSAGE_STREAM_WS_HEARTBEAT_INTERVAL_MS,
  upstreamStallTimeoutMs = DEFAULT_UPSTREAM_STALL_TIMEOUT_MS,
  upstreamReconnectDelayMs = DEFAULT_UPSTREAM_RECONNECT_DELAY_MS,
  fetchImpl = fetch,
  globalEventHub = null,
  remoteInstancesRuntime = null,
}) {
  const wsServer = new WebSocketServer({
    noServer: true,
  });

  const ownsGlobalHub = !globalEventHub;
  const globalHub = globalEventHub ?? createGlobalMessageStreamHub({
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
    fetchImpl,
    upstreamStallTimeoutMs,
    upstreamReconnectDelayMs,
  });

  const remoteGlobalEventFanout = remoteInstancesRuntime
    ? createRemoteGlobalEventFanout({
      remoteInstancesRuntime,
      fetchImpl,
      upstreamStallTimeoutMs,
      upstreamReconnectDelayMs,
    })
    : null;

  const globalBridge = createGlobalMessageStreamWsBridge({
    globalHub,
    ownsGlobalHub,
    wsClients,
    processForwardedEventPayload,
    triggerHealthCheck,
    heartbeatIntervalMs,
    remoteGlobalEventFanout,
  });

  wsServer.on('connection', (socket, req) => {
    const rawUrl = typeof req?.url === 'string' ? req.url : MESSAGE_STREAM_GLOBAL_WS_PATH;
    const pathname = parseRequestPathname(rawUrl);
    const requestUrl = new URL(rawUrl, 'http://127.0.0.1');
    const isGlobalStream = pathname === MESSAGE_STREAM_GLOBAL_WS_PATH;
    const requestedLastEventId = requestUrl.searchParams.get('lastEventId')?.trim() || '';
    const requestedDirectory = requestUrl.searchParams.get('directory')?.trim() || '';

    if (isGlobalStream) {
      globalBridge.accept(socket, {
        requestedLastEventId,
      });
      return;
    }

    acceptDirectoryMessageStreamWsConnection({
      socket,
      requestedLastEventId,
      requestedDirectory,
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
      processForwardedEventPayload,
      wsClients,
      triggerHealthCheck,
      heartbeatIntervalMs,
      upstreamStallTimeoutMs,
      upstreamReconnectDelayMs,
      fetchImpl,
    });
  });

  const upgradeHandler = (req, socket, head) => {
    const pathname = parseRequestPathname(req.url);
    const remoteWsInfo = parseRemoteWsPath(pathname);

    if (
      !remoteWsInfo &&
      pathname !== MESSAGE_STREAM_GLOBAL_WS_PATH &&
      pathname !== MESSAGE_STREAM_DIRECTORY_WS_PATH
    ) {
      return;
    }

    const handleUpgrade = async () => {
      try {
        let remoteInstance = null;

        if (uiAuthController?.enabled) {
          const sessionToken = await uiAuthController?.ensureSessionToken?.(req, null);
          if (!sessionToken) {
            rejectWebSocketUpgrade(socket, 401, 'UI authentication required');
            return;
          }

          const originAllowed = await isRequestOriginAllowed(req);
          if (!originAllowed) {
            rejectWebSocketUpgrade(socket, 403, 'Invalid origin');
            return;
          }
        }

        if (remoteWsInfo) {
          const resolved = await resolveRemoteWsInstance(remoteWsInfo.instanceId);
          if (!resolved.ok) {
            rejectWebSocketUpgrade(socket, resolved.status, resolved.error);
            return;
          }
          remoteInstance = resolved.instance;
        }

        wsServer.handleUpgrade(req, socket, head, (ws) => {
          if (remoteWsInfo) {
            handleRemoteInstanceWsConnection(ws, req, remoteWsInfo, remoteInstance);
          } else {
            wsServer.emit('connection', ws, req);
          }
        });
      } catch {
        rejectWebSocketUpgrade(socket, 500, 'Upgrade failed');
      }
    };

    void handleUpgrade();
  };

  const resolveRemoteWsInstance = async (instanceId) => {
    const instance = remoteInstancesRuntime?.getInstanceSync(instanceId);
    if (!instance) {
      return { ok: false, status: 404, error: 'Remote instance not found' };
    }
    if (!instance.enabled) {
      return { ok: false, status: 503, error: 'Remote instance not available' };
    }

    const healthy = remoteInstancesRuntime.isHealthy(instanceId);

    if (!healthy) {
      if (typeof remoteInstancesRuntime.ensureHealthy === 'function') {
        if (
          typeof remoteInstancesRuntime.isHealthProbeInFlight !== 'function'
          || !remoteInstancesRuntime.isHealthProbeInFlight(instanceId)
        ) {
          void remoteInstancesRuntime.ensureHealthy(instanceId, { timeoutSec: 2 }).catch(() => {});
        }
      }
      return { ok: false, status: 503, error: 'Remote instance not available' };
    }

    return { ok: true, instance };
  };

  const handleRemoteInstanceWsConnection = (ws, req, { isGlobal }, instance) => {
    const rawUrl = typeof req?.url === 'string' ? req.url : '';
    const queryString = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '';
    pipeRemoteWs(ws, instance, isGlobal, queryString);
  };

  server.on('upgrade', upgradeHandler);

  return {
    wsServer,
    async close() {
      server.off('upgrade', upgradeHandler);
      globalBridge.close();
      remoteGlobalEventFanout?.close?.();

      try {
        for (const client of wsServer.clients) {
          try {
            client.terminate();
          } catch {
          }
        }

        await new Promise((resolve) => {
          wsServer.close(() => resolve());
        });
      } catch {
      } finally {
        wsClients.clear();
      }
    },
  };
}
