import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  DEFAULT_PROTOCOL_MODE_SERVER_ID,
  PROTOCOL_MODE_ENV_KEY,
  getStoredProtocolModeEntry,
  readProtocolModeOverride,
  recordProtocolMode,
  recordProtocolModeFromVersion,
  resetProtocolModes,
  resolveProtocolMode,
  snapshotProtocolModes,
} from './protocol-mode.js';

afterEach(() => {
  resetProtocolModes();
});

describe('protocol-mode store (fork dual-stack, per serverId)', () => {
  test('resolves the conservative v1 default before any probe records', () => {
    expect(resolveProtocolMode('default')).toBe('v1');
    expect(resolveProtocolMode('remote-1')).toBe('v1');
    expect(resolveProtocolMode('')).toBe('v1');
    expect(getStoredProtocolModeEntry('default')).toBeUndefined();
  });

  test('stores and resolves modes independently per server instance', () => {
    recordProtocolMode('default', { mode: 'v2', version: '2.0.14-sscity', source: 'spawn' });
    recordProtocolMode('remote-1', { mode: 'v1', version: '1.18.31-sscity', source: 'remote-health' });

    expect(resolveProtocolMode('default')).toBe('v2');
    expect(resolveProtocolMode('remote-1')).toBe('v1');
    expect(resolveProtocolMode('remote-2')).toBe('v1');

    expect(getStoredProtocolModeEntry('default')).toMatchObject({
      mode: 'v2', version: '2.0.14-sscity', source: 'spawn',
    });
  });

  test('normalizes blank server ids onto the managed default instance', () => {
    expect(DEFAULT_PROTOCOL_MODE_SERVER_ID).toBe('default');
    recordProtocolMode('', { mode: 'v2' });
    expect(resolveProtocolMode('default')).toBe('v2');
    expect(resolveProtocolMode(undefined)).toBe('v2');
  });

  test('records v1/v2 judgment straight from a version string', () => {
    recordProtocolModeFromVersion('default', '2.0.14-sscity', 'spawn');
    recordProtocolModeFromVersion('remote-1', '1.18.32', 'remote-health');
    recordProtocolModeFromVersion('remote-2', null);

    expect(resolveProtocolMode('default')).toBe('v2');
    expect(resolveProtocolMode('remote-1')).toBe('v1');
    expect(resolveProtocolMode('remote-2')).toBe('v1');
    expect(getStoredProtocolModeEntry('remote-1')?.version).toBe('1.18.32');
  });

  test('rejects unknown modes instead of storing them silently', () => {
    expect(() => recordProtocolMode('default', { mode: 'v3' })).toThrow(TypeError);
    expect(() => recordProtocolMode('default', { mode: undefined })).toThrow(TypeError);
    expect(getStoredProtocolModeEntry('default')).toBeUndefined();
  });

  test('env override wins over recorded modes in both directions', () => {
    recordProtocolMode('default', { mode: 'v1' });
    expect(resolveProtocolMode('default', { [PROTOCOL_MODE_ENV_KEY]: 'v2' })).toBe('v2');

    recordProtocolMode('default', { mode: 'v2' });
    expect(resolveProtocolMode('default', { [PROTOCOL_MODE_ENV_KEY]: 'v1' })).toBe('v1');

    expect(readProtocolModeOverride({ [PROTOCOL_MODE_ENV_KEY]: ' V2 ' })).toBe('v2');
    expect(resolveProtocolMode('remote-1', { [PROTOCOL_MODE_ENV_KEY]: 'v2' })).toBe('v2');
  });

  test('ignores an invalid override, warns once, and keeps recorded resolution', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(readProtocolModeOverride({ [PROTOCOL_MODE_ENV_KEY]: 'v3' })).toBeNull();
      expect(readProtocolModeOverride({ [PROTOCOL_MODE_ENV_KEY]: 'v3' })).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);

      recordProtocolMode('default', { mode: 'v2' });
      expect(resolveProtocolMode('default', { [PROTOCOL_MODE_ENV_KEY]: 'bogus' })).toBe('v2');
      expect(resolveProtocolMode('default', {})).toBe('v2');
      expect(resolveProtocolMode('default')).toBe('v2');
    } finally {
      warn.mockRestore();
    }
  });

  test('snapshot and reset cover the whole instance table', () => {
    recordProtocolMode('default', { mode: 'v2' });
    recordProtocolMode('remote-1', { mode: 'v1' });
    expect(Object.keys(snapshotProtocolModes()).sort()).toEqual(['default', 'remote-1']);

    snapshotProtocolModes().default.mode = 'v1';
    expect(resolveProtocolMode('default')).toBe('v2');

    resetProtocolModes();
    expect(snapshotProtocolModes()).toEqual({});
    expect(resolveProtocolMode('default')).toBe('v1');
  });
});
