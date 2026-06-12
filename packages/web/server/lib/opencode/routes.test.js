import { afterEach, describe, expect, mock, test } from 'bun:test';
import express from 'express';
import request from 'supertest';
import { registerOpenCodeRoutes } from './routes.js';

const createApp = (overrides = {}) => {
  const app = express();
  app.use(express.json());
  registerOpenCodeRoutes(app, {
    crypto,
    clientReloadDelayMs: 0,
    getOpenCodeResolutionSnapshot: () => null,
    formatSettingsResponse: (settings) => settings,
    readSettingsFromDisk: async () => ({}),
    readSettingsFromDiskMigrated: async () => ({}),
    persistSettings: async (settings) => settings,
    sanitizeProjects: (projects) => projects,
    validateDirectoryPath: async () => ({ ok: true }),
    resolveProjectDirectory: () => '',
    getProviderSources: async () => ({}),
    removeProviderConfig: async () => {},
    refreshOpenCodeAfterConfigChange: async () => {},
    executeDirectOpenCodeUpgrade: async () => ({ success: false, error: 'not configured' }),
    buildOpenCodeUrl: (pathname) => `http://opencode.test${pathname}`,
    getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
    ...overrides,
  });
  return app;
};

const jsonResponse = (payload, init = {}) =>
  new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

const originalFetch = globalThis.fetch;

const useFetchMock = (fetchMock) => {
  globalThis.fetch = fetchMock;
  return fetchMock;
};

describe('opencode routes', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test('proxies OpenCode health through /api/opencode/health', async () => {
    const fetchMock = useFetchMock(mock(async () => jsonResponse({ healthy: true })));

    const response = await request(createApp())
      .get('/api/opencode/health')
      .expect(200);

    expect(response.body).toEqual({ healthy: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://opencode.test/api/health',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  test('returns the normalized OpenCode version from global health', async () => {
    const fetchMock = useFetchMock(mock(async () => jsonResponse({ version: 'v1.2.3' })));

    const response = await request(createApp())
      .get('/api/opencode/version')
      .expect(200);

    expect(response.body).toEqual({ version: '1.2.3' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://opencode.test/global/health',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  test('preserves OpenCode version route failure status', async () => {
    useFetchMock(mock(async () => jsonResponse({ error: 'not ready' }, { status: 503 })));

    const response = await request(createApp())
      .get('/api/opencode/version')
      .expect(503);

    expect(response.body).toEqual({ version: null, error: 'not ready' });
  });

  test('does not restart managed OpenCode after an upstream upgrade succeeds', async () => {
    const fetchMock = useFetchMock(mock(async () => jsonResponse({ success: true, version: '1.2.4' })));
    const refreshOpenCodeAfterConfigChange = mock(async () => {});

    const response = await request(createApp({ refreshOpenCodeAfterConfigChange }))
      .post('/api/opencode/upgrade')
      .send({})
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      version: '1.2.4',
      requiresReload: true,
      restarted: false,
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(refreshOpenCodeAfterConfigChange).not.toHaveBeenCalled();
  });

  test('falls back to direct OpenCode upgrade when upstream closes the connection', async () => {
    const fetchMock = useFetchMock(mock(async () => {
      throw new TypeError('fetch failed');
    }));
    const executeDirectOpenCodeUpgrade = mock(async () => ({
      success: true,
      source: 'homebrew',
      command: 'brew upgrade opencode',
      exitCode: 0,
      stdout: 'upgraded',
      stderr: '',
    }));
    const refreshOpenCodeAfterConfigChange = mock(async () => {});

    const response = await request(createApp({
      executeDirectOpenCodeUpgrade,
      refreshOpenCodeAfterConfigChange,
    }))
      .post('/api/opencode/upgrade')
      .send({})
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      upgraded: true,
      requiresReload: true,
      restarted: false,
      upgradeSource: 'direct',
      source: 'homebrew',
      command: 'brew upgrade opencode',
      stdout: 'upgraded',
      upstream: {
        success: false,
        error: 'fetch failed',
      },
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(executeDirectOpenCodeUpgrade).toHaveBeenCalled();
    expect(refreshOpenCodeAfterConfigChange).not.toHaveBeenCalled();
  });

  test('returns direct upgrade diagnostics when the fallback command fails', async () => {
    useFetchMock(mock(async () => jsonResponse({ error: 'upstream failed' }, { status: 500 })));
    const executeDirectOpenCodeUpgrade = mock(async () => ({
      success: false,
      source: 'homebrew',
      command: 'brew upgrade opencode',
      exitCode: 1,
      stdout: 'stdout text',
      stderr: 'stderr text',
      error: 'Direct OpenCode upgrade failed',
    }));
    const refreshOpenCodeAfterConfigChange = mock(async () => {});

    const response = await request(createApp({
      executeDirectOpenCodeUpgrade,
      refreshOpenCodeAfterConfigChange,
    }))
      .post('/api/opencode/upgrade')
      .send({})
      .expect(500);

    expect(response.body).toMatchObject({
      success: false,
      upgradeSource: 'direct',
      source: 'homebrew',
      command: 'brew upgrade opencode',
      exitCode: 1,
      stdout: 'stdout text',
      stderr: 'stderr text',
      error: 'Direct OpenCode upgrade failed',
      upstream: {
        success: false,
        error: 'upstream failed',
      },
    });
    expect(refreshOpenCodeAfterConfigChange).not.toHaveBeenCalled();
  });
});
