import { CapacitorHttp } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import React from 'react';

import { isCapacitorApp } from '@/lib/platform';
import {
  connectMobileEndpoint,
  disconnectMobileEndpoint,
  normalizeMobileServerUrl,
} from '@/apps/mobileRuntimeBridge';

const MOBILE_CONNECTIONS_STORAGE_KEY = 'openchamber.mobile.connections.v1';
const MOBILE_SECURE_STORAGE_PREFIX = 'openchamber.mobile.';
const MOBILE_CONNECTIONS_LIMIT = 12;
const MOBILE_CONNECT_TIMEOUT_MS = 8000;

export type MobileSavedConnection = {
  id: string;
  label: string;
  url: string;
  lastUsedAt: number;
  hasToken?: boolean;
  clientToken?: string;
};

export type MobileConnectInput = {
  url: string;
  clientToken?: string;
  label?: string;
  password?: string;
};

export const normalizeConnectionUrl = normalizeMobileServerUrl;

export const getConnectionLabel = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const getConnectionStorageKey = (url: string): string => {
  try {
    return normalizeConnectionUrl(url);
  } catch {
    return url.trim().replace(/\/+$/g, '');
  }
};

export const isSameConnectionUrl = (left: string, right: string): boolean =>
  getConnectionStorageKey(left) === getConnectionStorageKey(right);

const readConnections = (): MobileSavedConnection[] => {
  try {
    const raw = window.localStorage.getItem(MOBILE_CONNECTIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is MobileSavedConnection => (
      Boolean(entry)
      && typeof entry === 'object'
      && typeof (entry as MobileSavedConnection).id === 'string'
      && typeof (entry as MobileSavedConnection).url === 'string'
      && typeof (entry as MobileSavedConnection).label === 'string'
      && typeof (entry as MobileSavedConnection).lastUsedAt === 'number'
    ));
  } catch {
    return [];
  }
};

const writeConnections = (connections: MobileSavedConnection[]): void => {
  window.localStorage.setItem(MOBILE_CONNECTIONS_STORAGE_KEY, JSON.stringify(connections.slice(0, MOBILE_CONNECTIONS_LIMIT)));
};

const secureKeyForUrl = (url: string): string => `${MOBILE_SECURE_STORAGE_PREFIX}${getConnectionStorageKey(url)}`;

const readSecureToken = async (url: string): Promise<string | null> => {
  if (!isCapacitorApp()) return null;
  try {
    const value = await SecureStorage.get(secureKeyForUrl(url));
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
};

const writeSecureToken = async (url: string, token: string): Promise<void> => {
  if (!isCapacitorApp()) return;
  await SecureStorage.set(secureKeyForUrl(url), token);
};

const removeSecureToken = async (url: string): Promise<void> => {
  if (!isCapacitorApp()) return;
  try {
    await SecureStorage.remove(secureKeyForUrl(url));
  } catch {
    // ignore
  }
};

type MobileFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const mobileFetch = async (url: string, init: RequestInit = {}): Promise<MobileFetchResponse> => {
  if (isCapacitorApp()) {
    try {
      const method = (init.method || 'GET').toUpperCase();
      const headers: Record<string, string> = {};
      if (init.headers) {
        new Headers(init.headers).forEach((value, key) => {
          headers[key] = value;
        });
      }
      const response = await CapacitorHttp.request({
        url,
        method,
        headers,
        data: typeof init.body === 'string' ? init.body : undefined,
        connectTimeout: MOBILE_CONNECT_TIMEOUT_MS,
        readTimeout: MOBILE_CONNECT_TIMEOUT_MS,
      });
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => {
          if (typeof response.data === 'string') {
            try {
              return JSON.parse(response.data) as unknown;
            } catch {
              return response.data;
            }
          }
          return response.data;
        },
      };
    } catch {
      // fall through to browser fetch
    }
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), MOBILE_CONNECT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json().catch(() => null),
    };
  } finally {
    window.clearTimeout(timeout);
  }
};

