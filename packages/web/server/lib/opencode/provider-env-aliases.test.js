import { describe, expect, test } from 'bun:test';

import { applyProviderEnvAliases } from './provider-env-aliases.js';

describe('provider environment aliases', () => {
  test('uses the highest-priority configured Google key without overwriting values', () => {
    expect(applyProviderEnvAliases({
      GEMINI_API_KEY: 'gemini',
      GOOGLE_API_KEY: 'google',
    })).toEqual({
      GEMINI_API_KEY: 'gemini',
      GOOGLE_API_KEY: 'google',
      GOOGLE_GENERATIVE_AI_API_KEY: 'google',
    });
  });
});
