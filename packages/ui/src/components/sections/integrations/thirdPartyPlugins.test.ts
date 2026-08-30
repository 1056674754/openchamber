import { describe, expect, test } from 'bun:test';

import type { PluginEntry, RegistryResult } from '@/stores/usePluginsStore';

import {
  getCatalogPluginPresentation,
  getCatalogPluginPrimaryAction,
  getCatalogPluginState,
  getLatestNpmSpec,
  specMatchesPackage,
  THIRD_PARTY_PLUGINS,
} from './thirdPartyPlugins';

const packageName = '@openchamber/opencode-claude';
const userEntry = (spec = `${packageName}@1.0.0`): PluginEntry => ({
  id: 'config:user:claude',
  spec,
  scope: 'user',
  kind: 'config',
  parsedKind: 'npm',
});
const registry = (currentVersion: string | null, latestVersion = '2.0.0'): RegistryResult => ({
  kind: 'npm-ok',
  spec: userEntry().spec,
  name: packageName,
  currentVersion,
  latestVersion,
  versions: ['1.0.0', latestVersion],
  hasUpdate: currentVersion !== latestVersion,
});

describe('third-party integration catalog', () => {
  test('matches exact and versioned npm specs only', () => {
    expect(specMatchesPackage(packageName, packageName)).toBe(true);
    expect(specMatchesPackage(`${packageName}@1.0.0`, packageName)).toBe(true);
    expect(specMatchesPackage(`${packageName}-extra@1.0.0`, packageName)).toBe(false);
  });

  test('final v1.20 catalog contains Claude and Cursor but not retired Command Code', () => {
    expect(THIRD_PARTY_PLUGINS.map((plugin) => plugin.id)).toEqual([
      'opencode-claude',
      'opencode-cursor-oauth',
    ]);
  });

  test('separates a single user install from project installs', () => {
    const projectEntry: PluginEntry = {
      ...userEntry(),
      id: 'config:project:claude',
      scope: 'project',
    };
    const state = getCatalogPluginState(
      [userEntry(), projectEntry],
      packageName,
      { [userEntry().spec]: registry('1.0.0') },
    );

    expect(state.userEntry?.id).toBe('config:user:claude');
    expect(state.projectEntries).toEqual([projectEntry]);
    expect(state.userEntryIsAmbiguous).toBe(false);
  });

  test('requires manual management when duplicate user entries exist', () => {
    const state = getCatalogPluginState(
      [userEntry(), { ...userEntry(), id: 'config:user:claude-duplicate' }],
      packageName,
      {},
    );

    expect(state.userEntry).toBeNull();
    expect(state.userEntryIsAmbiguous).toBe(true);
    expect(getCatalogPluginPrimaryAction(state, packageName)).toBe('manage');
    expect(getCatalogPluginPresentation(state).status).toBe('ambiguous');
  });

  test('chooses install, update and setup from registry state', () => {
    const absent = getCatalogPluginState([], packageName, { [packageName]: registry(null) });
    expect(getCatalogPluginPrimaryAction(absent, packageName)).toBe('install');

    const outdated = getCatalogPluginState(
      [userEntry()],
      packageName,
      { [userEntry().spec]: registry('1.0.0') },
    );
    expect(getLatestNpmSpec(packageName, outdated.registry)).toBe(`${packageName}@2.0.0`);
    expect(getCatalogPluginPrimaryAction(outdated, packageName)).toBe('update');
    expect(getCatalogPluginPresentation(outdated).status).toBe('update-available');

    const current = getCatalogPluginState(
      [userEntry(`${packageName}@2.0.0`)],
      packageName,
      { [`${packageName}@2.0.0`]: { ...registry('2.0.0'), spec: `${packageName}@2.0.0` } },
    );
    expect(getCatalogPluginPrimaryAction(current, packageName)).toBe('setup');
    expect(getCatalogPluginPresentation(current).status).toBe('installed-version');
  });

  test('transient restart state outranks installed metadata', () => {
    const state = getCatalogPluginState(
      [userEntry()],
      packageName,
      { [userEntry().spec]: registry('1.0.0') },
    );
    expect(getCatalogPluginPresentation(state, { restartRequired: true }).status).toBe('restart-required');
  });
});
