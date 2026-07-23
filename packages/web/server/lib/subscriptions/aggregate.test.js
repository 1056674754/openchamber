import { describe, expect, test } from 'bun:test';
import { aggregateSubscriptions } from './aggregate.js';

describe('subscription aggregation', () => {
  test('builds the exact public provider payload from all sources', async () => {
    const payload = await aggregateSubscriptions({
      workingDirectory: '/workspace/project',
      processEnv: { ANTHROPIC_API_KEY: 'override' },
      fetchProvidersSnapshot: async () => [{
        id: 'anthropic',
        name: 'Anthropic',
        source: 'api',
        env: ['ANTHROPIC_API_KEY'],
        key: 'stored-secret',
        apiKey: 'another-secret',
        options: { headers: { Authorization: 'secret-header' } },
      }],
      getProviderSources: (providerId, workingDirectory) => {
        expect(providerId).toBe('anthropic');
        expect(workingDirectory).toBe('/workspace/project');
        return {
          sources: {
            user: { exists: false },
            project: { exists: true },
            custom: { exists: false },
          },
        };
      },
      listConfiguredQuotaProviders: () => ['claude'],
      now: () => 1784629500000,
    });

    expect(payload).toEqual({
      providers: [{
        id: 'anthropic',
        name: 'Anthropic',
        auth: {
          configured: true,
          source: 'api',
          envVars: ['ANTHROPIC_API_KEY'],
          type: 'api',
        },
        quota: { providerId: 'claude', configured: true },
        config: { user: false, project: true, custom: false },
        egress: { mode: 'direct' },
        conflicts: [{
          type: 'env-override',
          message: 'ANTHROPIC_API_KEY is set and may take precedence over stored credentials',
        }],
      }],
      degraded: false,
      fetchedAt: 1784629500000,
    });
    expect(JSON.stringify(payload)).not.toContain('stored-secret');
    expect(JSON.stringify(payload)).not.toContain('another-secret');
    expect(JSON.stringify(payload)).not.toContain('secret-header');
  });

  test('preserves fallback providers and degraded state when OpenCode is unavailable', async () => {
    const payload = await aggregateSubscriptions({
      fetchProvidersSnapshot: async () => {
        throw new Error('offline');
      },
      listProviderAuths: () => ['anthropic'],
      getProviderSources: () => ({ sources: {} }),
      listConfiguredQuotaProviders: () => [],
      now: () => 100,
    });

    expect(payload.degraded).toBe(true);
    expect(payload.providers).toHaveLength(1);
    expect(payload.providers[0]).toMatchObject({
      id: 'anthropic',
      auth: { configured: true, source: 'api', type: 'unknown' },
    });
  });
});
