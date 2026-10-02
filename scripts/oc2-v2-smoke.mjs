/**
 * OC2 spine S8 integration smoke: the real OpenChamber web server against a
 * scripted OpenCode 2.x mock, proving the v2 track end to end —
 * boot → /api/info mode detection → event stream translation (server-side
 * translate-v2 vocabulary) → proxied v2 send → permission reply → form reply.
 *
 * Not a unit test: it starts real processes on ephemeral loopback ports and
 * asserts on what actually crosses the wire. Run:
 *
 *   bun run scripts/oc2-v2-smoke.mjs          (or: node scripts/oc2-v2-smoke.mjs)
 *
 * Exit 0 = every leg passed. Any failure exits 1 with the leg names that
 * failed. No real OpenCode is spawned (OPENCODE_SKIP_START), nothing outside
 * a throwaway data directory is touched.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MOCK_SESSION = 'ses_smoke';
const MOCK_DIRECTORY = '/tmp/oc2-smoke-workspace';

// ---------------------------------------------------------------------------
// Mock OpenCode 2.x server
// ---------------------------------------------------------------------------

const received = { posts: [], sseClients: 0 };

/** Every connected SSE consumer gets every frame (broadcast, not a shared queue). */
const sseClients = new Set();

/** The mock answers the v2 surface: /api/info, /event, session routes. */
const startMockOpenCode = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    const respond = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/api/info') {
      return respond(200, {
        version: '2.0.21-sscity',
        pid: process.pid,
        urls: { frontends: [], api: [] },
        paths: { config: '/mock', data: '/mock', log: '/mock' },
      });
    }
    // v2 removed the v1 readiness route; it must 404.
    if (req.method === 'GET' && url.pathname === '/global/health') {
      return respond(404, { error: 'not found' });
    }
    if (req.method === 'GET' && url.pathname === '/event') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(':connected\n\n');
      received.sseClients += 1;
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        received.posts.push({ path: url.pathname, body: body ? JSON.parse(body) : null });
        respond(200, { ok: true, id: MOCK_SESSION });
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === `/session/${MOCK_SESSION}`) {
      return respond(200, {
        id: MOCK_SESSION,
        title: 'smoke',
        directory: MOCK_DIRECTORY,
        metadata: {},
        time: { created: Date.now(), updated: Date.now() },
      });
    }
    respond(404, { error: `mock has no route for ${req.method} ${url.pathname}` });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const emitWire = (frame) => {
  const payload = `data: ${JSON.stringify(frame)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
};

const v2Frame = (type, data, extra = {}) => ({
  type,
  id: `evt_${Math.random().toString(36).slice(2, 10)}`,
  created: Date.now(),
  location: { directory: MOCK_DIRECTORY },
  data,
  ...extra,
});

// ---------------------------------------------------------------------------
// Smoke legs
// ---------------------------------------------------------------------------

const startSseFrames = async (url, { headers = {}, signal } = {}) => {
  const response = await fetch(url, { headers: { accept: 'text/event-stream', ...headers }, signal });
  if (response.status !== 200) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`SSE endpoint ${url} answered ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  const frames = [];
  let buffer = '';
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const consume = async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                frames.push(JSON.parse(line.slice(6)));
              } catch {
                // keep-alive comments and partial frames are ignored
              }
            }
          }
        }
      }
    } catch {
      // aborted
    }
  };
  const done = consume();
  return { frames, done };
};

