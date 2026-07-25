import { describe, expect, it } from 'vitest';

import { createSettingsHelpers } from './settings-helpers.js';

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
        sessions: { root: true, child: false, invalid: 'true' },
        revision: 4,
      },
    })).toEqual({
      permissionAutoAccept: {
        sessions: { root: true, child: false },
        revision: 4,
      },
    });
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
});
