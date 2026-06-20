import React from 'react';
import { serverRegistry } from '@/lib/opencode/server-registry';
import { useInstanceContextStore } from '@/stores/useInstanceContextStore';

export interface ServerBaseUrlState {
  /** 'ready' = baseUrl is valid and usable. 'loading' = remote selected but not yet in registry. */
  status: 'ready' | 'loading';
  /** The base URL to use for API calls. Empty string for local/default instance. */
  baseUrl: string;
}

const READY_EMPTY: ServerBaseUrlState = { status: 'ready', baseUrl: '' };
const LOADING_EMPTY: ServerBaseUrlState = { status: 'loading', baseUrl: '' };
const readyStateByBaseUrl = new Map<string, ServerBaseUrlState>([['', READY_EMPTY]]);

const getReadyState = (baseUrl: string): ServerBaseUrlState => {
  const existing = readyStateByBaseUrl.get(baseUrl);
  if (existing) return existing;
  const next: ServerBaseUrlState = { status: 'ready', baseUrl };
  readyStateByBaseUrl.set(baseUrl, next);
  return next;
};

/**
 * Pure resolver: given a settings server ID (from the settings instance selector),
 * return the correct ServerBaseUrlState without any active-session fallback.
 *
 * - `null` or `undefined` → `{ status: 'ready', baseUrl: '' }` (default/local)
 * - Registered remote → `{ status: 'ready', baseUrl: connection.config.baseUrl }`
 * - Unregistered remote → `{ status: 'loading', baseUrl: '' }` (NOT active session)
 */
export function resolveSettingsServerBaseUrl(
  settingsServerId: string | null | undefined,
  registry = serverRegistry,
): ServerBaseUrlState {
  // Default/local: always ready with empty baseUrl.
  if (!settingsServerId) {
    return READY_EMPTY;
  }

  // Remote: check registry. Do NOT fallback to active session.
  const connection = registry.get(settingsServerId);
  if (!connection) {
    return LOADING_EMPTY;
  }
  return getReadyState(connection.config.baseUrl ?? '');
}

export function useSettingsServerBaseUrl(): ServerBaseUrlState {
  const currentInstance = useInstanceContextStore((s) => s.currentInstance);

  const settingsServerId = currentInstance?.type === 'remote' ? currentInstance.id : null;

  return React.useSyncExternalStore(
    React.useCallback(
      (notify: () => void) =>
        settingsServerId
          ? serverRegistry.onHealthChange(settingsServerId, notify)
          : () => {},
      [settingsServerId],
    ),
    React.useCallback((): ServerBaseUrlState => {
      return resolveSettingsServerBaseUrl(settingsServerId);
    }, [settingsServerId]),
    // SSR fallback: treat as ready with empty baseUrl (no remote in Node).
    () => READY_EMPTY,
  );
}
