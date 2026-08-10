import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyProviderEnvAliases } from './provider-env-aliases';

describe('VS Code provider environment aliases', () => {
  test('mirrors the first Google credential alias into unset siblings', () => {
    assert.deepStrictEqual(applyProviderEnvAliases({ GEMINI_API_KEY: 'gemini' }), {
      GEMINI_API_KEY: 'gemini',
      GOOGLE_API_KEY: 'gemini',
      GOOGLE_GENERATIVE_AI_API_KEY: 'gemini',
    });
  });
});
