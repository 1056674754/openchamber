import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Agent } from '@opencode-ai/sdk/v2';

const DIRECTORY = '/workspace/project';
const REMOTE_DIRECTORY = '/remote/project';
const REMOTE_SERVER_ID = 'remote-a';

type TestAgent = {
  name: string;
  mode?: string;
  hidden?: boolean;
  model?: { providerID?: string; modelID?: string };
  variant?: string;
};

let getConfigCalls = 0;
let listAgentsCalls = 0;
let lastAgentsDirectory: string | null = null;
let checkHealthCalls = 0;
let liveAgents: TestAgent[] = [];
let liveOpenChamberSettings: Record<string, unknown> = {};
let listAgentsImpl: ((directory?: string | null) => Promise<TestAgent[]>) | null = null;
let checkHealthImpl: () => Promise<boolean> = async () => true;

const provider = (id: string, modelId = `${id}-model`, variants?: Record<string, Record<string, unknown>>) => ({
  id,
  name: id,
  source: 'config' as const,
  env: [],
  options: {},
  models: [
    {
      id: modelId,
      name: modelId,
      providerID: id,
      api: { id: 'chat', url: '', npm: '' },
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 0, output: 0 },
      options: {},
      release_date: '',
      status: 'active' as const,
      headers: {},
      ...(variants ? { variants } : {}),
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
    },
  ],
});

let liveProviders = [provider('openai', 'gpt-5.5')];

const testAgent = (name: string, options?: Partial<TestAgent>): Agent => ({
  name,
  mode: options?.mode ?? 'primary',
  hidden: options?.hidden,
  model: options?.model,
  variant: options?.variant,
  permission: {},
  options: {},
}) as Agent;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const fakeSdk = {
  app: {
    agents: mock(async (options?: { directory?: string }) => {
      listAgentsCalls += 1;
      lastAgentsDirectory = options?.directory ?? null;
      const impl = listAgentsImpl;
      const agents = impl ? await impl(options?.directory) : liveAgents;
      return { data: agents };
    }),
  },
  config: {
    get: mock(async () => {
      getConfigCalls += 1;
      return { data: {} };
    }),
    providers: mock(async () => ({
      data: {
        providers: liveProviders,
        default: {},
      },
    })),
  },
  provider: {
    list: mock(async () => ({ data: { all: [], connected: [], default: {} } })),
  },
};

mock.module('@/stores/utils/safeStorage', () => ({
  createDeferredSafeJSONStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
  getSafeStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  }),
}));

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    setDirectory: mock(() => undefined),
    getDirectory: mock(() => DIRECTORY),
    checkHealth: mock(async () => {
      checkHealthCalls += 1;
      return checkHealthImpl();
    }),
    getConfig: mock(async () => {
      getConfigCalls += 1;
      return {};
    }),
    clearConfigCache: mock(() => undefined),
    getSdkClient: mock(() => fakeSdk),
  },
}));

mock.module('@/sync/session-actions', () => ({
  resolveSdkForDirectory: mock(() => fakeSdk),
  resolveProjectServerIdForDirectory: mock(() => undefined),
  resolveApiUrl: mock(() => undefined),
}));

mock.module('@/contexts/runtimeAPIRegistry', () => ({
  getRegisteredRuntimeAPIs: mock(() => null),
}));

mock.module('@/lib/runtime-fetch', () => ({
  buildRuntimeFetchUrl: (input: string) => input,
  runtimeFetch: mock(async () => new Response(JSON.stringify(liveOpenChamberSettings), {
    headers: { 'Content-Type': 'application/json' },
  })),
}));

mock.module('@/lib/persistence', () => ({
  updateDesktopSettings: mock(async () => undefined),
}));

mock.module('@/lib/startupTrace', () => ({
  markStartupTrace: mock(() => undefined),
  measureStartupTrace: mock(async (_name: string, callback: () => Promise<unknown>) => callback()),
}));

