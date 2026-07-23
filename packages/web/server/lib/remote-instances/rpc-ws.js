import { WebSocketServer } from 'ws';

import { parseRequestPathname } from '../terminal/index.js';
import { shouldForwardProxyResponseHeader } from '../../proxy-headers.js';
import {
  buildRemoteProxyAuthHeaders,
  formatRemoteGateError,
  getRemoteProxyRequestTimeoutMs,
  markRemoteProxyUnavailable,
  resolveHealthyRemoteInstance,
} from './proxy.js';

export const REMOTE_RPC_WS_PATH = '/api/remote-rpc/ws';
export const LOCAL_RPC_TARGET = 'local';

const REMOTE_RPC_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const REMOTE_RPC_QUEUE_TIMEOUT_MS = 1_000;
const HOP_BY_HOP_BASE_REQUEST_HEADERS = [
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];
const HOP_BY_HOP_REMOTE_REQUEST_HEADERS = new Set([
  'authorization',
  'cookie',
  'origin',
  ...HOP_BY_HOP_BASE_REQUEST_HEADERS,
]);
const HOP_BY_HOP_LOCAL_REQUEST_HEADERS = new Set(HOP_BY_HOP_BASE_REQUEST_HEADERS);

const jsonResponseBodyBase64 = (body) => Buffer.from(JSON.stringify(body)).toString('base64');

const sendFrame = (socket, frame) => {
  if (!socket || socket.readyState !== 1) {
    return false;
  }
  try {
    socket.send(JSON.stringify(frame));
    return true;
  } catch {
    return false;
  }
};

const normalizeMethod = (method) => {
  const value = typeof method === 'string' && method.trim() ? method.trim().toUpperCase() : 'GET';
  return /^[A-Z]+$/.test(value) ? value : 'GET';
};

const normalizeRpcApiPath = (path) => {
  if (typeof path !== 'string' || path.length === 0 || !path.startsWith('/api')) {
    return null;
  }
  try {
    const parsed = new URL(path, 'http://localhost');
    if (!parsed.pathname.startsWith('/api/')) {
      return null;
    }
    if (
      parsed.pathname === REMOTE_RPC_WS_PATH
      || parsed.pathname === '/api/global/event'
      || parsed.pathname === '/api/event'
      || parsed.pathname === '/api/global/event/ws'
      || parsed.pathname === '/api/event/ws'
    ) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
};

const sanitizeRequestHeaders = (input, target = 'remote') => {
  const headers = {};
  if (!input || typeof input !== 'object') {
    return headers;
  }

  const blockedHeaders = target === LOCAL_RPC_TARGET
    ? HOP_BY_HOP_LOCAL_REQUEST_HEADERS
    : HOP_BY_HOP_REMOTE_REQUEST_HEADERS;
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.toLowerCase();
    if (blockedHeaders.has(key)) {
      continue;
    }
    if (Array.isArray(rawValue)) {
      headers[rawKey] = rawValue.join(', ');
      continue;
    }
    if (typeof rawValue === 'string') {
      headers[rawKey] = rawValue;
    }
  }

  return headers;
};

const collectResponseHeaders = (headers) => {
  const result = {};
  headers?.forEach?.((value, key) => {
    if (shouldForwardProxyResponseHeader(key)) {
      result[key] = value;
    }
  });
  return result;
};

const readResponseBuffer = async (response) => {
  const lengthHeader = response.headers?.get?.('content-length');
  const contentLength = Number(lengthHeader);
  if (Number.isFinite(contentLength) && contentLength > REMOTE_RPC_MAX_RESPONSE_BYTES) {
    const error = new Error('Remote RPC response is too large');
    error.statusCode = 502;
    throw error;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > REMOTE_RPC_MAX_RESPONSE_BYTES) {
    const error = new Error('Remote RPC response is too large');
    error.statusCode = 502;
    throw error;
  }
  return buffer;
};

const getRpcErrorStatusText = (body) => {
  const errorText = typeof body?.error === 'string' ? body.error.trim() : '';
  return errorText || 'Remote RPC Error';
};

const sendErrorResponse = (socket, id, status, body, meta = {}) => {
  sendFrame(socket, {
    type: 'response',
    id,
    status,
    statusText: getRpcErrorStatusText(body),
    ...meta,
    headers: { 'content-type': 'application/json' },
    bodyBase64: jsonResponseBodyBase64(body),
  });
};

const isLocalRpcRequest = (frame) => frame?.target === LOCAL_RPC_TARGET;

const createRequestInit = (frame, method, signal, headers) => {
  const requestInit = {
    method,
    headers,
    signal,
  };
  if (method !== 'GET' && method !== 'HEAD' && typeof frame.bodyBase64 === 'string' && frame.bodyBase64.length > 0) {
    requestInit.body = Buffer.from(frame.bodyBase64, 'base64');
  }
  return requestInit;
};

