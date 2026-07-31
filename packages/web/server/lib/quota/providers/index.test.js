import { describe, expect, it } from 'vitest';

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

  it('lists configured providers without missing provider exports', () => {
    expect(() => listConfiguredQuotaProviders()).not.toThrow();
  });

  it('dispatches Crof and NeuralWatt instead of treating them as unsupported', async () => {
    await expect(fetchQuotaForProvider('crof')).resolves.not.toMatchObject({
      error: 'Unsupported provider',
    });
    await expect(fetchQuotaForProvider('neuralwatt')).resolves.not.toMatchObject({
      error: 'Unsupported provider',
    });
  });
});
