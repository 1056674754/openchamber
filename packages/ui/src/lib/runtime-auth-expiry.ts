import { create } from 'zustand';

import { getRuntimeKey } from '@/lib/runtime-switch';

export type AuthSessionState = 'ok' | 'expired' | 'reauthenticating';

interface AuthSessionStore {
  state: AuthSessionState;
  runtimeKey: string | null;
  markExpired: (runtimeKey: string) => void;
  markReauthenticating: () => void;
  markAuthenticated: (runtimeKey?: string | null) => void;
}

export const useAuthSessionStore = create<AuthSessionStore>((set) => ({
  state: 'ok',
  runtimeKey: null,
  markExpired: (runtimeKey) => set((current) => (
    current.state === 'expired' && current.runtimeKey === runtimeKey
      ? current
      : { state: 'expired', runtimeKey }
  )),
  markReauthenticating: () => set((current) => (
    current.state === 'expired'
      ? { state: 'reauthenticating', runtimeKey: current.runtimeKey }
      : current
  )),
  markAuthenticated: (runtimeKey) => set((current) => {
    if (runtimeKey && runtimeKey !== getRuntimeKey()) return current;
    if (current.state === 'ok' && current.runtimeKey === null) return current;
    return { state: 'ok', runtimeKey: null };
  }),
}));

const CONFIRM_PROBE_MIN_INTERVAL_MS = 15_000;
const FOCUS_REVALIDATE_MIN_INTERVAL_MS = 5 * 60_000;
const MAX_TRACKED_RUNTIMES = 16;

const lastProbeAtByRuntime = new Map<string, number>();
const probeInFlightByRuntime = new Set<string>();

const rememberProbe = (runtimeKey: string, timestamp: number): void => {
  lastProbeAtByRuntime.delete(runtimeKey);
  lastProbeAtByRuntime.set(runtimeKey, timestamp);
  while (lastProbeAtByRuntime.size > MAX_TRACKED_RUNTIMES) {
    const oldest = lastProbeAtByRuntime.keys().next().value;
    if (typeof oldest !== 'string') break;
    lastProbeAtByRuntime.delete(oldest);
  }
};

const isExcludedAuthPath = (url: string): boolean => (
  url.includes('/auth/session') || url.includes('/api/client-auth/')
);

const isClassifiablePath = (url: string): boolean => {
  const path = url.startsWith('/') ? url : (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  })();
  if (!path.startsWith('/api/') && !path.startsWith('/auth/')) return false;
  return !isExcludedAuthPath(path);
};

const confirmSessionExpired = async (runtimeKey: string): Promise<void> => {
  if (probeInFlightByRuntime.has(runtimeKey) || getRuntimeKey() !== runtimeKey) return;
  probeInFlightByRuntime.add(runtimeKey);
  try {
    const { runtimeFetch } = await import('./runtime-fetch');
    if (getRuntimeKey() !== runtimeKey) return;
    const response = await runtimeFetch('/auth/session', { credentials: 'include' });
    if (getRuntimeKey() !== runtimeKey) return;
    if (response.status === 401) {
      useAuthSessionStore.getState().markExpired(runtimeKey);
      return;
    }
    if (response.ok) {
      useAuthSessionStore.getState().markAuthenticated(runtimeKey);
    }
  } catch {
    // Connectivity failures are handled by the runtime connection state.
  } finally {
    probeInFlightByRuntime.delete(runtimeKey);
  }
};

export const observeRuntimeAuthResponse = (
  url: string,
  status: number,
  runtimeKey: string = getRuntimeKey(),
): void => {
  if (status !== 401 || !isClassifiablePath(url)) return;
  if (runtimeKey !== getRuntimeKey()) return;
  const current = useAuthSessionStore.getState();
  if (current.state === 'expired' && current.runtimeKey === runtimeKey) return;
  const now = Date.now();
  if (now - (lastProbeAtByRuntime.get(runtimeKey) ?? 0) < CONFIRM_PROBE_MIN_INTERVAL_MS) return;
  rememberProbe(runtimeKey, now);
  void confirmSessionExpired(runtimeKey);
};

let focusWatchInstalled = false;

export const installAuthSessionFocusWatch = (): void => {
  if (focusWatchInstalled || typeof document === 'undefined' || typeof window === 'undefined') return;
  focusWatchInstalled = true;
  let lastConfirmedAt = Date.now();
  const revalidate = () => {
    if (useAuthSessionStore.getState().state !== 'ok') return;
    const now = Date.now();
    if (now - lastConfirmedAt < FOCUS_REVALIDATE_MIN_INTERVAL_MS) return;
    lastConfirmedAt = now;
    const runtimeKey = getRuntimeKey();
    rememberProbe(runtimeKey, now);
    void confirmSessionExpired(runtimeKey);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revalidate();
  });
  window.addEventListener('focus', revalidate);
};

export const isRuntimeAuthBlocked = (runtimeKey: string = getRuntimeKey()): boolean => {
  const current = useAuthSessionStore.getState();
  return current.state !== 'ok' && current.runtimeKey === runtimeKey;
};

export const resetRuntimeAuthExpiryForTests = (): void => {
  lastProbeAtByRuntime.clear();
  probeInFlightByRuntime.clear();
  useAuthSessionStore.setState({ state: 'ok', runtimeKey: null });
};
