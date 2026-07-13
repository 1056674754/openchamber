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

describe('settings helpers', () => {
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
});
