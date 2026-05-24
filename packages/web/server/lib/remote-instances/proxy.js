import { createProxyMiddleware } from 'http-proxy-middleware';

import {
  shouldForwardProxyResponseHeader,
} from '../../proxy-headers.js';

export const registerRemoteProxy = (app, runtime) => {
  const proxy = createProxyMiddleware({
    target: 'http://127.0.0.1',
    changeOrigin: true,
    router: (req) => req.remoteInstance?.url || 'http://127.0.0.1',
    pathRewrite: (_path, req) => req.remoteProxyPath || req.url,
    on: {
      proxyReq: (proxyReq, req) => {
        const instance = req.remoteInstance;
        if (instance?.auth?.type === 'password' && instance.auth.value) {
          proxyReq.setHeader(
            'Authorization',
            `Basic ${Buffer.from(`user:${instance.auth.value}`).toString('base64')}`,
          );
        } else if (instance?.auth?.type === 'bearer' && instance.auth.value) {
          proxyReq.setHeader('Authorization', `Bearer ${instance.auth.value}`);
        }
        proxyReq.setHeader('accept-encoding', 'identity');
      },
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

    const instance = runtime.getInstanceSync(instanceId);
    if (!instance) {
      return res.status(404).json({ error: 'Remote instance not found' });
    }

    if (!instance.enabled) {
      return res.status(503).json({ error: 'Remote instance not available', instanceId });
    }

    const healthy = runtime.isHealthy(instanceId)
      || (typeof runtime.ensureHealthy === 'function' && await runtime.ensureHealthy(instanceId));

    if (!healthy) {
      return res.status(503).json({ error: 'Remote instance not available', instanceId });
    }

    const remotePath = '/api' + req.url;
    req.remoteInstance = instance;
    req.remoteProxyPath = remotePath;

    proxy(req, res, next);
  });
};
