import { describe, expect, test } from 'bun:test';

import { aggregateSubscriptions } from './subscriptions.ts';

describe('VS Code subscription aggregation', () => {
  test('builds the web-compatible provider contract without secrets', async () => {
    // Given
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
      listProviderAuths: () => [],
      getProviderSources: (providerId, workingDirectory) => {
        expect(providerId).toBe('anthropic');
        expect(workingDirectory).toBe('/workspace/project');
        return {
          user: { exists: false },
          project: { exists: true },
          custom: { exists: false },
        };
      },
      listConfiguredQuotaProviders: () => ['claude'],
      now: () => 1784629500000,
    });

    // Then
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

  test('returns partial legacy data with degraded true when OpenCode is unavailable', async () => {
    // Given
    const fetchProvidersSnapshot = async () => {
      throw new Error('connection refused');
    };

    // When
    const payload = await aggregateSubscriptions({
      fetchProvidersSnapshot,
      listProviderAuths: () => ['anthropic'],
      getProviderSources: () => ({
        user: { exists: false },
        project: { exists: false },
        custom: { exists: false },
      }),
      listConfiguredQuotaProviders: () => [],
      now: () => 100,
    });

    // Then
    expect(payload).toEqual({
      providers: [{
        id: 'anthropic',
        name: 'anthropic',
        auth: { configured: true, source: 'api', envVars: [], type: 'unknown' },
        quota: { providerId: 'claude', configured: false },
        config: { user: false, project: false, custom: false },
        egress: { mode: 'direct' },
        conflicts: [],
      }],
      degraded: true,
      fetchedAt: 100,
    });
  });
});
