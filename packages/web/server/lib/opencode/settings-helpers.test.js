import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createSettingsHelpers } from './settings-helpers.js';

const testFilePath = fileURLToPath(import.meta.url);

const createTestHelpers = () => createSettingsHelpers({
  normalizePathForPersistence: (value) => value,
  normalizeDirectoryPath: (value) => value,
  normalizeTunnelBootstrapTtlMs: (value) => value,
  normalizeTunnelSessionTtlMs: (value) => value,
  normalizeTunnelProvider: (value) => value,
  normalizeTunnelMode: (value) => value,
  normalizeOptionalPath: (value) => value,
  normalizeManagedRemoteTunnelHostname: (value) => value,
  normalizeManagedRemoteTunnelPresets: () => undefined,
  normalizeManagedRemoteTunnelPresetTokens: () => undefined,
  sanitizeTypographySizesPartial: () => undefined,
  normalizeStringArray: (input) => input,
  sanitizeModelRefs: () => undefined,
  sanitizeSkillCatalogs: () => undefined,
  sanitizeProjects: () => undefined,
});

const createModelPrefsTestHelpers = () => createSettingsHelpers({
  normalizePathForPersistence: (value) => value,
  normalizeDirectoryPath: (value) => value,
  normalizeTunnelBootstrapTtlMs: (value) => value,
  normalizeTunnelSessionTtlMs: (value) => value,
  normalizeTunnelProvider: (value) => value,
  normalizeTunnelMode: (value) => value,
  normalizeOptionalPath: (value) => value,
  normalizeManagedRemoteTunnelHostname: (value) => value,
  normalizeManagedRemoteTunnelPresets: () => undefined,
  normalizeManagedRemoteTunnelPresetTokens: () => undefined,
  sanitizeTypographySizesPartial: () => undefined,
  normalizeStringArray: (input) => Array.isArray(input)
    ? Array.from(new Set(input.filter((value) => typeof value === 'string' && value.length > 0)))
    : [],
  sanitizeModelRefs: (input, limit) => Array.isArray(input) ? input.slice(0, limit) : undefined,
  sanitizeSkillCatalogs: () => undefined,
  sanitizeProjects: () => undefined,
});

