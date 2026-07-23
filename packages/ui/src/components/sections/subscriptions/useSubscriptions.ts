import React from 'react';
import { create } from 'zustand';
import { useSettingsServerBaseUrl } from '@/hooks/useSettingsServerBaseUrl';
import { resolveApiUrl } from '@/lib/api/serverUrl';

export type SubscriptionAuthSource = 'api' | 'env' | 'config' | 'custom' | 'none';
export type SubscriptionAuthType = 'api' | 'oauth' | 'unknown';

export interface SubscriptionProvider {
  id: string;
  name: string;
  auth: {
    configured: boolean;
    source: SubscriptionAuthSource;
    envVars: string[];
    type: SubscriptionAuthType;
  };
  quota: {
    providerId: string | null;
    configured: boolean;
  };
  config: {
    user: boolean;
    project: boolean;
    custom: boolean;
  };
  egress: {
    mode: string;
  };
  conflicts: Array<{
    type: string;
    message: string;
  }>;
}

interface SubscriptionsPayload {
  providers?: SubscriptionProvider[];
  degraded?: boolean;
  fetchedAt?: number;
}

interface SubscriptionsState {
  providers: SubscriptionProvider[];
  /** Server-reported partial data flag. */
  degraded: boolean;
  /** True when the last fetch failed outright (distinct from a successful-but-empty response). */
  fetchFailed: boolean;
  fetchedAt: number | null;
  isLoading: boolean;
  selectedProviderId: string | null;
  /** Base URL the current data was loaded for; used to refetch on instance change. */
  loadedBaseUrl: string | null;
  setSelectedProvider: (providerId: string | null) => void;
  load: (baseUrl: string, options?: { force?: boolean }) => Promise<void>;
}

export const useSubscriptionsStore = create<SubscriptionsState>()((set, get) => ({
  providers: [],
  degraded: false,
  fetchFailed: false,
  fetchedAt: null,
  isLoading: false,
  selectedProviderId: null,
  loadedBaseUrl: null,
  setSelectedProvider: (providerId) => set({ selectedProviderId: providerId }),
  load: async (baseUrl, options) => {
    const state = get();
    const instanceChanged = state.loadedBaseUrl !== baseUrl;
    if (state.isLoading && !instanceChanged) {
      return;
    }
    if (!options?.force && !instanceChanged && (state.fetchedAt !== null || state.fetchFailed)) {
      return;
    }
    set(instanceChanged
      ? {
        providers: [],
        degraded: false,
        fetchFailed: false,
        fetchedAt: null,
        isLoading: true,
        selectedProviderId: null,
        loadedBaseUrl: baseUrl,
      }
      : { isLoading: true });
    try {
      const response = await fetch(resolveApiUrl('/api/subscriptions', baseUrl), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Subscriptions request failed (${response.status})`);
      }
      const payload = (await response.json().catch(() => null)) as SubscriptionsPayload | null;
      if (!payload || !Array.isArray(payload.providers)) {
        throw new Error('Subscriptions payload malformed');
      }
      if (get().loadedBaseUrl !== baseUrl) {
        return;
      }
      set({
        providers: payload.providers,
        degraded: payload.degraded === true,
        fetchFailed: false,
        fetchedAt: typeof payload.fetchedAt === 'number' ? payload.fetchedAt : Date.now(),
        isLoading: false,
        loadedBaseUrl: baseUrl,
      });
    } catch (error) {
      // Keep whatever data we already have; failure is surfaced as degraded,
      // never as an empty success.
      if (error instanceof Error) {
        console.error('Failed to load subscriptions:', error);
      } else {
        console.error('Failed to load subscriptions');
      }
      if (get().loadedBaseUrl === baseUrl) {
        set({ isLoading: false, fetchFailed: true });
      }
    }
  },
}));

export interface UseSubscriptionsResult {
  providers: SubscriptionProvider[];
  degraded: boolean;
  fetchFailed: boolean;
  fetchedAt: number | null;
  isLoading: boolean;
  /** True while the settings instance itself is still resolving. */
  instanceLoading: boolean;
  selectedProviderId: string | null;
  setSelectedProvider: (providerId: string | null) => void;
  refresh: () => Promise<void>;
}

/**
 * Returns the subscription/auth state for the currently-selected settings
 * instance. Local instance fetches `/api/subscriptions` from the current
 * server; a remote settings instance fetches the same endpoint from that
 * remote server. Refetches when the instance changes.
 */
export function useSubscriptions(): UseSubscriptionsResult {
  const { status, baseUrl } = useSettingsServerBaseUrl();
  const providers = useSubscriptionsStore((state) => state.providers);
  const degraded = useSubscriptionsStore((state) => state.degraded);
  const fetchFailed = useSubscriptionsStore((state) => state.fetchFailed);
  const fetchedAt = useSubscriptionsStore((state) => state.fetchedAt);
  const isLoading = useSubscriptionsStore((state) => state.isLoading);
  const loadedBaseUrl = useSubscriptionsStore((state) => state.loadedBaseUrl);
  const selectedProviderId = useSubscriptionsStore((state) => state.selectedProviderId);
  const setSelectedProvider = useSubscriptionsStore((state) => state.setSelectedProvider);

  React.useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    if (loadedBaseUrl === baseUrl && (fetchedAt !== null || fetchFailed)) {
      return;
    }
    void useSubscriptionsStore.getState().load(baseUrl);
  }, [status, baseUrl, loadedBaseUrl, fetchedAt, fetchFailed]);

  const refresh = React.useCallback(async () => {
    if (status !== 'ready') {
      return;
    }
    await useSubscriptionsStore.getState().load(baseUrl, { force: true });
  }, [status, baseUrl]);

  return {
    providers,
    degraded,
    fetchFailed,
    fetchedAt,
    isLoading,
    instanceLoading: status === 'loading',
    selectedProviderId,
    setSelectedProvider,
    refresh,
  };
}
