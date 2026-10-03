import { describe, expect, it, vi } from 'vitest';

vi.mock('../../opencode/auth.js', () => ({ readOpenCodeCredentials: async () => ({}) }));

import * as google from './google/index.js';
import { fetchQuotaForProvider, listConfiguredQuotaProviders } from './index.js';

describe('quota provider registry', () => {
  it('exposes the complete Google provider contract', () => {
    expect(google.providerId).toBe('google');
    expect(google.providerName).toBe('Google');
    expect(google.aliases).toContain('google.oauth');
    expect(typeof google.isConfigured).toBe('function');
    expect(typeof google.resolveGoogleAuthSources).toBe('function');
  });

  it('can list configured providers without missing provider exports', async () => {
    await expect(listConfiguredQuotaProviders()).resolves.toBeInstanceOf(Array);
  });

  it('dispatches Crof and NeuralWatt instead of treating them as unsupported', async () => {
    await expect(fetchQuotaForProvider('crof')).resolves.not.toMatchObject({
      error: 'Unsupported provider',
    });
    await expect(fetchQuotaForProvider('neuralwatt')).resolves.not.toMatchObject({
      error: 'Unsupported provider',
    });
  });

  it('coalesces simultaneous refreshes for the same provider', async () => {
    const first = fetchQuotaForProvider('unsupported-test-provider');
    const second = fetchQuotaForProvider('unsupported-test-provider');
    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({ error: 'Unsupported provider' });
  });
});
