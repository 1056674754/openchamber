import { afterEach, describe, expect, mock, test } from 'bun:test';
import express from 'express';
import request from 'supertest';
import { registerOpenCodeRoutes } from './routes.js';

const createApp = () => {
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
    buildOpenCodeUrl: (pathname) => `http://opencode.test${pathname}`,
    getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
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
});
