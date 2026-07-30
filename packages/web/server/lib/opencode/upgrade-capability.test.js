import { describe, expect, test } from 'bun:test';
import { resolveOpenCodeUpgradeCapability } from './upgrade-capability.js';

const resolve = (overrides = {}) => resolveOpenCodeUpgradeCapability({
  isExternal: false,
  hasManagedProcess: true,
  activeBinary: '/usr/local/bin/opencode',
  isBundledBinary: () => false,
  ...overrides,
});

describe('OpenCode upgrade capability', () => {
  test('rejects external runtimes', () => {
    expect(resolve({ isExternal: true })).toEqual({
      supported: false,
      manager: 'external',
      reason: 'external',
    });
  });

  test('rejects bundled runtimes', () => {
    expect(resolve({ isBundledBinary: () => true })).toEqual({
      supported: false,
      manager: 'openchamber',
      reason: 'bundled',
    });
  });

  test('rejects unavailable managed runtimes', () => {
    expect(resolve({ hasManagedProcess: false })).toEqual({
      supported: false,
      manager: null,
      reason: 'unavailable',
    });
  });

  test('allows a managed non-bundled runtime', () => {
    expect(resolve()).toEqual({
      supported: true,
      manager: 'opencode',
      reason: null,
    });
  });
});
