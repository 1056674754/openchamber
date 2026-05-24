import { WebSocket } from 'ws';

import {
  MESSAGE_STREAM_WS_HEARTBEAT_INTERVAL_MS,
  sendMessageStreamWsEvent,
  sendMessageStreamWsFrame,
} from '../event-stream/protocol.js';
import { createUpstreamSseReader } from '../event-stream/upstream-reader.js';
import {
  createSseBoundaryTracker,
  waitForSseDrain,
  writeSseChunkWithBackpressure,
} from '../opencode/proxy.js';

const isAbortError = (error) => error?.name === 'AbortError';
const isClientClosedStreamError = (error) => {
  const message = typeof error?.message === 'string' ? error.message : '';
  return (
    message.includes('socket connection was closed') ||
    message.includes('Socket connection was closed')
  );
};

/**
 * Build auth headers for a remote instance based on its auth config.
 */
const buildAuthHeaders = (instance) => {
  const headers = {};
  if (instance.auth?.type === 'password' && instance.auth.value) {
    headers['Authorization'] = `Basic ${Buffer.from(`user:${instance.auth.value}`).toString('base64')}`;
  } else if (instance.auth?.type === 'bearer' && instance.auth.value) {
    headers['Authorization'] = `Bearer ${instance.auth.value}`;
  }
  return headers;
};

const parseLastEventId = (searchParams) => {
  if (typeof searchParams !== 'string' || searchParams.length === 0) {
    return '';
  }
  const raw = searchParams.startsWith('?') ? searchParams.slice(1) : searchParams;
  return new URLSearchParams(raw).get('lastEventId')?.trim() || '';
};

const pipeRemoteGlobalSseToWs = (clientWs, instance, searchParams) => {
  const remoteBase = instance.url.replace(/\/$/, '');
  const controller = new AbortController();
  let reader = null;
  let upstreamConnected = false;

  sendMessageStreamWsFrame(clientWs, {
    type: 'ready',
    scope: 'global',
  });

  const cleanup = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
    reader?.stop();
  };

  const pingInterval = setInterval(() => {
    if (clientWs.readyState !== 1) return;
    try { clientWs.ping(); } catch {}
  }, MESSAGE_STREAM_WS_HEARTBEAT_INTERVAL_MS);

  const heartbeatInterval = setInterval(() => {
    if (!upstreamConnected) return;
    sendMessageStreamWsEvent(
      clientWs,
      { type: 'openchamber:heartbeat', timestamp: Date.now() },
      { directory: 'global' },
    );
  }, MESSAGE_STREAM_WS_HEARTBEAT_INTERVAL_MS);

  clientWs.on('close', () => {
    clearInterval(pingInterval);
    clearInterval(heartbeatInterval);
    upstreamConnected = false;
    cleanup();
  });

  clientWs.on('error', () => {
    cleanup();
    try { clientWs.close(); } catch {}
  });

  reader = createUpstreamSseReader({
    initialLastEventId: parseLastEventId(searchParams),
    signal: controller.signal,
    buildUrl: () => new URL(`${remoteBase}/api/global/event`),
    getHeaders: () => buildAuthHeaders(instance),
    onConnect() {
      upstreamConnected = true;
    },
    onDisconnect() {
      upstreamConnected = false;
    },
    onEvent({ payload, eventId, directory }) {
      sendMessageStreamWsEvent(clientWs, payload, {
        directory: typeof directory === 'string' && directory.length > 0 ? directory : 'global',
        eventId: typeof eventId === 'string' && eventId.length > 0 ? eventId : undefined,
      });
    },
    onError(error) {
      if (controller.signal.aborted) {
        return;
      }
      if (error?.type === 'upstream_unavailable') {
        return;
      }
      if (error?.type === 'stream_error') {
        return;
      }
    },
  });

  void reader.start();
};

