import { describe, expect, mock, test } from 'bun:test';

// R2 client unification: getConfig rides the v2 `@opencode/client` config
// route; the fixture hands back config-entry pages that
// `mergeConfigDocuments` folds into the effective document.
type ConfigEntries = Array<{ type: 'document'; info: Record<string, unknown> }>;

(mock as unknown as { restore?: () => void }).restore?.();

const configResolvers: Array<(entries: ConfigEntries) => void> = [];
let configCalls = 0;

mock.module('@opencode/client', () => ({
  OpenCode: {
    make: mock(() => ({
      config: {
        get: mock(() => {
          configCalls += 1;
          // The generated client unwraps the wire envelope; the stub
          // resolves with the entry page directly, like the real client.
          return new Promise<ConfigEntries>((resolve) => {
            configResolvers.push(resolve);
          });
        }),
      },
    })),
  },
}));

mock.module('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: mock(() => ({})),
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

// A permissive registry stub: the client module's import graph (via
// protocol-handle) shares this bun process with protocol-handle.test, whose
// beforeEach touches registry methods this test never calls.
mock.module('./server-registry', () => ({
  DEFAULT_SERVER_ID: 'default',
  serverRegistry: new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'get' || prop === 'getDefault' || prop === 'getServerForSession') return () => undefined
      return () => undefined
    },
  }),
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

    configResolvers[0]?.([{ type: 'document', info: { model: 'old/model' } }]);
    expect(await first).toEqual({ model: 'old/model' });

    const third = opencodeClient.getConfig('/workspace/project');
    expect(configCalls).toBe(2);

    configResolvers[1]?.([{ type: 'document', info: { model: 'new/model' } }]);
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

    configResolvers[0]?.([{ type: 'document', info: { model: 'a/model' } }]);
    configResolvers[1]?.([{ type: 'document', info: { model: 'b/model' } }]);
    expect(await a).toEqual({ model: 'a/model' });
    expect(await b).toEqual({ model: 'b/model' });
  });
});
