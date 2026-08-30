import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock heavyweight collaborators so persistence.ts imports in isolation.
// runtime-switch is mocked to cut the relay-tunnel dep and make the endpoint
// key deterministically controllable.

let activeRuntimeKey = 'host-a';
let draftStartersVisible = true;
let agentControlToolEnabled = true;
let agentMemoryToolEnabled = false;
let globalDraftStarters: unknown[] = [];
let sttProvider: 'browser' | 'server' | 'wasm' = 'browser';
let wasmSttModel = 'whisper-tiny';

mock.module('@/lib/runtime-switch', () => ({
  getRuntimeKey: () => activeRuntimeKey,
  subscribeRuntimeEndpointWillChange: () => () => {},
  subscribeRuntimeEndpointChanged: () => () => {},
}));

const noopStore = {
  getState: () => ({
    collapsedModelProviders: [],
    modelPickerLayoutByServerId: new Map(),
    draftStartersVisible,
    agentControlToolEnabled,
    agentMemoryToolEnabled,
    globalDraftStarters,
    setDraftStartersVisible: (value: boolean) => {
      draftStartersVisible = value;
    },
    setAgentControlToolEnabled: (value: boolean) => {
      agentControlToolEnabled = value;
    },
    setAgentMemoryToolEnabled: (value: boolean) => {
      agentMemoryToolEnabled = value;
    },
    setGlobalDraftStarters: (value: unknown[]) => {
      globalDraftStarters = value;
    },
  }),
  setState: () => {},
  persist: undefined,
};
mock.module('@/stores/useUIStore', () => ({ useUIStore: noopStore }));
mock.module('@/stores/messageQueueStore', () => ({ useMessageQueueStore: noopStore }));

mock.module('@/lib/projectId', () => ({ createProjectIdFromPath: () => 'id' }));
mock.module('@/lib/fontOptions', () => ({ isMonoFontOption: () => false, isUiFontOption: () => false }));
mock.module('@/lib/directoryShowHidden', () => ({ setDirectoryShowHidden: () => {} }));
mock.module('@/lib/filesViewShowGitignored', () => ({ setFilesViewShowGitignored: () => {} }));
mock.module('@/lib/appearancePersistence', () => ({
  loadAppearancePreferences: async () => null,
  applyAppearancePreferences: () => {},
}));
mock.module('@/lib/draftStarters', () => ({ sanitizeStarterRefs: (v: unknown) => v }));
mock.module('@/lib/mobileKeyboardMode', () => ({
  normalizeMobileKeyboardMode: (m: string) => m,
  setStoredMobileKeyboardMode: () => {},
}));
mock.module('@/lib/followUpBehavior', () => ({ resolvePersistedFollowUpBehavior: () => 'immediate' }));
mock.module('@/lib/modelPickerLayout', () => ({
  areModelPickerLayoutMapsEqual: () => true,
  migrateModelPickerLayoutState: () => ({ modelPickerLayoutByServerId: {}, collapsedModelProviders: [] }),
  sanitizeModelPickerLayoutByServerId: () => ({}),
}));

const {
  flushPendingSettingsUpdates,
  invalidateSettingsCache,
  refreshDesktopSettingsFromHost,
  sanitizeWebSettings,
  syncDesktopSettings,
  updateDesktopSettings,
} = await import(
  '@/lib/persistence'
);

type FetchCall = { method: string; body: unknown };
const calls: FetchCall[] = [];

let previousFetch: typeof globalThis.fetch | undefined;
let responseFor: ((url: string, method: string) => unknown) = () => ({ pinnedSessions: ['stale'] });

const json = (value: unknown) =>
  ({ ok: true, status: 200, json: async () => value } as unknown as Response);

const installFetch = () => {
  previousFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (init?.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }
    calls.push({ method, body });
    return Promise.resolve(json(responseFor(url, method)));
  }) as typeof globalThis.fetch;
};

