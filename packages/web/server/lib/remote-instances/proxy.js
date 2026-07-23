import { createProxyMiddleware } from 'http-proxy-middleware';

import {
  preserveDecodedPayloadLengthHeader,
  shouldForwardProxyResponseHeader,
} from '../../proxy-headers.js';

const remoteProxyPathPrefix = '/api/remote/';
const REMOTE_PROXY_FAST_TIMEOUT_MS = 3_000;
const REMOTE_PROXY_DEFAULT_TIMEOUT_MS = 5_000;
const REMOTE_PROXY_GIT_STATUS_TIMEOUT_MS = 30_000;
const REMOTE_PROXY_MESSAGE_HISTORY_TIMEOUT_MS = 30_000;
const REMOTE_PROXY_LONG_MUTATION_TIMEOUT_MS = 15_000;
const REMOTE_PROXY_UPGRADE_TIMEOUT_MS = 10 * 60_000;
const REMOTE_PROXY_SHELL_TIMEOUT_MS = REMOTE_PROXY_UPGRADE_TIMEOUT_MS;
const REMOTE_PROXY_MAX_TIMEOUT_MS = REMOTE_PROXY_UPGRADE_TIMEOUT_MS;
const REMOTE_PROXY_QUEUE_TIMEOUT_MS = 1_000;

const rejectUpgrade = (socket, statusCode, reason, rejectWebSocketUpgrade) => {
  if (typeof rejectWebSocketUpgrade === 'function') {
    rejectWebSocketUpgrade(socket, statusCode, reason);
    return;
  }

  try {
    socket.write(
      `HTTP/1.1 ${statusCode} Bad Request\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(reason)}\r\n\r\n` +
      reason
    );
  } catch {
  }

  try {
    socket.destroy();
  } catch {
  }
};

const parseRemoteProxyPath = (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(rawUrl || '', 'http://localhost');
  } catch {
    return null;
  }

  if (!parsed.pathname.startsWith(remoteProxyPathPrefix)) {
    return null;
  }

  const remainder = parsed.pathname.slice(remoteProxyPathPrefix.length);
  const slashIndex = remainder.indexOf('/');
  const rawInstanceId = slashIndex >= 0 ? remainder.slice(0, slashIndex) : remainder;
  if (!rawInstanceId) {
    return null;
  }

  let instanceId;
  try {
    instanceId = decodeURIComponent(rawInstanceId);
  } catch {
    return null;
  }

  const remotePathSuffix = slashIndex >= 0 ? remainder.slice(slashIndex) : '';
  const remotePathname = `/api${remotePathSuffix}`;
  return {
    instanceId,
    remotePath: `${remotePathname}${parsed.search}`,
  };
};

const isRemoteEventWsProxyPath = (remotePath) => {
  let parsed;
  try {
    parsed = new URL(remotePath || '', 'http://localhost');
  } catch {
    return false;
  }

  return parsed.pathname === '/api/global/event/ws' || parsed.pathname === '/api/event/ws';
};

export const getRemoteProxyRequestTimeoutMs = (remotePath, method = 'GET') => {
  let parsed;
  try {
    parsed = new URL(remotePath || '', 'http://localhost');
  } catch {
    return REMOTE_PROXY_DEFAULT_TIMEOUT_MS;
  }

  const pathname = parsed.pathname;
  const normalizedMethod = String(method || 'GET').toUpperCase();

  if (
    pathname === '/api/session'
    || pathname === '/api/project'
    || pathname === '/api/global/health'
    || pathname === '/api/session/status'
    || pathname === '/api/fs/list'
  ) {
    return REMOTE_PROXY_FAST_TIMEOUT_MS;
  }

  if (normalizedMethod === 'GET' && pathname === '/api/git/status') {
    return REMOTE_PROXY_GIT_STATUS_TIMEOUT_MS;
  }

  if (normalizedMethod === 'GET' && /\/api\/session\/[^/]+\/message$/.test(pathname)) {
    return REMOTE_PROXY_MESSAGE_HISTORY_TIMEOUT_MS;
  }

  if (normalizedMethod === 'POST' && /\/api\/session\/[^/]+\/prompt_async$/.test(pathname)) {
    return REMOTE_PROXY_LONG_MUTATION_TIMEOUT_MS;
  }

  if (normalizedMethod === 'POST' && /\/api\/session\/[^/]+\/shell$/.test(pathname)) {
    return REMOTE_PROXY_SHELL_TIMEOUT_MS;
  }

  if (normalizedMethod === 'POST' && pathname === '/api/opencode/upgrade') {
    return REMOTE_PROXY_UPGRADE_TIMEOUT_MS;
  }

  return REMOTE_PROXY_DEFAULT_TIMEOUT_MS;
};

export const buildRemoteProxyAuthHeaders = (instance) => {
  const headers = {};
  if (instance?.auth?.type === 'password' && instance.auth.value) {
    headers.Authorization = `Basic ${Buffer.from(`user:${instance.auth.value}`).toString('base64')}`;
  } else if (instance?.auth?.type === 'bearer' && instance.auth.value) {
    headers.Authorization = `Bearer ${instance.auth.value}`;
  }
  return headers;
};

