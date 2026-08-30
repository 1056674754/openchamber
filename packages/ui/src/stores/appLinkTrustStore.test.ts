import { beforeEach, describe, expect, test } from 'bun:test';

import { MAX_TRUSTED_SCHEMES, useAppLinkTrustStore } from './appLinkTrustStore';

describe('app link trust store', () => {
  beforeEach(() => {
    useAppLinkTrustStore.setState({ trustedSchemes: [] });
  });

  test('normalizes, deduplicates, and removes schemes', () => {
    const store = useAppLinkTrustStore.getState();
    store.trustScheme(' Obsidian ');
    store.trustScheme('linear');
    store.trustScheme('OBSIDIAN');
    expect(useAppLinkTrustStore.getState().trustedSchemes).toEqual(['obsidian', 'linear']);
    store.removeTrustedScheme('OBSIDIAN');
    expect(useAppLinkTrustStore.getState().trustedSchemes).toEqual(['linear']);
  });

  test('caps per-device trusted schemes', () => {
    for (let index = 0; index < MAX_TRUSTED_SCHEMES + 3; index += 1) {
      useAppLinkTrustStore.getState().trustScheme(`scheme${index}`);
    }
    expect(useAppLinkTrustStore.getState().trustedSchemes).toHaveLength(MAX_TRUSTED_SCHEMES);
  });
});
