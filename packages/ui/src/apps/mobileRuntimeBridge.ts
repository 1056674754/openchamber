import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import type { RelayRuntimeDescriptor } from '@/lib/relay/runtime-tunnel';
import { switchRuntimeEndpoint } from '@/lib/runtime-switch';

/**
 * Legacy synthetic id used briefly by Capacitor connect. It must NEVER be
 * persisted on shared host projects — that polluted the desktop sidebar with
 * "mobile-active" remote labels and broke chat routing.
 */
export const LEGACY_MOBILE_ACTIVE_SERVER_ID = 'mobile-active';

export const isLegacyMobileActiveServerId = (serverId: string | null | undefined): boolean =>
  Boolean(serverId && serverId.trim() === LEGACY_MOBILE_ACTIVE_SERVER_ID);

export const normalizeMobileServerUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
};

/** Mobile's bound host is the default server from the phone's point of view. */
export const getMobileActiveServerId = (): string => DEFAULT_SERVER_ID;

/**
 * Connect Capacitor mobile to a remote OpenChamber host.
 * Retargets DEFAULT_SERVER_ID only — do not invent a second serverId that
 * RemoteProjectDiscovery would persist back onto the host project list.
 */
export const connectMobileEndpoint = (options: {
  url: string;
  clientToken?: string | null;
  label?: string;
  /** When set, runtime HTTP/WS ride the E2EE private relay tunnel. */
  relay?: RelayRuntimeDescriptor | null;
}): string => {
  const apiBaseUrl = options.relay
    ? (normalizeMobileServerUrl(options.url) || `relay://${options.relay.serverId}`)
    : normalizeMobileServerUrl(options.url);
  if (!apiBaseUrl && !options.relay) {
    throw new Error('Server URL is required');
  }

  const label = (options.label || '').trim() || (() => {
    if (options.relay) return options.relay.serverId;
    try {
      return new URL(apiBaseUrl).host;
    } catch {
      return apiBaseUrl;
    }
  })();

  switchRuntimeEndpoint({
    apiBaseUrl: apiBaseUrl || `relay://${options.relay?.serverId || 'unknown'}`,
    clientToken: options.clientToken ?? null,
    runtimeKey: options.relay
      ? `relay:${options.relay.serverId}@${options.relay.relayUrl}`
      : `mobile:${apiBaseUrl}`,
    relay: options.relay ?? null,
  });

  // OpenCode SDK paths are relative to /api (e.g. /session/:id/message).
  // Register the API root — host origin alone serves the SPA HTML for those
  // paths, which surfaces as "session.messages returned non-array data".
  const sdkBaseUrl = `${apiBaseUrl}/api`;
  serverRegistry.register({
    id: DEFAULT_SERVER_ID,
    label,
    baseUrl: sdkBaseUrl,
    healthUrl: `${apiBaseUrl}/health`,
    authToken: options.clientToken ?? undefined,
  });

  // Drop any leftover synthetic registration from older builds.
  serverRegistry.unregister(LEGACY_MOBILE_ACTIVE_SERVER_ID);

  return DEFAULT_SERVER_ID;
};

export const disconnectMobileEndpoint = (): void => {
  switchRuntimeEndpoint({
    apiBaseUrl: '',
    clientToken: null,
    runtimeKey: 'mobile-disconnected',
  });
  serverRegistry.unregister(LEGACY_MOBILE_ACTIVE_SERVER_ID);
};