const setRemoteAuthHeaders = (proxyReq, req) => {
  const headers = buildRemoteProxyAuthHeaders(req.remoteInstance);
  for (const [key, value] of Object.entries(headers)) {
    proxyReq.setHeader(key, value);
  }
};

const setRemoteWsHeaders = (proxyReq, req) => {
  setRemoteAuthHeaders(proxyReq, req);
  const instanceUrl = req.remoteInstance?.url;
  if (typeof instanceUrl === 'string' && instanceUrl.length > 0) {
    try {
      proxyReq.setHeader('origin', new URL(instanceUrl).origin);
    } catch {
    }
  }
};

export const beginRemoteBackgroundHealthProbe = (runtime, instanceId) => {
  if (typeof runtime.ensureHealthy !== 'function') {
    return;
  }
  if (typeof runtime.isHealthProbeInFlight === 'function' && runtime.isHealthProbeInFlight(instanceId)) {
    return;
  }
  void runtime.ensureHealthy(instanceId, { timeoutSec: 2 }).catch(() => {});
};

export const markRemoteProxyUnavailable = (runtime, instanceId, error) => {
  const message = error?.message || 'Remote instance unavailable';
  runtime.setHealthStatus?.(instanceId, {
    healthy: false,
    latencyMs: 0,
    error: message,
  });
};

export const resolveHealthyRemoteInstance = async (runtime, instanceId, options = {}) => {
  const instance = runtime.getInstanceSync(instanceId);
  if (!instance) {
    return { ok: false, status: 404, error: 'Remote instance not found' };
  }

  if (!instance.enabled) {
    return { ok: false, status: 503, error: 'Remote instance not available' };
  }

  const healthy = runtime.isHealthy(instanceId);

  if (!healthy) {
    if (options.waitForHealth === true && typeof runtime.ensureHealthy === 'function') {
      const becameHealthy = await runtime.ensureHealthy(instanceId, { timeoutSec: options.timeoutSec || 2 });
      if (becameHealthy) {
        return { ok: true, instance };
      }
    } else {
      beginRemoteBackgroundHealthProbe(runtime, instanceId);
    }
    return { ok: false, status: 503, error: 'Remote instance not available' };
  }

  return { ok: true, instance };
};

export const formatRemoteGateError = (error, instanceId) => {
  const retryAfterMs = Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0
    ? Math.round(error.retryAfterMs)
    : undefined;
  return {
    status: Number.isInteger(error?.statusCode) ? error.statusCode : 503,
    headers: retryAfterMs === undefined
      ? {}
      : { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1_000))) },
    body: {
      error: error?.message || 'Remote instance unavailable',
      code: error?.code || 'REMOTE_REQUEST_REJECTED',
      instanceId,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
  };
};

const releaseRemoteLaneOnResponseEnd = (res, release) => {
  if (typeof release !== 'function') {
    return;
  }

  let released = false;
  const releaseOnce = () => {
    if (released) {
      return;
    }
    released = true;
    release();
  };

  res.once('finish', releaseOnce);
  res.once('close', releaseOnce);
  res.once('error', releaseOnce);
};

