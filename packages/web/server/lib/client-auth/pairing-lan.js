/**
 * LAN / local transport helpers for pairing v2 candidate lists.
 */

const isNetworkExposedBindHost = (host) => {
  const h = String(host || '').toLowerCase();
  if (!h || h === '127.0.0.1' || h === 'localhost' || h === '::1') return false;
  if (h === '0.0.0.0' || h === '::' || h === '[::]') return true;
  return true;
};

const requestReachedLanAddress = (req) => {
  const hostHeader = typeof req?.headers?.host === 'string' ? req.headers.host.trim() : '';
  if (!hostHeader) return null;
  let address = hostHeader;
  if (address.startsWith('[')) {
    const end = address.indexOf(']');
    address = end > 0 ? address.slice(1, end) : address;
  } else if (address.includes(':')) {
    address = address.split(':')[0];
  }
  if (!address || address === 'localhost' || address === '::1') return null;
  if (address.startsWith('127.')) return null;
  return address;
};

/**
 * @param {{
 *   os: typeof import('node:os'),
 *   getActivePort: () => number,
 *   bindHost: string,
 *   fallbackPort: number,
 *   isRelayAvailable?: () => boolean,
 * }} deps
 */
export const createPairingLanHelpers = ({ os, getActivePort, bindHost, fallbackPort, isRelayAvailable = () => true }) => {
  const resolvePairingTransports = (req) => {
    const activePort = getActivePort() || fallbackPort;
    const local = `http://127.0.0.1:${activePort}`;
    let lanHost = null;
    if (isNetworkExposedBindHost(bindHost)) {
      lanHost = requestReachedLanAddress(req);
      try {
        if (!lanHost) {
          for (const list of Object.values(os.networkInterfaces())) {
            for (const entry of (list || [])) {
              if ((entry.family === 'IPv4' || entry.family === 4) && !entry.internal) {
                lanHost = entry.address;
                break;
              }
            }
            if (lanHost) break;
          }
        }
      } catch {
        lanHost = null;
      }
    } else {
      const h = String(bindHost || '').toLowerCase();
      if (h && h !== '127.0.0.1' && h !== 'localhost' && h !== '::1') lanHost = bindHost;
    }
    const lan = lanHost ? `http://${lanHost.includes(':') ? `[${lanHost}]` : lanHost}:${activePort}` : null;
    // Enterprise mode without a pinned relay keeps pairing off the hosted
    // relay; direct transports are unaffected (upstream segb 3792ec325).
    return { local, lan, relayAvailable: isRelayAvailable() };
  };

  const resolveDirectLanUrls = (req) => {
    const activePort = getActivePort() || fallbackPort;
    const urls = [];
    const push = (host) => {
      if (typeof host !== 'string' || !host) return;
      const url = `http://${host.includes(':') ? `[${host}]` : host}:${activePort}`;
      if (!urls.includes(url)) urls.push(url);
    };
    if (isNetworkExposedBindHost(bindHost)) {
      push(requestReachedLanAddress(req));
      try {
        for (const list of Object.values(os.networkInterfaces())) {
          for (const entry of (list || [])) {
            if ((entry.family === 'IPv4' || entry.family === 4) && !entry.internal) push(entry.address);
          }
        }
      } catch {
        // keep whatever we collected
      }
    } else {
      const h = String(bindHost || '').toLowerCase();
      if (h && h !== '127.0.0.1' && h !== 'localhost' && h !== '::1') push(bindHost);
    }
    return urls;
  };

  return { resolvePairingTransports, resolveDirectLanUrls };
};
