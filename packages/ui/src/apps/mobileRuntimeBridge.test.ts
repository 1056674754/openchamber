import { describe, expect, mock, test } from 'bun:test';

const switchCalls: unknown[] = [];
const registerCalls: unknown[] = [];
const unregisterCalls: string[] = [];

mock.module('@/lib/runtime-switch', () => ({
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
  normalizeMobileServerUrl,
} = await import('./mobileRuntimeBridge');

describe('mobileRuntimeBridge', () => {
  test('normalizeMobileServerUrl adds scheme and strips trailing slash/search/hash', () => {
    expect(normalizeMobileServerUrl('192.168.1.10:3000')).toBe('http://192.168.1.10:3000');
    expect(normalizeMobileServerUrl('https://example.com/path/?x=1#h')).toBe('https://example.com/path');
    expect(normalizeMobileServerUrl('  ')).toBe('');
  });

  test('connectMobileEndpoint switches runtime and registers serverIds', () => {
    switchCalls.length = 0;
    registerCalls.length = 0;
    unregisterCalls.length = 0;

    const serverId = connectMobileEndpoint({
      url: 'http://10.0.0.2:3000/',
      clientToken: 'tok',
      label: 'Office',
    });

    expect(serverId).toBe(getMobileActiveServerId());
    expect(switchCalls).toEqual([{
      apiBaseUrl: 'http://10.0.0.2:3000',
      clientToken: 'tok',
      runtimeKey: 'mobile:http://10.0.0.2:3000',
    }]);
    expect(registerCalls.length).toBe(2);
    expect(registerCalls[0]).toEqual({
      id: 'mobile-active',
      label: 'Office',
      baseUrl: 'http://10.0.0.2:3000',
      authToken: 'tok',
    });
    expect(registerCalls[1]).toEqual({
      id: 'default',
      label: 'Office',
      baseUrl: 'http://10.0.0.2:3000',
      authToken: 'tok',
    });
  });

  test('disconnectMobileEndpoint clears runtime and unregisters mobile-active', () => {
    switchCalls.length = 0;
    unregisterCalls.length = 0;

    disconnectMobileEndpoint();
    expect(switchCalls).toEqual([{
      apiBaseUrl: '',
      clientToken: null,
      runtimeKey: 'mobile-disconnected',
    }]);
    expect(unregisterCalls).toEqual(['mobile-active']);
  });
});
