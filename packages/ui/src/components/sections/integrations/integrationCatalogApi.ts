import { resolveApiUrl } from '@/lib/api/serverUrl';
import { runtimeFetch } from '@/lib/runtime-fetch';
import type {
  PluginEntry,
  PluginMutationResult,
  RegistryResult,
} from '@/stores/usePluginsStore';

import { specMatchesPackage } from './thirdPartyPlugins';

type RuntimeFetcher = typeof runtimeFetch;

type PluginListResponse = {
  entries?: PluginEntry[];
};

type RegistryResponse = {
  results?: RegistryResult[];
};

type MutationPayload = {
  success?: boolean;
  restartDeferred?: boolean;
  requiresManualRestart?: boolean;
  reloadFailed?: boolean;
  message?: string;
  warning?: string;
  error?: string;
};

export type IntegrationCatalogSnapshot = {
  entries: PluginEntry[];
  registryInfo: Record<string, RegistryResult>;
  registryUnavailable: boolean;
};

export type IntegrationMutationResult = PluginMutationResult & {
  restartDeferred?: boolean;
  requiresManualRestart?: boolean;
};

export type IntegrationMutation =
  | { type: 'install'; spec: string }
  | { type: 'update'; entryId: string; spec: string }
  | { type: 'remove'; entryId: string };

const readJson = async (response: Response): Promise<unknown> => response.json().catch(() => null);

const payloadError = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string') {
    return (payload as { error: string }).error;
  }
  return fallback;
};

const buildCatalogUrl = (path: string, baseUrl: string): string => resolveApiUrl(path, baseUrl);

const buildRegistryUrl = (specs: readonly string[], baseUrl: string): string => {
  const encoded = specs.map((spec) => encodeURIComponent(spec)).join(',');
  return buildCatalogUrl(`/api/config/plugins/registry?specs=${encoded}&refresh=true`, baseUrl);
};

/**
 * Load the catalog from the Settings-selected instance. No active project,
 * active session or current-directory fallback participates in routing.
 */
export const loadIntegrationCatalog = async (
  baseUrl: string,
  packageNames: readonly string[],
  options: { signal?: AbortSignal; fetcher?: RuntimeFetcher } = {},
): Promise<IntegrationCatalogSnapshot> => {
  const fetcher = options.fetcher ?? runtimeFetch;
  const listResponse = await fetcher(buildCatalogUrl('/api/config/plugins', baseUrl), {
    signal: options.signal,
    headers: { Accept: 'application/json' },
  });
  const listPayload = await readJson(listResponse);
  if (!listResponse.ok) {
    throw new Error(payloadError(listPayload, `Failed to load integrations (${listResponse.status})`));
  }

  const entries = Array.isArray((listPayload as PluginListResponse | null)?.entries)
    ? (listPayload as PluginListResponse).entries ?? []
    : [];
  const specs = new Set(packageNames);
  for (const entry of entries) {
    if (packageNames.some((packageName) => specMatchesPackage(entry.spec, packageName))) {
      specs.add(entry.spec);
    }
  }

  const registryResponse = await fetcher(buildRegistryUrl([...specs], baseUrl), {
    signal: options.signal,
    headers: { Accept: 'application/json' },
  });
  const registryPayload = await readJson(registryResponse);
  if (!registryResponse.ok) {
    return { entries, registryInfo: {}, registryUnavailable: true };
  }

  const results = Array.isArray((registryPayload as RegistryResponse | null)?.results)
    ? (registryPayload as RegistryResponse).results ?? []
    : [];
  return {
    entries,
    registryInfo: Object.fromEntries(results.map((result) => [result.spec, result])),
    registryUnavailable: false,
  };
};

export const mutateIntegrationPlugin = async (
  baseUrl: string,
  mutation: IntegrationMutation,
  options: { signal?: AbortSignal; fetcher?: RuntimeFetcher } = {},
): Promise<IntegrationMutationResult> => {
  const fetcher = options.fetcher ?? runtimeFetch;
  const path = mutation.type === 'install'
    ? '/api/config/plugins/entry'
    : `/api/config/plugins/entry/${encodeURIComponent(mutation.entryId)}`;
  const method = mutation.type === 'install'
    ? 'POST'
    : mutation.type === 'update'
      ? 'PATCH'
      : 'DELETE';
  const response = await fetcher(buildCatalogUrl(path, baseUrl), {
    method,
    signal: options.signal,
    headers: mutation.type === 'remove'
      ? { Accept: 'application/json' }
      : { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(mutation.type === 'remove'
      ? {}
      : {
          body: JSON.stringify(mutation.type === 'install'
            ? { spec: mutation.spec, scope: 'user' }
            : { spec: mutation.spec }),
        }),
  });
  const payload = await readJson(response) as MutationPayload | null;
  if (!response.ok || payload?.success === false) {
    throw new Error(payloadError(payload, `Failed to update integration (${response.status})`));
  }

  return {
    ok: true,
    restartDeferred: payload?.restartDeferred === true,
    requiresManualRestart: payload?.requiresManualRestart === true,
    reloadFailed: payload?.reloadFailed === true,
    message: payload?.message,
    warning: payload?.warning,
  };
};
