import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { getRuntimeKey } from '@/lib/runtime-switch';
import {
  isRuntimeAuthBlocked,
  observeRuntimeAuthResponse,
  resetRuntimeAuthExpiryForTests,
  useAuthSessionStore,
} from './runtime-auth-expiry';

const originalFetch = globalThis.fetch;
const settleProbe = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('runtime auth expiry', () => {
  beforeEach(() => resetRuntimeAuthExpiryForTests());
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetRuntimeAuthExpiryForTests();
  });

  test('confirms a runtime 401 before marking the active session expired', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch;

    observeRuntimeAuthResponse('/api/session', 401);
    await settleProbe();

    expect(useAuthSessionStore.getState().state).toBe('expired');
    expect(useAuthSessionStore.getState().runtimeKey).toBe(getRuntimeKey());
    expect(isRuntimeAuthBlocked()).toBe(true);
  });

  test('does not confuse a provider-side 401 with UI auth expiry', async () => {
    globalThis.fetch = (async () => Response.json({ authenticated: true })) as typeof fetch;

    observeRuntimeAuthResponse('/api/provider/request', 401);
    await settleProbe();

    expect(useAuthSessionStore.getState().state).toBe('ok');
    expect(isRuntimeAuthBlocked()).toBe(false);
  });

  test('ignores excluded auth flows and stale runtime responses', async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response('{}', { status: 401 });
    }) as typeof fetch;

    observeRuntimeAuthResponse('/auth/session', 401);
    observeRuntimeAuthResponse('/api/client-auth/redeem', 401);
    observeRuntimeAuthResponse('/api/session', 401, 'stale-runtime');
    await settleProbe();

    expect(fetchCount).toBe(0);
    expect(useAuthSessionStore.getState().state).toBe('ok');
  });

  test('coalesces a burst of suspicious responses into one confirmation probe', async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return Response.json({ authenticated: true });
    }) as typeof fetch;

    observeRuntimeAuthResponse('/api/one', 401);
    observeRuntimeAuthResponse('/api/two', 401);
    await settleProbe();

    expect(fetchCount).toBe(1);
  });

  test('only an authentication result for the active runtime clears the blocker', () => {
    const runtimeKey = getRuntimeKey();
    useAuthSessionStore.getState().markExpired(runtimeKey);

    useAuthSessionStore.getState().markAuthenticated('stale-runtime');
    expect(useAuthSessionStore.getState().state).toBe('expired');

    useAuthSessionStore.getState().markAuthenticated(runtimeKey);
    expect(useAuthSessionStore.getState().state).toBe('ok');
  });
});
