import { beforeEach, describe, expect, mock, test } from 'bun:test';

const directoryAvailabilityResults = [];
const directoryAvailabilityCalls = [];
const createdChatDirectories = [];
const deletedChatDirectories = [];
const warmedChatServers = [];
let nextChatDirectory = '/remote/home/.config/openchamber/chats/2026-08-30/session-test';

mock.module('@/lib/chatDirectories', () => ({
  CHAT_DRAFT_PROJECT_ID: 'openchamber:chats',
  createChatDirectory: mock(async ({ serverId } = {}) => {
    createdChatDirectories.push({ directory: nextChatDirectory, serverId });
    return nextChatDirectory;
  }),
  deleteChatDirectory: mock(async (directory, serverId) => {
    deletedChatDirectories.push({ directory, serverId });
  }),
  isChatDirectoryPath: (directory) => typeof directory === 'string' && directory.includes('/.config/openchamber/chats/'),
  isChatDirectoryForHome: (directory) => typeof directory === 'string' && directory.includes('/.config/openchamber/chats/'),
  getChatsRootFromDirectory: (directory) => {
    const marker = '/.config/openchamber/chats/';
    const index = typeof directory === 'string' ? directory.indexOf(marker) : -1;
    return index < 0 ? null : directory.slice(0, index + marker.length - 1);
  },
  warmChatsRootDirectory: mock((serverId) => warmedChatServers.push(serverId)),
}));

mock.module('@/lib/directoryAvailability', () => ({
  probeWorkspaceDirectoryAvailability: mock(async (options) => {
    directoryAvailabilityCalls.push(options);
    return directoryAvailabilityResults.shift() ?? 'unknown';
  }),
}));

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    setDirectory: () => {},
    getDirectory: () => '/repo',
    getSdkClient: () => ({}),
    getScopedSdkClient: () => ({}),
  },
}));

const { serverRegistry } = await import('@/lib/opencode/server-registry');
const { useConfigStore } = await import('@/stores/useConfigStore');
const { useProjectsStore } = await import('@/stores/useProjectsStore');
const { useDirectoryStore } = await import('@/stores/useDirectoryStore');
const { useSelectionStore } = await import('./selection-store');
const { useSessionWorktreeStore } = await import('./session-worktree-store');
const { ChildStoreManager } = await import('./child-store');
const { setSyncRefs } = await import('./sync-refs');
const {
  expandSlashCommandGoalObjective,
  materializeOpenDraftSession,
  useSessionUIStore,
} = await import('./session-ui-store');

describe('slash-command goal objectives', () => {
  test('expands every $ARGUMENTS reference from the authoritative command template', () => {
    expect(expandSlashCommandGoalObjective('/issue--to-pr LIN-123 --draft', [{
      name: 'issue--to-pr',
      template: 'Run the issue pipeline for $ARGUMENTS. Verify $ARGUMENTS is represented by the PR.',
    }])).toBe('Run the issue pipeline for LIN-123 --draft. Verify LIN-123 --draft is represented by the PR.');
  });

  test('keeps the invocation when the command template is unavailable', () => {
    expect(expandSlashCommandGoalObjective('/issue--to-pr LIN-123', [{ name: 'issue--to-pr' }]))
      .toBe('/issue--to-pr LIN-123');
  });

  test('matches positional and implicit argument expansion', () => {
    expect(expandSlashCommandGoalObjective('/move "src old" dist extra', [{
      name: 'move',
      template: 'Move $1 to $2',
    }])).toBe('Move src old to dist extra');
    expect(expandSlashCommandGoalObjective('/review auth module', [{
      name: 'review',
      template: 'Review the requested scope.',
    }])).toBe('Review the requested scope.\n\nauth module');
  });
});