describe('settings helpers', () => {
  it('accepts only booleans for draft starter visibility', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ draftStartersVisible: true })).toEqual({
      draftStartersVisible: true,
    });
    expect(helpers.sanitizeSettingsUpdate({ draftStartersVisible: false })).toEqual({
      draftStartersVisible: false,
    });
    expect(helpers.sanitizeSettingsUpdate({ draftStartersVisible: 'false' })).toEqual({});
  });

  it('accepts only booleans for managed Agent features and the starter migration marker', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({
      agentControlToolEnabled: false,
      agentMemoryToolEnabled: true,
      draftStartersScheduleTaskAdded: true,
    })).toEqual({
      agentControlToolEnabled: false,
      agentMemoryToolEnabled: true,
      draftStartersScheduleTaskAdded: true,
    });
    expect(helpers.sanitizeSettingsUpdate({
      agentControlToolEnabled: 'false',
      agentMemoryToolEnabled: 'true',
      draftStartersScheduleTaskAdded: 1,
    })).toEqual({});
  });

  it('persists model visibility and sibling selector state', () => {
    const helpers = createModelPrefsTestHelpers();
    const payload = {
      hiddenModels: [{ providerID: 'openai', modelID: 'gpt-5' }],
      collapsedModelProviders: ['openai'],
      recentAgents: ['build'],
      recentEfforts: { 'openai/gpt-5': ['high', 'high', 'low'] },
    };

    expect(helpers.sanitizeSettingsUpdate(payload)).toEqual({
      ...payload,
      recentEfforts: { 'openai/gpt-5': ['high', 'low'] },
    });
    expect(helpers.sanitizeSettingsUpdate({ recentEfforts: {} })).toEqual({ recentEfforts: {} });
  });

  it('persists per-server model picker layout without cross-server leakage', () => {
    const helpers = createModelPrefsTestHelpers();
    const payload = {
      modelPickerLayoutByServerId: {
        default: {
          providerOrder: ['openai', 'openai', 'anthropic'],
          collapsedProviders: ['openai', 'favorites'],
        },
        remote: {
          providerOrder: ['remote-a'],
          collapsedProviders: ['provider:remote-a'],
        },
      },
    };

    expect(helpers.sanitizeSettingsUpdate(payload)).toEqual({
      modelPickerLayoutByServerId: {
        default: {
          providerOrder: ['openai', 'anthropic'],
          collapsedProviders: ['provider:openai', 'favorites'],
        },
        remote: {
          providerOrder: ['remote-a'],
          collapsedProviders: ['provider:remote-a'],
        },
      },
    });
  });

  it('accepts messageStreamTransport as a persisted shared setting', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ messageStreamTransport: 'ws' })).toEqual({
      messageStreamTransport: 'ws',
    });
    expect(helpers.sanitizeSettingsUpdate({ messageStreamTransport: 'sse' })).toEqual({
      messageStreamTransport: 'sse',
    });
    expect(helpers.sanitizeSettingsUpdate({ messageStreamTransport: 'auto' })).toEqual({
      messageStreamTransport: 'auto',
    });
  });

  it('clamps editor font size before persisting shared settings', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ editorFontSize: 8.6 })).toEqual({ editorFontSize: 9 });
    expect(helpers.sanitizeSettingsUpdate({ editorFontSize: 18.4 })).toEqual({ editorFontSize: 18 });
    expect(helpers.sanitizeSettingsUpdate({ editorFontSize: 80 })).toEqual({ editorFontSize: 32 });
    expect(helpers.sanitizeSettingsUpdate({ editorFontSize: '18' })).toEqual({});
  });

  it('only accepts a boolean subagent prompting preference', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ allowPromptingSubagentSessions: true })).toEqual({
      allowPromptingSubagentSessions: true,
    });
    expect(helpers.sanitizeSettingsUpdate({ allowPromptingSubagentSessions: false })).toEqual({
      allowPromptingSubagentSessions: false,
    });
    expect(helpers.sanitizeSettingsUpdate({ allowPromptingSubagentSessions: 'true' })).toEqual({});
  });

  it('only accepts a boolean prompt navigator preference', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ promptNavigatorEnabled: true })).toEqual({
      promptNavigatorEnabled: true,
    });
    expect(helpers.sanitizeSettingsUpdate({ promptNavigatorEnabled: false })).toEqual({
      promptNavigatorEnabled: false,
    });
    expect(helpers.sanitizeSettingsUpdate({ promptNavigatorEnabled: 'true' })).toEqual({});
  });

  it('only accepts a supported desktop window controls position', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ desktopWindowControlsPosition: 'left' })).toEqual({
      desktopWindowControlsPosition: 'left',
    });
    expect(helpers.sanitizeSettingsUpdate({ desktopWindowControlsPosition: 'right' })).toEqual({
      desktopWindowControlsPosition: 'right',
    });
    expect(helpers.sanitizeSettingsUpdate({ desktopWindowControlsPosition: 'auto' })).toEqual({});
  });

  it('only accepts a supported desktop window controls style', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ desktopWindowControlsStyle: 'classic' })).toEqual({
      desktopWindowControlsStyle: 'classic',
    });
    expect(helpers.sanitizeSettingsUpdate({ desktopWindowControlsStyle: 'traffic-lights' })).toEqual({
      desktopWindowControlsStyle: 'traffic-lights',
    });
    expect(helpers.sanitizeSettingsUpdate({ desktopWindowControlsStyle: 'native' })).toEqual({});
  });

  it('only accepts a boolean desktopRemoteOnly preference', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ desktopRemoteOnly: true })).toEqual({
      desktopRemoteOnly: true,
    });
    expect(helpers.sanitizeSettingsUpdate({ desktopRemoteOnly: false })).toEqual({
      desktopRemoteOnly: false,
    });
    expect(helpers.sanitizeSettingsUpdate({ desktopRemoteOnly: 'true' })).toEqual({});
  });

  it('rejects invalid messageStreamTransport values', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ messageStreamTransport: 'websocket' })).toEqual({});
  });

  it('accepts follow-up behavior and migrates legacy queue settings in responses', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ followUpBehavior: 'steer' })).toEqual({
      followUpBehavior: 'steer',
    });
    expect(helpers.sanitizeSettingsUpdate({ followUpBehavior: 'queue' })).toEqual({
      followUpBehavior: 'queue',
    });
    expect(helpers.sanitizeSettingsUpdate({ followUpBehavior: 'later' })).toEqual({});
    expect(helpers.formatSettingsResponse({ queueModeEnabled: true }).followUpBehavior).toBe('queue');
    expect(helpers.formatSettingsResponse({ queueModeEnabled: false }).followUpBehavior).toBe('steer');
    expect(helpers.formatSettingsResponse({ followUpBehavior: 'immediate' }).followUpBehavior).toBe('steer');
    expect(helpers.formatSettingsResponse({ }).followUpBehavior).toBeUndefined();
  });

  it('accepts desktopLanAccessEnabled as a persisted shared setting', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ desktopLanAccessEnabled: true })).toEqual({
      desktopLanAccessEnabled: true,
    });
    expect(helpers.sanitizeSettingsUpdate({ desktopLanAccessEnabled: false })).toEqual({
      desktopLanAccessEnabled: false,
    });
  });

  it('accepts session pin fields for desktop/mobile sync', () => {
    const helpers = createModelPrefsTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({
      pinnedSessions: ['ses_a', 'ses_a', ''],
      pinnedSessionOrder: ['ses_a'],
      pinnedSessionsByProject: { '/proj': ['ses_b', 'ses_b'] },
      pinnedSessionOrderByProject: { '/proj': ['ses_b'] },
    })).toEqual({
      pinnedSessions: ['ses_a'],
      pinnedSessionOrder: ['ses_a'],
      pinnedSessionsByProject: { '/proj': ['ses_b'] },
      pinnedSessionOrderByProject: { '/proj': ['ses_b'] },
    });

    expect(helpers.formatSettingsResponse({}).pinnedSessions).toBeUndefined();
    expect(helpers.formatSettingsResponse({ pinnedSessions: ['ses_a'] }).pinnedSessions).toEqual(['ses_a']);
  });

  it('accepts desktopKeepAwakeEnabled as a persisted shared setting', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ desktopKeepAwakeEnabled: true })).toEqual({
      desktopKeepAwakeEnabled: true,
    });
    expect(helpers.sanitizeSettingsUpdate({ desktopKeepAwakeEnabled: false })).toEqual({
      desktopKeepAwakeEnabled: false,
    });
  });

  it('accepts desktopMacMenuBarEnabled as a persisted shared setting', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ desktopMacMenuBarEnabled: true })).toEqual({
      desktopMacMenuBarEnabled: true,
    });
    expect(helpers.sanitizeSettingsUpdate({ desktopMacMenuBarEnabled: false })).toEqual({
      desktopMacMenuBarEnabled: false,
    });
    expect(helpers.formatSettingsResponse({ desktopMacMenuBarEnabled: false })).toMatchObject({
      desktopMacMenuBarEnabled: false,
    });
  });

  it('accepts desktopMinimizeToTrayEnabled as a persisted shared setting', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ desktopMinimizeToTrayEnabled: true })).toEqual({
      desktopMinimizeToTrayEnabled: true,
    });
    expect(helpers.sanitizeSettingsUpdate({ desktopMinimizeToTrayEnabled: false })).toEqual({
      desktopMinimizeToTrayEnabled: false,
    });
    expect(helpers.formatSettingsResponse({ desktopMinimizeToTrayEnabled: true })).toMatchObject({
      desktopMinimizeToTrayEnabled: true,
    });
  });

  it('sanitizes the persisted permission auto-accept policy', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({
      permissionAutoAccept: {
        sessions: { root: true, child: false, watched: 'safety', invalid: 'true' },
        revision: 4,
      },
    })).toEqual({
      permissionAutoAccept: {
        sessions: { root: true, child: false, watched: 'safety' },
        revision: 4,
      },
    });
  });

  it('sanitizes the permission default mode', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ permissionDefaultMode: 'safety' })).toEqual({ permissionDefaultMode: 'safety' });
    expect(helpers.sanitizeSettingsUpdate({ permissionDefaultMode: 'always-allow' })).toEqual({});
  });

  it('accepts mobileKeyboardMode as a persisted shared setting', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ mobileKeyboardMode: 'native' })).toEqual({
      mobileKeyboardMode: 'native',
    });
    expect(helpers.sanitizeSettingsUpdate({ mobileKeyboardMode: 'resize-content' })).toEqual({
      mobileKeyboardMode: 'resize-content',
    });
    expect(helpers.sanitizeSettingsUpdate({ mobileKeyboardMode: ' resize-content ' })).toEqual({
      mobileKeyboardMode: 'resize-content',
    });
  });

  it('rejects invalid mobileKeyboardMode values', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ mobileKeyboardMode: 'fixed-layout' })).toEqual({});
  });

  it('defaults mobileKeyboardMode to resize-content in settings responses', () => {
    const helpers = createTestHelpers();

    expect(helpers.formatSettingsResponse({}).mobileKeyboardMode).toBe('resize-content');
  });

  it('accepts collapsibleThinkingBlocks as a persisted shared setting', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ collapsibleThinkingBlocks: true })).toEqual({
      collapsibleThinkingBlocks: true,
    });
    expect(helpers.sanitizeSettingsUpdate({ collapsibleThinkingBlocks: false })).toEqual({
      collapsibleThinkingBlocks: false,
    });
  });

  it('rejects non-boolean collapsibleThinkingBlocks values', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ collapsibleThinkingBlocks: 'true' })).toEqual({});
    expect(helpers.sanitizeSettingsUpdate({ collapsibleThinkingBlocks: 1 })).toEqual({});
  });

  it('includes collapsibleThinkingBlocks in formatSettingsResponse', () => {
    const helpers = createTestHelpers();

    const response = helpers.formatSettingsResponse({ collapsibleThinkingBlocks: false });
    expect(response.collapsibleThinkingBlocks).toBe(false);

    const responseTrue = helpers.formatSettingsResponse({ collapsibleThinkingBlocks: true });
    expect(responseTrue.collapsibleThinkingBlocks).toBe(true);
  });

  it('defaults collapsibleThinkingBlocks to true in formatSettingsResponse when absent', () => {
    const helpers = createTestHelpers();

    const response = helpers.formatSettingsResponse({});
    expect(response.collapsibleThinkingBlocks).toBe(true);
  });

  it('redacts remote instance auth values in formatSettingsResponse', () => {
    const helpers = createTestHelpers();

    const response = helpers.formatSettingsResponse({
      remoteInstances: [
        {
          id: 'remote-a',
          label: 'Remote A',
          url: 'http://remote-a.example',
          auth: { type: 'bearer', value: 'secret-token' },
          enabled: true,
        },
      ],
    });

    expect(response.remoteInstances[0].auth).toEqual({ type: 'bearer', hasValue: true });
  });

  it('preserves remote instance auth values when merging redacted settings changes', () => {
    const helpers = createTestHelpers();

    const merged = helpers.mergePersistedSettings(
      {
        remoteInstances: [
          {
            id: 'remote-a',
            label: 'Remote A',
            url: 'http://remote-a.example',
            auth: { type: 'password', value: 'open-sesame' },
            enabled: true,
          },
        ],
      },
      {
        remoteInstances: [
          {
            id: 'remote-a',
            label: 'Remote A Updated',
            url: 'http://remote-a-updated.example',
            auth: { type: 'password' },
            enabled: true,
          },
        ],
      },
    );

    expect(merged.remoteInstances[0].auth).toEqual({ type: 'password', value: 'open-sesame' });
  });

  it('applies localStore patches without replacing unrelated persisted keys', () => {
    const helpers = createTestHelpers();
    const changes = helpers.sanitizeSettingsUpdate({
      localStorePatch: {
        set: {
          'session-display-mode': 'minimal',
          'openchamber.i18n.v1': 'zh-CN',
        },
        remove: ['oc.tempSessions.collapsed'],
      },
    });

    expect(changes).toEqual({
      localStorePatch: {
        set: {
          'session-display-mode': 'minimal',
          'openchamber.i18n.v1': 'zh-CN',
        },
        remove: ['oc.tempSessions.collapsed'],
      },
    });

    const merged = helpers.mergePersistedSettings(
      {
        localStore: {
          'session-display-mode': 'default',
          'oc.tempSessions.collapsed': 'true',
          'unrelated.preference': 'keep',
        },
      },
      changes,
    );

    expect(merged.localStore).toEqual({
      'session-display-mode': 'minimal',
      'openchamber.i18n.v1': 'zh-CN',
      'unrelated.preference': 'keep',
    });
    expect(merged).not.toHaveProperty('localStorePatch');
  });

  it('redacts and preserves remote instance requestHeaders', () => {
    const helpers = createTestHelpers();

    const response = helpers.formatSettingsResponse({
      remoteInstances: [
        {
          id: 'remote-a',
          label: 'Remote A',
          url: 'http://remote-a.example',
          auth: { type: 'none' },
          requestHeaders: {
            'CF-Access-Client-Id': 'id-a',
            'CF-Access-Client-Secret': 'secret-a',
          },
          enabled: true,
        },
      ],
    });

    expect(response.remoteInstances[0].requestHeaders).toEqual({
      'CF-Access-Client-Id': '',
      'CF-Access-Client-Secret': '',
    });
    expect(response.remoteInstances[0].hasRequestHeaders).toBe(true);

    const merged = helpers.mergePersistedSettings(
      {
        remoteInstances: [
          {
            id: 'remote-a',
            label: 'Remote A',
            url: 'http://remote-a.example',
            auth: { type: 'none' },
            requestHeaders: {
              'CF-Access-Client-Id': 'id-a',
              'CF-Access-Client-Secret': 'secret-a',
            },
            enabled: true,
          },
        ],
      },
      {
        remoteInstances: [
          {
            id: 'remote-a',
            label: 'Remote A',
            url: 'http://remote-a.example',
            auth: { type: 'none' },
            requestHeaders: {
              'CF-Access-Client-Id': '',
              'CF-Access-Client-Secret': '',
            },
            enabled: true,
          },
        ],
      },
    );

    expect(merged.remoteInstances[0].requestHeaders).toEqual({
      'CF-Access-Client-Id': 'id-a',
      'CF-Access-Client-Secret': 'secret-a',
    });
  });

  it('accepts only booleans for system prompt optimization', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ optimizeSystemPrompt: true })).toEqual({
      optimizeSystemPrompt: true,
    });
    expect(helpers.sanitizeSettingsUpdate({ optimizeSystemPrompt: false })).toEqual({
      optimizeSystemPrompt: false,
    });
    expect(helpers.sanitizeSettingsUpdate({ optimizeSystemPrompt: 'true' })).toEqual({});
  });

  it('persists only supported session retention actions', () => {
    const helpers = createTestHelpers();

    expect(helpers.sanitizeSettingsUpdate({ sessionRetentionAction: 'archive' })).toEqual({
      sessionRetentionAction: 'archive',
    });
    expect(helpers.sanitizeSettingsUpdate({ sessionRetentionAction: 'delete' })).toEqual({
      sessionRetentionAction: 'delete',
    });
    expect(helpers.sanitizeSettingsUpdate({ sessionRetentionAction: 'remove' })).toEqual({});
    expect(helpers.sanitizeSettingsUpdate({ sessionRetentionAction: true })).toEqual({});
  });
});

