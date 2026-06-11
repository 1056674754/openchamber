import { describe, expect, test } from 'bun:test';

import {
  normalizeConfigString,
  persistOpenChamberSettingsPatch,
  resolveConfiguredAgentName,
} from './configDefaults';

describe('config defaults', () => {
  test('normalizes invisible format characters from settings strings', () => {
    expect(normalizeConfigString('\u200BSisyphus - Ultraworker\uFEFF')).toBe('Sisyphus - Ultraworker');
  });

  test('resolves configured agent names by normalized display name', () => {
    const result = resolveConfiguredAgentName('\u200BSisyphus - Ultraworker', [
      { name: 'Sisyphus - ultraworker' },
      { name: 'build' },
    ]);

    expect(result).toEqual({
      name: 'Sisyphus - ultraworker',
      correctedName: 'Sisyphus - ultraworker',
      invalid: false,
    });
  });

  test('persists settings patches to a scoped remote settings endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      });
      return new Response('{}', { status: 200 });
    };

    try {
      await persistOpenChamberSettingsPatch(
        { defaultModel: '', defaultAgent: 'Sisyphus - ultraworker' },
        'http://127.0.0.1:55641/api',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:55641/api/config/settings',
        body: { defaultModel: '', defaultAgent: 'Sisyphus - ultraworker' },
      },
    ]);
  });
});