mock.module('@/lib/configSync', () => ({
  emitConfigChange: mock(() => undefined),
  scopeMatches: mock(() => false),
  subscribeToConfigChanges: mock(() => () => undefined),
}));

mock.module('@/sync/session-ui-store', () => ({
  useSessionUIStore: {
    getState: () => ({
      currentSessionId: null,
      isOpenChamberCreatedSession: () => false,
      initializeNewOpenChamberSession: () => undefined,
    }),
  },
}));

mock.module('@/sync/selection-store', () => ({
  useSelectionStore: {
    getState: () => ({
      saveSessionAgentSelection: () => undefined,
      getAgentModelForSession: () => null,
      getAgentModelVariantForSession: () => undefined,
    }),
  },
}));

mock.module('@/stores/useDirectoryStore', () => ({
  useDirectoryStore: {
    getState: () => ({ currentDirectory: DIRECTORY }),
    subscribe: () => () => undefined,
  },
}));

mock.module('@/lib/opencode/server-registry', () => ({
  DEFAULT_SERVER_ID: 'default',
  serverRegistry: {
    get: () => undefined,
    getServerForSession: () => undefined,
  },
}));

const { useConfigStore } = await import('./useConfigStore');
const { emitSyncConfigChanged } = await import('@/sync/sync-refs');

