import { resolveApiUrl } from '@/lib/api/serverUrl';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { runtimeFetch } from '@/lib/runtime-fetch';

export type DiscoveredDevServer = {
  readonly port: number;
  readonly url: string;
  readonly command: string;
};

export type DevServerDiscovery =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly servers: readonly DiscoveredDevServer[] }
  | { readonly kind: 'unavailable' };

export const parseDevServers = (value: unknown): DiscoveredDevServer[] | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as { servers?: unknown }).servers;
  if (!Array.isArray(raw)) return null;
  const byPort = new Map<number, DiscoveredDevServer>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (!Number.isInteger(record.port) || (record.port as number) <= 0 || (record.port as number) > 65535) continue;
    if (typeof record.url !== 'string' || !record.url) continue;
    const port = record.port as number;
    if (!byPort.has(port)) {
      byPort.set(port, {
        port,
        url: record.url,
        command: typeof record.command === 'string' ? record.command : '',
      });
    }
  }
  return [...byPort.values()].sort((left, right) => left.port - right.port);
};

export const fetchDevServers = async ({
  serverId,
  signal,
  defaultFetch = runtimeFetch,
  remoteFetch = fetch,
}: {
  serverId: string;
  signal?: AbortSignal;
  defaultFetch?: typeof runtimeFetch;
  remoteFetch?: typeof fetch;
}): Promise<DevServerDiscovery> => {
  try {
    let response: Response;
    if (!serverId || serverId === DEFAULT_SERVER_ID) {
      response = await defaultFetch('/api/dev-servers', { signal });
    } else {
      const connection = serverRegistry.get(serverId);
      const baseUrl = connection?.config.baseUrl?.trim();
      if (!connection || !baseUrl) return { kind: 'unavailable' };
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (connection.config.authToken) headers.Authorization = `Bearer ${connection.config.authToken}`;
      response = await remoteFetch(resolveApiUrl('/api/dev-servers', baseUrl), { signal, headers });
    }
    if (!response.ok) return { kind: 'unavailable' };
    const servers = parseDevServers(await response.json());
    return servers ? { kind: 'ready', servers } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
};
