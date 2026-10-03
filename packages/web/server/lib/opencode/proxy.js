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
import { getWorktreeBootstrapStatus } from '../git/service.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from './protocol-mode.js';
import {
  resolveUpstreamRequestPath,
  rewriteDirectoryQueryForUpstream,
} from './upstream-v2-paths.js';

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

// The fields a session-list record may carry when it leaves the server (upstream d67dcca2d).
// The isolated-spaces session index runs every record a space reports through it, because a
// space's list is untrusted data; the host's own answers go out unsanitized as before.
const SESSION_LIST_ALLOWED_FIELDS = [
  'id',
  'parentID',
  'projectID',
  'location',
  'subpath',
  'title',
  'agent',
  'model',
  'cost',
  'tokens',
  'outcome',
  'time',
  'metadata',
  'fork',
];

export const sanitizeSessionListItem = (session) => {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return session;
  }

  const sanitized = {};
  for (const key of SESSION_LIST_ALLOWED_FIELDS) {
    if (key in session) {
      sanitized[key] = session[key];
    }
  }

  // Only the revert marker: the staged file list and its snapshot are what make
  // a reverted session's record large.
  const revert = session.revert;
  if (revert && typeof revert === 'object' && !Array.isArray(revert)) {
    const revertMarker = {};
    if (typeof revert.messageID === 'string') {
      revertMarker.messageID = revert.messageID;
    }
    if (typeof revert.partID === 'string') {
      revertMarker.partID = revert.partID;
    }
    if (Object.keys(revertMarker).length > 0) {
      sanitized.revert = revertMarker;
    }
  }

  return sanitized;
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
    readWorktreeBootstrapStatus = getWorktreeBootstrapStatus,
    WORKTREE_READY_TIMEOUT_MS = 5 * 60 * 1000,
    // Isolated spaces, when the feature's switch is on: the merged session list, and the hub
    // whose space events the global SSE stream carries beside the host's. Both absent means
    // the host's own answers go out exactly as before spaces (upstream d67dcca2d).
    mergeSpaceSessionList = null,
    spaceEventHub = null,
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
    let unsubscribeSpaceEvents = null;
    let writeQueue = Promise.resolve(true);
    const sseBoundary = createSseBoundaryTracker();

    req.on('close', closeUpstream);

    try {
      const requestUrl = typeof req.originalUrl === 'string' && req.originalUrl.length > 0
        ? req.originalUrl
        : (typeof req.url === 'string' ? req.url : '');
      let upstreamPath = requestUrl.startsWith('/api') ? requestUrl.slice(4) || '/' : requestUrl;
      // OpenCode 2's `/api/event` is one global stream across all locations and
      // declares no query parameters; the v1 directory scoping does not exist
      // there and undeclared parameters must not reach the upstream validator.
      // (buildOpenCodeUrl renames `/global/event` to the v2 stream endpoint.)
      if (resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2') {
        upstreamPath = upstreamPath.split('?')[0];
      }
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

      // The events of isolated spaces ride the global stream too, one block each, written
      // only between the upstream's own blocks so a block of the host's is never cut
      // (upstream d67dcca2d). A directory in the query or in the header scopes the stream to
      // the host's one directory; the fork's per-directory subscriber lanes keep their
      // space-free answers.
      const isGlobalStream = !new URL(requestUrl, 'http://localhost').searchParams.get('directory') && !req.get('x-opencode-directory');
      const pendingSpaceBlocks = [];
      const flushSpaceBlocks = async () => {
        while (pendingSpaceBlocks.length > 0 && sseBoundary.isAtBoundary() && !abortController.signal.aborted) {
          const canContinue = await enqueueSseWrite(pendingSpaceBlocks.shift());
          if (!canContinue) return false;
        }
        return true;
      };
      if (spaceEventHub && isGlobalStream) {
        unsubscribeSpaceEvents = spaceEventHub.subscribeEvent((event) => {
          if (event.spaceId === null) return;
          pendingSpaceBlocks.push(`data: ${JSON.stringify(event.payload)}\n\n`);
          void flushSpaceBlocks();
        }, { spaces: true });
      }

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
          if (!await flushSpaceBlocks()) {
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
      if (unsubscribeSpaceEvents) {
        unsubscribeSpaceEvents();
        unsubscribeSpaceEvents = null;
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

  // Isolated spaces: the first page of the global list carries every space's sessions after
  // the host's (upstream d67dcca2d, refitted to the fork's list semantics). The fork reads
  // the global list through its own multi-server lanes — a remote server's list arrives on
  // its own lane and never passes here, so a host merge cannot leak into it. A later page
  // (the fork pages by `cursor`), a list scoped to one directory by query or by the
  // `x-opencode-directory` header, and every answer with the switch off fall through to the
  // generic proxy unchanged; a host read that fails falls through too, so the error shape
  // stays the proxy's own.
  app.get('/api/session', async (req, res, next) => {
    if (typeof mergeSpaceSessionList !== 'function') return next();
    const rawUrl = req.originalUrl || req.url || '';
    let listQuery;
    try {
      listQuery = new URL(rawUrl, 'http://localhost').searchParams;
    } catch {
      return next();
    }
    if (listQuery.get('directory') || listQuery.get('cursor') || req.get('x-opencode-directory')) {
      return next();
    }

    try {
      const fetchOpts = {
        method: 'GET',
        headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
        signal: AbortSignal.timeout(10000),
      };
      const globalRes = await fetch(buildOpenCodeUrl('/session', ''), fetchOpts);
      if (!globalRes.ok) return next();
      const hostPayload = await globalRes.json().catch(() => null);
      const hostRecords = Array.isArray(hostPayload)
        ? hostPayload
        : (hostPayload && typeof hostPayload === 'object' && Array.isArray(hostPayload.data) ? hostPayload.data : null);
      if (hostRecords === null) return next();
      res.json(await mergeSpaceSessionList(hostPayload));
    } catch (error) {
      console.log(`[spaces] merged session list failed: ${error?.message ?? error}, falling through`);
      next();
    }
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
  // v1 track: strip the `/api` prefix — OpenCode 1.x serves the bare paths.
  // v2 track: OpenCode 2 serves `/api/...` (its v1-shaped root paths answer
  // 500), so the prefix is kept and v1-only names are mapped to their v2
  // endpoints (`/api/path` → `/api/location`, …) via the shared rename table.
  const proxyPathRewrite = (path) => {
    if (resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) !== 'v2') {
      return path.replace(/^\/api/, '');
    }
    const withoutPrefix = path.startsWith('/api') ? path.slice(4) || '/' : path;
    return resolveUpstreamRequestPath(withoutPrefix, 'v2');
  };
  const createApiProxy = (timeoutMs) => createProxyMiddleware({
    target: resolveProxyTarget(),
    get agent() {
      return resolveOpenCodeProxyAgent();
    },
    changeOrigin: true,
    pathRewrite: proxyPathRewrite,
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

  // Any directory-scoped read can initialize OpenCode's cached project/config,
  // before session.create runs. Hold all upstream requests until Git population
  // finishes, independently of the user's optional setup-script wait.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  app.use('/api', async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    const directory = url.searchParams.get('directory') || req.get('x-opencode-directory');
    if (!directory) return next();

    const deadline = Date.now() + WORKTREE_READY_TIMEOUT_MS;
    try {
      while (!res.destroyed && !res.writableEnded && !req.aborted) {
        const status = await readWorktreeBootstrapStatus(directory);
        if (res.destroyed || res.writableEnded || req.aborted) return;
        if (status.status === 'failed') {
          return res.status(503).json({ error: status.error || 'Worktree bootstrap failed' });
        }
        if (status.status === 'ready' || status.phase === 'git-ready' || status.phase === 'setup-ready') {
          return next();
        }
        if (Date.now() >= deadline) {
          return res.status(503).json({ error: 'Timed out waiting for worktree checkout' });
        }
        await sleep(75);
      }
    } catch (error) {
      next(error);
    }
  });

  // v2 boundary translation (spine finale): OpenCode 2 scopes a request from
  // `?location[directory]=` or the `x-opencode-directory` header and ignores
  // v1's `?directory=` — the request would silently fall back to the server's
  // own working directory. Runs after the worktree gate (which reads the v1
  // parameter) and only rewrites proxied traffic; handlers above that read
  // req.url themselves see the original shape.
  app.use('/api', (req, _res, next) => {
    if (!req.url || !req.url.includes('directory=')) return next();
    if (resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) !== 'v2') return next();
    try {
      const rewritten = rewriteDirectoryQueryForUpstream(req.url, 'v2');
      if (rewritten !== req.url) {
        req.url = rewritten;
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