/**
 * Bidirectional WS relay between a browser client and a remote OpenChamber instance.
 * @param {import('ws').WebSocket} clientWs
 * @param {object} instance - Remote instance config (url, auth)
 * @param {boolean} isGlobal - Global vs directory-scoped stream
 * @param {string} searchParams - Query string (?lastEventId=...&directory=...)
 */
export const pipeRemoteWs = (clientWs, instance, isGlobal, searchParams) => {
  if (isGlobal) {
    pipeRemoteGlobalSseToWs(clientWs, instance, searchParams);
    return;
  }

  const remoteBase = instance.url.replace(/\/$/, '');
  const remotePath = isGlobal ? '/api/global/event/ws' : '/api/event/ws';
  const remoteWsUrl = remoteBase.replace(/^http/, 'ws') + remotePath + (searchParams || '');

  const headers = buildAuthHeaders(instance);

  let remoteWs;
  try {
    remoteWs = new WebSocket(remoteWsUrl, { headers });
  } catch (error) {
    console.error('[remote-ws] Failed to connect to remote instance:', error?.message ?? error);
    try { clientWs.close(1011, 'Remote connection failed'); } catch {}
    return;
  }

  const cleanup = () => {
    try { remoteWs.close(); } catch {}
    try { clientWs.close(); } catch {}
  };

  remoteWs.on('message', (data) => {
    if (clientWs.readyState === 1) {
      try { clientWs.send(data); } catch {}
    }
  });

  clientWs.on('message', (data) => {
    if (remoteWs.readyState === 1) {
      try { remoteWs.send(data); } catch {}
    }
  });

  remoteWs.on('close', () => {
    try { clientWs.close(); } catch {}
  });

  clientWs.on('close', () => {
    try { remoteWs.close(); } catch {}
  });

  remoteWs.on('error', (error) => {
    console.error('[remote-ws] Upstream error:', error?.message ?? error);
    cleanup();
  });

  clientWs.on('error', (error) => {
    console.error('[remote-ws] Client error:', error?.message ?? error);
    cleanup();
  });
};

export const parseRemoteWsPath = (pathname) => {
  if (!pathname.startsWith('/api/remote/')) {
    return null;
  }

  const isGlobal = pathname.endsWith('/global/event/ws');
  const isDirectory = pathname.endsWith('/event/ws');

  if (!isGlobal && !isDirectory) {
    return null;
  }

  const parts = pathname.split('/');
  // /api/remote/{instanceId}/... → parts[0]='', parts[1]='api', parts[2]='remote', parts[3]=instanceId
  if (parts.length < 4) {
    return null;
  }

  const instanceId = parts[3];
  if (!instanceId || instanceId.length === 0) {
    return null;
  }

  return { instanceId, isGlobal };
};

/**
 * Forward an SSE request from the browser to a remote OpenChamber instance.
 *
 * This is a thin pipe: each browser client gets its own fetch to the remote.
 * No hub or subscriber model needed — just proxy the upstream stream directly,
 * following the same pattern as `forwardSseRequest` in opencode/proxy.js.
 */
