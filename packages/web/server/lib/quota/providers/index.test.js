import { describe, expect, it } from 'vitest';

import * as google from './google/index.js';
import { listConfiguredQuotaProviders } from './index.js';

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
});
