import { describe, expect, test } from 'bun:test';
import { resolveOpenCodeUpgradeCommand } from './opencode-upgrade-runtime.js';

describe('OpenCode direct upgrade runtime', () => {
  test('uses Homebrew when the resolved OpenCode binary is under Homebrew', () => {
    const result = resolveOpenCodeUpgradeCommand({
      resolved: '/opt/homebrew/bin/opencode',
    });

    expect(result).toEqual({
      source: 'homebrew',
      command: 'brew upgrade anomalyco/tap/opencode || brew upgrade opencode',
      opencodeBinary: '/opt/homebrew/bin/opencode',
    });
  });

  test('uses Bun global install when the binary is under the Bun home', () => {
    const result = resolveOpenCodeUpgradeCommand({
      resolved: `${process.env.HOME}/.bun/bin/opencode`,
    });

    expect(result).toEqual({
      source: 'bun',
      command: 'bun add -g opencode-ai@latest',
      opencodeBinary: `${process.env.HOME}/.bun/bin/opencode`,
    });
  });

  test('returns an explicit unknown result when the install source is not recognized', () => {
    const result = resolveOpenCodeUpgradeCommand({
      resolved: '/tmp/custom/opencode',
    });

    expect(result).toEqual({
      source: 'unknown',
      command: null,
      opencodeBinary: '/tmp/custom/opencode',
    });
  });
});
