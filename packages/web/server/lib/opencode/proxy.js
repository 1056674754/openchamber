import http from 'node:http';
import https from 'node:https';
import { createProxyMiddleware } from 'http-proxy-middleware';

import {
  DECODED_PAYLOAD_LENGTH_HEADER,
  applyForwardProxyResponseHeaders,
  collectForwardProxyHeaders,
  preserveDecodedPayloadLengthHeader,
  shouldForwardProxyResponseHeader,
} from '../../proxy-headers.js';
import { createRealpathCache } from '../path-realpath-cache.js';
import { DEFAULT_UPSTREAM_STALL_TIMEOUT_MS } from '../event-stream/upstream-reader.js';

const MAX_MESSAGE_HISTORY_DIFFS = 500;
const MAX_MESSAGE_HISTORY_PATCH_LENGTH = 100_000;
const DEFAULT_SSE_HEARTBEAT_INTERVAL_MS = 20_000;
const PROXY_AGENT_OPTIONS = {
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: Infinity,
  maxFreeSockets: 256,
  timeout: 60_000,
};

const isHttpsProxyTarget = (target) => {
  try {
    return new URL(target).protocol === 'https:';
  } catch {
    return /^https:/i.test(String(target ?? '').trim());
  }
};

export const createOpenCodeProxyAgent = (target) => (
  isHttpsProxyTarget(target)
    ? new https.Agent(PROXY_AGENT_OPTIONS)
    : new http.Agent(PROXY_AGENT_OPTIONS)
);

export const createOpenCodeProxyAgentResolver = (resolveTarget) => {
  const agents = new Map();
  return () => {
    const target = resolveTarget();
    const scheme = isHttpsProxyTarget(target) ? 'https:' : 'http:';
    let agent = agents.get(scheme);
    if (!agent) {
      agent = createOpenCodeProxyAgent(target);
      agents.set(scheme, agent);
    }
    return agent;
  };
};

export const projectMessageHistoryPayload = (payload) => {
  if (!Array.isArray(payload)) {
    return payload;
  }

  return payload.map((record) => {
    const summary = record?.info?.summary;
    if (!summary || !Array.isArray(summary.diffs)) {
      return record;
    }

    const diffs = summary.diffs.slice(0, MAX_MESSAGE_HISTORY_DIFFS).map((diff) => {
      if (!diff || typeof diff !== 'object' || Array.isArray(diff)) {
        return diff;
      }

      const { before: _before, after: _after, from: _from, to: _to, ...projected } = diff;
      if (typeof projected.patch === 'string' && projected.patch.length > MAX_MESSAGE_HISTORY_PATCH_LENGTH) {
        projected.patch = projected.patch.slice(0, MAX_MESSAGE_HISTORY_PATCH_LENGTH);
      }
      return projected;
    });

    return {
      ...record,
      info: {
        ...record.info,
        summary: {
          ...summary,
          diffs,
        },
      },
    };
  });
};

export const projectMessageHistoryResponseText = (bodyText) => {
  try {
    return JSON.stringify(projectMessageHistoryPayload(JSON.parse(bodyText)));
  } catch {
    return bodyText;
  }
};

export const createDirectoryQueryCanonicalizer = ({ realpath, ...cacheOptions } = {}) => {
  const realpathCache = createRealpathCache({ fallbackOnError: true, realpath, ...cacheOptions });

  return async (requestUrl) => {
    if (typeof requestUrl !== 'string' || !requestUrl.includes('directory=')) {
      return requestUrl;
    }

    const url = new URL(requestUrl, 'http://localhost');
    const directory = url.searchParams.get('directory');
    if (!directory) {
      return requestUrl;
    }

    const canonicalDirectory = await realpathCache.resolve(directory);
    if (!canonicalDirectory || canonicalDirectory === directory) {
      return requestUrl;
    }

    url.searchParams.set('directory', canonicalDirectory);
    return `${url.pathname}${url.search}`;
  };
};

