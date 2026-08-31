import { describe, expect, it, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { createProjectIdFromPath } from '../projects/project-id.js';
import { createSettingsRuntime } from './settings-runtime.js';

const createRuntime = async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-settings-runtime-'));
  const settingsFilePath = path.join(tempRoot, 'settings.json');
  const runtime = createSettingsRuntime({
    fsPromises,
    path,
    crypto,
    SETTINGS_FILE_PATH: settingsFilePath,
    sanitizeProjects: (projects) => Array.isArray(projects) ? projects : [],
    sanitizeSettingsUpdate: (settings) => settings,
    // Real merge semantics: a regression where reads lose on-disk keys (the
    // historical wipe) must be observable as lost keys after a persist.
    mergePersistedSettings: (current, changes) => ({ ...current, ...changes }),
    normalizeSettingsPaths: (settings) => ({ settings, changed: false }),
    normalizeStringArray: (values) => Array.isArray(values) ? values.filter((value) => typeof value === 'string') : [],
    formatSettingsResponse: (settings) => settings,
    resolveDirectoryCandidate: (value) => value,
    normalizeManagedRemoteTunnelHostname: (value) => value,
    normalizeManagedRemoteTunnelPresets: (value) => value,
    normalizeManagedRemoteTunnelPresetTokens: (value) => value,
    syncManagedRemoteTunnelConfigWithPresets: async () => {},
    upsertManagedRemoteTunnelToken: async () => {},
  });

  return {
    runtime,
    settingsFilePath,
    tempRoot,
    cleanup: async () => {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    },
  };
};

