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

  test('returns an empty degraded result when OpenCode is down', async () => {
    const result = await getProviderAuthStates({
      fetchProvidersSnapshot: async () => {
        throw new Error('connection refused');
      },
    });

    expect(result).toEqual({ providers: [], states: {}, degraded: true });
  });

  test('surfaces an unreachable OpenCode instead of a local fallback on delete', async () => {
    await expect(removeProviderAuth('anthropic', {
      buildOpenCodeUrl: () => {
        throw new Error('port unavailable');
      },
      getOpenCodeAuthHeaders: () => ({}),
    })).rejects.toThrow('OpenCode auth DELETE unreachable for anthropic');
  });
});
