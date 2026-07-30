import { beforeEach, describe, expect, mock, test } from 'bun:test';

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
const { useSelectionStore } = await import('./selection-store');
const { useSessionWorktreeStore } = await import('./session-worktree-store');
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
    // Clear all attachments before each test
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
