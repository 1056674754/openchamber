import { createProxyMiddleware } from 'http-proxy-middleware';

import {
  shouldForwardProxyResponseHeader,
} from '../../proxy-headers.js';

const remoteProxyPathPrefix = '/api/remote/';

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

const setRemoteAuthHeaders = (proxyReq, req) => {
  const instance = req.remoteInstance;
  if (instance?.auth?.type === 'password' && instance.auth.value) {
    proxyReq.setHeader(
      'Authorization',
      `Basic ${Buffer.from(`user:${instance.auth.value}`).toString('base64')}`,
    );
  } else if (instance?.auth?.type === 'bearer' && instance.auth.value) {
    proxyReq.setHeader('Authorization', `Bearer ${instance.auth.value}`);
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

const resolveHealthyInstance = async (runtime, instanceId) => {
  const instance = runtime.getInstanceSync(instanceId);
  if (!instance) {
    return { ok: false, status: 404, error: 'Remote instance not found' };
  }

  if (!instance.enabled) {
    return { ok: false, status: 503, error: 'Remote instance not available' };
  }

  const healthy = runtime.isHealthy(instanceId)
    || (typeof runtime.ensureHealthy === 'function' && await runtime.ensureHealthy(instanceId));

  if (!healthy) {
    return { ok: false, status: 503, error: 'Remote instance not available' };
  }

  return { ok: true, instance };
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
      },
      proxyReqWs: setRemoteWsHeaders,
      proxyRes: (proxyRes) => {
        for (const key of Object.keys(proxyRes.headers || {})) {
          if (!shouldForwardProxyResponseHeader(key)) {
            delete proxyRes.headers[key];
          }
        }
      },
      error: (err, req, res) => {
        const instanceId = req?.params?.instanceId || req?.remoteInstance?.id || 'unknown';
        console.error(`[remote-proxy] Proxy error for instance "${instanceId}":`, err.message);
        if (res && !res.headersSent && typeof res.status === 'function') {
          res.status(503).json({ error: 'Remote instance unavailable', instanceId });
        }
      },
    },
  });

  app.use('/api/remote/:instanceId', async (req, res, next) => {
    const { instanceId } = req.params;

    const resolved = await resolveHealthyInstance(runtime, instanceId);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: resolved.error, instanceId });
    }

    const remotePath = '/api' + req.url;
    req.remoteInstance = resolved.instance;
    req.remoteProxyPath = remotePath;

    proxy(req, res, next);
  });

  if (server && typeof server.on === 'function') {
    server.on('upgrade', (req, socket, head) => {
      const parsed = parseRemoteProxyPath(req.url);
      if (!parsed) {
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

          const resolved = await resolveHealthyInstance(runtime, parsed.instanceId);
          if (!resolved.ok) {
            rejectUpgrade(socket, resolved.status, resolved.error, rejectWebSocketUpgrade);
            return;
          }

          req.remoteInstance = resolved.instance;
          req.remoteProxyPath = parsed.remotePath;
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