const originalFetch = globalThis.fetch;
const fakeFetch = (url: string | URL | Request): Promise<Response> => {
  const urlStr = typeof url === 'string' ? url : url.toString();
  if (urlStr.includes('/api/config/settings')) {
    return Promise.resolve(
      new Response(JSON.stringify(liveOpenChamberSettings), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }
  return Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
};

const scopedKey = (directory: string, serverId: string) =>
  `__server__${encodeURIComponent(serverId)}::${encodeURIComponent(directory)}`;

describe('useConfigStore non-blocking OpenCode config', () => {
  beforeEach(() => {
    getConfigCalls = 0;
    listAgentsCalls = 0;
    lastAgentsDirectory = null;
    checkHealthCalls = 0;
    liveAgents = [testAgent('build')];
    liveProviders = [provider('openai', 'gpt-5.5')];
    liveOpenChamberSettings = {};
    listAgentsImpl = null;
    checkHealthImpl = async () => true;
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    useConfigStore.setState({
      activeDirectoryKey: DIRECTORY,
      providers: [provider('openai', 'gpt-5.5'), provider('manual', 'manual-model'), provider('default', 'default-model')],
      agents: [testAgent('build')],
      currentProviderId: 'openai',
      currentModelId: 'gpt-5.5',
      currentVariant: undefined,
      currentAgentName: 'build',
      selectedProviderId: 'openai',
      selectionSource: 'auto',
      opencodeDefaultAgent: undefined,
      opencodeDefaultModel: undefined,
      settingsDefaultModel: undefined,
      settingsDefaultAgent: undefined,
      settingsDefaultVariant: undefined,
      directoryScoped: {
        [DIRECTORY]: {
          providers: [provider('openai', 'gpt-5.5'), provider('manual', 'manual-model'), provider('default', 'default-model')],
          agents: [testAgent('build')],
          currentProviderId: 'openai',
          currentModelId: 'gpt-5.5',
          currentAgentName: 'build',
          selectedProviderId: 'openai',
          agentModelSelections: {},
          defaultProviders: {},
          selectionSource: 'auto',
        },
      },
      isConnected: true,
      hasEverConnected: true,
      connectionPhase: 'connected',
      lastDisconnectReason: null,
      isInitialized: false,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('loadAgents does not fetch OpenCode config directly', async () => {
    await useConfigStore.getState().loadAgents({ directory: DIRECTORY, source: 'test:noConfigFetch' });

    expect(listAgentsCalls).toBe(1);
    expect(getConfigCalls).toBe(0);
  });

  test('activateDirectory reconciles a persisted native catalog with the live plugin catalog', async () => {
    liveAgents = [
      testAgent('build', { mode: 'subagent', hidden: true }),
      testAgent('plan', { mode: 'subagent', hidden: true }),
      testAgent('Sisyphus - ultraworker'),
    ];

    await useConfigStore.getState().activateDirectory(DIRECTORY);

    const state = useConfigStore.getState();
    expect(listAgentsCalls).toBe(1);
    expect(lastAgentsDirectory).toBe(DIRECTORY);
    expect(state.agents.map((agent) => agent.name)).toEqual([
      'build',
      'plan',
      'Sisyphus - ultraworker',
    ]);
    expect(state.currentAgentName).toBe('Sisyphus - ultraworker');
  });

  test('a refreshed catalog replaces a hidden native selection with a visible primary agent', async () => {
    liveAgents = [
      testAgent('build', { mode: 'subagent', hidden: true }),
      testAgent('plan', { mode: 'subagent', hidden: true }),
      testAgent('Sisyphus - ultraworker'),
    ];
    useConfigStore.setState((state) => ({
      selectionSource: 'manual',
      directoryScoped: {
        ...state.directoryScoped,
        [DIRECTORY]: {
          ...state.directoryScoped[DIRECTORY],
          selectionSource: 'manual',
        },
      },
    }));

    await useConfigStore.getState().loadAgents({ directory: DIRECTORY, source: 'test:pluginReady' });

    expect(useConfigStore.getState().currentAgentName).toBe('Sisyphus - ultraworker');
    expect(useConfigStore.getState().directoryScoped[DIRECTORY]?.currentAgentName).toBe('Sisyphus - ultraworker');
  });

  test('a hidden-but-existing defaultAgent in settings is preserved across loadAgents', async () => {
    liveAgents = [
      testAgent('build'),
      testAgent('Sisyphus - ultraworker', { mode: 'subagent', hidden: true }),
    ];
    liveOpenChamberSettings = { defaultAgent: 'Sisyphus - ultraworker' };

    await useConfigStore.getState().loadAgents({ directory: DIRECTORY, source: 'test:hiddenDefault' });

    const state = useConfigStore.getState();
    expect(state.settingsDefaultAgent).toBe('Sisyphus - ultraworker');
    expect(state.directoryScoped[DIRECTORY]?.currentAgentName).toBe('build');
  });

  test('a defaultAgent that no longer exists in the catalog is still cleared', async () => {
    liveAgents = [testAgent('build'), testAgent('review')];
    liveOpenChamberSettings = { defaultAgent: 'ghost-agent' };

    await useConfigStore.getState().loadAgents({ directory: DIRECTORY, source: 'test:missingDefault' });

    const state = useConfigStore.getState();
    expect(state.settingsDefaultAgent).toBe(undefined);
    expect(state.currentAgentName).toBe('build');
  });

  test('manual selection survives a late sync config apply', () => {
    useConfigStore.setState({
      currentProviderId: 'manual',
      currentModelId: 'manual-model',
      currentAgentName: 'build',
      selectedProviderId: 'manual',
      selectionSource: 'manual',
      directoryScoped: {
        [DIRECTORY]: {
          ...useConfigStore.getState().directoryScoped[DIRECTORY],
          currentProviderId: 'manual',
          currentModelId: 'manual-model',
          currentAgentName: 'build',
          selectedProviderId: 'manual',
          selectionSource: 'manual',
        },
      },
    });

    emitSyncConfigChanged(DIRECTORY, { default_agent: 'build', model: 'openai/gpt-5.5' });

    const state = useConfigStore.getState();
    expect(state.selectionSource).toBe('manual');
    expect(state.currentProviderId).toBe('manual');
    expect(state.currentModelId).toBe('manual-model');
    expect(state.opencodeDefaultModel).toBe('openai/gpt-5.5');
  });

  test('provider refresh preserves a settings selection missing from the live catalog', async () => {
    liveProviders = [provider('live')];
    useConfigStore.setState((state) => ({
      selectedProviderId: 'plugin-provider',
      directoryScoped: {
        ...state.directoryScoped,
        [DIRECTORY]: {
          ...state.directoryScoped[DIRECTORY],
          selectedProviderId: 'plugin-provider',
        },
      },
    }));

    await useConfigStore.getState().loadProviders({ directory: DIRECTORY, source: 'test:missingSettingsSelection' });

    const state = useConfigStore.getState();
    expect(state.providers.map((entry) => entry.id)).toEqual(['live']);
    expect(state.selectedProviderId).toBe('plugin-provider');
    expect(state.directoryScoped[DIRECTORY]?.selectedProviderId).toBe('plugin-provider');
  });

  test('provider refresh fills only an empty settings selection', async () => {
    liveProviders = [provider('live')];
    useConfigStore.setState((state) => ({
      selectedProviderId: '',
      directoryScoped: {
        ...state.directoryScoped,
        [DIRECTORY]: {
          ...state.directoryScoped[DIRECTORY],
          selectedProviderId: '',
        },
      },
    }));

    await useConfigStore.getState().loadProviders({ directory: DIRECTORY, source: 'test:emptySettingsSelection' });

    expect(useConfigStore.getState().selectedProviderId).toBe('live');
  });

  test('changing the chat provider leaves the settings provider selection alone', () => {
    useConfigStore.setState((state) => ({
      providers: [provider('anthropic'), provider('openai')],
      currentProviderId: 'anthropic',
      currentModelId: 'anthropic-model',
      selectedProviderId: 'openai',
      directoryScoped: {
        ...state.directoryScoped,
        [DIRECTORY]: {
          ...state.directoryScoped[DIRECTORY],
          providers: [provider('anthropic'), provider('openai')],
          selectedProviderId: 'openai',
        },
      },
    }));

    useConfigStore.getState().setProvider('anthropic');

    const state = useConfigStore.getState();
    expect(state.currentProviderId).toBe('anthropic');
    expect(state.selectedProviderId).toBe('openai');
    expect(state.directoryScoped[DIRECTORY]?.selectedProviderId).toBe('openai');
  });

  test('applies a project thinking level only with its project model', () => {
    const projectProvider = provider('openai', 'gpt-5.5', { low: {}, high: {} });
    useConfigStore.setState((state) => ({
      providers: [projectProvider],
      currentProviderId: 'openai',
      currentModelId: 'gpt-5.5',
      currentVariant: undefined,
      selectionSource: 'auto',
      settingsDefaultVariant: 'low',
      directoryScoped: {
        ...state.directoryScoped,
        [DIRECTORY]: {
          ...state.directoryScoped[DIRECTORY],
          providers: [projectProvider],
          currentProviderId: 'openai',
          currentModelId: 'gpt-5.5',
          currentVariant: undefined,
          selectionSource: 'auto',
        },
      },
    }));

    useConfigStore.getState().applyDefaultModelAgentSelection({
      projectDefaultModel: 'openai/gpt-5.5',
      projectDefaultVariant: 'high',
    });

    expect(useConfigStore.getState().currentVariant).toBe('high');
    expect(useConfigStore.getState().directoryScoped[DIRECTORY]?.currentVariant).toBe('high');
  });

  test('manual selection survives an in-flight loadAgents refresh', async () => {
    const pendingAgents = deferred<TestAgent[]>();
    listAgentsImpl = async () => pendingAgents.promise;

    const load = useConfigStore.getState().loadAgents({ directory: DIRECTORY, source: 'test:manualRace' });
    useConfigStore.setState((state) => ({
      currentProviderId: 'manual',
      currentModelId: 'manual-model',
      currentAgentName: 'build',
      selectedProviderId: 'manual',
      selectionSource: 'manual',
      directoryScoped: {
        ...state.directoryScoped,
        [DIRECTORY]: {
          ...state.directoryScoped[DIRECTORY],
          currentProviderId: 'manual',
          currentModelId: 'manual-model',
          currentAgentName: 'build',
          selectedProviderId: 'manual',
          selectionSource: 'manual',
        },
      },
    }));
    pendingAgents.resolve([
      testAgent('build', { model: { providerID: 'default', modelID: 'default-model' } }),
    ]);
    await load;

    const state = useConfigStore.getState();
    expect(state.currentProviderId).toBe('manual');
    expect(state.currentModelId).toBe('manual-model');
    expect(state.selectionSource).toBe('manual');
    expect(getConfigCalls).toBe(0);
  });

  test('remote directory slot stores OpenCode defaults under server-scoped key', () => {
    const key = scopedKey(REMOTE_DIRECTORY, REMOTE_SERVER_ID);
    useConfigStore.setState({
      activeDirectoryKey: key,
      providers: [provider('openai', 'gpt-5.5')],
      agents: [testAgent('build'), testAgent('review')],
      currentProviderId: 'openai',
      currentModelId: 'gpt-5.5',
      currentAgentName: 'build',
      selectedProviderId: 'openai',
      selectionSource: 'auto',
      directoryScoped: {
        [key]: {
          providers: [provider('openai', 'gpt-5.5')],
          agents: [testAgent('build'), testAgent('review')],
          currentProviderId: 'openai',
          currentModelId: 'gpt-5.5',
          currentAgentName: 'build',
          selectedProviderId: 'openai',
          agentModelSelections: {},
          defaultProviders: {},
          selectionSource: 'auto',
        },
      },
    });

    useConfigStore.getState().applyOpenCodeConfigDefaults(
      REMOTE_DIRECTORY,
      'test:remote',
      { default_agent: 'review', model: 'openai/gpt-5.5' },
      REMOTE_SERVER_ID,
    );

    const state = useConfigStore.getState();
    expect(state.directoryScoped[key]?.opencodeDefaultAgent).toBe('review');
    expect(state.currentAgentName).toBe('review');
    expect(state.directoryScoped[DIRECTORY]).toBeFalsy();
  });

  test('initializeApp resolves without waiting on OpenCode config.get', async () => {
    const before = getConfigCalls;
    await useConfigStore.getState().initializeApp();
    expect(useConfigStore.getState().isInitialized).toBe(true);
    expect(getConfigCalls).toBe(before);
  });

  test('checkConnection does not let a failed health probe override a connected event stream', async () => {
    checkHealthImpl = async () => false;
    useConfigStore.setState({
      isConnected: true,
      hasEverConnected: true,
      connectionPhase: 'connected',
      lastDisconnectReason: null,
    });

    const isConnected = await useConfigStore.getState().checkConnection();

    expect(isConnected).toBe(true);
    expect(checkHealthCalls).toBe(1);
    expect(useConfigStore.getState().isConnected).toBe(true);
    expect(useConfigStore.getState().connectionPhase).toBe('connected');
    expect(useConfigStore.getState().lastDisconnectReason).toBeNull();
  });

  test('checkConnection retries unhealthy results before declaring startup disconnected', async () => {
    checkHealthImpl = async () => checkHealthCalls >= 3;
    useConfigStore.setState({
      isConnected: false,
      hasEverConnected: false,
      connectionPhase: 'connecting',
      lastDisconnectReason: null,
    });

    const isConnected = await useConfigStore.getState().checkConnection();

    expect(isConnected).toBe(true);
    expect(checkHealthCalls).toBe(3);
    expect(useConfigStore.getState().isConnected).toBe(true);
    expect(useConfigStore.getState().connectionPhase).toBe('connected');
  });

  test('checkConnection preserves the event-stream disconnect reason after health retries fail', async () => {
    checkHealthImpl = async () => false;
    useConfigStore.setState({
      isConnected: false,
      hasEverConnected: true,
      connectionPhase: 'reconnecting',
      lastDisconnectReason: 'upstream_stalled',
    });

    const isConnected = await useConfigStore.getState().checkConnection();

    expect(isConnected).toBe(false);
    expect(checkHealthCalls).toBe(5);
    expect(useConfigStore.getState().lastDisconnectReason).toBe('upstream_stalled');
  });
});