const upsertConnection = async (input: MobileConnectInput & { token?: string | null }): Promise<MobileSavedConnection> => {
  const url = normalizeConnectionUrl(input.url);
  const label = (input.label || '').trim() || getConnectionLabel(url);
  const token = input.token?.trim() || input.clientToken?.trim() || '';
  const existing = readConnections();
  const next: MobileSavedConnection = {
    id: existing.find((entry) => isSameConnectionUrl(entry.url, url))?.id || crypto.randomUUID(),
    label,
    url,
    lastUsedAt: Date.now(),
    hasToken: Boolean(token),
    ...(isCapacitorApp() ? {} : (token ? { clientToken: token } : {})),
  };
  const merged = [next, ...existing.filter((entry) => !isSameConnectionUrl(entry.url, url))];
  writeConnections(merged);
  if (token) {
    if (isCapacitorApp()) await writeSecureToken(url, token);
  }
  return next;
};

export const listMobileConnections = (): MobileSavedConnection[] =>
  readConnections().slice().sort((a, b) => b.lastUsedAt - a.lastUsedAt);

export const removeMobileConnection = async (url: string): Promise<void> => {
  const normalized = normalizeConnectionUrl(url);
  writeConnections(readConnections().filter((entry) => !isSameConnectionUrl(entry.url, normalized)));
  await removeSecureToken(normalized);
};

export const connectToMobileServer = async (input: MobileConnectInput): Promise<MobileSavedConnection> => {
  const url = normalizeConnectionUrl(input.url);
  if (!url) throw new Error('Server URL is required');

  let token = input.clientToken?.trim() || '';
  if (!token && isCapacitorApp()) {
    token = (await readSecureToken(url)) || '';
  }
  if (!token) {
    const stored = listMobileConnections().find((entry) => isSameConnectionUrl(entry.url, url));
    token = stored?.clientToken?.trim() || '';
  }

  const health = await mobileFetch(`${url}/health`);
  if (!health.ok) {
    throw new Error(`Server unreachable (HTTP ${health.status})`);
  }

  const sessionProbe = await mobileFetch(`${url}/auth/session`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const sessionBody = await sessionProbe.json().catch(() => null) as { authenticated?: boolean; disabled?: boolean } | null;

  if (sessionBody?.disabled) {
    // Auth disabled — connect without token.
    connectMobileEndpoint({ url, clientToken: null, label: input.label });
    return upsertConnection({ url, label: input.label, token: null });
  }

  if (sessionProbe.ok && sessionBody?.authenticated) {
    connectMobileEndpoint({ url, clientToken: token || null, label: input.label });
    return upsertConnection({ url, label: input.label, token: token || null });
  }

  const password = input.password?.trim() || '';
  if (!password) {
    throw new Error('PASSWORD_REQUIRED');
  }

  const unlock = await mobileFetch(`${url}/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, trustDevice: true }),
  });
  if (!unlock.ok) {
    throw new Error('Invalid password');
  }
  const unlockBody = await unlock.json().catch(() => null) as { token?: string; clientToken?: string } | null;
  const issued = unlockBody?.clientToken || unlockBody?.token || '';
  if (!issued) {
    throw new Error('Server did not issue a client token');
  }

  connectMobileEndpoint({ url, clientToken: issued, label: input.label });
  return upsertConnection({ url, label: input.label, token: issued });
};

export const disconnectMobileServer = (): void => {
  disconnectMobileEndpoint();
};

export const useMobileConnections = (): {
  connections: MobileSavedConnection[];
  refresh: () => void;
} => {
  const [connections, setConnections] = React.useState<MobileSavedConnection[]>(() => listMobileConnections());
  const refresh = React.useCallback(() => {
    setConnections(listMobileConnections());
  }, []);
  return { connections, refresh };
};
