import { describe, expect, mock, test } from 'bun:test';
import { getProviderAuthStates, removeProviderAuth } from './auth-adapter.js';

const jsonResponse = (payload, init = {}) => new Response(JSON.stringify(payload), {
  headers: { 'Content-Type': 'application/json' },
  ...init,
});

describe('subscription auth adapter', () => {
  test('maps OpenCode provider auth without exposing secrets', async () => {
    const fetchImpl = mock(async () => jsonResponse({
      all: [
        { id: 'anthropic', name: 'Anthropic', source: 'api', env: ['ANTHROPIC_API_KEY'], key: 'secret' },
        { id: 'plugin', name: 'Plugin', source: 'custom', env: [], key: 'oauth-secret', apiKey: 'hidden' },
        { id: 'unconfigured', name: 'Unconfigured', source: 'env', env: ['EMPTY_KEY'] },
      ],
      connected: ['anthropic', 'plugin'],
    }));

    const result = await getProviderAuthStates({
      buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Basic hidden' }),
      fetchImpl,
      listProviderAuths: () => {
        throw new Error('legacy fallback should not run');
      },
    });

    expect(result.degraded).toBe(false);
    expect(result.states).toEqual({
      anthropic: {
        configured: true,
        source: 'api',
        envVars: ['ANTHROPIC_API_KEY'],
        type: 'api',
      },
      plugin: {
        configured: true,
        source: 'custom',
        envVars: [],
        type: 'unknown',
      },
      unconfigured: {
        configured: false,
        source: 'none',
        envVars: ['EMPTY_KEY'],
        type: 'unknown',
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('apiKey');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://opencode.test/provider',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Basic hidden' }),
      }),
    );
  });

  test('returns partial legacy auth data with degraded true when OpenCode is down', async () => {
    const result = await getProviderAuthStates({
      fetchProvidersSnapshot: async () => {
        throw new Error('connection refused');
      },
      listProviderAuths: () => ['legacy-provider'],
    });

    expect(result).toEqual({
      providers: [{ id: 'legacy-provider', name: 'legacy-provider', source: 'api', env: [] }],
      states: {
        'legacy-provider': {
          configured: true,
          source: 'api',
          envVars: [],
          type: 'unknown',
        },
      },
      degraded: true,
    });
  });

  test('uses the legacy delete only when the OpenCode request is unreachable', async () => {
    const removeLegacyProviderAuth = mock(() => true);
    const result = await removeProviderAuth('anthropic', {
      buildOpenCodeUrl: () => {
        throw new Error('port unavailable');
      },
      getOpenCodeAuthHeaders: () => ({}),
      removeLegacyProviderAuth,
    });

    expect(result).toEqual({ removed: true, path: 'legacy' });
    expect(removeLegacyProviderAuth).toHaveBeenCalledWith('anthropic');
  });
});
