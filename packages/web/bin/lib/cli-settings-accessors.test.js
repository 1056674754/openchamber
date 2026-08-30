import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSettingsAccessors } from './cli-settings-accessors.js';

const tempDirectories = [];

const createAccessors = async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-cli-settings-'));
  tempDirectories.push(dataDir);
  return createSettingsAccessors({ fsPromises: fs, path, dataDir });
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('CLI settings accessors', () => {
  test('treats only a missing file as empty settings', async () => {
    const accessors = await createAccessors();
    await expect(accessors.readSettingsStrict()).resolves.toEqual({});

    await fs.writeFile(accessors.settingsPath, '{broken', 'utf8');
    await expect(accessors.readSettingsStrict()).rejects.toThrow('Settings file is corrupt or unreadable');
    await fs.writeFile(accessors.settingsPath, '[]', 'utf8');
    await expect(accessors.readSettingsStrict()).rejects.toThrow('Settings file is corrupt or unreadable');
  });

  test('writes atomically with private permissions and no orphan temp', async () => {
    const accessors = await createAccessors();
    await accessors.writeSettingsToDisk({ existing: true });

    expect(JSON.parse(await fs.readFile(accessors.settingsPath, 'utf8'))).toEqual({ existing: true });
    expect((await fs.stat(accessors.settingsPath)).mode & 0o777).toBe(0o600);
    expect((await fs.readdir(path.dirname(accessors.settingsPath))).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  test('serializes whole read-modify-write transactions across concurrent callers', async () => {
    const accessors = await createAccessors();
    await accessors.writeSettingsToDisk({ count: 0 });

    await Promise.all(Array.from({ length: 8 }, (_, index) => (
      accessors.withSettingsTransaction(async (transaction) => {
        const current = await transaction.readSettingsStrict();
        await new Promise((resolve) => setTimeout(resolve, index % 2));
        await transaction.writeSettingsToDisk({ ...current, count: current.count + 1 });
      })
    )));

    await expect(accessors.readSettingsStrict()).resolves.toMatchObject({ count: 8 });
  });

  test('does not enter a transaction when the shared lock cannot be acquired', async () => {
    const entered = [];
    const accessors = createSettingsAccessors({
      fsPromises: fs,
      path,
      dataDir: os.tmpdir(),
      lock: async () => {
        const error = new Error('busy');
        error.code = 'SETTINGS_LOCK_TIMEOUT';
        throw error;
      },
    });

    await expect(accessors.withSettingsTransaction(async () => entered.push(true))).rejects.toMatchObject({
      code: 'SETTINGS_LOCK_TIMEOUT',
    });
    expect(entered).toEqual([]);
  });
});
