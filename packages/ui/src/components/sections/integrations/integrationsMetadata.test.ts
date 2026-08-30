import { describe, expect, test } from 'bun:test';

import { getSettingsNavIcon } from '@/lib/settings/navIcons';
import {
  getSettingsPageMeta,
  isSettingsPageVisibleForInstance,
} from '@/lib/settings/metadata';

describe('Integrations settings registration', () => {
  test('is reachable on both local and remote Settings instances', () => {
    const page = getSettingsPageMeta('integrations');

    expect(page?.kind).toBe('single');
    expect(page && isSettingsPageVisibleForInstance(page, 'default')).toBe(true);
    expect(page && isSettingsPageVisibleForInstance(page, 'remote')).toBe(true);
    expect(getSettingsNavIcon('integrations')).toBe('plug');
  });
});
