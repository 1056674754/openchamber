import { describe, expect, test } from 'bun:test';

import { mergeOpenChamberPluginEntries } from './plugin-overlay.js';

describe('OpenChamber plugin overlay entries', () => {
  test('preserves existing user plugins before appending OpenChamber', () => {
    const openChamberPlugin = 'file:///Users/test/.config/openchamber/opencode-notifier';
    const merged = mergeOpenChamberPluginEntries([
      'file:///Users/test/.config/opencode/node_modules/oh-my-opencode/dist/index.js',
      ['file:///Users/test/.config/opencode/node_modules/gitlab/dist/index.js', { token: 'x' }],
    ], openChamberPlugin);

    expect(merged).toEqual([
      'file:///Users/test/.config/opencode/node_modules/oh-my-opencode/dist/index.js',
      ['file:///Users/test/.config/opencode/node_modules/gitlab/dist/index.js', { token: 'x' }],
      openChamberPlugin,
    ]);
  });

  test('deduplicates stale OpenChamber entries from user plugins', () => {
    const openChamberPlugin = 'file:///Users/test/.config/openchamber/opencode-notifier';
    const merged = mergeOpenChamberPluginEntries([
      '@openchamber/plugin',
      'file:///Users/test/dev/openchamber/packages/plugin/src/index.ts',
      'file:///Users/test/.config/openchamber/plugin/index.js',
      openChamberPlugin,
      'other-plugin',
      'other-plugin',
    ], openChamberPlugin);

    expect(merged).toEqual(['other-plugin', openChamberPlugin]);
  });
});