describe('settings registry gate', () => {
  const registryPath = join(dirname(testFilePath), 'settings-registry.json');
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const persistableKeys = Object.entries(registry.fields)
    .filter(([, field]) => !field.computed && !field.local && field.owner !== 'desktop-shell')
    .map(([key]) => key);

  // One valid value per persistable registry key. The test below fails when a
  // key is added to the registry without a line here, and when the sanitizer
  // stops accepting a key the registry still lists — that is the drift the
  // registry exists to end.
  const validValues = {
    themeId: 'openchamber-dark', useSystemTheme: true, themeVariant: 'dark', lightThemeId: 'openchamber-light', darkThemeId: 'openchamber-dark',
    splashBgLight: '#fff', splashFgLight: '#000', splashBgDark: '#000', splashFgDark: '#fff',
    lastDirectory: '/home/testuser/project', homeDirectory: '/home/testuser', opencodeBinary: '/usr/local/bin/opencode',
    projects: [{ id: 'p', path: '/home/testuser/project' }], activeProjectId: 'p',
    approvedDirectories: ['/home/testuser/project'], securityScopedBookmarks: ['bookmark'],
    permissionAutoAccept: { sessions: { s: true }, revision: 1 },
    permissionDefaultMode: 'safety',
    remoteInstances: [{ id: 'r', url: 'https://r.example' }],
    pinnedDirectories: ['/home/testuser/project'], pinnedSessions: ['s1'],
    pinnedSessionsByProject: { p: ['s1'] }, pinnedSessionOrder: ['s1'], pinnedSessionOrderByProject: { p: ['s1'] },
    desktopLanAccessEnabled: true, desktopKeepAwakeEnabled: true, desktopMinimizeToTrayEnabled: true, desktopMacMenuBarEnabled: true,
    desktopKeepManagedOpenCodeAliveOnQuit: true, desktopRemoteOnly: true,
    skillCatalogs: [{ id: 'c', label: 'C', source: 'https://x' }],
    defaultGitIdentityId: 'global',
    agentControlToolEnabled: true, browserProvider: 'builtin', agentMemoryToolEnabled: true, agentNotifyToolEnabled: true, isolatedSpacesEnabled: true, isolatedSpacesIdleStop: { enabled: true, hours: 4 },
    autoDeleteEnabled: true, autoDeleteAfterDays: 30, sessionRetentionAction: 'archive', sessionRetentionOnlyArchived: false, autoSaveEnabled: true,
    openInAppId: 'vscode',
    sttProvider: 'server', sttServerUrl: 'http://localhost:8001/v1', sttModel: 'm', wasmSttModel: 'm', sttLanguage: 'en',
    sttSilenceThresholdDb: -40, sttSilenceHoldMs: 500, sttTranscribeOnStop: true,
    tunnelProvider: 'cloudflare', tunnelMode: 'quick', tunnelBootstrapTtlMs: 600000, tunnelSessionTtlMs: 86400000,
    managedLocalTunnelConfigPath: '/tmp/x', managedRemoteTunnelHostname: 'x.example', managedRemoteTunnelToken: 'token',
    managedRemoteTunnelPresets: [{ id: 'a', name: 'A', hostname: 'a.example' }],
    managedRemoteTunnelSelectedPresetId: 'a', managedRemoteTunnelPresetTokens: { a: 'token' },
    showReasoningTraces: true, collapsibleThinkingBlocks: true,
    chatRenderMode: 'live', activityRenderMode: 'summary',
    userMessageRenderingMode: 'markdown', collapsibleUserMessages: true,
    stickyUserHeader: true, promptNavigatorEnabled: true, wideChatLayoutEnabled: true,
    showSplitAssistantMessageActions: true, showToolFileIcons: true, codeBlockLineWrap: true,
    showExpandedBashTools: true, showExpandedEditTools: true,
    timeFormatPreference: '24h', weekStartPreference: 'monday', messageStreamTransport: 'ws',
    diffLayoutPreference: 'inline', diffViewMode: 'single', gitChangesViewMode: 'tree',
    gitmojiEnabled: true, defaultFileViewerPreview: true, directoryShowHidden: true, filesViewShowGitignored: true,
    allowPromptingSubagentSessions: true, inputSpellcheckEnabled: true,
    followUpBehavior: 'steer', queueModeEnabled: true,
    draftStarters: [{ type: 'command', name: 'plan-feature' }],
    draftStartersScheduleTaskAdded: true, draftStartersVisible: true,
    fontSize: 100, terminalFontSize: 14, editorFontSize: 14, uiFont: 'inter', monoFont: 'jetbrains-mono', padding: 100, cornerRadius: 8,
    globalBehaviorPrompt: 'Be brief.', responseStyleEnabled: true, responseStylePreset: 'concise', responseStyleCustomInstructions: 'x',
    optimizeSystemPrompt: true,
    defaultModel: 'anthropic/claude', defaultVariant: 'high', defaultAgent: 'build',
    smallModelUseDefault: false, smallModelOverride: 'anthropic/haiku', walkthroughModelOverride: 'anthropic/claude', zenModel: 'zen/model',
    gitProviderId: 'anthropic', gitModelId: 'claude',
    favoriteModels: [{ providerID: 'anthropic', modelID: 'claude' }], hiddenModels: [{ providerID: 'openai', modelID: 'gpt' }],
    collapsedModelProviders: ['provider:openai'],
    modelPickerLayoutByServerId: { srv: { providerOrder: ['anthropic'], collapsedProviders: ['provider:openai'] } },
    recentModels: [{ providerID: 'anthropic', modelID: 'claude' }], recentAgents: ['build'], recentEfforts: { 'anthropic/claude': ['high'] },
    sessionRecapEnabled: true, sessionSuggestionEnabled: true, sessionGoalEnabled: true,
    sessionGoalDefaultBudgetEnabled: true, sessionGoalDefaultBudget: 5,
    showDeletionDialog: true, autoCreateWorktree: true,
    nativeNotificationsEnabled: true, notificationMode: 'always', notifyOnSubtasks: true,
    notifyOnCompletion: true, notifyOnError: true, notifyOnQuestion: true,
    notificationTemplates: { completion: { title: 't', message: 'm' } }, reportUsage: true,
    summarizeLastMessage: true, summaryThreshold: 100, summaryLength: 50, maxLastMessageLength: 200,
    usageAutoRefresh: true, usageRefreshIntervalMs: 60000, usageDisplayMode: 'usage', usageShowPredValues: true,
    usageDropdownProviders: ['anthropic'], usageSelectedModels: { anthropic: ['claude'] },
    usageCollapsedFamilies: { anthropic: ['f'] }, usageExpandedFamilies: { anthropic: ['f'] },
    usageModelGroups: { anthropic: { customGroups: [{ id: 'g', label: 'G', models: ['claude'], order: 0 }] } },
    pwaAppName: 'OpenChamber', pwaOrientation: 'portrait',
    messageLimit: 100, localStore: { k: 'v' }, localStorePatch: { set: { k: 'v' } },
    mobileKeyboardMode: 'native', desktopWindowControlsPosition: 'left', desktopWindowControlsStyle: 'classic', inputBarOffset: 10,
  };

  it('accepts a valid value for every persistable registry key (no server-side drift)', () => {
    // The shared test helpers stub the injected list sanitizers to `undefined`
    // (they are covered by their own suites); here they must pass values through
    // so a key is judged by the sanitizer's own branch, not by a stub.
    const helpers = createSettingsHelpers({
      normalizePathForPersistence: (value) => value,
      normalizeDirectoryPath: (value) => value,
      normalizeTunnelBootstrapTtlMs: (value) => value,
      normalizeTunnelSessionTtlMs: (value) => value,
      normalizeTunnelProvider: (value) => value,
      normalizeTunnelMode: (value) => value,
      normalizeOptionalPath: (value) => value,
      normalizeManagedRemoteTunnelHostname: (value) => value,
      normalizeManagedRemoteTunnelPresets: (value) => value,
      normalizeManagedRemoteTunnelPresetTokens: (value) => value,
      normalizeStringArray: (input) => input,
      sanitizeModelRefs: (value) => value,
      sanitizeSkillCatalogs: (value) => value,
      sanitizeProjects: (value) => value,
    });
    const missingFixture = persistableKeys.filter((key) => !(key in validValues));
    expect(missingFixture).toEqual([]);

    const rejected = persistableKeys.filter((key) => {
      const result = helpers.sanitizeSettingsUpdate({ [key]: validValues[key] });
      return result[key] === undefined;
    });
    expect(rejected).toEqual([]);
  });

  it('drops keys the registry does not list, computed flags, and desktop-shell-owned keys', () => {
    const helpers = createTestHelpers();
    const sanitized = helpers.sanitizeSettingsUpdate({
      markdownDisplayMode: 'x',
      typographySizes: { md: 16 },
      hasManagedRemoteTunnelToken: true,
      desktopHosts: [],
      desktopInstallId: 'x',
      localStore: { a: 'b' },
    });
    expect(sanitized).toEqual({ localStore: { a: 'b' } });
  });
});