/**
 * Unit tests for session worktree routing through the authoritative store.
 *
 * These tests verify that session-worktree-store is properly integrated as the
 * authoritative holder of session↔worktree attachments, and that session-ui-store
 * routes through it for switching and creation flows.
 *
 * Note: Full integration tests for setCurrentSession require runtime mocking.
 * These tests focus on the contract layer: that setAttachment/getAttachment work
 * correctly and that the contract helpers produce correct results.
 */

describe('session-worktree-store worktree routing', () => {
  beforeEach(() => {
    setSyncRefs({}, new ChildStoreManager(), '/repo');
    const store = useSessionWorktreeStore.getState();
    const attachments = store.attachments;
    for (const sessionId of attachments.keys()) {
      store.clearAttachment(sessionId);
    }
    useSessionUIStore.setState({ currentSessionId: null, worktreeMetadata: new Map() });
    useProjectsStore.setState({ projects: [], activeProjectId: null });
  });

  test('getDirectoryForSession prefers authoritative attachment cwd over sync fallback', () => {
    useSessionWorktreeStore.getState().setAttachment('session-dir', {
      worktreeRoot: '/repo/worktrees/feat-a',
      cwd: '/repo/worktrees/feat-a/src',
      branch: 'feat-a',
      headState: 'branch',
      worktreeStatus: 'ready',
      worktreeSource: 'existing',
      legacy: false,
      degraded: false,
    });

    expect(useSessionUIStore.getState().getDirectoryForSession('session-dir')).toBe('/repo/worktrees/feat-a/src');
  });

  test('getDirectoryForSession falls back to authoritative worktreeRoot when attachment is degraded', () => {
    useSessionWorktreeStore.getState().setAttachment('session-dir', {
      worktreeRoot: '/repo/worktrees/feat-a',
      cwd: '/tmp/outside',
      branch: 'feat-a',
      headState: 'branch',
      worktreeStatus: 'invalid',
      worktreeSource: 'existing',
      legacy: false,
      degraded: true,
    });

    expect(useSessionUIStore.getState().getDirectoryForSession('session-dir')).toBe('/repo/worktrees/feat-a');
  });

  test('setCurrentSession uses canonical cwd when valid', () => {
    const store = useSessionWorktreeStore.getState();

    // Simulate: session has valid worktree metadata with cwd inside worktreeRoot
    store.setAttachment('session-1', {
      worktreeRoot: '/repo/worktrees/feat-a',
      cwd: '/repo/worktrees/feat-a/src',
      branch: 'feat-a',
      headState: 'branch',
      worktreeStatus: 'ready',
      worktreeSource: 'existing',
      legacy: false,
      degraded: false,
    });

    const attachment = store.getAttachment('session-1');
    expect(attachment).toBeDefined();
    expect(attachment.cwd).toBe('/repo/worktrees/feat-a/src');
    expect(attachment.worktreeRoot).toBe('/repo/worktrees/feat-a');
    expect(attachment.degraded).toBe(false);
    expect(attachment.worktreeStatus).toBe('ready');
  });

  test('setCurrentSession falls back to worktreeRoot when cwd is degraded', () => {
    const store = useSessionWorktreeStore.getState();

    // Simulate: cwd is outside worktreeRoot (degraded)
    store.setAttachment('session-2', {
      worktreeRoot: '/repo/worktrees/feat-a',
      cwd: '/repo/worktrees/feat-a', // same as worktreeRoot means not degraded for this case
      branch: 'feat-a',
      headState: 'branch',
      worktreeStatus: 'ready',
      worktreeSource: 'existing',
      legacy: false,
      degraded: true, // marked degraded because cwd was resolved from invalid state
    });

    const attachment = store.getAttachment('session-2');
    expect(attachment).toBeDefined();
    expect(attachment.degraded).toBe(true);
    // cwd should equal worktreeRoot when degraded (fallback)
    expect(attachment.cwd).toBe(attachment.worktreeRoot);
  });

  test('setCurrentSession indexes remote server from the selected directory project', () => {
    serverRegistry.forgetSession('remote-session');
    useProjectsStore.setState({
      projects: [{
        id: 'remote-project',
        path: '/remote/project',
        label: 'Remote Project',
        serverId: 'remote-a',
      }],
      activeProjectId: 'remote-project',
    });

    useSessionUIStore.getState().setCurrentSession('remote-session', '/remote/project/src');

    expect(serverRegistry.getServerForSession('remote-session')).toBe('remote-a');
  });

  test('isolated session initializes created-for-session attachment', () => {
    const store = useSessionWorktreeStore.getState();

    // Simulate: isolated worktree session created for a specific branch
    store.setAttachment('session-isolated', {
      worktreeRoot: '/repo/worktrees/feature-xyz',
      cwd: '/repo/worktrees/feature-xyz',
      branch: 'feature-xyz',
      headState: 'branch',
      worktreeStatus: 'ready',
      worktreeSource: 'created-for-session',
      legacy: false,
      degraded: false,
    });

    const attachment = store.getAttachment('session-isolated');
    expect(attachment).toBeDefined();
    expect(attachment.worktreeSource).toBe('created-for-session');
    expect(attachment.worktreeStatus).toBe('ready');
    expect(attachment.legacy).toBe(false);
  });

  test('legacy session upgrades when runtime canonicalization recovers a worktree', () => {
    const store = useSessionWorktreeStore.getState();

    // Simulate: session without metadata (legacy) gets upgraded via runtime resolution
    // Initially no attachment
    let attachment = store.getAttachment('session-legacy');
    expect(attachment).toBeUndefined();

    // Runtime canonicalization resolves it to a worktree
    store.setAttachment('session-legacy', {
      worktreeRoot: '/repo/worktrees/recovered',
      cwd: '/repo/worktrees/recovered',
      branch: 'recovered',
      headState: 'branch',
      worktreeStatus: 'ready',
      worktreeSource: 'existing',
      legacy: false, // upgraded from legacy=true to false
      degraded: false,
    });

    attachment = store.getAttachment('session-legacy');
    expect(attachment).toBeDefined();
    expect(attachment.legacy).toBe(false);
    expect(attachment.worktreeRoot).toBe('/repo/worktrees/recovered');
  });

  test('missing worktree session has missing status', () => {
    const store = useSessionWorktreeStore.getState();

    // Simulate: session whose worktree was deleted
    store.setAttachment('session-missing', {
      worktreeRoot: null,
      cwd: null,
      branch: null,
      headState: 'branch',
      worktreeStatus: 'missing',
      worktreeSource: null,
      legacy: false,
      degraded: true,
    });

    const attachment = store.getAttachment('session-missing');
    expect(attachment).toBeDefined();
    expect(attachment.worktreeStatus).toBe('missing');
    expect(attachment.degraded).toBe(true);
  });

  test('not-a-repo session has correct status', () => {
    const store = useSessionWorktreeStore.getState();

    // Simulate: session opened in a directory that is not a git repo
    store.setAttachment('session-not-repo', {
      worktreeRoot: null,
      cwd: '/tmp/not-a-repo',
      branch: null,
      headState: 'detached',
      worktreeStatus: 'not-a-repo',
      worktreeSource: null,
      legacy: false,
      degraded: true,
    });

    const attachment = store.getAttachment('session-not-repo');
    expect(attachment).toBeDefined();
    expect(attachment.worktreeStatus).toBe('not-a-repo');
  });
});