export const waitForSseDrain = (res, signal) => new Promise((resolve) => {
  if (signal?.aborted || res.writableEnded || res.destroyed) {
    resolve();
    return;
  }

  const cleanup = () => {
    res.off?.('drain', onDone);
    res.off?.('close', onDone);
    res.off?.('error', onDone);
    signal?.removeEventListener?.('abort', onDone);
  };
  const onDone = () => {
    cleanup();
    resolve();
  };

  res.once?.('drain', onDone);
  res.once?.('close', onDone);
  res.once?.('error', onDone);
  signal?.addEventListener?.('abort', onDone, { once: true });
});

export const writeSseChunkWithBackpressure = async (res, value, signal) => {
  if (!value || value.length === 0 || signal?.aborted || res.writableEnded || res.destroyed) {
    return false;
  }

  const flushed = res.write(value);
  if (flushed !== false) {
    return true;
  }

  await waitForSseDrain(res, signal);
  return !signal?.aborted && !res.writableEnded && !res.destroyed;
};

export const createSseBoundaryTracker = () => {
  const decoder = new TextDecoder();
  let tail = '';

  const normalize = (value) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return {
    observe(value) {
      const text = typeof value === 'string'
        ? value
        : decoder.decode(value, { stream: true });
      if (text.length > 0) {
        tail = `${tail}${normalize(text)}`;
        if (tail.length > 4096) {
          tail = tail.slice(-4096);
        }
      }
      return this.isAtBoundary();
    },
    isAtBoundary() {
      return tail.length === 0 || tail.endsWith('\n\n');
    },
  };
};