// bun:test has no global `window`/`localStorage`; persistence guards on `typeof window`
// and persistToLocalStorage uses the bare `localStorage` global.
const memoryStore = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => memoryStore.get(k) ?? null,
  setItem: (k: string, v: string) => { memoryStore.set(k, v); },
  removeItem: (k: string) => { memoryStore.delete(k); },
  clear: () => { memoryStore.clear(); },
} as Storage;
const eventTarget = new EventTarget();
let previousWindow: PropertyDescriptor | undefined;
let previousLocalStorage: PropertyDescriptor | undefined;
const installWindow = () => {
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      __zustand_config_store__: {
        getState: () => ({
          sttProvider,
          sttServerUrl: '',
          sttModel: '',
          wasmSttModel,
          sttLanguage: '',
          sttSilenceThresholdDb: -45,
          sttSilenceHoldMs: 1500,
          sttTranscribeOnStop: false,
        }),
        setState: (next: { sttProvider?: 'browser' | 'server' | 'wasm'; wasmSttModel?: string }) => {
          if (next.sttProvider) sttProvider = next.sttProvider;
          if (next.wasmSttModel) wasmSttModel = next.wasmSttModel;
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageStub });
};
const restoreWindow = () => {
  if (previousWindow) {
    Object.defineProperty(globalThis, 'window', previousWindow);
  } else {
    // @ts-expect-error delete is intentional when no prior descriptor existed
    delete globalThis.window;
  }
  if (previousLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', previousLocalStorage);
  } else {
    // @ts-expect-error delete is intentional when no prior descriptor existed
    delete globalThis.localStorage;
  }
};

const dispatched: unknown[] = [];
const handler = (event: Event) => {
  dispatched.push((event as CustomEvent).detail);
};

describe('sanitizeWebSettings voice settings', () => {
  test('preserves the local WASM provider and model', () => {
    // Given
    const payload = {
      sttProvider: 'wasm',
      wasmSttModel: 'whisper-small',
    };

    // When
    const settings = sanitizeWebSettings(payload);

    // Then
    expect(settings?.sttProvider).toBe('wasm');
    expect(settings?.wasmSttModel).toBe('whisper-small');
  });
});