export const registerRemoteProxy = (app, runtime, options = {}) => {
  const {
    server,
    uiAuthController,
    isRequestOriginAllowed,
    rejectWebSocketUpgrade,
  } = options;

  const proxy = createProxyMiddleware({
    target: 'http://127.0.0.1',
    changeOrigin: true,
    ws: true,
    proxyTimeout: REMOTE_PROXY_MAX_TIMEOUT_MS,
    timeout: REMOTE_PROXY_MAX_TIMEOUT_MS,
    pathFilter: (pathname, req) => {
      const target = req?.originalUrl || pathname || req?.url || '';
      return target.startsWith(remoteProxyPathPrefix);
    },
    router: (req) => req.remoteInstance?.url || 'http://127.0.0.1',
    pathRewrite: (_path, req) => req.remoteProxyPath || req.url,
    on: {
      proxyReq: (proxyReq, req) => {
        setRemoteAuthHeaders(proxyReq, req);
        proxyReq.setHeader('accept-encoding', 'identity');
        const timeoutMs = getRemoteProxyRequestTimeoutMs(req.remoteProxyPath || req.url, req.method);
        proxyReq.setTimeout(timeoutMs, () => {
          const error = new Error(`Remote proxy request timed out after ${timeoutMs}ms`);
          error.code = 'ETIMEDOUT';
          proxyReq.destroy(error);
        });
      },
      proxyReqWs: setRemoteWsHeaders,
      proxyRes: (proxyRes, req) => {
        preserveDecodedPayloadLengthHeader(proxyRes.headers);
        for (const key of Object.keys(proxyRes.headers || {})) {
          if (!shouldForwardProxyResponseHeader(key)) {
            delete proxyRes.headers[key];
          }
        }
        const instanceId = req?._remoteInstanceId;
        const statusCode = proxyRes.statusCode || 0;
        if (instanceId && statusCode >= 500) {
          runtime.recordRemoteRequestFailure?.(instanceId, { status: statusCode });
          if (statusCode >= 502) {
            markRemoteProxyUnavailable(runtime, instanceId, new Error(`Remote API returned ${statusCode}`));
          }
        } else if (instanceId && statusCode > 0) {
          runtime.recordRemoteRequestSuccess?.(instanceId);
        }
      },
      error: (err, req, res) => {
        const instanceId = req?.params?.instanceId || req?.remoteInstance?.id || 'unknown';
        runtime.recordRemoteRequestFailure?.(instanceId, err);
        markRemoteProxyUnavailable(runtime, instanceId, err);
        console.error(`[remote-proxy] Proxy error for instance "${instanceId}":`, err.message);
        if (res && !res.headersSent && typeof res.status === 'function') {
          const status = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' ? 504 : 503;
          res.status(status).json({ error: 'Remote instance unavailable', instanceId });
        }
      },
    },
  });

  app.use('/api/remote/:instanceId', async (req, res, next) => {
    const { instanceId } = req.params;

    const resolved = await resolveHealthyRemoteInstance(runtime, instanceId);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: resolved.error, instanceId });
    }

    let releaseLane = null;
    try {
      releaseLane = await runtime.enterRequestLane?.(instanceId, 'normal', {
        queueTimeoutMs: REMOTE_PROXY_QUEUE_TIMEOUT_MS,
      });
    } catch (error) {
      const formatted = formatRemoteGateError(error, instanceId);
      const pressure = runtime.getRequestPressure?.(instanceId);
      console.warn('[remote-proxy] request lane rejected', {
        instanceId,
        lane: 'normal',
        method: req.method,
        path: req.path,
        status: formatted.status,
        code: formatted.body.code,
        retryAfterMs: formatted.body.retryAfterMs,
        pressure,
      });
      for (const [name, value] of Object.entries(formatted.headers)) {
        res.setHeader(name, value);
      }
      return res.status(formatted.status).json(formatted.body);
    }

    const remotePath = '/api' + req.url;
    req.remoteInstance = resolved.instance;
    req.remoteProxyPath = remotePath;
    req._remoteInstanceId = instanceId;

    releaseRemoteLaneOnResponseEnd(res, releaseLane);

    proxy(req, res, next);
  });

  if (server && typeof server.on === 'function') {
    server.on('upgrade', (req, socket, head) => {
      const parsed = parseRemoteProxyPath(req.url);
      if (!parsed || isRemoteEventWsProxyPath(parsed.remotePath)) {
        return;
      }

      const handleUpgrade = async () => {
        try {
          if (uiAuthController?.enabled) {
            const sessionToken = await uiAuthController?.ensureSessionToken?.(req, null);
            if (!sessionToken) {
              rejectUpgrade(socket, 401, 'UI authentication required', rejectWebSocketUpgrade);
              return;
            }

            if (typeof isRequestOriginAllowed === 'function') {
              const originAllowed = await isRequestOriginAllowed(req);
              if (!originAllowed) {
                rejectUpgrade(socket, 403, 'Invalid origin', rejectWebSocketUpgrade);
                return;
              }
            }
          }

          const resolved = await resolveHealthyRemoteInstance(runtime, parsed.instanceId);
          if (!resolved.ok) {
            rejectUpgrade(socket, resolved.status, resolved.error, rejectWebSocketUpgrade);
            return;
          }

          let releaseLane = null;
          try {
            releaseLane = await runtime.enterRequestLane?.(parsed.instanceId, 'stream');
          } catch (error) {
            const formatted = formatRemoteGateError(error, parsed.instanceId);
            console.warn('[remote-proxy] stream lane rejected', {
              instanceId: parsed.instanceId,
              lane: 'stream',
              path: parsed.remotePath.split('?')[0],
              status: formatted.status,
              code: formatted.body.code,
              retryAfterMs: formatted.body.retryAfterMs,
              pressure: runtime.getRequestPressure?.(parsed.instanceId),
            });
            rejectUpgrade(socket, formatted.status, formatted.body.error, rejectWebSocketUpgrade);
            return;
          }

          if (typeof releaseLane === 'function') {
            let released = false;
            const releaseOnce = () => {
              if (released) {
                return;
              }
              released = true;
              releaseLane();
            };
            socket.once('close', releaseOnce);
            socket.once('error', releaseOnce);
          }

          req.remoteInstance = resolved.instance;
          req.remoteProxyPath = parsed.remotePath;
          req._remoteInstanceId = parsed.instanceId;
          req.originalUrl = req.url;
          req.url = parsed.remotePath;
          proxy.upgrade(req, socket, head);
        } catch (error) {
          console.error('[remote-proxy] WebSocket upgrade failed:', error?.message ?? error);
          rejectUpgrade(socket, 500, 'Upgrade failed', rejectWebSocketUpgrade);
        }
      };

      void handleUpgrade();
    });
  }
};