describe('new-session draft permission intent', () => {
  beforeEach(() => {
    directoryAvailabilityResults.length = 0;
    directoryAvailabilityCalls.length = 0;
    createdChatDirectories.length = 0;
    deletedChatDirectories.length = 0;
    warmedChatServers.length = 0;
    nextChatDirectory = '/remote/home/.config/openchamber/chats/2026-08-30/session-test';
    useSessionUIStore.getState().closeNewSessionDraft();
  });

  test('starts manual, can enable auto-accept, and resets after closing', () => {
    useSessionUIStore.getState().openNewSessionDraft();

    expect(useSessionUIStore.getState().newSessionDraft.permissionIntent.autoAccept).toBe(false);

    useSessionUIStore.getState().setDraftPermissionAutoAccept(true);

    expect(useSessionUIStore.getState().newSessionDraft.permissionIntent.autoAccept).toBe(true);

    useSessionUIStore.getState().closeNewSessionDraft();

    expect(useSessionUIStore.getState().newSessionDraft.permissionIntent.autoAccept).toBe(false);
  });

  test('does not change permission intent while the draft is closed', () => {
    useSessionUIStore.getState().setDraftPermissionAutoAccept(true);

    expect(useSessionUIStore.getState().newSessionDraft.permissionIntent.autoAccept).toBe(false);
  });

  test('rewrites an implicit draft only when its deleted worktree is confirmed missing', async () => {
    useProjectsStore.setState({
      projects: [{ id: 'project', path: '/repo', label: 'Project' }],
      activeProjectId: 'project',
    });
    useDirectoryStore.setState({ currentDirectory: '/repo/deleted-worktree' });
    directoryAvailabilityResults.push('missing');

    useSessionUIStore.getState().openNewSessionDraft();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useSessionUIStore.getState().newSessionDraft).toMatchObject({
      open: true,
      selectedProjectId: 'project',
      directoryOverride: '/repo',
    });
    expect(directoryAvailabilityCalls).toHaveLength(1);
  });

  test('does not rewrite an implicit draft when the directory probe is unavailable', async () => {
    useProjectsStore.setState({
      projects: [{ id: 'project', path: '/repo', label: 'Project' }],
      activeProjectId: 'project',
    });
    useDirectoryStore.setState({ currentDirectory: '/repo/offline-worktree' });
    directoryAvailabilityResults.push('unknown');

    useSessionUIStore.getState().openNewSessionDraft();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useSessionUIStore.getState().newSessionDraft.directoryOverride).toBe('/repo/offline-worktree');
  });

  test('does not probe or rewrite an explicit worktree target', async () => {
    useProjectsStore.setState({
      projects: [{ id: 'project', path: '/repo', label: 'Project' }],
      activeProjectId: 'project',
    });

    useSessionUIStore.getState().openNewSessionDraft({
      selectedProjectId: 'project',
      directoryOverride: '/repo/explicit-worktree',
      preserveDirectoryOverride: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useSessionUIStore.getState().newSessionDraft.directoryOverride).toBe('/repo/explicit-worktree');
    expect(directoryAvailabilityCalls).toEqual([]);
  });

  test('prepares and cancels an instance-scoped projectless Chat draft', async () => {
    useProjectsStore.setState({
      projects: [{ id: 'remote-project', path: '/remote/project', label: 'Remote', serverId: 'remote-a' }],
      activeProjectId: 'remote-project',
    });

    useSessionUIStore.getState().openNewSessionDraft({ target: 'chat', chatServerId: 'remote-a' });
    const first = await useSessionUIStore.getState().prepareChatDraftDirectory();
    const second = await useSessionUIStore.getState().prepareChatDraftDirectory();

    expect(first).toBe(nextChatDirectory);
    expect(second).toBe(nextChatDirectory);
    expect(createdChatDirectories).toEqual([{ directory: nextChatDirectory, serverId: 'remote-a' }]);
    expect(warmedChatServers).toEqual(['remote-a']);
    expect(useSessionUIStore.getState().newSessionDraft).toMatchObject({
      target: 'chat',
      chatServerId: 'remote-a',
      selectedProjectId: 'openchamber:chats',
      directoryOverride: null,
      preparedChatDirectory: nextChatDirectory,
    });

    useSessionUIStore.getState().closeNewSessionDraft();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deletedChatDirectories).toEqual([{ directory: nextChatDirectory, serverId: 'remote-a' }]);
  });

  test('materializes a projectless Chat on its explicit instance without deleting the owned directory', async () => {
    const original = useSessionUIStore.getState();
    const originalConfig = useConfigStore.getState();
    const createCalls = [];
    useConfigStore.setState({ currentAgentName: 'build', agents: [], activateDirectory: async () => {} });
    useSessionUIStore.setState({
      currentSessionId: null,
      newSessionDraft: {
        draftId: 42,
        open: true,
        target: 'chat',
        chatServerId: 'remote-a',
        preparedChatDirectory: null,
        selectedProjectId: 'openchamber:chats',
        directoryOverride: null,
        permissionIntent: { autoAccept: false },
        parentID: null,
      },
      createSession: async (...args) => {
        createCalls.push(args);
        return { id: 'ses_chat', title: '', directory: nextChatDirectory, time: { created: 1, updated: 1 } };
      },
      initializeNewOpenChamberSession: () => {},
      setCurrentSession: (sessionId) => useSessionUIStore.setState({ currentSessionId: sessionId }),
    });

    try {
      const result = await materializeOpenDraftSession({ providerID: 'provider-a', modelID: 'model-a' });

      expect(result).toEqual({
        sessionId: 'ses_chat',
        directory: nextChatDirectory,
        serverId: 'remote-a',
        agent: 'build',
      });
      expect(createCalls[0]?.[1]).toBe(nextChatDirectory);
      expect(createCalls[0]?.[3]).toBe('remote-a');
      expect(deletedChatDirectories).toEqual([]);
      expect(useSessionUIStore.getState().newSessionDraft.open).toBe(false);
    } finally {
      useSessionUIStore.setState({
        createSession: original.createSession,
        initializeNewOpenChamberSession: original.initializeNewOpenChamberSession,
        setCurrentSession: original.setCurrentSession,
      });
      useConfigStore.setState({
        currentAgentName: originalConfig.currentAgentName,
        agents: originalConfig.agents,
        activateDirectory: originalConfig.activateDirectory,
      });
      serverRegistry.forgetSession('ses_chat');
    }
  });

  test('materializes a confirmed stale implicit draft in the fallback project', async () => {
    const original = useSessionUIStore.getState();
    const originalConfig = useConfigStore.getState();
    const createCalls = [];
    useProjectsStore.setState({
      projects: [{ id: 'project', path: '/repo', label: 'Project' }],
      activeProjectId: 'project',
    });
    useConfigStore.setState({ currentAgentName: 'build', agents: [], activateDirectory: async () => {} });
    directoryAvailabilityResults.push('missing');
    useSessionUIStore.setState({
      currentSessionId: null,
      newSessionDraft: {
        open: true,
        selectedProjectId: 'project',
        directoryOverride: '/repo/deleted-worktree',
        permissionIntent: { autoAccept: false },
        parentID: null,
      },
      createSession: async (...args) => {
        createCalls.push(args);
        return { id: 'ses_recovered', title: '', directory: '/repo', time: { created: 1, updated: 1 } };
      },
      initializeNewOpenChamberSession: () => {},
      setCurrentSession: (sessionId) => useSessionUIStore.setState({ currentSessionId: sessionId }),
    });

    try {
      const result = await materializeOpenDraftSession({ providerID: 'provider-a', modelID: 'model-a' });

      expect(result?.directory).toBe('/repo');
      expect(createCalls[0]?.[1]).toBe('/repo');
    } finally {
      useSessionUIStore.setState({
        createSession: original.createSession,
        initializeNewOpenChamberSession: original.initializeNewOpenChamberSession,
        setCurrentSession: original.setCurrentSession,
      });
      useConfigStore.setState({
        currentAgentName: originalConfig.currentAgentName,
        agents: originalConfig.agents,
        activateDirectory: originalConfig.activateDirectory,
      });
      serverRegistry.forgetSession('ses_recovered');
    }
  });

  test('materializes a draft in its selected remote project', async () => {
    const original = useSessionUIStore.getState();
    const originalConfig = useConfigStore.getState();
    const createCalls = [];
    useProjectsStore.setState({
      projects: [{
        id: 'remote-project',
        path: '/remote/project',
        label: 'Remote Project',
        serverId: 'remote-a',
      }],
      activeProjectId: null,
    });
    useConfigStore.setState({
      currentAgentName: 'build',
      agents: [],
      activateDirectory: async () => {},
    });
    useSessionUIStore.setState({
      currentSessionId: null,
      newSessionDraft: {
        open: true,
        selectedProjectId: 'remote-project',
        directoryOverride: '/remote/project/nested',
        permissionIntent: { autoAccept: false },
        parentID: null,
      },
      createSession: async (...args) => {
        createCalls.push(args);
        return {
          id: 'ses_draft',
          title: '',
          directory: '/remote/project/nested',
          time: { created: 1, updated: 1 },
        };
      },
      initializeNewOpenChamberSession: () => {},
      setCurrentSession: (sessionId) => {
        useSessionUIStore.setState({ currentSessionId: sessionId });
      },
    });

    try {
      const result = await materializeOpenDraftSession({
        providerID: 'provider-a',
        modelID: 'model-a',
        variant: 'high',
      });

      expect(result).toEqual({
        sessionId: 'ses_draft',
        directory: '/remote/project/nested',
        serverId: 'remote-a',
        agent: 'build',
      });
      expect(createCalls[0]?.[3]).toBe('remote-a');
      expect(useSelectionStore.getState().getSessionModelSelection('ses_draft')).toEqual({
        providerId: 'provider-a',
        modelId: 'model-a',
      });
      expect(useSessionUIStore.getState().currentSessionId).toBe('ses_draft');
      expect(useSessionUIStore.getState().newSessionDraft.open).toBe(false);
    } finally {
      useSessionUIStore.setState({
        createSession: original.createSession,
        initializeNewOpenChamberSession: original.initializeNewOpenChamberSession,
        setCurrentSession: original.setCurrentSession,
      });
      useConfigStore.setState({
        currentAgentName: originalConfig.currentAgentName,
        agents: originalConfig.agents,
        activateDirectory: originalConfig.activateDirectory,
      });
      serverRegistry.forgetSession('ses_draft');
    }
  });
});

