import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { switchRuntimeEndpoint } from '@/lib/runtime-switch';

const MOBILE_ACTIVE_SERVER_ID = 'mobile-active';

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

export const getMobileActiveServerId = (): string => MOBILE_ACTIVE_SERVER_ID;

/**
 * Connect Capacitor mobile to a remote OpenChamber host.
 * Keeps fork authority: registers `serverId` in serverRegistry AND switches the
 * runtime URL resolver so relative `/api` fetches hit the absolute host.
 */
export const connectMobileEndpoint = (options: {
  url: string;
  clientToken?: string | null;
  label?: string;
}): string => {
  const apiBaseUrl = normalizeMobileServerUrl(options.url);
  if (!apiBaseUrl) {
    throw new Error('Server URL is required');
  }

  const label = (options.label || '').trim() || (() => {
    try {
      return new URL(apiBaseUrl).host;
    } catch {
      return apiBaseUrl;
    }
  })();

  switchRuntimeEndpoint({
    apiBaseUrl,
    clientToken: options.clientToken ?? null,
    runtimeKey: `mobile:${apiBaseUrl}`,
  });

  serverRegistry.register({
    id: MOBILE_ACTIVE_SERVER_ID,
    label,
    baseUrl: apiBaseUrl,
    authToken: options.clientToken ?? undefined,
  });

  // Also retarget default so code paths that still read DEFAULT_SERVER_ID work
  // while a single mobile connection is active.
  serverRegistry.register({
    id: DEFAULT_SERVER_ID,
    label,
    baseUrl: apiBaseUrl,
    authToken: options.clientToken ?? undefined,
  });

  return MOBILE_ACTIVE_SERVER_ID;
};

export const disconnectMobileEndpoint = (): void => {
  switchRuntimeEndpoint({
    apiBaseUrl: '',
    clientToken: null,
    runtimeKey: 'mobile-disconnected',
  });
  serverRegistry.unregister(MOBILE_ACTIVE_SERVER_ID);
};
