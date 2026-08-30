import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fetchOpenCodeGoUsage, parseOpenCodeGoUsage } from './opencode-go.js';

mock.module('../../opencode/auth.js', () => ({
  readAuthFile: () => ({ 'opencode-go': { key: 'api-key' } }),
}));

mock.module('../opencode-go-credentials.js', () => ({
  deleteLegacyOpenCodeGoCredential: () => undefined,
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenCode Go quota provider', () => {
  test('parses partial API usage windows', () => {
    const windows = parseOpenCodeGoUsage({
      usage: {
        rolling: { percent: 25, resetsAt: '2026-08-30T12:00:00Z' },
        weekly: { percent: 40, resetsAt: '2026-09-01T12:00:00Z' },
      },
    });

    expect(windows['5h'].usedPercent).toBe(25);
    expect(windows['5h'].resetAt).toBe(Date.parse('2026-08-30T12:00:00Z'));
    expect(windows.weekly.usedPercent).toBe(40);
    expect(windows.monthly).toBeUndefined();
  });

  test('uses the OpenCode Go JSON API with bearer auth', async () => {
    let capturedUrl = '';
    let capturedAuthorization = '';
    await expect(
      fetchOpenCodeGoUsage('api-key', async (url, init) => {
        capturedUrl = String(url);
        capturedAuthorization = String(init?.headers?.Authorization ?? '');
        return Response.json({ usage: { rolling: { percent: 10, resetsAt: '2026-08-30T12:00:00Z' } } });
      }),
    ).resolves.toHaveProperty('5h');
    expect(capturedUrl).toBe('https://opencode.ai/zen/go/v1/usage');
    expect(capturedAuthorization).toBe('Bearer api-key');
  });

  test('rejects responses without recognizable usage data', async () => {
    await expect(
      fetchOpenCodeGoUsage('api-key', async () => Response.json({})),
    ).rejects.toThrow('could not be parsed');
  });
});
