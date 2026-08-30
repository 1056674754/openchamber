import { describe, expect, test } from 'bun:test';

import {
  buildSettingsInstanceDescriptors,
  resolveSettingsInstancePhase,
} from './settingsInstances';

describe('settings instance sources', () => {
  test('uses configured web remotes when no desktop SSH bridge exists', () => {
    const instances = buildSettingsInstanceDescriptors({
      desktopInvokeAvailable: false,
      sshInstances: [],
      webInstances: [{
        id: 'remote-web',
        label: 'Remote Web',
        enabled: true,
        url: 'https://remote.example',
        source: 'explicit',
      }],
    });

    expect(instances).toEqual([{
      id: 'remote-web',
      type: 'remote',
      transport: 'url',
      label: 'Remote Web',
      directory: '',
      instanceLabel: 'Remote Web',
    }]);
  });

  test('keeps the native SSH source authoritative in desktop', () => {
    const instances = buildSettingsInstanceDescriptors({
      desktopInvokeAvailable: true,
      sshInstances: [{
        id: 'desktop-ssh',
        nickname: 'Desktop SSH',
        sshCommand: 'ssh dev',
        connectionTimeoutSec: 60,
        remoteOpenchamber: {
          mode: 'managed',
          keepRunning: true,
          bindHost: '127.0.0.1',
          installMethod: 'auto',
          uploadBundleOverSsh: false,
        },
        localForward: { bindHost: '127.0.0.1' },
        auth: {},
        portForwards: [],
      }],
      webInstances: [{
        id: 'remote-web',
        label: 'Remote Web',
        enabled: true,
      }],
    });

    expect(instances.map((instance) => instance.id)).toEqual(['desktop-ssh']);
    expect(instances[0]?.transport).toBe('ssh');
  });

  test('reads status from the matching runtime store', () => {
    const sshStatuses = {
      remote: {
        id: 'remote',
        phase: 'ready' as const,
        startedByUs: true,
        retryAttempt: 0,
        requiresUserAction: false,
        updatedAtMs: 1,
      },
    };
    const webStatuses = {
      remote: {
        id: 'remote',
        phase: 'connected' as const,
        updatedAtMs: 1,
      },
    };

    expect(resolveSettingsInstancePhase('remote', true, sshStatuses, webStatuses)).toBe('ready');
    expect(resolveSettingsInstancePhase('remote', false, sshStatuses, webStatuses)).toBe('connected');
  });
});
