import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mergeOpenChamberPluginEntries, writeOpenChamberOverlay } from './plugin-overlay.js';

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

  test('attaches managed plugin options without replacing user plugins', () => {
    const openChamberPlugin = 'file:///Users/test/.config/openchamber/opencode-notifier';
    const merged = mergeOpenChamberPluginEntries(
      ['other-plugin'],
      openChamberPlugin,
      { optimizeSystemPrompt: true },
    );

    expect(merged).toEqual([
      'other-plugin',
      [openChamberPlugin, { optimizeSystemPrompt: true }],
    ]);
  });

  test('reads plugin entries only from the explicit OpenCode config directory', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'openchamber-overlay-'));
    const configDirectory = join(rootDirectory, 'opencode');
    const overlayDirectory = join(rootDirectory, 'openchamber');
    const overlayFile = join(overlayDirectory, 'opencode-overlay.json');
    const pluginEntry = join(overlayDirectory, 'opencode-notifier');

    try {
      await mkdir(configDirectory, { recursive: true });
      await writeFile(
        join(configDirectory, 'opencode.json'),
        JSON.stringify({ plugin: ['isolated-plugin'] }),
        'utf8',
      );

      writeOpenChamberOverlay({
        overlayDir: overlayDirectory,
        overlayFile,
        pluginEntry,
        userConfigDir: configDirectory,
      });

      expect(JSON.parse(await readFile(overlayFile, 'utf8')).plugin).toEqual([
        'isolated-plugin',
        `file://${pluginEntry}`,
      ]);
    } finally {
      await rm(rootDirectory, { recursive: true, force: true });
    }
  });
});
