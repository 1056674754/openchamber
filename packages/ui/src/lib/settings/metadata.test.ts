import { describe, expect, test } from 'bun:test';
import {
  SETTINGS_PAGE_METADATA,
  isSettingsPageVisibleForInstance,
} from './metadata';

const meta = (slug: string) => {
  const page = SETTINGS_PAGE_METADATA.find((entry) => entry.slug === slug);
  if (!page) {
    throw new Error(`Missing settings metadata for ${slug}`);
  }
  return page;
};

describe('settings page instance visibility', () => {
  test('requires explicit instance visibility for non-home pages', () => {
    for (const page of SETTINGS_PAGE_METADATA) {
      if (page.slug === 'home') {
        continue;
      }
      expect(page.showOn === undefined).toBe(false);
    }
  });

  test('keeps remote instance management on the default instance only', () => {
    const page = meta('remote-instances');
    expect(page.kind).toBe('split');
    expect(isSettingsPageVisibleForInstance(page, 'default')).toBe(true);
    expect(isSettingsPageVisibleForInstance(page, 'remote')).toBe(false);
  });

  test('keeps local UI settings out of the remote instance scope', () => {
    for (const slug of ['appearance', 'chat', 'notifications', 'shortcuts', 'voice', 'tunnel']) {
      const page = meta(slug);
      expect(isSettingsPageVisibleForInstance(page, 'default')).toBe(true);
      expect(isSettingsPageVisibleForInstance(page, 'remote')).toBe(false);
    }
  });

  test('keeps server and workflow configuration pages visible in the remote instance scope', () => {
    for (const slug of [
      'sessions',
      'git',
      'magic-prompts',
      'snippets',
      'providers',
      'usage',
      'agents',
      'behavior',
      'commands',
      'mcp',
      'plugins',
      'permissions',
      'config-presets',
      'skills.installed',
      'skills.catalog',
    ]) {
      const page = meta(slug);
      expect(isSettingsPageVisibleForInstance(page, 'default')).toBe(true);
      expect(isSettingsPageVisibleForInstance(page, 'remote')).toBe(true);
    }
  });

  test('keeps remote projects visible but hides connection maintenance pages from the settings nav', () => {
    for (const slug of ['remote-projects']) {
      const page = meta(slug);
      expect(isSettingsPageVisibleForInstance(page, 'default')).toBe(false);
      expect(isSettingsPageVisibleForInstance(page, 'remote')).toBe(true);
    }

    for (const slug of ['remote-connection', 'remote-port-forwarding']) {
      const page = meta(slug);
      expect(isSettingsPageVisibleForInstance(page, 'remote')).toBe(true);
      expect(page.isAvailable?.({
        isVSCode: false,
        isWeb: false,
        isDesktop: true,
        isDesktopServer: true,
      })).toBe(false);
    }
  });

  test('keeps config sync hidden until selected-instance sync is implemented', () => {
    const page = meta('config-sync');
    expect(page.showOn).toBe('remote');
    expect(page.isAvailable?.({
      isVSCode: false,
      isWeb: false,
      isDesktop: true,
      isDesktopServer: true,
    })).toBe(false);
  });
});
