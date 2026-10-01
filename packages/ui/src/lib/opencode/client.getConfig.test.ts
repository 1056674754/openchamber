import { describe, expect, mock, test } from 'bun:test';

type ConfigResponse = { data: Record<string, unknown> };

(mock as unknown as { restore?: () => void }).restore?.();

const configResolvers: Array<(response: ConfigResponse) => void> = [];
let configCalls = 0;

mock.module('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: mock(() => ({
    config: {
      get: mock(() => {
        configCalls += 1;
        return new Promise<ConfigResponse>((resolve) => {
          configResolvers.push(resolve);
        });
      }),
    },
  })),
}));

mock.module('@/contexts/runtimeAPIRegistry', () => ({
  getRegisteredRuntimeAPIs: mock(() => null),
}));

mock.module('@/lib/runtime-url', () => ({
  getRuntimeUrlResolver: mock(() => ({
    api: (path: string) => path,
  })),
}));

mock.module('@/lib/runtime-switch', () => ({
  getRuntimeApiBaseUrl: mock(() => ''),
  getRuntimeKey: mock(() => 'test-runtime'),
}));

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async () => new Response(JSON.stringify([]), {
    headers: { 'Content-Type': 'application/json' },
  })),
}));

mock.module('@/lib/startupTrace', () => ({
  markStartupTrace: mock(() => undefined),
}));

mock.module('@/sync/session-routing', () => ({
  resolveSdkForDirectory: mock(() => ({})),
  resolveRouteForDirectory: mock(() => ({ serverId: 'default', client: {} })),
  resolveBaseUrlForSession: mock(() => undefined),
  resolveBaseUrl: mock(() => undefined),
  resolveApiUrl: mock(() => undefined),
  resolveProjectServerIdForDirectory: mock(() => undefined),
  setDirectoryServerId: mock(() => undefined),
  normalizeDirectoryKey: mock((value: string) => value),
  getOrRegisterRemoteConnection: mock(() => undefined),
  getServerIdForBaseUrl: mock(() => undefined),
}));

mock.module('@/sync/multi-server-registry', () => ({
  getAllSyncStores: mock(() => []),
  getSyncStoresForServer: mock(() => undefined),
  registerSyncStores: mock(() => () => undefined),
  subscribeSyncStoresRegistry: mock(() => () => undefined),
}));

mock.module('./server-registry', () => ({
  DEFAULT_SERVER_ID: 'default',
  serverRegistry: {
    register: mock(() => undefined),
    startHealthPolling: mock(() => undefined),
    stopHealthPolling: mock(() => undefined),
    get: mock(() => undefined),
    getDefault: mock(() => undefined),
    getServerForSession: mock(() => undefined),
  },
}));

mock.module('@/lib/worktrees/worktreeBootstrap', () => ({
  waitForWorktreeBootstrap: mock(async () => undefined),
}));

mock.module('@/lib/api/serverUrl', () => ({
  resolveApiUrl: mock((path: string) => path),
  resolveOpenCodeProxyApiUrl: mock((path: string) => path),
  ensureAbsoluteBaseUrl: mock((value: string) => value),
}));

const { opencodeClient } = await import(`./client?cache-test=${Date.now()}`);

describe('opencodeClient getConfig cache', () => {
  test('cleared stale in-flight requests do not repopulate cache or delete newer in-flight requests', async () => {
    const first = opencodeClient.getConfig('/workspace/project');
    expect(configCalls).toBe(1);

    opencodeClient.clearConfigCache();

    const second = opencodeClient.getConfig('/workspace/project');
    expect(configCalls).toBe(2);

    configResolvers[0]?.({ data: { model: 'old/model' } });
    expect(await first).toEqual({ model: 'old/model' });

    const third = opencodeClient.getConfig('/workspace/project');
    expect(configCalls).toBe(2);

    configResolvers[1]?.({ data: { model: 'new/model' } });
    expect(await second).toEqual({ model: 'new/model' });
    expect(await third).toEqual({ model: 'new/model' });

    const cached = await opencodeClient.getConfig('/workspace/project');
    expect(cached).toEqual({ model: 'new/model' });
    expect(configCalls).toBe(2);
  });

  test('isolates cache keys by directory scope', async () => {
    configCalls = 0;
    configResolvers.length = 0;
    opencodeClient.clearConfigCache();

    const a = opencodeClient.getConfig('/workspace/a');
    const b = opencodeClient.getConfig('/workspace/b');
    expect(configCalls).toBe(2);

    configResolvers[0]?.({ data: { model: 'a/model' } });
    configResolvers[1]?.({ data: { model: 'b/model' } });
    expect(await a).toEqual({ model: 'a/model' });
    expect(await b).toEqual({ model: 'b/model' });
  });
});