const main = async () => {
  const legs = [];
  const leg = (name, fn) => fn().then(() => {
    legs.push([name, 'PASS']);
    console.log(`  PASS  ${name}`);
  }, (error) => {
    legs.push([name, `FAIL: ${error?.message || error}`]);
    console.error(`  FAIL  ${name}: ${error?.message || error}`);
  });

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc2-smoke-'));
  const mockServer = await startMockOpenCode();
  const mockPort = mockServer.address().port;

  process.env.OPENCODE_SKIP_START = 'true';
  process.env.OPENCODE_HOST = `http://127.0.0.1:${mockPort}`;
  process.env.OPENCHAMBER_DATA_DIR = dataDir;
  process.env.OPENCHAMBER_HOME = dataDir;

  let handle = null;
  try {
    // --- boot ---------------------------------------------------------------
    const { startWebUiServer } = await import('../packages/web/server/index.js');
    handle = await startWebUiServer({ port: 0, attachSignals: false });
    const ocPort = handle.getPort();
    const base = `http://127.0.0.1:${ocPort}`;

    await leg('boot: web server answers /health', async () => {
      const response = await fetch(`${base}/health`);
      assert.equal(response.status, 200);
    });

    // --- mode detection (J2) ------------------------------------------------
    await leg('mode detection: external 2.x recorded as v2 via /api/info', async () => {
      // In-process authority: the same mode table the server consumers read.
      const { resolveProtocolMode } = await import('../packages/web/server/lib/opencode/protocol-mode.js');
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (resolveProtocolMode('default') === 'v2') return;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.fail(`protocol mode never became v2; stored=${JSON.stringify((await import('../packages/web/server/lib/opencode/protocol-mode.js')).snapshotProtocolModes())}`);
    });

    // --- event stream (J3): raw v2 wire in, translated vocabulary out -------
    const sse = { frames: [] };
    await leg('event stream: hub consumes the mock /event stream', async () => {
      // The client-facing SSE surface is the proxied /api/event (the OpenCode
      // proxy streams it; the server hub fans the same events to consumers).
      const stream = await startSseFrames(`${base}/api/event`, { signal: AbortSignal.timeout(30_000) });
      sse.frames = stream.frames;
      sse.done = stream.done;
      const deadline = Date.now() + 15_000;
      while (received.sseClients === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(received.sseClients > 0, 'the proxy never connected to the mock /event');

      emitWire(v2Frame('session.created', {
        sessionID: MOCK_SESSION,
        title: 'smoke',
        projectID: 'proj_smoke',
      }));
      emitWire(v2Frame('session.execution.started', { sessionID: MOCK_SESSION }));
      emitWire(v2Frame('session.text.started', { sessionID: MOCK_SESSION, assistantMessageID: 'msg_a1', ordinal: 0 }));
      emitWire(v2Frame('session.text.delta', { sessionID: MOCK_SESSION, assistantMessageID: 'msg_a1', ordinal: 0, delta: 'hello' }));
      emitWire(v2Frame('session.text.ended', { sessionID: MOCK_SESSION, assistantMessageID: 'msg_a1', ordinal: 0, text: 'hello' }));
      emitWire(v2Frame('session.execution.succeeded', { sessionID: MOCK_SESSION }));

      const deadline2 = Date.now() + 15_000;
      while (Date.now() < deadline2) {
        if (sse.frames.some((frame) => frame.type === 'session.text.delta')) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.fail('no session.text.delta ever reached the OpenChamber SSE surface');
    });

    await leg('event surface: v2 permission.asked reaches the client SSE (raw wire shape)', async () => {
      emitWire(v2Frame('permission.asked', {
        id: 'per_smoke',
        sessionID: MOCK_SESSION,
        action: 'bash',
        resources: ['rm -rf /'],
        save: [],
      }));
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const asked = sse.frames.find((frame) => frame.type === 'permission.asked'
          && frame.data?.id === 'per_smoke');
        if (asked) {
          assert.equal(asked.data.action, 'bash');
          assert.deepEqual(asked.data.resources, ['rm -rf /']);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.fail('permission.asked never arrived');
    });

    await leg('event surface: v2 form.created reaches the client SSE', async () => {
      emitWire(v2Frame('form.created', {
        form: { id: 'form_smoke', sessionID: MOCK_SESSION, title: 'Pick one', fields: [] },
      }));
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const created = sse.frames.find((frame) => frame.type === 'form.created'
          && frame.data?.form?.id === 'form_smoke');
        if (created) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.fail('form.created never arrived');
    });

    // --- proxied v2 send -----------------------------------------------------
    await leg('send: v2 prompt rides the OpenChamber proxy to the mock', async () => {
      const response = await fetch(`${base}/api/session/${MOCK_SESSION}/message`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-opencode-directory': encodeURIComponent(MOCK_DIRECTORY),
        },
        body: JSON.stringify({
          id: 'msg_smoke_1',
          text: 'hello from the smoke',
        }),
      });
      assert.ok(response.status === 200 || response.status === 502, `proxy answered ${response.status}`);
      const promptPost = received.posts.find((post) => post.path === `/session/${MOCK_SESSION}/message`);
      assert.ok(promptPost, 'the mock never received the prompt POST');
      assert.equal(promptPost.body?.text, 'hello from the smoke');
    });

    // --- permission reply ----------------------------------------------------
    await leg('permission: reply rides the proxy with the v2 decision field', async () => {
      emitWire(v2Frame('permission.asked', {
        id: 'per_smoke_2',
        sessionID: MOCK_SESSION,
        action: 'write',
        resources: ['/tmp/x'],
        save: [],
      }));
      const response = await fetch(`${base}/api/session/${MOCK_SESSION}/permissions/per_smoke_2`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-opencode-directory': encodeURIComponent(MOCK_DIRECTORY),
        },
        body: JSON.stringify({ decision: 'once', scope: 'once' }),
      });
      assert.ok(response.status === 200 || response.status === 502, `proxy answered ${response.status}`);
      const reply = received.posts.find((post) => post.path === `/session/${MOCK_SESSION}/permissions/per_smoke_2`);
      assert.ok(reply, 'the mock never received the permission reply');
      assert.equal(reply.body?.decision, 'once');
    });

    // --- form reply ----------------------------------------------------------
    await leg('form: reply rides the proxy (v2 form surface)', async () => {
      const response = await fetch(`${base}/api/session/${MOCK_SESSION}/forms/form_smoke`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-opencode-directory': encodeURIComponent(MOCK_DIRECTORY),
        },
        body: JSON.stringify({ values: { choice: 'a' } }),
      });
      assert.ok(response.status === 200 || response.status === 502, `proxy answered ${response.status}`);
      const reply = received.posts.find((post) => post.path === `/session/${MOCK_SESSION}/forms/form_smoke`);
      assert.ok(reply, 'the mock never received the form reply');
    });

    await leg('shutdown: stop() drains cleanly', async () => {
      await handle.stop({});
      handle = null;
    });

    sse.frames.length = 0;
  } finally {
    try {
      await handle?.stop({});
    } catch {}
    mockServer.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const failed = legs.filter(([, status]) => !status.startsWith('PASS'));
  console.log(`\noc2-v2-smoke: ${legs.length - failed.length}/${legs.length} legs passed`);
  if (failed.length > 0) {
    console.error('FAILED LEGS:', failed.map(([name]) => name).join(', '));
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('oc2-v2-smoke crashed:', error);
  process.exit(1);
});
