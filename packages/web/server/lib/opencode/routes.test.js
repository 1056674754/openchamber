import { afterEach, describe, expect, mock, test } from 'bun:test';
import express from 'express';
import request from 'supertest';
import { registerOpenCodeRoutes } from './routes.js';

const createApp = (overrides = {}) => {
  const app = express();
  app.use(express.json());
  registerOpenCodeRoutes(app, {
    crypto,
    getOpenCodeResolutionSnapshot: () => null,
    getOpenCodeUpgradeCapability: () => ({
      supported: true,
      manager: 'opencode',
      reason: null,
    }),
    formatSettingsResponse: (settings) => settings,
    readSettingsFromDisk: async () => ({}),
    readSettingsFromDiskMigrated: async () => ({}),
    persistSettings: async (settings) => settings,
    sanitizeProjects: (projects) => projects,
    validateDirectoryPath: async () => ({ ok: true }),
    resolveProjectDirectory: () => '',
    getProviderSources: async () => ({}),
    removeProviderConfig: async () => {},
    markPendingConfigRestart: () => ({ count: 1, reasons: ['provider change'] }),
    executeDirectOpenCodeUpgrade: async () => ({ success: false, error: 'not configured' }),
    buildOpenCodeUrl: (pathname) => `http://opencode.test${pathname}`,
    getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
    ...overrides,
  });
  return app;
};

