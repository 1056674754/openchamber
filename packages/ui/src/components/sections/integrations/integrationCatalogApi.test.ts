import { describe, expect, mock, test } from 'bun:test';

import type { RuntimeFetchOptions } from '@/lib/runtime-fetch';

import { loadIntegrationCatalog, mutateIntegrationPlugin } from './integrationCatalogApi';

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('integration catalog API', () => {
  test('routes list and registry reads through the explicit remote Settings base URL', async () => {
    const calls: string[] = [];
    const fetcher = mock(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/registry?')) {
        return jsonResponse({
          results: [{
            kind: 'npm-ok',
            spec: '@openchamber/opencode-claude@1.0.0',
            name: '@openchamber/opencode-claude',
            currentVersion: '1.0.0',
            latestVersion: '2.0.0',
            versions: ['1.0.0', '2.0.0'],
            hasUpdate: true,
          }],
        });
      }
      return jsonResponse({
        entries: [{
          id: 'config:user:claude',
          spec: '@openchamber/opencode-claude@1.0.0',
          scope: 'user',
          kind: 'config',
          parsedKind: 'npm',
        }],
        files: [],
      });
    });

    const result = await loadIntegrationCatalog(
      '/api/remote/dev3',
      ['@openchamber/opencode-claude'],
      { fetcher },
    );

    expect(calls[0]).toBe('/api/remote/dev3/config/plugins');
    expect(calls[1]?.startsWith('/api/remote/dev3/config/plugins/registry?')).toBe(true);
    expect(calls[1]).toContain('%40openchamber%2Fopencode-claude%401.0.0');
    expect(result.entries).toHaveLength(1);
    expect(result.registryUnavailable).toBe(false);
  });

  test('preserves the plugin list when npm registry lookup is temporarily unavailable', async () => {
    let call = 0;
    const fetcher = mock(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ entries: [], files: [] })
        : jsonResponse({ error: 'offline' }, 503);
    });

    const result = await loadIntegrationCatalog('', ['@openchamber/opencode-claude'], { fetcher });

    expect(result).toEqual({ entries: [], registryInfo: {}, registryUnavailable: true });
  });

  test('installs a pinned user plugin and exposes the deferred restart contract', async () => {
    const requests: Array<{ input: string; init?: RuntimeFetchOptions }> = [];
    const fetcher = mock(async (input: string | URL | Request, init?: RuntimeFetchOptions) => {
      requests.push({ input: String(input), init });
      return jsonResponse({
        success: true,
        restartDeferred: true,
        message: 'Restart OpenCode to apply.',
      });
    });

    const result = await mutateIntegrationPlugin('/api/remote/dev3', {
      type: 'install',
      spec: '@openchamber/opencode-claude@2.0.0',
    }, { fetcher });

    const request = requests[0];
    expect(request?.input).toBe('/api/remote/dev3/config/plugins/entry');
    expect(request?.init?.method).toBe('POST');
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      spec: '@openchamber/opencode-claude@2.0.0',
      scope: 'user',
    });
    expect(result.restartDeferred).toBe(true);
  });

  test('surfaces the raw mutation error', async () => {
    const fetcher = mock(async () => jsonResponse({ error: 'ENTRY_EXISTS: duplicate plugin' }, 409));

    await expect(mutateIntegrationPlugin('', {
      type: 'install',
      spec: '@openchamber/opencode-claude@2.0.0',
    }, { fetcher })).rejects.toThrow('ENTRY_EXISTS: duplicate plugin');
  });
});
