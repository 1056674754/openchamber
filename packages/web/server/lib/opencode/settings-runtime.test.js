import { describe, expect, it, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { createProjectIdFromPath } from '../projects/project-id.js';
import { createSettingsRuntime } from './settings-runtime.js';

const createRuntime = async ({ mergePersistedSettings = (current, changes) => ({ ...current, ...changes }) } = {}) => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-settings-runtime-'));
  const settingsFilePath = path.join(tempRoot, 'settings.json');
  const runtime = createSettingsRuntime({
    fsPromises,
    path,
    crypto,
    SETTINGS_FILE_PATH: settingsFilePath,
    sanitizeProjects: (projects) => Array.isArray(projects) ? projects : [],
    sanitizeSettingsUpdate: (settings) => settings,
    mergePersistedSettings,
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

describe('settings runtime: preferences.json split', () => {
  const readJson = async (filePath) => JSON.parse(await fsPromises.readFile(filePath, 'utf8'));

  it('seeds preferences.json from the profile keys of an existing settings.json and leaves that file intact', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      const legacy = { projects: [], fontSize: 110, themeId: 'openchamber-dark', desktopLanAccessEnabled: true };
      await fsPromises.writeFile(settingsFilePath, JSON.stringify(legacy));

      const merged = await runtime.readSettingsFromDisk();
      expect(merged).toMatchObject(legacy);

      const preferences = await readJson(path.join(tempRoot, 'preferences.json'));
      expect(preferences.version).toBe(1);
      expect(Object.keys(preferences.fields).sort()).toEqual(['fontSize', 'themeId']);
      expect(preferences.fields.fontSize.value).toBe(110);
      expect(typeof preferences.fields.fontSize.updatedAt).toBe('number');
      expect(await readJson(settingsFilePath)).toEqual(legacy);
    } finally {
      await cleanup();
    }
  });

  it('routes profile keys to preferences.json, keeps a legacy copy of them in settings.json, and keeps fork device keys in settings.json', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      await runtime.persistSettings({ fontSize: 120, desktopLanAccessEnabled: true, mobileKeyboardMode: 'native' });

      const settings = await readJson(settingsFilePath);
      expect(settings.desktopLanAccessEnabled).toBe(true);
      // Older builds read only settings.json: the profile's base values stay there as a copy.
      expect(settings.fontSize).toBe(120);
      // Fork: device keys this fork still round-trips keep living in settings.json.
      expect(settings.mobileKeyboardMode).toBe('native');

      const preferences = await readJson(path.join(tempRoot, 'preferences.json'));
      expect(preferences.fields.fontSize.value).toBe(120);
      expect(preferences.fields).not.toHaveProperty('mobileKeyboardMode');
      expect(preferences.fields).not.toHaveProperty('desktopLanAccessEnabled');

      expect(await runtime.readSettingsFromDisk()).toMatchObject({ fontSize: 120, desktopLanAccessEnabled: true });
    } finally {
      await cleanup();
    }
  });

  it('keeps the timestamp of an unchanged profile key and restamps a changed one', async () => {
    const { runtime, tempRoot, cleanup } = await createRuntime();
    try {
      const preferencesPath = path.join(tempRoot, 'preferences.json');
      await runtime.persistSettings({ fontSize: 100, padding: 100 });
      const first = await readJson(preferencesPath);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await runtime.persistSettings({ fontSize: 100, padding: 120 });
      const second = await readJson(preferencesPath);

      expect(second.fields.fontSize.updatedAt).toBe(first.fields.fontSize.updatedAt);
      expect(second.fields.padding.updatedAt).toBeGreaterThan(first.fields.padding.updatedAt);
      expect(second.fields.padding.value).toBe(120);
    } finally {
      await cleanup();
    }
  });

  it('treats an unreadable preferences.json as failure: no seed, no overwrite, profile writes refused, instance still served', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      const preferencesPath = path.join(tempRoot, 'preferences.json');
      await fsPromises.writeFile(settingsFilePath, JSON.stringify({ desktopLanAccessEnabled: true }));
      await fsPromises.writeFile(preferencesPath, '{ not json');

      expect(await runtime.readSettingsFromDisk()).toEqual({ desktopLanAccessEnabled: true });

      await runtime.persistSettings({ fontSize: 130, desktopKeepAwakeEnabled: true });

      expect(await fsPromises.readFile(preferencesPath, 'utf8')).toBe('{ not json');
      const settings = await readJson(settingsFilePath);
      expect(settings.desktopKeepAwakeEnabled).toBe(true);
      // The refused profile write must not land in the legacy copy either.
      expect(settings).not.toHaveProperty('fontSize');
    } finally {
      await cleanup();
    }
  });
});

describe('settings runtime: per-surface profile keys', () => {
  const readJson = async (filePath) => JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
  // These sequences persist several times; the replace stub makes each write
  // carry only the latest changes, the real merge keeps the current document.
  const createReplacingRuntime = () => createRuntime({ mergePersistedSettings: (_current, changes) => changes });

  it('stores a per-surface key under the writing surface and leaves the base alone', async () => {
    const { runtime, tempRoot, cleanup } = await createReplacingRuntime();
    try {
      await runtime.persistSettings({ fontSize: 100 }); // base (no surface): migrations and legacy callers
      await runtime.persistSettings({ fontSize: 130, showReasoningTraces: false }, { surface: 'mobile' });

      const stored = await readJson(path.join(tempRoot, 'preferences.json'));
      expect(stored.fields.fontSize.value).toBe(100);
      expect(stored.fields.fontSize.surfaces.mobile.value).toBe(130);
      expect(stored.fields.showReasoningTraces.value).toBe(false);

      // A mobile read resolves the mobile value first.
      await expect(runtime.readSettingsFromDisk({ surface: 'mobile' })).resolves.toMatchObject({ fontSize: 130 });
      await expect(runtime.readSettingsFromDisk()).resolves.toMatchObject({ fontSize: 100, showReasoningTraces: false });
    } finally {
      await cleanup();
    }
  });
});
