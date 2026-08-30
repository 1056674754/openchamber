import {
  defaultSettingsLockPath,
  withSettingsLock,
} from '@openchamber/shared/settings-lock';

const isSettingsObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const createSettingsAccessors = ({
  fsPromises,
  path,
  dataDir,
  settingsFileName = 'settings.json',
  platform = process.platform,
  lock = withSettingsLock,
}) => {
  const settingsPath = path.join(dataDir, settingsFileName);
  const lockPath = defaultSettingsLockPath(settingsPath);

  const corruptSettingsError = (cause) =>
    new Error(`Settings file is corrupt or unreadable: ${settingsPath} (fix or remove it, then retry)`, { cause });

  const readSettingsStrict = async () => {
    let raw;
    try {
      raw = await fsPromises.readFile(settingsPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return {};
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw corruptSettingsError(error);
    }
    if (!isSettingsObject(parsed)) {
      throw corruptSettingsError(new Error('non-object payload'));
    }
    return parsed;
  };

  const readSettingsFromDiskMigrated = async () => {
    try {
      return await readSettingsStrict();
    } catch {
      return {};
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isTransientWindowsReplaceError = (error) => (
    platform === 'win32'
    && (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'EBUSY')
  );

  const replaceFile = async (temporaryPath) => {
    const maxAttempts = platform === 'win32' ? 6 : 1;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await fsPromises.rename(temporaryPath, settingsPath);
        return;
      } catch (error) {
        lastError = error;
        if (!isTransientWindowsReplaceError(error) || attempt === maxAttempts) break;
        await sleep(25 * attempt);
      }
    }

    if (!isTransientWindowsReplaceError(lastError)) throw lastError;
    await fsPromises.copyFile(temporaryPath, settingsPath);
    await fsPromises.rm(temporaryPath, { force: true });
  };

  const writeSettingsUnlocked = async (settings) => {
    if (!isSettingsObject(settings)) {
      throw new TypeError('Settings payload must be an object');
    }
    await fsPromises.mkdir(path.dirname(settingsPath), { recursive: true });
    const temporaryPath = `${settingsPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await fsPromises.writeFile(temporaryPath, JSON.stringify(settings, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      if (platform !== 'win32') await fsPromises.chmod(temporaryPath, 0o600);
      await replaceFile(temporaryPath);
      if (platform !== 'win32') await fsPromises.chmod(settingsPath, 0o600);
    } catch (error) {
      await fsPromises.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  const writeSettingsToDisk = async (settings) => (
    lock(lockPath, () => writeSettingsUnlocked(settings))
  );

  const withSettingsTransaction = async (operation) => (
    lock(lockPath, () => operation({
      readSettingsFromDiskMigrated,
      readSettingsStrict,
      writeSettingsToDisk: writeSettingsUnlocked,
    }))
  );

  return {
    settingsPath,
    lockPath,
    readSettingsFromDiskMigrated,
    readSettingsStrict,
    writeSettingsToDisk,
    withSettingsTransaction,
  };
};