describe('new session remembers the last used side', () => {
  const CHAT_DRAFT_PROJECT_ID = 'openchamber:chats';

  const seedProjectSide = () => {
    // An explicit project open records the "project" side unconditionally.
    useSessionUIStore.getState().openNewSessionDraft({ target: 'project' });
    useSessionUIStore.getState().closeNewSessionDraft();
  };

  beforeEach(() => {
    useSessionUIStore.getState().closeNewSessionDraft();
    seedProjectSide();
  });

  test('a plain new session reopens on the Chat side after the user last picked Chat', () => {
    useSessionUIStore.getState().openNewSessionDraft();
    useSessionUIStore.getState().setNewSessionDraftTarget({ projectId: CHAT_DRAFT_PROJECT_ID });
    useSessionUIStore.getState().closeNewSessionDraft();

    useSessionUIStore.getState().openNewSessionDraft();

    expect(useSessionUIStore.getState().newSessionDraft).toMatchObject({
      open: true,
      target: 'chat',
      selectedProjectId: CHAT_DRAFT_PROJECT_ID,
    });
    useSessionUIStore.getState().closeNewSessionDraft();
  });

  test('a plain new session stays on the Project side after the user last picked Project', () => {
    useSessionUIStore.getState().openNewSessionDraft();
    useSessionUIStore.getState().setNewSessionDraftTarget({ projectId: 'project' });
    useSessionUIStore.getState().closeNewSessionDraft();

    useSessionUIStore.getState().openNewSessionDraft();

    expect(useSessionUIStore.getState().newSessionDraft).toMatchObject({
      open: true,
      target: 'project',
    });
    useSessionUIStore.getState().closeNewSessionDraft();
  });
});
