import { describe, expect, test } from 'bun:test';

import { requiresProviderAuth } from './providerAvailability';

describe('provider authentication availability', () => {
  test('does not require a separate credential for config-defined custom providers', () => {
    expect(requiresProviderAuth(true, false, true)).toBe(false);
    expect(requiresProviderAuth(true, false, false)).toBe(true);
    expect(requiresProviderAuth(true, true, false)).toBe(false);
    expect(requiresProviderAuth(false, false, false)).toBe(false);
  });
});
