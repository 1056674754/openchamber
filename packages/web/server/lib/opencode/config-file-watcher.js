import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';

const CONFIG_FILE_NAMES = new Set(['config.json', 'opencode.json', 'opencode.jsonc']);

const unique = (values) => [...new Set(values.filter(Boolean))];

export const createOpenCodeConfigFileWatcherRuntime = (dependencies = {}) => {
  const {
    fsModule = fs,
    osModule = os,
    pathModule = path,
    getWorkingDirectory = () => process.cwd(),
    getActiveSessionCount = () => 0,
    isOpenCodeIdle = async () => getActiveSessionCount() === 0,
    isManagedOpenCode = () => true,
    refreshOpenCodeAfterConfigChange,
    logger = console,
    debounceMs = 500,
    idlePollIntervalMs = 1000,
  } = dependencies;

  const watchers = new Map();
  let debounceTimer = null;
  let idleTimer = null;
  let started = false;
  let disposed = false;
  let reloadPromise = null;
  let rerunRequested = false;
  let waitingForIdle = false;
  let appliedFingerprint = '';

  const getConfigPaths = () => {
    const configDir = pathModule.join(osModule.homedir(), '.config', 'opencode');
    const workingDirectory = getWorkingDirectory();
    return unique([
      pathModule.join(configDir, 'config.json'),
      pathModule.join(configDir, 'opencode.json'),
      pathModule.join(configDir, 'opencode.jsonc'),
      workingDirectory && pathModule.join(workingDirectory, 'opencode.json'),
      workingDirectory && pathModule.join(workingDirectory, 'opencode.jsonc'),
      workingDirectory && pathModule.join(workingDirectory, '.opencode', 'opencode.json'),
      workingDirectory && pathModule.join(workingDirectory, '.opencode', 'opencode.jsonc'),
    ]);
  };

  const readSnapshot = () => {
    const entries = [];
    for (const configPath of getConfigPaths().sort()) {
      try {
        entries.push([configPath, fsModule.readFileSync(configPath, 'utf8')]);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        entries.push([configPath, null]);
      }
    }
    return {
      entries,
      fingerprint: JSON.stringify(entries),
    };
  };

  const validateSnapshot = (snapshot) => {
    for (const [configPath, content] of snapshot.entries) {
      if (content === null || content.trim() === '') continue;
      const errors = [];
      parseJsonc(content, errors, { allowTrailingComma: true });
      if (errors.length > 0) {
        throw new Error(`${configPath} contains invalid JSONC at offset ${errors[0].offset}`);
      }
    }
  };

  const reconcileWatchers = () => {
    const directories = unique(getConfigPaths().map((configPath) => pathModule.dirname(configPath)));
    for (const directory of directories) {
      if (watchers.has(directory) || !fsModule.existsSync(directory)) continue;
      try {
        const watcher = fsModule.watch(directory, (_eventType, filename) => {
          if (disposed || !filename) return;
          const changedName = pathModule.basename(filename.toString());
          if (!CONFIG_FILE_NAMES.has(changedName) && changedName !== '.opencode') return;
          scheduleCheck();
        });
        watchers.set(directory, watcher);
      } catch (error) {
        logger.warn(`[OpenCode Config] Failed to watch ${directory}: ${error?.message || error}`);
      }
    }
  };

  const checkNow = async () => {
    if (!started || disposed || !isManagedOpenCode()) return false;
    if (reloadPromise) {
      rerunRequested = true;
      return reloadPromise;
    }

    reconcileWatchers();
    let snapshot;
    try {
      snapshot = readSnapshot();
      if (snapshot.fingerprint === appliedFingerprint) return false;
      validateSnapshot(snapshot);
    } catch (error) {
      logger.warn(`[OpenCode Config] Ignoring invalid configuration change: ${error?.message || error}`);
      return false;
    }

    if (!(await isOpenCodeIdle())) {
      if (!waitingForIdle) {
        waitingForIdle = true;
        logger.log('[OpenCode Config] Configuration changed; waiting for OpenCode to report all sessions idle');
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimer = null;
        void checkNow();
      }, idlePollIntervalMs);
      return false;
    }

    waitingForIdle = false;
    reloadPromise = (async () => {
      await refreshOpenCodeAfterConfigChange('configuration file change');
      appliedFingerprint = snapshot.fingerprint;
      logger.log('[OpenCode Config] Configuration file change applied');
      return true;
    })();

    try {
      return await reloadPromise;
    } catch (error) {
      logger.error(`[OpenCode Config] Automatic reload failed: ${error?.message || error}`);
      return false;
    } finally {
      reloadPromise = null;
      if (rerunRequested) {
        rerunRequested = false;
        scheduleCheck();
      }
    }
  };

  function scheduleCheck() {
    if (!started || disposed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void checkNow();
    }, debounceMs);
  }

  const acknowledgeCurrentConfig = () => {
    try {
      appliedFingerprint = readSnapshot().fingerprint;
    } catch (error) {
      logger.warn(`[OpenCode Config] Failed to acknowledge current configuration: ${error?.message || error}`);
    }
  };

  const start = () => {
    if (started && !disposed) return true;
    if (!isManagedOpenCode()) {
      logger.log('[OpenCode Config] Automatic reload disabled for external OpenCode');
      return false;
    }
    disposed = false;
    started = true;
    acknowledgeCurrentConfig();
    reconcileWatchers();
    logger.log('[OpenCode Config] Watching OpenCode configuration files');
    return true;
  };

  const stop = () => {
    disposed = true;
    started = false;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (idleTimer) clearTimeout(idleTimer);
    debounceTimer = null;
    idleTimer = null;
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };

  return {
    start,
    stop,
    checkNow,
    acknowledgeCurrentConfig,
  };
};
