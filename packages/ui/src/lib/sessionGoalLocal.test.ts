import { describe, expect, test } from 'bun:test';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import {
  isSessionGoalSupportedForSession,
  isSessionGoalSupportedOnServer,
  probeSessionGoalSupport,
  resetSessionGoalSupportCacheForTests,
  resolveSessionGoalServerId,
} from '@/lib/sessionGoalLocal';

describe('sessionGoalLocal', () => {
  test('treats missing/default serverId as supported without probing', async () => {
    resetSessionGoalSupportCacheForTests();
    expect(isSessionGoalSupportedOnServer(undefined)).toBe(true);
    expect(isSessionGoalSupportedOnServer(DEFAULT_SERVER_ID)).toBe(true);
    const result = await probeSessionGoalSupport(DEFAULT_SERVER_ID);
    expect(result).toEqual({
      supported: true,
      reason: 'supported',
    });
  });

  test('sync gate fails closed for unknown remotes until probe succeeds', () => {
    resetSessionGoalSupportCacheForTests();
    expect(isSessionGoalSupportedOnServer('remote-a')).toBe(false);
  });

  test('resolves session support from lookup', () => {
    resetSessionGoalSupportCacheForTests();
    expect(resolveSessionGoalServerId('ses_1', () => 'remote-a')).toBe('remote-a');
    expect(isSessionGoalSupportedForSession('ses_1', () => 'remote-a')).toBe(false);
    expect(resolveSessionGoalServerId('ses_1', () => undefined)).toBe(DEFAULT_SERVER_ID);
    expect(isSessionGoalSupportedForSession('ses_1', () => undefined)).toBe(true);
  });

  test('probe marks capable remotes supported', async () => {
    resetSessionGoalSupportCacheForTests();
    serverRegistry.register({
      id: 'remote-capable',
      label: 'Capable',
      baseUrl: '/api/remote/remote-capable',
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ goals: true, apiVersion: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    try {
      const result = await probeSessionGoalSupport('remote-capable');
      expect(result).toEqual({ supported: true, reason: 'supported' });
      expect(isSessionGoalSupportedOnServer('remote-capable')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      serverRegistry.unregister('remote-capable');
      resetSessionGoalSupportCacheForTests();
    }
  });

  test('probe marks unreachable remotes', async () => {
    resetSessionGoalSupportCacheForTests();
    serverRegistry.register({
      id: 'remote-down',
      label: 'Down',
      baseUrl: '/api/remote/remote-down',
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network');
    }) as typeof fetch;

    try {
      const result = await probeSessionGoalSupport('remote-down');
      expect(result).toEqual({ supported: false, reason: 'unreachable' });
      expect(isSessionGoalSupportedOnServer('remote-down')).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      serverRegistry.unregister('remote-down');
      resetSessionGoalSupportCacheForTests();
    }
  });
});
