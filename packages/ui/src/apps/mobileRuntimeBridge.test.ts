import { describe, expect, mock, test } from 'bun:test';

const switchCalls: unknown[] = [];
const registerCalls: unknown[] = [];
const unregisterCalls: string[] = [];

mock.module('@/lib/runtime-switch', () => ({
  getRuntimeApiBaseUrl: () => '',
  getRuntimeKey: () => '',
  switchRuntimeEndpoint: (options: unknown) => {
    switchCalls.push(options);
  },
}));

mock.module('@/lib/opencode/server-registry', () => ({
  DEFAULT_SERVER_ID: 'default',
  serverRegistry: {
    register: (entry: unknown) => {
      registerCalls.push(entry);
    },
    unregister: (id: string) => {
      unregisterCalls.push(id);
    },
  },
}));

const {
  connectMobileEndpoint,
  disconnectMobileEndpoint,
  getMobileActiveServerId,
  isLegacyMobileActiveServerId,
  LEGACY_MOBILE_ACTIVE_SERVER_ID,
  normalizeMobileServerUrl,
} = await import('./mobileRuntimeBridge');

describe('mobileRuntimeBridge', () => {
  test('normalizeMobileServerUrl adds scheme and strips trailing slash/search/hash', () => {
    expect(normalizeMobileServerUrl('192.168.1.10:3000')).toBe('http://192.168.1.10:3000');
    expect(normalizeMobileServerUrl('https://example.com/path/?x=1#h')).toBe('https://example.com/path');
    expect(normalizeMobileServerUrl('  ')).toBe('');
  });

  test('connectMobileEndpoint retargets default only (no synthetic mobile-active persist id)', () => {
    switchCalls.length = 0;
    registerCalls.length = 0;
    unregisterCalls.length = 0;

    const serverId = connectMobileEndpoint({
      url: 'http://10.0.0.2:3000/',
      clientToken: 'tok',
      label: 'Office',
    });

    expect(serverId).toBe('default');
    expect(getMobileActiveServerId()).toBe('default');
    expect(switchCalls).toEqual([{
      apiBaseUrl: 'http://10.0.0.2:3000',
      clientToken: 'tok',
      relay: null,
      runtimeKey: 'mobile:http://10.0.0.2:3000',
    }]);
    expect(registerCalls).toEqual([{
      id: 'default',
      label: 'Office',
      baseUrl: 'http://10.0.0.2:3000/api',
      healthUrl: 'http://10.0.0.2:3000/health',
      authToken: 'tok',
    }]);
    expect(unregisterCalls).toEqual([LEGACY_MOBILE_ACTIVE_SERVER_ID]);
  });

  test('disconnectMobileEndpoint clears runtime and drops legacy mobile-active', () => {
    switchCalls.length = 0;
    unregisterCalls.length = 0;

    disconnectMobileEndpoint();
    expect(switchCalls).toEqual([{
      apiBaseUrl: '',
      clientToken: null,
      runtimeKey: 'mobile-disconnected',
    }]);
    expect(unregisterCalls).toEqual([LEGACY_MOBILE_ACTIVE_SERVER_ID]);
  });

  test('isLegacyMobileActiveServerId detects polluted project tags', () => {
    expect(isLegacyMobileActiveServerId('mobile-active')).toBe(true);
    expect(isLegacyMobileActiveServerId('default')).toBe(false);
    expect(isLegacyMobileActiveServerId(null)).toBe(false);
  });
});
