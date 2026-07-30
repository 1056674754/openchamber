import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOpenCodeUpgradeStatus,
  upgradeManagedOpenCode,
  type OpenCodeUpgradeManager,
} from './opencode-upgrade-runtime';

const originalFetch = globalThis.fetch;

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
      if (url.endsWith('/global/health')) {
        return new Response(JSON.stringify({ version: '1.18.8' }));
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

  test('does not treat an sscity build as older than the same stable core', async () => {
    const { manager } = createManager();
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith('/global/health')) {
        return new Response(JSON.stringify({ version: '1.18.5-sscity' }));
      }
      return new Response(JSON.stringify({ version: '1.18.5', tag_name: 'v1.18.5' }));
    }) as typeof fetch;

    const status = await getOpenCodeUpgradeStatus(manager);
    assert.equal(status.available, false);
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
    globalThis.fetch = (async () => (
      new Response(JSON.stringify({ success: true, version: '1.18.9' }))
    )) as typeof fetch;

    assert.deepEqual(await upgradeManagedOpenCode(manager, '1.18.9'), {
      status: 200,
      body: { success: true, version: '1.18.9', restarted: true },
    });
    assert.equal(getRestartCount(), 1);
  });
});
