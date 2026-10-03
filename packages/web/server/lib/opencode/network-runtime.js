import { DEFAULT_PROTOCOL_MODE_SERVER_ID, recordProtocolModeFromVersion, resolveProtocolMode } from './protocol-mode.js';
import {
  resolveUpstreamRequestPath,
  rewriteDirectoryQueryForUpstream,
} from './upstream-v2-paths.js';

export const createOpenCodeNetworkRuntime = (deps) => {
  const {
    state,
    getOpenCodeAuthHeaders,
  } = deps;

  const normalizeApiPrefix = (prefix) => {
    if (!prefix) {
      return '';
    }

    if (prefix.includes('://')) {
      try {
        const parsed = new URL(prefix);
        return normalizeApiPrefix(parsed.pathname);
      } catch {
        return '';
      }
    }

    const trimmed = prefix.trim();
    if (!trimmed || trimmed === '/') {
      return '';
    }
    const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
  };

  /**
   * Startup readiness, dual-track (spine OC2-S3). The v1 probe
   * (`/global/health`, `healthy: true`) is unchanged and still answers first;
   * a server that does not answer it gets one `/api/info` attempt per tick —
   * a 200 there is the whole readiness answer on the v2 track (2.0.8 removed
   * `healthy`), and its `version` records the protocol mode for the instance.
   * A v1 server therefore behaves exactly as before and records `v1` from its
   * health payload's version.
   */
  const waitForReady = async (url, timeoutMs = 10000) => {
    const base = url.replace(/\/+$/, '');
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let timeout = null;
      try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${base}/global/health`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...getOpenCodeAuthHeaders(),
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        timeout = null;

        if (response.ok) {
          const body = await response.json().catch(() => null);
          if (body?.healthy === true) {
            if (typeof body?.version === 'string' && body.version.trim()) {
              recordProtocolModeFromVersion(DEFAULT_PROTOCOL_MODE_SERVER_ID, body.version.trim(), 'startup-health');
            }
            return true;
          }
        }

        const infoResponse = await fetch(`${base}/api/info`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...getOpenCodeAuthHeaders(),
          },
          signal: controller.signal,
        });
        if (infoResponse.ok) {
          const info = await infoResponse.json().catch(() => null);
          if (typeof info?.version === 'string' && info.version.trim()) {
            recordProtocolModeFromVersion(DEFAULT_PROTOCOL_MODE_SERVER_ID, info.version.trim(), 'startup-info');
          }
          return true;
        }
      } catch {
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  };

  const setDetectedOpenCodeApiPrefix = () => {
    state.openCodeApiPrefix = '';
    state.openCodeApiPrefixDetected = true;
    if (state.openCodeApiDetectionTimer) {
      clearTimeout(state.openCodeApiDetectionTimer);
      state.openCodeApiDetectionTimer = null;
    }
  };

  /**
   * Build an upstream OpenCode URL for a v1-shaped request path. On the v2
   * track (spine finale) the path is translated to the OpenCode 2 request
   * shape — `/api` prefix, renamed endpoints, `?directory=` → the v2 location
   * query — so every caller of this module keeps its v1 path spelling on both
   * tracks (see `upstream-v2-paths.js`). Already-v2 paths pass through.
   */
  const buildOpenCodeUrl = (path, prefixOverride) => {
    if (!state.openCodePort) {
      throw new Error('OpenCode port is not available');
    }
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const prefix = normalizeApiPrefix(prefixOverride !== undefined ? prefixOverride : '');
    const mode = resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID);
    const fullPath = `${prefix}${rewriteDirectoryQueryForUpstream(resolveUpstreamRequestPath(normalizedPath, mode), mode)}`;
    const base = state.openCodeBaseUrl ?? `http://localhost:${state.openCodePort}`;
    return `${base}${fullPath}`;
  };

  const detectOpenCodeApiPrefix = () => {
    state.openCodeApiPrefixDetected = true;
    state.openCodeApiPrefix = '';
    return true;
  };

  const ensureOpenCodeApiPrefix = () => detectOpenCodeApiPrefix();

  const scheduleOpenCodeApiDetection = () => {
    return;
  };

  return {
    waitForReady,
    normalizeApiPrefix,
    setDetectedOpenCodeApiPrefix,
    buildOpenCodeUrl,
    ensureOpenCodeApiPrefix,
    scheduleOpenCodeApiDetection,
  };
};
