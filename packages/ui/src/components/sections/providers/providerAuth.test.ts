import { describe, expect, test } from 'bun:test';

import { requiresOpenCodeReloadAfterOAuth } from './providerAuth';

describe('provider OAuth reload behavior', () => {
  test('keeps the Claude CLI provider live without reloading OpenCode', () => {
    expect(requiresOpenCodeReloadAfterOAuth('claude-code')).toBe(false);
    expect(requiresOpenCodeReloadAfterOAuth('github-copilot')).toBe(true);
  });
});