const forwardRemoteSseRequest = async (req, res, { instance, upstreamPath }) => {
  const abortController = new AbortController();
  const closeUpstream = () => abortController.abort();
  let upstream = null;
  let reader = null;
  let heartbeatTimer = null;
  let writeQueue = Promise.resolve(true);
  const sseBoundary = createSseBoundaryTracker();

  req.on('close', closeUpstream);

  try {
    const headers = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...buildAuthHeaders(instance),
    };

    if (req.headers['last-event-id']) {
      headers['Last-Event-ID'] = req.headers['last-event-id'];
    }

    upstream = await fetch(`${instance.url}${upstreamPath}`, {
      method: 'GET',
      headers,
      signal: abortController.signal,
    });

    if (!upstream.ok) {
      if (!res.headersSent) {
        res
          .status(upstream.status)
          .json({ error: 'upstream_unavailable', status: upstream.status });
      }
      return;
    }

    const contentType =
      upstream.headers.get('content-type') || 'text/event-stream';
    const isEventStream = contentType
      .toLowerCase()
      .includes('text/event-stream');

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

    // Disable TCP Nagle so small SSE chunks are sent immediately.
    if (res.socket && typeof res.socket.setNoDelay === 'function') {
      res.socket.setNoDelay(true);
    }

    const SSE_HEARTBEAT_INTERVAL_MS = 20_000;

    const scheduleHeartbeat = () => {
      heartbeatTimer = setTimeout(async () => {
        if (
          abortController.signal.aborted ||
          res.writableEnded ||
          res.destroyed
        ) {
          return;
        }
        if (!sseBoundary.isAtBoundary()) {
          scheduleHeartbeat();
          return;
        }
        const canContinue = await enqueueSseWrite(':heartbeat\n\n');
        if (canContinue) {
          scheduleHeartbeat();
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);
    };

    const enqueueSseWrite = (value) => {
      writeQueue = writeQueue
        .catch(() => false)
        .then((canContinue) => {
          if (!canContinue) {
            return false;
          }
          return writeSseChunkWithBackpressure(
            res,
            value,
            abortController.signal,
          );
        });
      return writeQueue;
    };

    scheduleHeartbeat();

    reader = upstream.body.getReader();
    while (!abortController.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value && value.length > 0) {
        sseBoundary.observe(value);
        const canContinue = await enqueueSseWrite(value);
        if (!canContinue) {
          break;
        }
      }
    }

    res.end();
  } catch (error) {
    if (
      isAbortError(error) ||
      abortController.signal.aborted ||
      res.writableEnded ||
      res.destroyed ||
      isClientClosedStreamError(error)
    ) {
      return;
    }
    console.error(
      `[remote-sse] SSE relay error for instance "${req.params.instanceId}":`,
      error?.message ?? error,
    );
    if (!res.headersSent) {
      res.status(503).json({ error: 'Remote SSE relay error' });
    } else {
      res.end();
    }
  } finally {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
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
      // Best-effort cleanup
    }
  }
};

/**
 * Register SSE relay routes for remote instances.
 *
 * Must be registered BEFORE the generic remote proxy so Express matches
 * the more specific SSE paths first.
 *
 * Routes:
 *   GET /api/remote/:instanceId/global/event — global SSE relay
 *   GET /api/remote/:instanceId/event         — directory-scoped SSE relay
 */
export const registerRemoteSseRelay = (app, runtime) => {
  // Global SSE relay
  app.get('/api/remote/:instanceId/global/event', (req, res) => {
    const { instanceId } = req.params;
    const instance = runtime.getInstanceSync(instanceId);

    if (!instance) {
      return res.status(404).json({ error: 'Remote instance not found' });
    }

    if (!instance.enabled || !runtime.isHealthy(instanceId)) {
      return res
        .status(503)
        .json({ error: 'Remote instance not available', instanceId });
    }

    void forwardRemoteSseRequest(req, res, {
      instance,
      upstreamPath: '/api/global/event',
    });
  });

  // Directory-scoped SSE relay
  app.get('/api/remote/:instanceId/event', (req, res) => {
    const { instanceId } = req.params;
    const instance = runtime.getInstanceSync(instanceId);

    if (!instance) {
      return res.status(404).json({ error: 'Remote instance not found' });
    }

    if (!instance.enabled || !runtime.isHealthy(instanceId)) {
      return res
        .status(503)
        .json({ error: 'Remote instance not available', instanceId });
    }

    // Preserve query string (e.g. ?directory=...)
    const queryString =
      typeof req.url === 'string' && req.url.includes('?')
        ? req.url.slice(req.url.indexOf('?'))
        : '';

    void forwardRemoteSseRequest(req, res, {
      instance,
      upstreamPath: `/api/event${queryString}`,
    });
  });
};
