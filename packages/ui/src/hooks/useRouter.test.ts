import { describe, expect, mock, test } from 'bun:test';

type Effect = () => void | (() => void);

const effects: Effect[] = [];

const fakeReact = {
  useMemo: <T>(factory: () => T): T => factory(),
  useRef: <T>(initialValue: T): { current: T } => ({ current: initialValue }),
  useCallback: <T extends (...args: never[]) => unknown>(callback: T): T => callback,
  useEffect: (effect: Effect): void => {
    effects.push(effect);
  },
};

mock.module('react', () => ({
  default: fakeReact,
  ...fakeReact,
}));

const targetSessionId = 'ses_direct_route';
const targetSessionDirectory = '/repo/direct-route';
let persistedLastSession: { sessionId: string; serverId: string; directory: string | null } | null = null;
let boundProjectId: string | null = null;
let projects: Array<{ id: string; path: string; label: string; serverId?: string }> = [];

const setCurrentSessionCalls: Array<{
  sessionId: string | null;
  directory?: string | null;
  options?: { serverId?: string };
}> = [];

const sessionState = {
  currentSessionId: null as string | null,
  setCurrentSession: (
    sessionId: string | null,
    directory?: string | null,
    options?: { serverId?: string },
  ): void => {
    setCurrentSessionCalls.push({ sessionId, directory, options });
    sessionState.currentSessionId = sessionId;
  },
  getDirectoryForSession: (): string | null => null,
};

const useSessionUIStore = Object.assign(
  <T>(selector: (state: typeof sessionState) => T): T => selector(sessionState),
  {
    getState: (): typeof sessionState => sessionState,
    subscribe: (): (() => void) => () => {},
  },
);

mock.module('@/sync/session-ui-store', () => ({ useSessionUIStore }));

const uiState = {
  activeMainTab: 'chat' as const,
  isSettingsDialogOpen: false,
  settingsPage: 'general',
  pendingDiffFile: null as string | null,
  setActiveMainTab: (): void => {},
  setSettingsDialogOpen: (): void => {},
  setSettingsPage: (): void => {},
  navigateToDiff: (): void => {},
};

const useUIStore = Object.assign(
  <T>(selector: (state: typeof uiState) => T): T => selector(uiState),
  {
    getState: (): typeof uiState => uiState,
    subscribe: (): (() => void) => () => {},
  },
);

mock.module('@/stores/useUIStore', () => ({ useUIStore }));
mock.module('@/lib/router', () => ({
  hasRouteParams: (): boolean => true,
  parseRoute: () => ({ sessionId: targetSessionId }),
  updateBrowserURL: (): void => {},
}));
mock.module('@/lib/settings/metadata', () => ({
  resolveSettingsSlug: (value: string): string => value,
}));
mock.module('@/components/layout/contextPanelEmbeddedChat', () => ({
  isEmbeddedSessionChat: (): boolean => false,
}));
mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    getSdkClient: () => ({
      session: {
        get: async () => ({
          data: { id: targetSessionId, directory: targetSessionDirectory },
        }),
      },
    }),
  },
}));
mock.module('@/lib/runtime-switch', () => ({
  getRuntimeKey: (): string => 'local',
}));
mock.module('@/sync/last-session-cache', () => ({
  readLastActiveSession: () => persistedLastSession,
}));
mock.module('@/stores/useSessionProjectStore', () => ({
  useSessionProjectStore: {
    getState: () => ({ getProject: () => boundProjectId }),
  },
}));
mock.module('@/stores/useProjectsStore', () => ({
  useProjectsStore: {
    getState: () => ({ projects }),
  },
}));
mock.module('@/sync/session-routing', () => ({
  getOrRegisterRemoteConnection: () => ({
    client: {
      session: {
        get: async () => ({
          data: { id: targetSessionId, directory: '/root/novel_editor-worktree' },
        }),
      },
    },
  }),
}));
const { serverRegistry } = await import('@/lib/opencode/server-registry');
const { useRouter } = await import('./useRouter');

describe('useRouter', () => {
  test('reapplies the direct session route when React repeats mount effects', async () => {
    effects.length = 0;
    setCurrentSessionCalls.length = 0;
    sessionState.currentSessionId = null;
    persistedLastSession = null;
    boundProjectId = null;
    projects = [];

    useRouter();
    const initializeEffect = effects[0];
    expect(initializeEffect).not.toBe(undefined);

    initializeEffect?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(sessionState.currentSessionId).toBe(targetSessionId);
    expect(setCurrentSessionCalls[0]).toEqual({
      sessionId: targetSessionId,
      directory: targetSessionDirectory,
      options: { serverId: 'default' },
    });

    sessionState.currentSessionId = null;
    initializeEffect?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionState.currentSessionId).toBe(targetSessionId);
  });

  test('restores remote ownership before applying a persisted direct session route', async () => {
    effects.length = 0;
    setCurrentSessionCalls.length = 0;
    sessionState.currentSessionId = null;
    serverRegistry.forgetSession(targetSessionId);
    boundProjectId = null;
    projects = [];
    persistedLastSession = {
      sessionId: targetSessionId,
      serverId: 'dev3',
      directory: '/root/novel_editor',
    };

    useRouter();
    const initializeEffect = effects[0];
    initializeEffect?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(setCurrentSessionCalls[0]).toEqual({
      sessionId: targetSessionId,
      directory: '/root/novel_editor',
      options: { serverId: 'dev3' },
    });
    expect(serverRegistry.getServerForSession(targetSessionId)).toBe('dev3');
  });

  test('uses the persisted project binding to resolve a remote direct session route', async () => {
    effects.length = 0;
    setCurrentSessionCalls.length = 0;
    sessionState.currentSessionId = null;
    serverRegistry.forgetSession(targetSessionId);
    persistedLastSession = {
      sessionId: targetSessionId,
      serverId: 'stale-dev2',
      directory: '/root/wrong-project',
    };
    boundProjectId = 'project-dev3';
    projects = [{
      id: 'project-dev3',
      path: '/root/novel_editor',
      label: 'Novel Editor',
      serverId: 'dev3',
    }];

    useRouter();
    const initializeEffect = effects[0];
    initializeEffect?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(setCurrentSessionCalls[0]).toEqual({
      sessionId: targetSessionId,
      directory: '/root/novel_editor-worktree',
      options: { serverId: 'dev3' },
    });
    expect(serverRegistry.getServerForSession(targetSessionId)).toBe('dev3');
  });
});
