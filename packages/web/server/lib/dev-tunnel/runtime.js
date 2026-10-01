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
    let upstream = null;
    let connected = false;
    let pendingWrites = [];
    let pendingBytes = 0;
    let settled = false;
    const teardown = () => {
      if (settled) return;
      settled = true;
      openSockets -= 1;
      clearTimeout(connectTimer);
      pendingWrites = [];
      try { upstream?.destroy(); } catch { /* already gone */ }
      try { socket.terminate(); } catch { /* already closing */ }
    };

    const connectTimer = setTimeout(() => {
      if (connected) return;
      logger.warn?.(`[dev-tunnel] timed out connecting to loopback port ${port}`);
      teardown();
    }, CONNECT_TIMEOUT_MS);

    const pipeUpstream = () => {
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
      upstream.on('error', teardown);
      upstream.on('close', teardown);
    };

    // Discovery offers a port bound to either loopback family, and `localhost`
    // resolves to `::1` first on many systems, so a dev server started with its
    // defaults may listen on IPv6 only. Dialing just `127.0.0.1` refused every
    // connection to such a server while the panel listed it as available.
    const LOOPBACK_HOSTS = ['127.0.0.1', '::1'];
    const dial = (hostIndex) => {
      const candidate = net.connect({ host: LOOPBACK_HOSTS[hostIndex], port });
      upstream = candidate;
      candidate.setNoDelay(true);
      candidate.once('connect', () => {
        if (settled) return;
        connected = true;
        clearTimeout(connectTimer);
        candidate.removeAllListeners('error');
        pipeUpstream();
        for (const chunk of pendingWrites) candidate.write(chunk);
        pendingWrites = [];
        pendingBytes = 0;
      });
      candidate.once('error', (error) => {
        candidate.destroy();
        if (settled) return;
        if (hostIndex + 1 < LOOPBACK_HOSTS.length) {
          dial(hostIndex + 1);
          return;
        }
        logger.warn?.(`[dev-tunnel] could not connect to port ${port} on ${LOOPBACK_HOSTS.join(' or ')}: ${error?.code || error?.message || error}`);
        teardown();
      });
    };
    dial(0);

    socket.on('message', (data) => {
      if (settled) return;
      if (connected) {
        upstream.write(data);
        return;
      }
      // Bytes the page may send before the dev server connection is up.
      pendingWrites.push(data);
      pendingBytes += data.length;
      if (pendingBytes > 256 * 1024) {
        logger.warn?.(`[dev-tunnel] dropped a connection that buffered too much before port ${port} answered`);
        teardown();
      }
    });
    socket.on('close', teardown);
    socket.on('error', teardown);
  });

  const upgradeHandler = (req, socket, head) => {
    if (!isDevTunnelPath(req.url)) return;
    const port = parseRequestedPort(req.url);
    // Every refusal is logged with its reason: the desktop only sees its local
    // connection close, which the panel cannot tell apart from a dev server
    // that is still starting. Never logs the URL, which may carry a token.
    const refuse = (status, reason) => {
      logger.warn?.(`[dev-tunnel] refused port ${port ?? 'unknown'}: ${reason}`);
      rejectWebSocketUpgrade(socket, status, reason);
    };
    void (async () => {
      try {
        if (uiAuthController?.enabled) {
          const auth = await uiAuthController.resolveAuthContext(req, null, { allowUrlToken: false });
          if (!auth) {
            refuse(401, 'UI authentication required');
            return;
          }
          const hasOrigin = typeof req.headers?.origin === 'string' && req.headers.origin.trim() !== '';
          if (hasOrigin) {
            if (!await isRequestOriginAllowed(req)) {
              refuse(403, 'Invalid origin');
              return;
            }
          } else if (auth.type !== 'client') {
            refuse(403, 'Client authentication required');
            return;
          }
        }

        if (port === null) {
          refuse(400, 'Invalid port');
          return;
        }
        if (openSockets >= MAX_CONCURRENT_SOCKETS) {
          refuse(503, 'Too many tunnel connections');
          return;
        }
        if (!await isAllowedPort(port)) {
          refuse(403, 'That port is not an available dev server');
          return;
        }
        wsServer.handleUpgrade(req, socket, head, (ws) => wsServer.emit('connection', ws, req));
      } catch (error) {
        logger.warn?.(`[dev-tunnel] upgrade for port ${port ?? 'unknown'} failed: ${error?.message || error}`);
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