const sendFetchResponse = async (socket, id, response, meta = {}) => {
  const responseBuffer = await readResponseBuffer(response);
  const status = Number.isInteger(response.status) ? response.status : 502;
  sendFrame(socket, {
    type: 'response',
    id,
    status,
    statusText: response.statusText || '',
    ...meta,
    headers: collectResponseHeaders(response.headers),
    bodyBase64: responseBuffer.toString('base64'),
  });
  return status;
};

const resolveLoopbackBaseUrlFromServer = (server) => {
  const addressInfo = server?.address?.();
  if (!addressInfo || typeof addressInfo !== 'object' || !Number.isFinite(addressInfo.port)) {
    return null;
  }
  const address = typeof addressInfo.address === 'string' ? addressInfo.address : '';
  if (address === '::' || address === '[::]') {
    return `http://[::1]:${addressInfo.port}`;
  }
  const hostname = !address || address === '0.0.0.0'
    ? '127.0.0.1'
    : address;
  return `http://${hostname}:${addressInfo.port}`;
};

export function createRemoteRpcConnectionAcceptor({
  remoteInstancesRuntime,
  getLocalBaseUrl,
  fetchImpl = fetch,
  logger = console,
}) {
  return (socket) => {
    const activeRequests = new Map();

    const cleanupRequest = (id) => {
      const active = activeRequests.get(id);
      if (!active) {
        return;
      }
      activeRequests.delete(id);
      try {
        active.releaseLane?.();
      } catch {
      }
      if (active.timeout) {
        clearTimeout(active.timeout);
      }
    };

    const abortRequest = (id) => {
      const active = activeRequests.get(id);
      if (!active) {
        return;
      }
      try {
        active.controller.abort();
      } catch {
      }
      cleanupRequest(id);
    };

    const handleRequest = async (frame) => {
      const id = typeof frame?.id === 'string' && frame.id.length > 0 ? frame.id : '';
      if (!id) {
        return;
      }

      const rpcPath = normalizeRpcApiPath(frame.path);
      if (!rpcPath) {
        sendErrorResponse(
          socket,
          id,
          400,
          { error: 'Invalid remote RPC request' },
          {
            target: isLocalRpcRequest(frame) ? LOCAL_RPC_TARGET : 'remote',
            instanceId: typeof frame.instanceId === 'string' ? frame.instanceId : undefined,
            path: typeof frame.path === 'string' ? frame.path : '',
          },
        );
        return;
      }

      if (isLocalRpcRequest(frame)) {
        const responseMeta = { target: LOCAL_RPC_TARGET, path: rpcPath };
        const localBaseUrl = typeof getLocalBaseUrl === 'function' ? getLocalBaseUrl() : null;
        if (!localBaseUrl) {
          sendErrorResponse(socket, id, 503, { error: 'Local RPC target unavailable' }, responseMeta);
          return;
        }

        const controller = new AbortController();
        const method = normalizeMethod(frame.method);
        const timeoutMs = getRemoteProxyRequestTimeoutMs(rpcPath, method);
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        activeRequests.set(id, { controller, releaseLane: null, timeout });

        try {
          const headers = {
            ...sanitizeRequestHeaders(frame.headers, LOCAL_RPC_TARGET),
            'accept-encoding': 'identity',
          };
          const response = await fetchImpl(`${localBaseUrl.replace(/\/+$/, '')}${rpcPath}`, createRequestInit(frame, method, controller.signal, headers));
          await sendFetchResponse(socket, id, response, responseMeta);
        } catch (error) {
          if (controller.signal.aborted) {
            sendErrorResponse(socket, id, 499, {
              error: 'Local RPC request aborted',
              rpcTarget: LOCAL_RPC_TARGET,
              path: rpcPath,
              method,
              timeoutMs,
            }, responseMeta);
            return;
          }
          logger?.warn?.('[remote-rpc] Local request failed:', error?.message ?? error);
          const status = Number.isInteger(error?.statusCode) ? error.statusCode : 503;
          sendErrorResponse(socket, id, status, { error: 'Local API unavailable' }, responseMeta);
        } finally {
          cleanupRequest(id);
        }
        return;
      }

      const instanceId = typeof frame.instanceId === 'string' && frame.instanceId.length > 0 ? frame.instanceId : '';
      if (!instanceId) {
        sendErrorResponse(socket, id, 400, { error: 'Invalid remote RPC request' }, {
          target: 'remote',
          path: rpcPath,
        });
        return;
      }
      const responseMeta = { target: 'remote', instanceId, path: rpcPath };

      const resolved = await resolveHealthyRemoteInstance(remoteInstancesRuntime, instanceId);
      if (!resolved.ok) {
        sendErrorResponse(socket, id, resolved.status, { error: resolved.error, instanceId }, responseMeta);
        return;
      }

      let releaseLane = null;
      try {
        releaseLane = await remoteInstancesRuntime.enterRequestLane?.(instanceId, 'normal', {
          queueTimeoutMs: REMOTE_RPC_QUEUE_TIMEOUT_MS,
        });
      } catch (error) {
        const formatted = formatRemoteGateError(error, instanceId);
        logger?.warn?.('[remote-rpc] request lane rejected', {
          instanceId,
          lane: 'normal',
          method: normalizeMethod(frame.method),
          path: rpcPath.split('?')[0],
          status: formatted.status,
          code: formatted.body.code,
          retryAfterMs: formatted.body.retryAfterMs,
          pressure: remoteInstancesRuntime.getRequestPressure?.(instanceId),
        });
        sendErrorResponse(socket, id, formatted.status, formatted.body, responseMeta);
        return;
      }

      const controller = new AbortController();
      const method = normalizeMethod(frame.method);
      const timeoutMs = getRemoteProxyRequestTimeoutMs(rpcPath, method);
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      activeRequests.set(id, { controller, releaseLane, timeout });

      try {
        const headers = {
          ...sanitizeRequestHeaders(frame.headers),
          ...buildRemoteProxyAuthHeaders(resolved.instance),
          'accept-encoding': 'identity',
        };

        const remoteBase = resolved.instance.url.replace(/\/+$/, '');
        const response = await fetchImpl(`${remoteBase}${rpcPath}`, createRequestInit(frame, method, controller.signal, headers));
        const status = await sendFetchResponse(socket, id, response, responseMeta);

        if (status >= 500) {
          remoteInstancesRuntime.recordRemoteRequestFailure?.(instanceId, { status });
          if (status >= 502) {
            markRemoteProxyUnavailable(remoteInstancesRuntime, instanceId, new Error(`Remote API returned ${status}`));
          }
        } else {
          remoteInstancesRuntime.recordRemoteRequestSuccess?.(instanceId);
        }

      } catch (error) {
        if (controller.signal.aborted) {
          sendErrorResponse(socket, id, 499, {
            error: 'Remote RPC request aborted',
            rpcTarget: 'remote',
            instanceId,
            path: rpcPath,
            method,
            timeoutMs,
          }, responseMeta);
          return;
        }
        remoteInstancesRuntime.recordRemoteRequestFailure?.(instanceId, error);
        markRemoteProxyUnavailable(remoteInstancesRuntime, instanceId, error);
        logger?.warn?.(`[remote-rpc] Request failed for instance "${instanceId}":`, error?.message ?? error);
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 503;
        sendErrorResponse(socket, id, status, { error: 'Remote instance unavailable', instanceId }, responseMeta);
      } finally {
        cleanupRequest(id);
      }
    };

    socket.on('message', (data) => {
      let frame = null;
      try {
        frame = JSON.parse(String(data));
      } catch {
        return;
      }

      if (frame?.type === 'cancel') {
        const id = typeof frame.id === 'string' ? frame.id : '';
        if (id) {
          abortRequest(id);
        }
        return;
      }

      if (frame?.type === 'request') {
        void handleRequest(frame);
      }
    });

    socket.on('close', () => {
      for (const id of Array.from(activeRequests.keys())) {
        abortRequest(id);
      }
    });

    socket.on('error', () => {
      for (const id of Array.from(activeRequests.keys())) {
        abortRequest(id);
      }
    });

    sendFrame(socket, { type: 'ready' });
  };
}

