import { describe, expect, test } from 'bun:test';
import type { ProjectEntry } from '@/lib/api/types';
import { resolveSettingsProjectTarget } from '@/lib/settingsProjectTarget';

const projects: ProjectEntry[] = [
  { id: 'local-a', path: '/same' },
  { id: 'local-b', path: '/local/b' },
  { id: 'remote-a', path: '/same', serverId: 'dev3' },
];

describe('resolveSettingsProjectTarget', () => {
  test('keeps Settings selection independent per server', () => {
    const local = resolveSettingsProjectTarget({ default: 'local-b', dev3: 'remote-a' }, projects, 'local-a', 'default');
    const remote = resolveSettingsProjectTarget({ default: 'local-b', dev3: 'remote-a' }, projects, 'local-a', 'dev3');
    expect([local.projectId, local.directory, local.serverId]).toEqual(['local-b', '/local/b', 'default']);
    expect([remote.projectId, remote.directory, remote.serverId]).toEqual(['remote-a', '/same', 'dev3']);
  });

  test('follows the active project only within the selected settings server', () => {
    expect(resolveSettingsProjectTarget({}, projects, 'local-a', 'default').projectId).toBe('local-a');
    expect(resolveSettingsProjectTarget({}, projects, 'local-a', 'dev3').projectId).toBe('remote-a');
  });

  test('falls back when a remembered project disappears', () => {
    expect(resolveSettingsProjectTarget({ default: 'removed' }, projects, 'local-b', 'default').projectId).toBe('local-b');
  });
});
