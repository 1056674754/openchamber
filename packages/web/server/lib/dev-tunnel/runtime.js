import net from 'node:net';
import { WebSocketServer } from 'ws';

const DEV_TUNNEL_WS_PATH = '/api/dev-tunnel';
const MAX_CONCURRENT_SOCKETS = 64;
const CONNECT_TIMEOUT_MS = 5_000;
const BACKPRESSURE_BYTES = 1_000_000;

const parseRequestedPort = (url) => {
  try {
    const parsed = new URL(String(url || ''), 'http://localhost');
    if (parsed.pathname !== DEV_TUNNEL_WS_PATH) return null;
    const port = Number.parseInt(parsed.searchParams.get('port') || '', 10);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
};

export const isDevTunnelPath = (url) => {
  try {
    return new URL(String(url || ''), 'http://localhost').pathname === DEV_TUNNEL_WS_PATH;
  } catch {
    return false;
  }
};

export function createDevTunnelRuntime({
  server,
  discoverDevServers,
  uiAuthController,
  isRequestOriginAllowed,
  rejectWebSocketUpgrade,
  logger = console,
}) {
  const wsServer = new WebSocketServer({ noServer: true });
  let openSockets = 0;

  const isAllowedPort = async (port) => {
    const result = await discoverDevServers();
    return Boolean(result?.ok && result.servers.some((entry) => entry.port === port));
  };

  wsServer.on('connection', (socket, req) => {
    const port = parseRequestedPort(req.url);
    if (port === null) {
      socket.close(1008, 'Invalid port');
      return;
    }

    openSockets += 1;
    const upstream = net.connect({ host: '127.0.0.1', port });
    upstream.setNoDelay(true);
    let settled = false;
    const teardown = () => {
      if (settled) return;
      settled = true;
      openSockets -= 1;
      try { upstream.destroy(); } catch { /* already gone */ }
      try { socket.terminate(); } catch { /* already closing */ }
    };

    const connectTimer = setTimeout(() => {
      if (!upstream.connecting) return;
      logger.warn?.(`[dev-tunnel] timed out connecting to 127.0.0.1:${port}`);
      teardown();
    }, CONNECT_TIMEOUT_MS);
    upstream.on('connect', () => clearTimeout(connectTimer));
    upstream.on('data', (chunk) => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(chunk);
      if (socket.bufferedAmount <= BACKPRESSURE_BYTES) return;
      upstream.pause();
      const resume = () => {
        if (settled) return;
        if (socket.bufferedAmount > BACKPRESSURE_BYTES) {
          setTimeout(resume, 20);
          return;
        }
        upstream.resume();
      };
      setTimeout(resume, 20);
    });
    upstream.on('error', () => { clearTimeout(connectTimer); teardown(); });
    upstream.on('close', () => { clearTimeout(connectTimer); teardown(); });
    socket.on('message', (data) => {
      if (!upstream.destroyed) upstream.write(data);
    });
    socket.on('close', teardown);
    socket.on('error', teardown);
  });

  const upgradeHandler = (req, socket, head) => {
    if (!isDevTunnelPath(req.url)) return;
    void (async () => {
      try {
        if (uiAuthController?.enabled) {
          const auth = await uiAuthController.resolveAuthContext(req, null, { allowUrlToken: false });
          if (!auth) {
            rejectWebSocketUpgrade(socket, 401, 'UI authentication required');
            return;
          }
          const hasOrigin = typeof req.headers?.origin === 'string' && req.headers.origin.trim() !== '';
          if (hasOrigin) {
            if (!await isRequestOriginAllowed(req)) {
              rejectWebSocketUpgrade(socket, 403, 'Invalid origin');
              return;
            }
          } else if (auth.type !== 'client') {
            rejectWebSocketUpgrade(socket, 403, 'Client authentication required');
            return;
          }
        }

        const port = parseRequestedPort(req.url);
        if (port === null) {
          rejectWebSocketUpgrade(socket, 400, 'Invalid port');
          return;
        }
        if (openSockets >= MAX_CONCURRENT_SOCKETS) {
          rejectWebSocketUpgrade(socket, 503, 'Too many tunnel connections');
          return;
        }
        if (!await isAllowedPort(port)) {
          logger.warn?.(`[dev-tunnel] refused port ${port}: not reported by dev-server discovery`);
          rejectWebSocketUpgrade(socket, 403, 'That port is not an available dev server');
          return;
        }
        wsServer.handleUpgrade(req, socket, head, (ws) => wsServer.emit('connection', ws, req));
      } catch (error) {
        logger.warn?.(`[dev-tunnel] upgrade failed: ${error?.message || error}`);
        rejectWebSocketUpgrade(socket, 500, 'Upgrade failed');
      }
    })();
  };

  server.on('upgrade', upgradeHandler);
  return {
    path: DEV_TUNNEL_WS_PATH,
    get openSocketCount() {
      return openSockets;
    },
    dispose() {
      server.off('upgrade', upgradeHandler);
      for (const socket of wsServer.clients) {
        try { socket.terminate(); } catch { /* already closing */ }
      }
      wsServer.close();
    },
  };
}