export function registerRemoteRpcWebSocket({
  server,
  remoteInstancesRuntime,
  uiAuthController,
  isRequestOriginAllowed,
  rejectWebSocketUpgrade,
  fetchImpl = fetch,
  logger = console,
}) {
  if (!server || typeof server.on !== 'function' || !remoteInstancesRuntime) {
    return { close() {} };
  }

  const wsServer = new WebSocketServer({ noServer: true });
  const acceptConnection = createRemoteRpcConnectionAcceptor({
    remoteInstancesRuntime,
    getLocalBaseUrl: () => resolveLoopbackBaseUrlFromServer(server),
    fetchImpl,
    logger,
  });

  const upgradeHandler = (req, socket, head) => {
    if (parseRequestPathname(req.url) !== REMOTE_RPC_WS_PATH) {
      return;
    }

    const handleUpgrade = async () => {
      try {
        if (uiAuthController?.enabled) {
          const sessionToken = await uiAuthController?.ensureSessionToken?.(req, null);
          if (!sessionToken) {
            rejectWebSocketUpgrade(socket, 401, 'UI authentication required');
            return;
          }

          if (typeof isRequestOriginAllowed === 'function') {
            const originAllowed = await isRequestOriginAllowed(req);
            if (!originAllowed) {
              rejectWebSocketUpgrade(socket, 403, 'Invalid origin');
              return;
            }
          }
        }

        wsServer.handleUpgrade(req, socket, head, (ws) => {
          acceptConnection(ws);
        });
      } catch {
        rejectWebSocketUpgrade(socket, 500, 'Upgrade failed');
      }
    };

    void handleUpgrade();
  };

  server.on('upgrade', upgradeHandler);

  return {
    wsServer,
    close() {
      server.off('upgrade', upgradeHandler);
      try {
        for (const client of wsServer.clients) {
          try {
            client.terminate();
          } catch {
          }
        }
        wsServer.close();
      } catch {
      }
    },
  };
}
