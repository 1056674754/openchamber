import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import express from 'express';
import path from 'path';

import { createSseBoundaryTracker, registerOpenCodeProxy, writeSseChunkWithBackpressure } from './lib/opencode/proxy.js';
import { recordProtocolMode, resetProtocolModes } from './lib/opencode/protocol-mode.js';

const listen = (app, host = '127.0.0.1') => new Promise((resolve, reject) => {
  const server = app.listen(0, host, () => resolve(server));
  server.once('error', reject);
});

const closeServer = (server) => new Promise((resolve, reject) => {
  if (!server) {
    resolve();
    return;
  }
  server.close((error) => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  });
});

describe('OpenCode proxy SSE forwarding', () => {
  let upstreamServer;
  let proxyServer;

  afterEach(async () => {
    await closeServer(proxyServer);
    await closeServer(upstreamServer);
    proxyServer = undefined;
    upstreamServer = undefined;
  });

  it('forwards event streams with nginx-safe headers', async () => {
    let seenAuthorization = null;

    const upstream = express();
    upstream.get('/global/event', (req, res) => {
      seenAuthorization = req.headers.authorization ?? null;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'private, max-age=0');
      res.setHeader('X-Upstream-Test', 'ok');
      res.write('data: {"ok":true}\n\n');
      res.end();
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/global/event`, {
      headers: { Accept: 'text/event-stream' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('x-upstream-test')).toBe('ok');
    expect(await response.text()).toBe('data: {"ok":true}\n\n');
    expect(seenAuthorization).toBe('Bearer test-token');
  });

  it('closes downstream SSE when the OpenCode upstream stalls despite proxy heartbeats', async () => {
    let stallTimeoutReads = 0;
    const upstream = express();
    upstream.get('/global/event', (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      setTimeout(() => res.write(':upstream-alive\n\n'), 40);
      setTimeout(() => res.write('data: still-alive\n\n'), 80);
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      SSE_HEARTBEAT_INTERVAL_MS: 10,
      getSseUpstreamStallTimeoutMs: () => {
        stallTimeoutReads += 1;
        return stallTimeoutReads === 1 ? 50 : 100;
      },
      getRuntime: () => ({
        openCodePort: upstreamPort,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/global/event`, {
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.timeout(2000),
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('data: {"heartbeat":true}\n\n');
    expect(body).toContain(':upstream-alive\n\n');
    expect(body).toContain('data: still-alive\n\n');
    expect(stallTimeoutReads).toBeGreaterThanOrEqual(3);
  });

  it('waits for drain when writing to a slow SSE response', async () => {
    const writes = [];
    const res = new EventEmitter();
    res.writableEnded = false;
    res.destroyed = false;
    res.write = (value) => {
      writes.push(value);
      return false;
    };
    const controller = new AbortController();

    const write = writeSseChunkWithBackpressure(res, Buffer.from('data: {"ok":true}\n\n'), controller.signal);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toHaveLength(1);

    res.emit('drain');

    await expect(write).resolves.toBe(true);
  });

  it('tracks whether a raw SSE stream is between event blocks', () => {
    const tracker = createSseBoundaryTracker();

    expect(tracker.isAtBoundary()).toBe(true);
    expect(tracker.observe(Buffer.from('id: evt-1\n'))).toBe(false);
    expect(tracker.observe(Buffer.from('data: {"ok"'))).toBe(false);
    expect(tracker.observe(Buffer.from(':true}\n'))).toBe(false);
    expect(tracker.observe(Buffer.from('\n'))).toBe(true);
    expect(tracker.observe(Buffer.from('data: next\r\n\r\n'))).toBe(true);
  });

  it('routes generic API requests through external OpenCode base URL', async () => {
    const upstream = express();
    upstream.get('/config/providers', (_req, res) => {
      res.json({ ok: true, source: 'external-host' });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: 3902,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, source: 'external-host' });
  });

  it('projects unused diff snapshots out of message history before sending it to the UI', async () => {
    const upstream = express();
    upstream.get('/session/:sessionID/message', (_req, res) => {
      res.setHeader('X-Next-Cursor', 'cursor-older');
      res.json([{
        info: {
          id: 'msg_user',
          role: 'user',
          summary: {
            additions: 4,
            deletions: 2,
            files: 1,
            diffs: [{
              file: 'large.ts',
              before: 'b'.repeat(400_000),
              after: 'a'.repeat(400_000),
              patch: 'p'.repeat(120_000),
            }],
          },
        },
        parts: [],
      }]);
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(
      `http://127.0.0.1:${proxyPort}/api/session/ses_1/message?directory=%2Frepo&limit=30`,
    );
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);
    const diff = body[0].info.summary.diffs[0];

    expect(diff.before).toBeUndefined();
    expect(diff.after).toBeUndefined();
    expect(diff.patch).toHaveLength(100_000);
    expect(body[0].info.summary.additions).toBe(4);
    expect(response.headers.get('x-next-cursor')).toBe('cursor-older');
    expect(response.headers.get('x-openchamber-decoded-content-length')).toBe(
      String(Buffer.byteLength(bodyText)),
    );
  });

  it('exempts interactive provider OAuth callbacks from the ordinary proxy timeout', async () => {
    const upstream = express();
    // Stands in for upstream blocking until the user finishes signing in.
    upstream.post('/provider/:providerID/oauth/callback', async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      res.json(true);
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/provider/github-copilot/oauth/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 0 }),
      signal: AbortSignal.timeout(5000),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBe(true);
  });
});

describe('OpenCode proxy v2 boundary translation', () => {
  let upstreamServer;
  let proxyServer;

  const setUp = async ({ seen }) => {
    const upstream = express();
    const record = (tag) => (req, res) => {
      seen.push({ tag, url: req.url });
      res.json({ ok: true, tag });
    };
    upstream.get('/api/session', record('v2-session'));
    upstream.get('/api/session/active', record('v2-session-active'));
    upstream.get('/api/location', record('v2-location'));
    upstream.get('/session', record('v1-session'));
    upstream.get('/session/status', record('v1-session-status'));
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
      readWorktreeBootstrapStatus: async () => ({ status: 'ready' }),
    });
    proxyServer = await listen(app);
    return proxyServer.address().port;
  };

  afterEach(async () => {
    await closeServer(proxyServer);
    await closeServer(upstreamServer);
    proxyServer = undefined;
    upstreamServer = undefined;
    resetProtocolModes();
  });

  it('keeps the /api prefix, maps renamed endpoints, and moves the directory query on the v2 track', async () => {
    recordProtocolMode('default', { mode: 'v2' });
    const seen = [];
    const proxyPort = await setUp({ seen });

    const listed = await fetch(`http://127.0.0.1:${proxyPort}/api/session?directory=/tmp/proj`, { signal: AbortSignal.timeout(5000) });
    expect(listed.status).toBe(200);
    const located = await fetch(`http://127.0.0.1:${proxyPort}/api/path?directory=/tmp/proj`, { signal: AbortSignal.timeout(5000) });
    expect(located.status).toBe(200);
    const status = await fetch(`http://127.0.0.1:${proxyPort}/api/session/status`, { signal: AbortSignal.timeout(5000) });
    expect(status.status).toBe(200);

    expect(seen).toEqual([
      { tag: 'v2-session', url: '/api/session?location%5Bdirectory%5D=%2Ftmp%2Fproj' },
      { tag: 'v2-location', url: '/api/location?location%5Bdirectory%5D=%2Ftmp%2Fproj' },
      { tag: 'v2-session-active', url: '/api/session/active' },
    ]);
  });

  it('strips the /api prefix and keeps ?directory= verbatim on the v1 track', async () => {
    const seen = [];
    const proxyPort = await setUp({ seen });

    const listed = await fetch(`http://127.0.0.1:${proxyPort}/api/session?directory=/tmp/proj`, { signal: AbortSignal.timeout(5000) });
    expect(listed.status).toBe(200);
    const status = await fetch(`http://127.0.0.1:${proxyPort}/api/session/status`, { signal: AbortSignal.timeout(5000) });
    expect(status.status).toBe(200);

    expect(seen).toEqual([
      { tag: 'v1-session', url: '/session?directory=/tmp/proj' },
      { tag: 'v1-session-status', url: '/session/status' },
    ]);
  });
});