describe('refreshDesktopSettingsFromHost', () => {
  beforeEach(() => {
    activeRuntimeKey = 'host-a';
    draftStartersVisible = true;
    agentControlToolEnabled = true;
    agentMemoryToolEnabled = false;
    globalDraftStarters = [];
    sttProvider = 'browser';
    wasmSttModel = 'whisper-tiny';
    calls.length = 0;
    dispatched.length = 0;
    memoryStore.clear();
    invalidateSettingsCache();
    responseFor = () => ({ pinnedSessions: ['host-1'] });
    installWindow();
    window.addEventListener('openchamber:settings-synced', handler as EventListener);
    installFetch();
  });

  test('applies persisted draft starter visibility from the active host', async () => {
    responseFor = () => ({ draftStartersVisible: false });

    await syncDesktopSettings();

    expect(draftStartersVisible).toBe(false);
  });

  test('uses the visible default when the active host has no saved preference', async () => {
    draftStartersVisible = false;
    responseFor = () => ({});

    await syncDesktopSettings();

    expect(draftStartersVisible).toBe(true);
  });

  test('applies the persisted managed Agent tool preference from the active host', async () => {
    // Given
    responseFor = () => ({
      agentControlToolEnabled: false,
      draftStartersScheduleTaskAdded: true,
    });

    // When
    await syncDesktopSettings();

    // Then
    expect(agentControlToolEnabled).toBe(false);
  });

  test('applies the persisted Agent Memory tool preference from the active host', async () => {
    responseFor = () => ({ agentMemoryToolEnabled: true });

    await syncDesktopSettings();

    expect(agentMemoryToolEnabled).toBe(true);
  });

  test('restores the local WASM provider and model from the active host', async () => {
    // Given
    responseFor = () => ({
      sttProvider: 'wasm',
      wasmSttModel: 'whisper-small',
    });

    // When
    await syncDesktopSettings();

    // Then
    expect(sttProvider).toBe('wasm');
    expect(wasmSttModel).toBe('whisper-small');
  });

  test('adds the scheduled task starter once without replacing the custom order', async () => {
    // Given
    responseFor = (_url, method) => method === 'GET'
      ? {
          draftStarters: [
            { type: 'command', name: 'explore' },
            { type: 'command', name: 'craft-goal' },
            { type: 'command', name: 'debug' },
          ],
          draftStartersScheduleTaskAdded: false,
        }
      : {};

    // When
    await syncDesktopSettings();
    await flushPendingSettingsUpdates();

    // Then
    expect(globalDraftStarters).toEqual([
      { type: 'command', name: 'explore' },
      { type: 'command', name: 'craft-goal' },
      { type: 'command', name: 'schedule-task' },
      { type: 'command', name: 'debug' },
    ]);
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      draftStartersScheduleTaskAdded: true,
      draftStarters: globalDraftStarters,
    });
  });

  afterEach(async () => {
    window.removeEventListener('openchamber:settings-synced', handler as EventListener);
    // Reset to a clean, immediately-resolving responder so any debounced PUT
    // left by updateDesktopSettings drains instead of hanging on a test's
    // controllable (never-resolving) responseFor.
    responseFor = () => ({ pinnedSessions: [] });
    await flushPendingSettingsUpdates();
    restoreWindow();
    if (previousFetch) globalThis.fetch = previousFetch;
  });

  test('bypasses a warm cache and issues a fresh GET', async () => {
    // Prime the 2s cache via the non-forced path.
    await syncDesktopSettings();
    expect(calls.filter((c) => c.method === 'GET').length).toBe(1);

    // A second non-forced sync must reuse the cache (no new GET).
    await syncDesktopSettings();
    expect(calls.filter((c) => c.method === 'GET').length).toBe(1);

    // The forced refresh must issue a new GET despite the warm cache and
    // dispatch the fresh payload.
    responseFor = () => ({ pinnedSessions: ['host-2'] });
    dispatched.length = 0;
    await refreshDesktopSettingsFromHost();

    expect(calls.filter((c) => c.method === 'GET').length).toBe(2);
    expect(dispatched).toEqual([{ pinnedSessions: ['host-2'] }]);
  });

  test('flushes a pending PUT before issuing the GET', async () => {
    // Schedule a debounced PUT (200ms). refreshDesktopSettingsFromHost must
    // flush it before reading, so the read reflects the local write.
    updateDesktopSettings({ themeId: 'new-theme' });

    await refreshDesktopSettingsFromHost();

    const putIndex = calls.findIndex((c) => c.method === 'PUT');
    const getIndex = calls.findIndex((c) => c.method === 'GET');
    expect(putIndex).not.toBe(-1);
    expect(getIndex).toBeGreaterThan(putIndex);
  });

  test('aborts the GET when a pending PUT fails', async () => {
    // Override fetch: PUT fails (non-ok), GET would succeed with stale data.
    globalThis.fetch = (async (_input, init) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ method, body: undefined });
      if (method === 'PUT') return { ok: false, status: 500 } as unknown as Response;
      return json({ pinnedSessions: ['stale-host'] }) as Response;
    }) as typeof globalThis.fetch;

    updateDesktopSettings({ themeId: 'new-theme' });
    await refreshDesktopSettingsFromHost();

    // The PUT was attempted and failed; refresh must NOT issue a GET, since the
    // host still holds the pre-mutation value and applying it would revert.
    expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    expect(calls.some((c) => c.method === 'GET')).toBe(false);
    expect(dispatched).toEqual([]);
  });

  test('discards the response when a local mutation begins during the GET', async () => {
    let resolveGet: (value: unknown) => void = () => {};
    let signalGetStarted: () => void = () => {};
    const getStarted = new Promise<void>((resolve) => { signalGetStarted = resolve; });
    responseFor = (_url, method) => {
      if (method !== 'GET') return { pinnedSessions: [] };
      return new Promise((resolve) => {
        resolveGet = resolve;
        signalGetStarted();
      });
    };

    const refreshPromise = refreshDesktopSettingsFromHost();
    // Wait until the refresh is actually awaiting the in-flight GET.
    await getStarted;

    // While the GET is in flight, a local mutation lands (a non-pin field, so it
    // is not stripped and actually bumps the mutation generation).
    updateDesktopSettings({ themeId: 'just-changed' });

    resolveGet({ pinnedSessions: ['older'] });
    await refreshPromise;

    expect(dispatched).toEqual([]);
  });

  test('discards the response when the endpoint switches during the GET', async () => {
    let resolveGet: (value: unknown) => void = () => {};
    let signalGetStarted: () => void = () => {};
    const getStarted = new Promise<void>((resolve) => { signalGetStarted = resolve; });
    responseFor = (_url, method) => {
      if (method !== 'GET') return { pinnedSessions: [] };
      return new Promise((resolve) => {
        resolveGet = resolve;
        signalGetStarted();
      });
    };

    const refreshPromise = refreshDesktopSettingsFromHost();
    await getStarted;

    // Endpoint switches to a different host while the GET is in flight.
    activeRuntimeKey = 'host-b';

    resolveGet({ pinnedSessions: ['from-old-host'] });
    await refreshPromise;

    expect(dispatched).toEqual([]);
  });
});
