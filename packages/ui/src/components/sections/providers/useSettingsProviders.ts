import React from 'react';
import type { Provider } from '@opencode-ai/sdk/v2';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSettingsServerBaseUrl } from '@/hooks/useSettingsServerBaseUrl';
import { resolveApiUrl } from '@/lib/api/serverUrl';

type ProviderModel = Provider['models'][string];
type ProviderWithModelList = Omit<Provider, 'models'> & { models: ProviderModel[] };

interface RemoteProvidersPayload {
  providers?: Array<Partial<Provider> & { models?: Record<string, ProviderModel> }>;
}

function transformRemoteProviders(raw: RemoteProvidersPayload['providers']): ProviderWithModelList[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((provider) => ({
    ...(provider as Provider),
    models: Object.values(provider.models ?? {}),
  }));
}

/**
 * Returns the connected providers for the currently-selected settings instance.
 *
 * When the settings instance is local (no server base URL), this reads from the
 * config store like before. When the settings instance is a remote server, it
 * fetches the connected-provider list directly from that remote server so the
 * page reflects the remote instance's own provider/model configuration rather
 * than the local one.
 */
export function useSettingsProviders(): { providers: ProviderWithModelList[]; isLoading: boolean } {
  const storeProviders = useConfigStore((state) => state.providers);
  const serverBaseUrl = useSettingsServerBaseUrl();
  const [remoteProviders, setRemoteProviders] = React.useState<ProviderWithModelList[] | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    if (!serverBaseUrl) {
      setRemoteProviders(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetch(resolveApiUrl('/api/config/providers', serverBaseUrl), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: RemoteProvidersPayload | null) => {
        if (cancelled) return;
        setRemoteProviders(transformRemoteProviders(data?.providers));
      })
      .catch(() => {
        if (!cancelled) setRemoteProviders([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverBaseUrl]);

  const providers = serverBaseUrl ? (remoteProviders ?? []) : storeProviders;
  return { providers, isLoading };
}
