export const createRequestSecurityRuntime = (deps) => {
  const { readSettingsFromDiskMigrated } = deps;

  // Packaged clients whose WebView Origin never matches the server host.
  // `http://app.openchamber.localhost` is the HarmonyOS (ArkWeb) shell: the
  // `.localhost` TLD is a potentially-trustworthy origin (secure context, so
  // crypto.subtle exists for the relay E2EE handshake) while staying plain http,
  // so the page can fetch http://LAN-IP servers without hitting mixed-content
  // blocking. The older https://app.openchamber.local origin is kept for
  // already-installed shells.
  const packagedClientOrigins = new Set([
    'openchamber-ui://app',
    'capacitor://localhost',
    'https://localhost',
    'https://app.openchamber.local',
    'http://app.openchamber.localhost',
  ]);

  const getUiSessionTokenFromRequest = (req) => {
    const cookieHeader = req?.headers?.cookie;
    if (!cookieHeader || typeof cookieHeader !== 'string') {
      return null;
    }
    const segments = cookieHeader.split(';');
    for (const segment of segments) {
      const [rawName, ...rest] = segment.split('=');
      const name = rawName?.trim();
      if (!name) continue;
      if (name !== 'oc_ui_session') continue;
      const value = rest.join('=').trim();
      try {
        return decodeURIComponent(value || '');
      } catch {
        return value || null;
      }
    }
    return null;
  };

  const rejectWebSocketUpgrade = (socket, statusCode, reason) => {
    if (!socket || socket.destroyed) {
      return;
    }

    const message = typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : 'Bad Request';
    const body = Buffer.from(message, 'utf8');
    const statusText = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      500: 'Internal Server Error',
    }[statusCode] || 'Bad Request';

    try {
      socket.write(
        `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
        'Connection: close\r\n' +
        'Content-Type: text/plain; charset=utf-8\r\n' +
        `Content-Length: ${body.length}\r\n\r\n`
      );
      socket.write(body);
    } catch {
    }

    try {
      socket.destroy();
    } catch {
    }
  };

  const getRequestOriginCandidates = async (req) => {
    const origins = new Set();
    const hosts = new Set();
    const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0].trim().toLowerCase()
      : '';
    const protocol = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');

    const forwardedHost = typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0].trim()
      : '';
    const host = forwardedHost || (typeof req.headers.host === 'string' ? req.headers.host.trim() : '');

    if (host) {
      hosts.add(host.toLowerCase());
      origins.add(`${protocol}://${host}`);
      const [hostname, port] = host.split(':');
      const normalizedHost = typeof hostname === 'string' ? hostname.toLowerCase() : '';
      const portSuffix = typeof port === 'string' && port.length > 0 ? `:${port}` : '';
      if (normalizedHost === 'localhost') {
        origins.add(`${protocol}://127.0.0.1${portSuffix}`);
        origins.add(`${protocol}://[::1]${portSuffix}`);
      } else if (normalizedHost === '127.0.0.1' || normalizedHost === '[::1]') {
        origins.add(`${protocol}://localhost${portSuffix}`);
      }
    }

    try {
      const settings = await readSettingsFromDiskMigrated();
      if (typeof settings?.publicOrigin === 'string' && settings.publicOrigin.trim().length > 0) {
        origins.add(new URL(settings.publicOrigin.trim()).origin);
      }
    } catch {
    }

    return { origins, hosts };
  };

  const isRequestOriginAllowed = async (req) => {
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    if (!originHeader) {
      return false;
    }

    // Packaged clients first, against the raw header: URL.origin is "null"
    // for non-special schemes like openchamber-ui://app.
    if (packagedClientOrigins.has(originHeader)) {
      return true;
    }

    let origin;
    try {
      origin = new URL(originHeader);
    } catch {
      return false;
    }

    const candidates = await getRequestOriginCandidates(req);
    if (candidates.origins.has(origin.origin)) return true;

    // TLS commonly ends at a cloud edge before an HTTP hop to OpenChamber.
    // In that setup the browser's Origin is https while a generic reverse
    // proxy reports the upstream request as http. The external host remains
    // authoritative, so compare it directly instead of requiring the proxy to
    // preserve the browser-facing protocol.
    return candidates.hosts.has(origin.host.toLowerCase());
  };

  return {
    getUiSessionTokenFromRequest,
    rejectWebSocketUpgrade,
    isRequestOriginAllowed,
  };
};