export const registerOpenCodeProxy = (app, deps) => {
  const {
    fs,
    os,
    path,
    OPEN_CODE_READY_GRACE_MS,
    getRuntime,
    getOpenCodeAuthHeaders,
    buildOpenCodeUrl,
    ensureOpenCodeApiPrefix,
    SSE_HEARTBEAT_INTERVAL_MS = DEFAULT_SSE_HEARTBEAT_INTERVAL_MS,
    SSE_UPSTREAM_STALL_TIMEOUT_MS = DEFAULT_UPSTREAM_STALL_TIMEOUT_MS,
    getSseUpstreamStallTimeoutMs = () => SSE_UPSTREAM_STALL_TIMEOUT_MS,
  } = deps;

  if (app.get('opencodeProxyConfigured')) {
    return;
  }

  const runtime = getRuntime();
  if (runtime.openCodePort) {
    console.log(`Setting up proxy to OpenCode on port ${runtime.openCodePort}`);
  } else {
    console.log('Setting up OpenCode API gate (OpenCode not started yet)');
  }
  app.set('opencodeProxyConfigured', true);

  const isAbortError = (error) => error?.name === 'AbortError';
  const isClientClosedStreamError = (error) => {
    const message = typeof error?.message === 'string' ? error.message : '';
    return message.includes('socket connection was closed') || message.includes('Socket connection was closed');
  };
  const FALLBACK_PROXY_TARGET = 'http://127.0.0.1:3902';
  const canonicalizeDirectoryQuery = createDirectoryQueryCanonicalizer({
    realpath: fs?.promises?.realpath?.bind(fs.promises),
  });

  const normalizeProxyTarget = (candidate) => {
    if (typeof candidate !== 'string') {
      return null;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }

    return trimmed.replace(/\/+$/, '');
  };

  // Keep generic proxy requests on the same upstream base URL that health checks
  // and direct fetch helpers use. This avoids split-brain state where /health
  // succeeds against an external host but /api/* still proxies to 127.0.0.1.
  const resolveProxyTarget = () => {
    try {
      const resolved = normalizeProxyTarget(buildOpenCodeUrl('/', ''));
      if (resolved) {
        return resolved;
      }
    } catch {
    }

    const runtimeState = getRuntime();
    const externalBase = normalizeProxyTarget(runtimeState.openCodeBaseUrl);
    if (externalBase) {
      return externalBase;
    }

    if (runtimeState.openCodePort) {
      return `http://localhost:${runtimeState.openCodePort}`;
    }

    return FALLBACK_PROXY_TARGET;
  };

  const forwardSseRequest = async (req, res) => {
    const abortController = new AbortController();
    const closeUpstream = () => abortController.abort();
    let upstream = null;
    let reader = null;
    let heartbeatTimer = null;
    let upstreamStallTimer = null;
    let didUpstreamStall = false;
    let writeQueue = Promise.resolve(true);
    const sseBoundary = createSseBoundaryTracker();

    req.on('close', closeUpstream);

    try {
      const requestUrl = typeof req.originalUrl === 'string' && req.originalUrl.length > 0
        ? req.originalUrl
        : (typeof req.url === 'string' ? req.url : '');
      const upstreamPath = requestUrl.startsWith('/api') ? requestUrl.slice(4) || '/' : requestUrl;
      const headers = collectForwardProxyHeaders(req.headers, getOpenCodeAuthHeaders());
      headers.accept ??= 'text/event-stream';
      headers['cache-control'] ??= 'no-cache';

      upstream = await fetch(buildOpenCodeUrl(upstreamPath, ''), {
        method: 'GET',
        headers,
        signal: abortController.signal,
      });

      res.status(upstream.status);
      applyForwardProxyResponseHeaders(upstream.headers, res);

      const contentType = upstream.headers.get('content-type') || 'text/event-stream';
      const isEventStream = contentType.toLowerCase().includes('text/event-stream');

      if (!upstream.body) {
        res.end(await upstream.text().catch(() => ''));
        return;
      }

      if (!isEventStream) {
        res.end(await upstream.text());
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      // Disable TCP Nagle's algorithm so small SSE chunks are sent immediately
      // instead of being buffered up to ~200ms by the TCP stack.
      if (res.socket && typeof res.socket.setNoDelay === 'function') {
        res.socket.setNoDelay(true);
      }

      const scheduleHeartbeat = () => {
        heartbeatTimer = setTimeout(async () => {
          if (abortController.signal.aborted || res.writableEnded || res.destroyed) {
            return;
          }
          if (!sseBoundary.isAtBoundary()) {
            scheduleHeartbeat();
            return;
          }
          const canContinue = await enqueueSseWrite('data: {"heartbeat":true}\n\n');
          if (canContinue) {
            scheduleHeartbeat();
          }
        }, SSE_HEARTBEAT_INTERVAL_MS);
      };

      const clearUpstreamStallTimer = () => {
        if (upstreamStallTimer) {
          clearTimeout(upstreamStallTimer);
          upstreamStallTimer = null;
        }
      };

      const resetUpstreamStallTimer = () => {
        clearUpstreamStallTimer();
        const timeoutMs = getSseUpstreamStallTimeoutMs();
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          return;
        }
        upstreamStallTimer = setTimeout(() => {
          didUpstreamStall = true;
          abortController.abort();
        }, timeoutMs);
        upstreamStallTimer.unref?.();
      };

      const enqueueSseWrite = (value) => {
        writeQueue = writeQueue
          .catch(() => false)
          .then((canContinue) => {
            if (!canContinue) {
              return false;
            }
            return writeSseChunkWithBackpressure(res, value, abortController.signal);
          });
        return writeQueue;
      };

      scheduleHeartbeat();
      resetUpstreamStallTimer();

      reader = upstream.body.getReader();
      while (!abortController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value && value.length > 0) {
          resetUpstreamStallTimer();
          sseBoundary.observe(value);
          const canContinue = await enqueueSseWrite(value);
          if (!canContinue) {
            break;
          }
        }
      }

      res.end();
    } catch (error) {
      if (isAbortError(error) || abortController.signal.aborted || res.writableEnded || res.destroyed || isClientClosedStreamError(error)) {
        if (didUpstreamStall && !res.writableEnded && !res.destroyed) {
          await writeQueue.catch(() => false);
          res.end();
        }
        return;
      }
      console.error('[proxy] OpenCode SSE proxy error:', error?.message ?? error);
      if (!res.headersSent) {
        res.status(503).json({ error: 'OpenCode service unavailable' });
      } else {
        res.end();
      }
    } finally {
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (upstreamStallTimer) {
        clearTimeout(upstreamStallTimer);
        upstreamStallTimer = null;
      }
      req.off('close', closeUpstream);
      try {
        if (reader) {
          await reader.cancel();
          reader.releaseLock();
        } else if (upstream?.body && !upstream.body.locked) {
          await upstream.body.cancel();
        }
      } catch {
      }
    }
  };

  // Ensure API prefix is detected before proxying
  app.use('/api', (_req, _res, next) => {
    ensureOpenCodeApiPrefix();
    next();
  });

  // Readiness gate — return 503 while OpenCode is starting/restarting
  app.use('/api', (req, res, next) => {
    if (
      req.path.startsWith('/themes/custom') ||
      req.path.startsWith('/push') ||
      req.path.startsWith('/config/agents') ||
      req.path.startsWith('/config/opencode-resolution') ||
      req.path.startsWith('/config/settings') ||
      req.path.startsWith('/config/skills') ||
      req.path === '/config/reload' ||
      req.path === '/health'
    ) {
      return next();
    }

    const runtimeState = getRuntime();
    const waitElapsed = runtimeState.openCodeNotReadySince === 0 ? 0 : Date.now() - runtimeState.openCodeNotReadySince;
    const stillWaiting =
      (!runtimeState.isOpenCodeReady && (runtimeState.openCodeNotReadySince === 0 || waitElapsed < OPEN_CODE_READY_GRACE_MS)) ||
      runtimeState.isRestartingOpenCode ||
      !runtimeState.openCodePort;

    if (stillWaiting) {
      return res.status(503).json({
        error: 'OpenCode is restarting',
        restarting: true,
      });
    }

    next();
  });

  // Windows: session merge for cross-directory session listing
  if (process.platform === 'win32') {
    app.get('/api/session', async (req, res, next) => {
      const rawUrl = req.originalUrl || req.url || '';
      if (rawUrl.includes('directory=')) return next();

      try {
        const authHeaders = getOpenCodeAuthHeaders();
        const fetchOpts = {
          method: 'GET',
          headers: { Accept: 'application/json', ...authHeaders },
          signal: AbortSignal.timeout(10000),
        };
        const globalRes = await fetch(buildOpenCodeUrl('/session', ''), fetchOpts);
        const globalPayload = globalRes.ok ? await globalRes.json().catch(() => []) : [];
        const globalSessions = Array.isArray(globalPayload) ? globalPayload : [];

        const settingsPath = path.join(os.homedir(), '.config', 'openchamber', 'settings.json');
        let projectDirs = [];
        try {
          const settingsRaw = fs.readFileSync(settingsPath, 'utf8');
          const settings = JSON.parse(settingsRaw);
          projectDirs = (settings.projects || [])
            .map((project) => (typeof project?.path === 'string' ? project.path.trim() : ''))
            .filter(Boolean);
        } catch {
        }

        const seen = new Set(
          globalSessions
            .map((session) => (session && typeof session.id === 'string' ? session.id : null))
            .filter((id) => typeof id === 'string')
        );
        const extraSessions = [];
        for (const dir of projectDirs) {
          const candidates = Array.from(new Set([
            dir,
            dir.replace(/\\/g, '/'),
            dir.replace(/\//g, '\\'),
          ]));
          for (const candidateDir of candidates) {
            const encoded = encodeURIComponent(candidateDir);
            try {
              const dirRes = await fetch(buildOpenCodeUrl(`/session?directory=${encoded}`, ''), fetchOpts);
              if (dirRes.ok) {
                const dirPayload = await dirRes.json().catch(() => []);
                const dirSessions = Array.isArray(dirPayload) ? dirPayload : [];
                for (const session of dirSessions) {
                  const id = session && typeof session.id === 'string' ? session.id : null;
                  if (id && !seen.has(id)) {
                    seen.add(id);
                    extraSessions.push(session);
                  }
                }
              }
            } catch {
            }
          }
        }

        const merged = [...globalSessions, ...extraSessions];
        merged.sort((a, b) => {
          const aTime = a && typeof a.time_updated === 'number' ? a.time_updated : 0;
          const bTime = b && typeof b.time_updated === 'number' ? b.time_updated : 0;
          return bTime - aTime;
        });
        console.log(`[SessionMerge] ${globalSessions.length} global + ${extraSessions.length} extra = ${merged.length} total`);
        return res.json(merged);
      } catch (error) {
        console.log(`[SessionMerge] Error: ${error.message}, falling through`);
        next();
      }
    });
  }

  app.get('/api/global/event', forwardSseRequest);
  app.get('/api/event', forwardSseRequest);

  // Generic proxy for non-SSE OpenCode API routes.
  const resolveOpenCodeProxyAgent = createOpenCodeProxyAgentResolver(resolveProxyTarget);
  const createApiProxy = (timeoutMs) => createProxyMiddleware({
    target: resolveProxyTarget(),
    get agent() {
      return resolveOpenCodeProxyAgent();
    },
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
    ...(timeoutMs ? { timeout: timeoutMs, proxyTimeout: timeoutMs } : {}),
    // Dynamic target — port can change after restart
    router: () => resolveProxyTarget(),
    on: {
      proxyReq: (proxyReq) => {
        // Inject OpenCode auth headers
        const authHeaders = getOpenCodeAuthHeaders();
        if (authHeaders.Authorization) {
          proxyReq.setHeader('Authorization', authHeaders.Authorization);
        }

        // Defensive: request identity encoding from upstream OpenCode.
        // This avoids compressed-body/header mismatches in multi-proxy setups.
        proxyReq.setHeader('accept-encoding', 'identity');
      },
      proxyRes: (proxyRes) => {
        preserveDecodedPayloadLengthHeader(proxyRes.headers);
        for (const key of Object.keys(proxyRes.headers || {})) {
          if (!shouldForwardProxyResponseHeader(key)) {
            delete proxyRes.headers[key];
          }
        }
      },
      error: (err, _req, res) => {
        console.error('[proxy] OpenCode proxy error:', err.message);
        if (res && !res.headersSent && typeof res.status === 'function') {
          res.status(503).json({ error: 'OpenCode service unavailable' });
        }
      },
    },
  });

  // A provider OAuth callback blocks upstream for as long as the user takes to
  // sign in in their browser (device-code polling, or a loopback redirect), so
  // it cannot share the ordinary request deadline. Bounded by the shortest
  // upstream expiry we know of — GitHub device codes last ~15 minutes.
  const INTERACTIVE_OAUTH_TIMEOUT_MS = 15 * 60 * 1000;
  const apiProxy = createApiProxy();
  const interactiveOAuthProxy = createApiProxy(INTERACTIVE_OAUTH_TIMEOUT_MS);

  app.use('/api', async (req, _res, next) => {
    try {
      const rewrittenUrl = await canonicalizeDirectoryQuery(req.url);
      if (rewrittenUrl !== req.url) {
        req.url = rewrittenUrl;
      }
    } catch {
    }
    next();
  });

  app.get('/api/session/:sessionID/message', async (req, res) => {
    try {
      const requestUrl = typeof req.url === 'string' ? req.url : '';
      const upstreamPath = requestUrl.startsWith('/api') ? requestUrl.slice(4) || '/' : requestUrl;
      const headers = collectForwardProxyHeaders(req.headers, getOpenCodeAuthHeaders());
      headers.accept ??= 'application/json';
      headers['accept-encoding'] = 'identity';

      const upstream = await fetch(buildOpenCodeUrl(upstreamPath, ''), {
        method: 'GET',
        headers,
      });
      const upstreamBody = await upstream.text();
      const contentType = upstream.headers.get('content-type')?.toLowerCase() || '';
      const bodyText = upstream.ok && contentType.includes('json')
        ? projectMessageHistoryResponseText(upstreamBody)
        : upstreamBody;

      res.status(upstream.status);
      applyForwardProxyResponseHeaders(upstream.headers, res);
      res.setHeader(DECODED_PAYLOAD_LENGTH_HEADER, String(Buffer.byteLength(bodyText)));
      res.send(bodyText);
    } catch (error) {
      console.error('[proxy] OpenCode message history proxy error:', error?.message ?? error);
      res.status(503).json({ error: 'OpenCode service unavailable' });
    }
  });

  app.post('/api/provider/:providerID/oauth/callback', interactiveOAuthProxy);
  app.post('/api/mcp/:name/auth/authenticate', interactiveOAuthProxy);
  app.use('/api', apiProxy);
};
