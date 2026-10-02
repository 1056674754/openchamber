import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOpenCodeUpgradeStatus,
  upgradeManagedOpenCode,
  type OpenCodeUpgradeManager,
} from './opencode-upgrade-runtime';

const originalFetch = globalThis.fetch;

// A v1 OpenCode server 404s /api/info (the v2 probe) before /global/health
// answers; every fetch stub below that models a v1 managed server starts with
// this branch.
const isV1ApiInfoRequest = (url: string) => url.endsWith('/api/info');

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const createManager = (mode: 'managed' | 'external' = 'managed') => {
  let restartCount = 0;
  const manager: OpenCodeUpgradeManager = {
    getApiUrl: () => 'http://127.0.0.1:4096',
    getOpenCodeAuthHeaders: () => ({ Authorization: 'Basic test' }),
    getDebugInfo: () => ({ mode }),
    restart: async () => { restartCount += 1; },
  };
  return { manager, getRestartCount: () => restartCount };
};

describe('VS Code OpenCode upgrades', () => {
  test('reports an available update for a managed OpenCode process', async () => {
    const { manager } = createManager();
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (isV1ApiInfoRequest(url)) {
        return new Response(null, { status: 404, statusText: 'Not Found' });
      }
      if (url.endsWith('/global/health')) {
        return new Response(JSON.stringify({ version: '1.18.8', healthy: true }));
      }
      return new Response(JSON.stringify({ version: '1.18.9', tag_name: 'v1.18.9' }));
    }) as typeof fetch;

    assert.deepEqual(await getOpenCodeUpgradeStatus(manager), {
      available: true,
      currentVersion: '1.18.8',
      latestVersion: '1.18.9',
      upgrade: { supported: true, manager: 'opencode', reason: null },
    });
  });

  test('reads the current version from /api/info on a v2 managed OpenCode', async () => {
    const { manager } = createManager();
    let healthEndpointHit = false;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith('/api/info')) {
        return new Response(JSON.stringify({ version: '2.0.14-sscity', pid: 7 }));
      }
      if (url.endsWith('/global/health')) {
        healthEndpointHit = true;
        return new Response(JSON.stringify({ version: '1.0.0', healthy: true }));
      }
      return new Response(JSON.stringify({ version: '2.1.0', tag_name: 'v2.1.0' }));
    }) as typeof fetch;

    assert.deepEqual(await getOpenCodeUpgradeStatus(manager), {
      available: true,
      currentVersion: '2.0.14-sscity',
      latestVersion: '2.1.0',
      upgrade: { supported: true, manager: 'opencode', reason: null },
    });
    assert.equal(healthEndpointHit, false);
  });

  test('does not treat an sscity build as older than the same stable core', async () => {
    const { manager } = createManager();
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (isV1ApiInfoRequest(url)) {
        return new Response(null, { status: 404, statusText: 'Not Found' });
      }
      if (url.endsWith('/global/health')) {
        return new Response(JSON.stringify({ version: '1.18.5-sscity', healthy: true }));
      }
      return new Response(JSON.stringify({ version: '1.18.5', tag_name: 'v1.18.5' }));
    }) as typeof fetch;

    const status = await getOpenCodeUpgradeStatus(manager);
    assert.equal(status.available, false);
  });

  test('surfaces the probe error when both version endpoints fail', async () => {
    const { manager } = createManager();
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:4096/')) {
        if (url.endsWith('/api/info')) {
          return new Response(null, { status: 404, statusText: 'Not Found' });
        }
        return new Response(JSON.stringify({ error: 'down' }), { status: 503, statusText: 'Service Unavailable' });
      }
      return new Response(JSON.stringify({ version: '1.18.9', tag_name: 'v1.18.9' }));
    }) as typeof fetch;

    const status = await getOpenCodeUpgradeStatus(manager);
    assert.equal(status.available, null);
    assert.equal(status.error, 'down');
  });

  test('fails closed for externally managed OpenCode without contacting the updater', async () => {
    const { manager } = createManager('external');
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response('{}');
    }) as typeof fetch;

    assert.deepEqual(await upgradeManagedOpenCode(manager), {
      status: 409,
      body: {
        success: false,
        code: 'OPENCODE_UPGRADE_UNSUPPORTED',
        error: 'This OpenCode runtime cannot be upgraded by OpenChamber.',
      },
    });
    assert.equal(fetchCount, 0);
  });

  test('upgrades then restarts the extension-owned OpenCode process', async () => {
    const { manager, getRestartCount } = createManager();
    globalThis.fetch = (async (input, init) => {
      assert.equal(String(input), 'http://127.0.0.1:4096/global/upgrade');
      assert.equal(init?.body, JSON.stringify({ target: '1.18.9' }));
      return new Response(JSON.stringify({ success: true, version: '1.18.9' }));
    }) as typeof fetch;

    assert.deepEqual(await upgradeManagedOpenCode(manager, '1.18.9'), {
      status: 200,
      body: { success: true, version: '1.18.9', restarted: true },
    });
    assert.equal(getRestartCount(), 1);
  });

  test('resolves the latest release before an untargeted upgrade', async () => {
    const { manager, getRestartCount } = createManager();
    let upgradeBody: string | undefined;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === 'https://registry.npmjs.org/opencode-ai/latest') {
        return new Response(JSON.stringify({ version: '1.18.9' }));
      }
      if (url === 'https://api.github.com/repos/anomalyco/opencode/releases/latest') {
        return new Response(JSON.stringify({ tag_name: 'v1.19.0' }));
      }
      upgradeBody = typeof init?.body === 'string' ? init.body : undefined;
      return new Response(JSON.stringify({ success: true, version: '1.19.0' }));
    }) as typeof fetch;

    const result = await upgradeManagedOpenCode(manager);

    assert.equal(upgradeBody, JSON.stringify({ target: '1.19.0' }));
    assert.deepEqual(result, {
      status: 200,
      body: { success: true, version: '1.19.0', restarted: true },
    });
    assert.equal(getRestartCount(), 1);
  });

  test('reports a target lookup failure without contacting OpenCode', async () => {
    const { manager, getRestartCount } = createManager();
    let openCodeRequestCount = 0;
    globalThis.fetch = (async (input) => {
      if (String(input).startsWith('http://127.0.0.1:4096/')) openCodeRequestCount += 1;
      return new Response('{}', { status: 503 });
    }) as typeof fetch;

    const result = await upgradeManagedOpenCode(manager);

    assert.equal(result.status, 502);
    assert.equal(result.body.code, 'OPENCODE_UPGRADE_TARGET_UNRESOLVED');
    assert.equal(openCodeRequestCount, 0);
    assert.equal(getRestartCount(), 0);
  });

  test('surfaces nested OpenCode upgrade failure details', async () => {
    const { manager, getRestartCount } = createManager();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: { message: 'Requested release is not available' },
    }), { status: 422 })) as typeof fetch;

    assert.deepEqual(await upgradeManagedOpenCode(manager, '9.9.9'), {
      status: 422,
      body: { success: false, error: 'Requested release is not available' },
    });
    assert.equal(getRestartCount(), 0);
  });
});