describe('settings runtime', () => {
  it('only remaps project plan paths within the migrated storage directory', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      const projectPath = path.join(tempRoot, 'project');
      const oldProjectId = 'legacy-project-id';
      const newProjectId = createProjectIdFromPath(projectPath);
      const projectsRoot = path.join(path.dirname(settingsFilePath), 'projects');
      const oldStorageDir = path.join(projectsRoot, oldProjectId);
      const newStorageDir = path.join(projectsRoot, newProjectId);
      const siblingStorageDir = `${oldStorageDir}-sibling`;

      await fsPromises.mkdir(projectPath, { recursive: true });
      await fsPromises.mkdir(projectsRoot, { recursive: true });
      await fsPromises.writeFile(
        settingsFilePath,
        JSON.stringify({
          projects: [{ id: oldProjectId, path: projectPath, addedAt: 1, lastOpenedAt: 1 }],
          activeProjectId: oldProjectId,
        }, null, 2),
        'utf8',
      );
      await fsPromises.writeFile(
        path.join(projectsRoot, `${oldProjectId}.json`),
        JSON.stringify({
          projectPlanFiles: [
            { id: 'inside', path: path.join(oldStorageDir, 'plans', 'inside.md') },
            { id: 'sibling', path: path.join(siblingStorageDir, 'plans', 'outside.md') },
          ],
        }, null, 2),
        'utf8',
      );

      await runtime.readSettingsFromDiskMigrated();

      const migratedConfig = JSON.parse(await fsPromises.readFile(path.join(projectsRoot, `${newProjectId}.json`), 'utf8'));
      expect(migratedConfig.projectPlanFiles).toEqual([
        { id: 'inside', path: path.join(newStorageDir, 'plans', 'inside.md') },
        { id: 'sibling', path: path.join(siblingStorageDir, 'plans', 'outside.md') },
      ]);
    } finally {
      await cleanup();
    }
  });

  it('cleans orphaned settings temp files during startup migration', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      const orphan = path.join(tempRoot, 'settings.json.tmp-1234-11111-abc');
      const unrelated = path.join(tempRoot, 'other-file.json');
      await fsPromises.writeFile(orphan, '{"broken":true}', 'utf8');
      await fsPromises.writeFile(unrelated, '{"keep":true}', 'utf8');
      await fsPromises.writeFile(settingsFilePath, '{"theme":"light"}', 'utf8');

      await runtime.readSettingsFromDiskMigrated();

      const files = await fsPromises.readdir(tempRoot);
      expect(files).toContain('settings.json');
      expect(files).toContain('other-file.json');
      expect(files).not.toContain(path.basename(orphan));
    } finally {
      await cleanup();
    }
  });

  it('removes its temp file when atomic replacement fails', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-settings-runtime-'));
    const settingsFilePath = path.join(tempRoot, 'settings.json');
    let capturedTmp = null;
    const wrappedFs = {
      ...fsPromises,
      rename: async (source) => {
        capturedTmp = source;
        throw Object.assign(new Error('unexpected disk failure'), { code: 'EIO' });
      },
    };
    const runtime = createSettingsRuntime({
      fsPromises: wrappedFs,
      path,
      crypto,
      SETTINGS_FILE_PATH: settingsFilePath,
      sanitizeProjects: (projects) => Array.isArray(projects) ? projects : [],
      sanitizeSettingsUpdate: (settings) => settings,
      mergePersistedSettings: (_current, changes) => changes,
      normalizeSettingsPaths: (settings) => ({ settings, changed: false }),
      normalizeStringArray: (values) => Array.isArray(values) ? values.filter((value) => typeof value === 'string') : [],
      formatSettingsResponse: (settings) => settings,
      resolveDirectoryCandidate: (value) => value,
      normalizeManagedRemoteTunnelHostname: (value) => value,
      normalizeManagedRemoteTunnelPresets: (value) => value,
      normalizeManagedRemoteTunnelPresetTokens: (value) => value,
      syncManagedRemoteTunnelConfigWithPresets: async () => {},
      upsertManagedRemoteTunnelToken: async () => {},
    });

    try {
      await expect(runtime.writeSettingsToDisk({ theme: 'dark' })).rejects.toThrow('unexpected disk failure');
      expect(capturedTmp).toBeTruthy();
      expect((await fsPromises.readdir(tempRoot)).some((file) => file.startsWith('settings.json.tmp-'))).toBe(false);
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('refuses to persist over an existing settings file that fails to parse', async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime();
    try {
      await fsPromises.writeFile(settingsFilePath, '{corrupted');

      await expect(runtime.persistSettings({ themeId: 'dark' })).rejects.toThrow(/Refusing to write settings/);

      // The corrupted file must remain untouched on disk so the data stays recoverable.
      expect(await fsPromises.readFile(settingsFilePath, 'utf8')).toBe('{corrupted');

      // Repair by rewrite clears the guard and persistence works again.
      await fsPromises.writeFile(settingsFilePath, JSON.stringify({ themeId: 'light' }, null, 2));
      await runtime.persistSettings({ themeId: 'dark' });
      const saved = JSON.parse(await fsPromises.readFile(settingsFilePath, 'utf8'));
      expect(saved.themeId).toBe('dark');
    } finally {
      await cleanup();
    }
  });

  it('recovers via repair-by-delete: removing the corrupt file re-enables persistence', async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime();
    try {
      await fsPromises.writeFile(settingsFilePath, '{corrupted');
      await expect(runtime.persistSettings({ themeId: 'dark' })).rejects.toThrow(/Refusing to write settings/);

      await fsPromises.rm(settingsFilePath);
      await runtime.persistSettings({ themeId: 'dark' });
      const saved = JSON.parse(await fsPromises.readFile(settingsFilePath, 'utf8'));
      expect(saved.themeId).toBe('dark');
    } finally {
      await cleanup();
    }
  });

  it('blocks direct writeSettingsToDisk calls while the settings file is unreadable', async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime();
    try {
      await fsPromises.writeFile(settingsFilePath, '{corrupted');
      await runtime.readSettingsFromDisk();

      await expect(runtime.writeSettingsToDisk({ themeId: 'dark' })).rejects.toThrow(/Refusing to write settings/);
      expect(await fsPromises.readFile(settingsFilePath, 'utf8')).toBe('{corrupted');
    } finally {
      await cleanup();
    }
  });

  it('treats array-root and primitive-root settings files as unreadable', async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime();
    try {
      for (const corruptRoot of ['[]', '"settings"', '42']) {
        await fsPromises.writeFile(settingsFilePath, corruptRoot);
        await expect(runtime.persistSettings({ themeId: 'dark' })).rejects.toThrow(/Refusing to write settings/);
        expect(await fsPromises.readFile(settingsFilePath, 'utf8')).toBe(corruptRoot);
      }
    } finally {
      await cleanup();
    }
  });

  it('keeps unrelated on-disk settings keys across a persist (wipe regression guard)', async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime();
    try {
      await fsPromises.writeFile(settingsFilePath, JSON.stringify({
        themeId: 'light',
        desktopSshInstances: [{ id: 'ssh-1773445565164-e132cb04b5e51', nickname: 'SUIS-QP-TX-CLOUD' }],
      }, null, 2));

      await runtime.persistSettings({ themeId: 'dark' });

      const saved = JSON.parse(await fsPromises.readFile(settingsFilePath, 'utf8'));
      expect(saved.themeId).toBe('dark');
      expect(saved.desktopSshInstances).toEqual([{ id: 'ssh-1773445565164-e132cb04b5e51', nickname: 'SUIS-QP-TX-CLOUD' }]);
    } finally {
      await cleanup();
    }
  });

  it('degrades migrated reads to defaults without rewriting an unreadable settings file', async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime();
    try {
      await fsPromises.writeFile(settingsFilePath, '{corrupted');
      const settings = await runtime.readSettingsFromDiskMigrated();
      // Migrations ran against the lenient {} read: defaults are present.
      expect(settings.lightThemeId).toBe('flexoki-light');
      expect(settings.darkThemeId).toBe('flexoki-dark');
      expect(await fsPromises.readFile(settingsFilePath, 'utf8')).toBe('{corrupted');
    } finally {
      await cleanup();
    }
  });

  it('warns at most once per corruption span and resets after repair', async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await fsPromises.writeFile(settingsFilePath, '{corrupted');
      // Repeated reads over the corrupt file must not flood the log.
      await runtime.readSettingsFromDisk();
      await runtime.readSettingsFromDisk();
      await runtime.readSettingsFromDiskMigrated();
      const unreadableWarns = warnSpy.mock.calls.filter((call) => String(call[0]).includes('not a JSON object') || String(call[0]).includes('Failed to read settings file'));
      expect(unreadableWarns).toHaveLength(1);
      // The refused migration write warns once as well.
      const skippedWarns = warnSpy.mock.calls.filter((call) => String(call[0]).includes('Skipped settings migration write'));
      expect(skippedWarns).toHaveLength(1);

      // After repair, the warn gate resets: a fresh corruption warns again.
      await fsPromises.writeFile(settingsFilePath, JSON.stringify({ themeId: 'light' }, null, 2));
      await runtime.readSettingsFromDisk();
      await fsPromises.writeFile(settingsFilePath, '{corrupted-again');
      await runtime.readSettingsFromDisk();
      expect(warnSpy.mock.calls.filter((call) => String(call[0]).includes('not a JSON object') || String(call[0]).includes('Failed to read settings file'))).toHaveLength(2);
    } finally {
      warnSpy.mockRestore();
      await cleanup();
    }
  });

  it('keeps a .prev copy of the previous settings generation on write', async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime();
    try {
      await fsPromises.writeFile(settingsFilePath, JSON.stringify({ themeId: 'light' }, null, 2));
      await runtime.writeSettingsToDisk({ themeId: 'dark' });
      const prev = JSON.parse(await fsPromises.readFile(`${settingsFilePath}.prev`, 'utf8'));
      expect(prev.themeId).toBe('light');
    } finally {
      await cleanup();
    }
  });

  it('still completes the write when the best-effort .prev copy fails', async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime();
    try {
      await fsPromises.writeFile(settingsFilePath, JSON.stringify({ themeId: 'light' }, null, 2));
      // A directory at the .prev path makes copyFile fail with EISDIR.
      await fsPromises.mkdir(`${settingsFilePath}.prev`);
      await runtime.writeSettingsToDisk({ themeId: 'dark' });
      const saved = JSON.parse(await fsPromises.readFile(settingsFilePath, 'utf8'));
      expect(saved.themeId).toBe('dark');
    } finally {
      await cleanup();
    }
  });
});
