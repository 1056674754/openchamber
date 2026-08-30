import { describe, expect, test } from 'bun:test';

import { providerHasCredentials, requiresOpenCodeReloadAfterOAuth } from './providerAuth';

describe('provider OAuth reload behavior', () => {
  test('keeps the Claude CLI provider live without reloading OpenCode', () => {
    expect(requiresOpenCodeReloadAfterOAuth('claude-code')).toBe(false);
    expect(requiresOpenCodeReloadAfterOAuth('github-copilot')).toBe(true);
  });
});

describe('provider credential signals', () => {
  test('accepts resolved keys, config apiKey, auth provenance, and declared env', () => {
    expect(providerHasCredentials({ key: 'resolved' })).toBe(true);
    expect(providerHasCredentials({ optionsApiKey: '{env:CUSTOM_KEY}' })).toBe(true);
    expect(providerHasCredentials({ authSourceExists: true })).toBe(true);
    expect(providerHasCredentials({ envDeclared: true })).toBe(true);
    expect(providerHasCredentials({ key: ' ', optionsApiKey: '', authSourceExists: false })).toBe(false);
  });
});