const createMcpOAuthApp = (overrides = {}) => {
  const app = express();
  registerOpenCodeRoutes(app, {
    crypto,
    getOpenCodeResolutionSnapshot: () => null,
    getOpenCodeUpgradeCapability: () => ({ supported: false, manager: null, reason: 'external' }),
    formatSettingsResponse: (settings) => settings,
    readSettingsFromDisk: async () => ({}),
    readSettingsFromDiskMigrated: async () => ({}),
    persistSettings: async (settings) => settings,
    sanitizeProjects: (projects) => projects,
    validateDirectoryPath: async () => ({ ok: true }),
    resolveProjectDirectory: () => '',
    getProviderSources: async () => ({}),
    removeProviderConfig: async () => {},
    markPendingConfigRestart: () => ({ count: 0, reasons: [] }),
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

  test('persists ordinary OpenChamber settings without marking an OpenCode restart', async () => {
    const persistSettings = mock(async (settings) => settings);
    const markPendingConfigRestart = mock(() => ({ count: 1 }));

    const response = await request(createApp({ persistSettings, markPendingConfigRestart }))
      .put('/api/config/settings')
      .send({ autoSaveEnabled: false })
      .expect(200);

    expect(response.body).toEqual({ autoSaveEnabled: false });
    expect(persistSettings).toHaveBeenCalledWith({ autoSaveEnabled: false });
    expect(markPendingConfigRestart).not.toHaveBeenCalled();
  });

  test('reports Agent Memory feature availability separately from its stored toggle', async () => {
    const response = await request(createApp({
      readSettingsFromDiskMigrated: async () => ({ agentMemoryToolEnabled: false }),
      isAgentMemoryAvailable: () => true,
    }))
      .get('/api/config/settings')
      .expect(200);

    expect(response.body).toEqual({
      agentMemoryToolEnabled: false,
      agentMemoryAvailable: true,
    });
  });

  test('marks a restart only when the Agent Memory tool preference changes', async () => {
    const markPendingConfigRestart = mock(() => ({ count: 1 }));
    const persistSettings = mock(async (settings) => ({ ...settings }));

    await request(createApp({
      readSettingsFromDiskMigrated: async () => ({ agentMemoryToolEnabled: false }),
      persistSettings,
      markPendingConfigRestart,
    }))
      .put('/api/config/settings')
      .send({ agentMemoryToolEnabled: true })
      .expect(200);

    expect(markPendingConfigRestart).toHaveBeenCalledWith(
      'Agent Memory tool setting changed',
      { scope: 'agent-memory' },
    );

    markPendingConfigRestart.mockClear();
    await request(createApp({
      readSettingsFromDiskMigrated: async () => ({ agentMemoryToolEnabled: true }),
      persistSettings,
      markPendingConfigRestart,
    }))
      .put('/api/config/settings')
      .send({ agentMemoryToolEnabled: true })
      .expect(200);
    expect(markPendingConfigRestart).not.toHaveBeenCalled();
  });

  test('keeps provider source response shape while reading auth from the adapter', async () => {
    const response = await request(createApp({
      getProviderSources: () => ({
        sources: {
          auth: { exists: false },
          user: { exists: false, path: '/user/config.json' },
          project: { exists: true, path: '/project/opencode.json' },
          custom: { exists: false, path: null },
        },
      }),
      fetchProvidersSnapshot: async () => [{
        id: 'anthropic',
        name: 'Anthropic',
        source: 'api',
        env: ['ANTHROPIC_API_KEY'],
        key: 'hidden',
      }],
    }))
      .get('/api/provider/anthropic/source')
      .expect(200);

    expect(response.body).toEqual({
      providerId: 'anthropic',
      sources: {
        auth: { exists: true },
        user: { exists: false, path: '/user/config.json' },
        project: { exists: true, path: '/project/opencode.json' },
        custom: { exists: false, path: null },
      },
    });
  });

  test('proxies provider auth deletion to OpenCode without changing the response shape', async () => {
    const fetchMock = useFetchMock(mock(async () => jsonResponse(true)));
    const markPendingConfigRestart = mock(() => ({ count: 1, reasons: ['provider change'] }));

    const response = await request(createApp({ markPendingConfigRestart }))
      .delete('/api/provider/anthropic/auth')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      removed: true,
      requiresReload: false,
      requiresRestart: true,
      restartDeferred: true,
      pendingRestart: { count: 1, reasons: ['provider change'] },
      message: 'Provider disconnected successfully. Restart OpenCode to apply.',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://opencode.test/auth/anthropic',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
    expect(markPendingConfigRestart).toHaveBeenCalled();
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

  test('reports no OpenCode upgrade for a custom build on the same upstream version', async () => {
    useFetchMock(mock(async (url) => {
      const requestUrl = String(url);
      if (requestUrl === 'http://opencode.test/global/health') {
        return jsonResponse({ version: '1.17.6-codex.session-fixes.20260614' });
      }
      if (requestUrl === 'https://registry.npmjs.org/opencode-ai/latest') {
        return jsonResponse({ version: '1.17.6' });
      }
      if (requestUrl === 'https://api.github.com/repos/anomalyco/opencode/releases/latest') {
        return jsonResponse({ tag_name: 'v1.17.6' });
      }
      throw new Error(`Unexpected fetch: ${requestUrl}`);
    }));

    const response = await request(createApp())
      .get('/api/opencode/upgrade-status')
      .expect(200);

    expect(response.body).toEqual({
      available: false,
      currentVersion: '1.17.6-codex.session-fixes.20260614',
      latestVersion: '1.17.6',
      upgrade: {
        supported: true,
        manager: 'opencode',
        reason: null,
      },
    });
  });

  test('reports OpenCode upgrade for a release candidate behind the same stable version', async () => {
    useFetchMock(mock(async (url) => {
      const requestUrl = String(url);
      if (requestUrl === 'http://opencode.test/global/health') {
        return jsonResponse({ version: '1.17.6-rc.1' });
      }
      if (requestUrl === 'https://registry.npmjs.org/opencode-ai/latest') {
        return jsonResponse({ version: '1.17.6' });
      }
      if (requestUrl === 'https://api.github.com/repos/anomalyco/opencode/releases/latest') {
        return jsonResponse({ tag_name: 'v1.17.6' });
      }
      throw new Error(`Unexpected fetch: ${requestUrl}`);
    }));

    const response = await request(createApp())
      .get('/api/opencode/upgrade-status')
      .expect(200);

    expect(response.body).toEqual({
      available: true,
      currentVersion: '1.17.6-rc.1',
      latestVersion: '1.17.6',
      upgrade: {
        supported: true,
        manager: 'opencode',
        reason: null,
      },
    });
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

  test('refuses to mutate a signed bundled OpenCode binary in place', async () => {
    const fetchMock = useFetchMock(mock(async () => jsonResponse({ success: true })));

    const response = await request(createApp({
      getOpenCodeUpgradeCapability: () => ({
        supported: false,
        manager: 'openchamber',
        reason: 'bundled',
      }),
    }))
      .post('/api/opencode/upgrade')
      .send({})
      .expect(409);

    expect(response.body).toEqual({
      success: false,
      code: 'OPENCODE_UPGRADE_MANAGED_BY_OPENCHAMBER',
      error: 'OpenCode is bundled with OpenChamber Desktop and updates with the app.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('reports bundled ownership without checking release registries', async () => {
    const fetchMock = useFetchMock(mock(async (url) => {
      expect(String(url)).toBe('http://opencode.test/global/health');
      return jsonResponse({ version: '1.18.5-sscity' });
    }));

    const response = await request(createApp({
      getOpenCodeUpgradeCapability: () => ({
        supported: false,
        manager: 'openchamber',
        reason: 'bundled',
      }),
    }))
      .get('/api/opencode/upgrade-status')
      .expect(200);

    expect(response.body).toEqual({
      available: false,
      currentVersion: '1.18.5-sscity',
      latestVersion: null,
      upgrade: {
        supported: false,
        manager: 'openchamber',
        reason: 'bundled',
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe('MCP OAuth browser callback', () => {
  test('forwards a parked code to the owning directory and clears the state', async () => {
    const fetchMock = useFetchMock(mock(async () => jsonResponse({ success: true })));
    const app = createMcpOAuthApp();

    await request(app)
      .post('/api/mcp/auth/pending')
      .send({ state: 'state-1', name: 'linear', directory: '/projects/demo', origin: 'desktop' })
      .expect(200);

    const response = await request(app)
      .get('/mcp/oauth/callback')
      .query({ state: 'state-1', code: 'auth-code' })
      .expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [callbackUrl, callbackInit] = fetchMock.mock.calls[0];
    expect(String(callbackUrl)).toBe('http://opencode.test/mcp/linear/auth/callback?directory=%2Fprojects%2Fdemo');
    expect(callbackInit).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        body: JSON.stringify({ code: 'auth-code' }),
      }),
    );
    expect(response.text).toContain('Authorization Complete');
    expect(response.text).toContain('openchamber://focus/mcp-auth');
    await request(app).get('/api/mcp/auth/pending').query({ state: 'state-1' }).expect(404);
  });

  test('rejects an unknown state without forwarding its code', async () => {
    const fetchMock = useFetchMock(mock(async () => jsonResponse({ success: true })));

    const response = await request(createMcpOAuthApp())
      .get('/mcp/oauth/callback')
      .query({ state: 'forged', code: 'attacker-code' })
      .expect(400);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.text).toContain('Authorization Failed');
  });

  test('parks a relay callback for completion by the connected client', async () => {
    const fetchMock = useFetchMock(mock(async () => jsonResponse({ success: true })));
    const app = createMcpOAuthApp();

    await request(app)
      .post('/api/mcp/auth/pending')
      .send({ state: 'state-relay', name: 'linear', directory: '/remote/demo', completionMode: 'client' })
      .expect(200);

    await request(app)
      .get('/mcp/oauth/callback')
      .query({ state: 'state-relay', code: 'relay-code' })
      .expect(200);

    expect(fetchMock).not.toHaveBeenCalled();
    const pending = await request(app)
      .get('/api/mcp/auth/pending')
      .query({ state: 'state-relay' })
      .expect(200);
    expect(pending.body).toEqual(expect.objectContaining({
      name: 'linear',
      directory: '/remote/demo',
      code: 'relay-code',
    }));
  });

  test('escapes provider errors and never forwards them', async () => {
    const fetchMock = useFetchMock(mock(async () => jsonResponse({ success: true })));
    const app = createMcpOAuthApp();
    await request(app)
      .post('/api/mcp/auth/pending')
      .send({ state: 'state-error', name: 'linear' })
      .expect(200);

    const response = await request(app)
      .get('/mcp/oauth/callback')
      .query({ state: 'state-error', error: 'access_denied', error_description: 'User <denied> access' })
      .expect(400);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.text).toContain('User &lt;denied&gt; access');
  });
});
