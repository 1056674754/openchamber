import { afterEach, describe, expect, test } from 'bun:test';
import http from 'node:http';
import net from 'node:net';

import { createDevTunnelClient } from './client.js';
import { createDevTunnelRuntime, isDevTunnelPath } from './runtime.js';

const cleanup = [];

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const trackSockets = (server) => {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return sockets;
};

const stopServer = async (server, sockets) => {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    server.close(finish);
    server.closeAllConnections?.();
    setTimeout(finish, 500);
  });
};

const startDevServer = async (handler) => {
  const server = http.createServer(handler);
  const sockets = trackSockets(server);
  const port = await listen(server);
  cleanup.push(() => stopServer(server, sockets));
  return port;
};

const startHost = async ({ allowedPorts, auth = null, discoveryOk = true }) => {
  const server = http.createServer((_req, res) => res.end('host'));
  const sockets = trackSockets(server);
  const port = await listen(server);
  const runtime = createDevTunnelRuntime({
    server,
    discoverDevServers: async () => discoveryOk
      ? { ok: true, servers: allowedPorts.map((value) => ({ port: value })) }
      : { ok: false, reason: 'no-listener-source' },
    uiAuthController: auth ?? { enabled: false },
    isRequestOriginAllowed: async (req) => req.headers.origin === 'http://allowed.example',
    rejectWebSocketUpgrade: (socket, status, message) => {
      socket.write(`HTTP/1.1 ${status} ${message}\r\n\r\n`);
      socket.destroy();
    },
    logger: { warn: () => {} },
  });
  cleanup.push(async () => {
    runtime.dispose();
    await stopServer(server, sockets);
  });
  return { baseUrl: `http://127.0.0.1:${port}`, runtime };
};

const httpGet = (port, path = '/') => new Promise((resolve, reject) => {
  const request = http.get({ host: '127.0.0.1', port, path }, (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
  });
  request.on('error', reject);
  request.setTimeout(3_000, () => request.destroy(new Error('timeout')));
});

const expectTunnelUnavailable = async (port) => {
  try {
    const response = await httpGet(port);
    expect(response.status).not.toBe(200);
  } catch (error) {
    expect(error).toBeTruthy();
  }
};

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});

describe('dev tunnel path', () => {
  test('claims only its own WebSocket route', () => {
    expect(isDevTunnelPath('/api/dev-tunnel?port=5173')).toBe(true);
    expect(isDevTunnelPath('/api/terminal/ws')).toBe(false);
  });
});

describe('dev tunnel end to end', () => {
  test('pipes an allowed dev server without rewriting its response', async () => {
    const devPort = await startDevServer((req, res) => {
      res.setHeader('x-dev-header', 'kept');
      res.end(`path:${req.url}`);
    });
    const host = await startHost({ allowedPorts: [devPort] });
    const client = createDevTunnelClient({ logger: { warn: () => {} } });
    cleanup.push(() => client.closeAll());

    const { localPort } = await client.open({ baseUrl: host.baseUrl, port: devPort });
    const response = await httpGet(localPort, '/page?q=1');

    expect(response.body).toBe('path:/page?q=1');
    expect(response.headers['x-dev-header']).toBe('kept');
  });

  test('reuses listeners and closes them deterministically', async () => {
    const devPort = await startDevServer((_req, res) => res.end('ok'));
    const host = await startHost({ allowedPorts: [devPort] });
    const client = createDevTunnelClient({ logger: { warn: () => {} } });

    const first = await client.open({ baseUrl: host.baseUrl, port: devPort });
    const second = await client.open({ baseUrl: host.baseUrl, port: devPort });

    expect(second).toEqual({ localPort: first.localPort, reused: true });
    expect(client.close({ baseUrl: host.baseUrl, port: devPort })).toBe(true);
    expect(client.list()).toEqual([]);
  });

  test('refuses ports absent from discovery and discovery failures', async () => {
    const secretPort = await startDevServer((_req, res) => res.end('secret'));
    for (const discoveryOk of [true, false]) {
      const host = await startHost({ allowedPorts: [], discoveryOk });
      const client = createDevTunnelClient({ logger: { warn: () => {} } });
      cleanup.push(() => client.closeAll());
      const { localPort } = await client.open({ baseUrl: host.baseUrl, port: secretPort });
      await expectTunnelUnavailable(localPort);
    }
  });

  test('rejects invalid ports and non-http base URLs before binding', async () => {
    const client = createDevTunnelClient({ logger: { warn: () => {} } });
    await expect(client.open({ baseUrl: 'http://127.0.0.1:1', port: 0 })).rejects.toThrow('valid remote port');
    await expect(client.open({ baseUrl: 'openchamber-ui://index', port: 5173 })).rejects.toThrow('must be http(s)');
    expect(client.list()).toEqual([]);
  });

  test('bounds bytes while an upstream handshake is stalled', async () => {
    const stalled = net.createServer(() => {});
    const sockets = trackSockets(stalled);
    const stalledPort = await listen(stalled);
    cleanup.push(() => stopServer(stalled, sockets));
    const client = createDevTunnelClient({ logger: { warn: () => {} }, handshakeTimeoutMs: 200 });
    cleanup.push(() => client.closeAll());
    const { localPort } = await client.open({ baseUrl: `http://127.0.0.1:${stalledPort}`, port: 4321 });

    const closed = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: localPort }, () => {
        socket.write(Buffer.alloc(300 * 1024));
      });
      socket.on('close', () => resolve(true));
      socket.on('error', () => resolve(true));
      setTimeout(() => resolve(false), 2_000);
    });

    expect(closed).toBe(true);
  });
});

describe('dev tunnel authentication', () => {
  const clientAuth = {
    enabled: true,
    resolveAuthContext: async (req) => req.headers.authorization === 'Bearer good' ? { type: 'client' } : null,
  };

  test('accepts origin-less paired-client auth', async () => {
    const devPort = await startDevServer((_req, res) => res.end('ok'));
    const host = await startHost({ allowedPorts: [devPort], auth: clientAuth });
    const client = createDevTunnelClient({ logger: { warn: () => {} } });
    cleanup.push(() => client.closeAll());

    const { localPort } = await client.open({
      baseUrl: host.baseUrl,
      port: devPort,
      headers: { Authorization: 'Bearer good' },
    });

    expect((await httpGet(localPort)).body).toBe('ok');
  });

  test('rejects missing credentials and non-client sessions without an origin', async () => {
    const devPort = await startDevServer((_req, res) => res.end('ok'));
    for (const auth of [clientAuth, { enabled: true, resolveAuthContext: async () => ({ type: 'session' }) }]) {
      const host = await startHost({ allowedPorts: [devPort], auth });
      const client = createDevTunnelClient({ logger: { warn: () => {} } });
      cleanup.push(() => client.closeAll());
      const { localPort } = await client.open({ baseUrl: host.baseUrl, port: devPort });
      await expectTunnelUnavailable(localPort);
    }
  });

  test('keeps the normal Origin check for browser-like callers', async () => {
    const devPort = await startDevServer((_req, res) => res.end('ok'));
    const host = await startHost({ allowedPorts: [devPort], auth: clientAuth });
    const client = createDevTunnelClient({ logger: { warn: () => {} } });
    cleanup.push(() => client.closeAll());
    const { localPort } = await client.open({
      baseUrl: host.baseUrl,
      port: devPort,
      headers: { Authorization: 'Bearer good', Origin: 'http://evil.example' },
    });

    await expectTunnelUnavailable(localPort);
  });
});
