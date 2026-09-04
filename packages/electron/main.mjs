import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, powerMonitor, powerSaveBlocker, session, shell, webContents } from 'electron';
import contextMenu from 'electron-context-menu';
import log from 'electron-log/main.js';
import dgram from 'node:dgram';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import updaterPkg from 'electron-updater';
import { ElectronSshManager } from './ssh-manager.mjs';
import { replaceFileWithRetry } from './windows-file-replace.mjs';
import { hasSameHttpOrigin, loginRemotePasswordAndPersistSession } from './remote-password-login.mjs';
import {
  resolveDefaultHostBootStatus,
  shouldRetryDefaultHostProbe,
  shouldUseLocalSubstrateForDefaultHost,
} from './relay-default-boot.mjs';
import { createSingleFlight } from './startup-coordinator.mjs';
import { createTrayController } from './tray.mjs';
import {
  buildLinuxInstalledApps,
  buildLinuxOpenSpecs,
  fetchLinuxAppIcons,
  filterLinuxInstalledApps,
  readLinuxDesktopEntries,
} from './linux-app-discovery.mjs';
import { readLinuxAutostartEnabled, setLinuxAutostartEnabled } from './linux-autostart.mjs';
import { assertUpdaterCapability } from './updater-capability.mjs';
import { checkForDesktopUpdate } from './updater-check.mjs';
import { resolveUpdaterFeed } from './updater-feed.mjs';
import { resolveUpdaterChannel } from './updater-channel.mjs';
import { shouldAllowBrowserPanelCertificateError } from './browser-panel-security.mjs';
import { resolveDesktopDevTunnelAuthority } from './dev-tunnel-authority.mjs';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = process.env.OPENCHAMBER_ELECTRON_DEV === '1' || !app.isPackaged;
const externalRuntimeRoot = !isDev && process.env.OPENCHAMBER_RUNTIME_SOURCE === 'external'
  ? process.env.OPENCHAMBER_RUNTIME_ROOT?.trim() || null
  : null;

const readExternalRuntimeManifest = () => {
  if (!externalRuntimeRoot) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(externalRuntimeRoot, 'runtime-manifest.json'), 'utf8'));
  } catch (error) {
    throw new Error(
      `Failed to read external runtime manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const externalRuntimeManifest = readExternalRuntimeManifest();

const DEEP_LINK_PROTOCOL = 'openchamber';
const APP_USER_MODEL_ID = 'dev.openchamber.desktop';
const BACKGROUND_START_ARG = '--background';
const BROWSER_PANEL_PARTITION = 'persist:openchamber-browser';

let browserPanelSessionHardened = false;
const hardenBrowserPanelSession = () => {
  if (browserPanelSessionHardened) return;
  browserPanelSessionHardened = true;
  const panelSession = session.fromPartition(BROWSER_PANEL_PARTITION);

  app.on('certificate-error', (event, contents, url, error, _certificate, callback) => {
    if (contents.session === panelSession && shouldAllowBrowserPanelCertificateError({ url, error })) {
      event.preventDefault();
      callback(true);
      return;
    }
    callback(false);
  });
};

const getLoginItemOptions = () => {
  if (process.platform === 'win32') {
    return {
      path: process.execPath,
      args: [BACKGROUND_START_ARG],
      name: APP_USER_MODEL_ID,
    };
  }
  return {};
};

const readLoginItemSettings = () => {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return null;
  try {
    return app.getLoginItemSettings(getLoginItemOptions());
  } catch {
    return null;
  }
};

const shouldStartInBackground = (loginItemSettings = readLoginItemSettings()) => {
  return (
    process.argv.includes(BACKGROUND_START_ARG) ||
    loginItemSettings?.wasOpenedAtLogin === true ||
    loginItemSettings?.wasOpenedAsHidden === true
  );
};

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
  process.exit(0);
}

// Set the product name early so electron-log derives its log directory as
// ~/Library/Logs/OpenChamber/ (not ~/Library/Logs/@openchamber/electron/).
app.setName('OpenChamber');
if (isDev) {
  app.setPath('userData', path.join(app.getPath('appData'), 'OpenChamber Dev'));
}
app.setAppUserModelId(APP_USER_MODEL_ID);
app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>');
app.commandLine.appendSwitch('ignore-connections-limit', '127.0.0.1,localhost');
// Workaround for upstream Electron 41 + macOS 26.5 V8/Oilpan GC crash
// (fontations_ffi / rust_png / cppgc::CollectGarbageInYoungGenerationForTesting
// + brk 0). Disabling the Rust fontations backend avoids a font-rasterisation
// path into the unstable GC code. See electron/electron#49522 and related
// upstream issues. This is a partial mitigation; the full fix requires Electron
// 42.4.1+, which needs a new notarised shell.
app.commandLine.appendSwitch('disable-features', 'FontationsFontBackend');

try {
  process.chdir(os.homedir());
} catch {
}

log.initialize();
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.level = 'info';
log.transports.console.level = isDev ? 'debug' : 'warn';

// The in-process web server runs in this same Node process and uses plain
// `console.log/warn/error`. Without piping console through electron-log,
// that output never lands in ~/Library/Logs/OpenChamber/main.log and we
// can't diagnose issues (e.g. OpenCode lifecycle, SSE disconnects) after
// the fact. Route all console calls through electron-log so server-side
// diagnostics are persisted.
Object.assign(console, log.functions);

const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
try {
  const logPath = log.transports.file.getFile().path;
  const logDir = path.dirname(logPath);
  const cutoff = Date.now() - LOG_MAX_AGE_MS;
  for (const entry of fs.readdirSync(logDir)) {
    const candidate = path.join(logDir, entry);
    try {
      const info = fs.statSync(candidate);
      if (info.isFile() && info.mtimeMs < cutoff) {
        fs.unlinkSync(candidate);
      }
    } catch {
    }
  }
} catch {
}

try {
  if (!app.isDefaultProtocolClient(DEEP_LINK_PROTOCOL)) {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  }
} catch (error) {
  // log.* not yet initialized at this point; fall back to console.
  console.warn('[electron] failed to register deep-link protocol:', error);
}

const readAppMetadata = () => {
  const candidates = [
    path.join(__dirname, 'package.json'),
    path.join(__dirname, '..', 'package.json'),
    path.join(app.getAppPath?.() || '', 'package.json'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.name === '@openchamber/electron' && typeof parsed.version === 'string') {
        return { name: parsed.name, version: parsed.version };
      }
    } catch {
    }
  }
  return { name: '@openchamber/electron', version: app.getVersion() };
};

const APP_METADATA = readAppMetadata();
const APP_VERSION = APP_METADATA.version;
const EMBEDDED_UPDATER_FEED_URL = process.env.OPENCHAMBER_UPDATER_FEED_URL || '';
const UPDATER_E2E_BUILD = process.env.OPENCHAMBER_UPDATER_E2E_BUILD === '1';

const clearDesktopWebCacheStorage = async () => {
  try {
    await session.defaultSession.clearStorageData({
      storages: ['serviceworkers', 'cachestorage'],
    });
    log.info('[electron] cleared desktop web service worker cache storage');
  } catch (error) {
    log.warn('[electron] failed to clear desktop web service worker cache storage:', error);
  }
};

const DEFAULT_DESKTOP_PORT = 57123;
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 520;
const MIN_RESTORE_WINDOW_WIDTH = 900;
const MIN_RESTORE_WINDOW_HEIGHT = 560;
const MINI_CHAT_WINDOW_WIDTH = 520;
const MINI_CHAT_WINDOW_HEIGHT = 760;
const MINI_CHAT_MIN_WINDOW_WIDTH = 360;
const MINI_CHAT_MIN_WINDOW_HEIGHT = 480;
const MAX_CAPTURE_PAGE_RECT_AREA = 4_000_000;
const LOCAL_HOST_ID = 'local';
const ENV_OVERRIDE_HOST_ID = '__env';
const CHANGELOG_URL = 'https://raw.githubusercontent.com/openchamber/openchamber/main/CHANGELOG.md';
const GITHUB_BUG_REPORT_URL = 'https://github.com/openchamber/openchamber/issues/new?template=bug_report.yml';
const GITHUB_FEATURE_REQUEST_URL = 'https://github.com/openchamber/openchamber/issues/new?template=feature_request.yml';
const DISCORD_INVITE_URL = 'https://discord.gg/ZYRSdnwwKA';
const INSTALLED_APPS_CACHE_TTL_SECS = 60 * 60 * 24;
const INSTALLED_APPS_CACHE_FILE = 'discovered-apps.json';
const LINUX_DESKTOP_ENTRIES_CACHE_TTL_MS = 30_000;

const { autoUpdater } = updaterPkg;

const state = {
  serverHandle: null,
  sidecarUrl: null,
  localOrigin: null,
  bootOutcome: null,
  initScript: null,
  mainWindow: null,
  quitRequested: false,
  quitConfirmed: false,
  quitConfirmationPending: false,
  stopManagedOpenCodeOnQuit: false,
  installingUpdate: false,
  pendingUpdate: null,
  updaterConfigured: false,
  unreachableHosts: new Set(),
  windowCounter: 1,
  focusedWindowIds: new Set(),
  windowGeometryRevisions: new Map(),
  miniChatWindowsBySession: new Map(),
  sshStatuses: new Map(),
  sshLogs: new Map(),
  keepAwakeBlockerId: null,
  trayController: null,
  trayFocusListener: null,
  lastFocusedWindowId: null,
};

const setDesktopKeepAwakeActive = (enabled) => {
  const currentId = state.keepAwakeBlockerId;
  const isActive = Number.isInteger(currentId) && powerSaveBlocker.isStarted(currentId);

  if (enabled) {
    if (!isActive) {
      state.keepAwakeBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
    return Number.isInteger(state.keepAwakeBlockerId) && powerSaveBlocker.isStarted(state.keepAwakeBlockerId);
  }

  if (isActive) {
    powerSaveBlocker.stop(currentId);
  }
  state.keepAwakeBlockerId = null;
  return false;
};

const readDesktopKeepAwakeStatus = () => {
  const enabled = readSettingsRoot().desktopKeepAwakeEnabled === true;
  const currentId = state.keepAwakeBlockerId;
  const active = Number.isInteger(currentId) && powerSaveBlocker.isStarted(currentId);
  return { supported: true, enabled, active };
};

const quitRisk = {
  hasActiveTunnel: false,
  hasRunningScheduledTasks: false,
  hasEnabledScheduledTasks: false,
  runningScheduledTasksCount: 0,
  enabledScheduledTasksCount: 0,
};

const shouldKeepManagedOpenCodeAliveByDefault = () => {
  const settings = readSettingsRoot();
  // When managed OpenCode is not started this session, do not keep it "alive" on quit.
  if (shouldSkipManagedOpenCodeStart(settings)) return false;
  return settings.desktopKeepManagedOpenCodeAliveOnQuit !== false;
};

/**
 * Explicit remote-only product policy: local OpenCode is unavailable by design.
 * Chooser/recovery must not offer broken "fix local OpenCode" actions.
 */
const isDesktopRemoteOnlyPolicy = (settings = readSettingsRoot()) => {
  const envRemoteOnly = process.env.OPENCHAMBER_REMOTE_ONLY === '1'
    || process.env.OPENCHAMBER_REMOTE_ONLY === 'true';
  const envSkipOpenCode = process.env.OPENCODE_SKIP_START === 'true'
    || process.env.OPENCHAMBER_SKIP_OPENCODE_START === 'true'
    || process.env.OPENCHAMBER_SKIP_OPENCODE_START === '1';
  if (envRemoteOnly || envSkipOpenCode) return true;
  return settings?.desktopRemoteOnly === true;
};

/**
 * Whether Electron should skip managed OpenCode attach/start.
 * Broader than remote-only policy: also skips when the default desktop host is remote
 * (local UI/proxy still boots; user may later switch default to local and restart).
 */
const shouldSkipManagedOpenCodeStart = (settings = readSettingsRoot()) => {
  if (isDesktopRemoteOnlyPolicy(settings)) return true;
  try {
    const config = readDesktopHostsConfig();
    const defaultId = config?.defaultHostId || '';
    if (defaultId && defaultId !== LOCAL_HOST_ID) return true;
  } catch {
  }
  return false;
};

const quitConfirmationMessage = () => {
  const reasons = [];
  if (quitRisk.hasActiveTunnel) {
    reasons.push('an active tunnel');
  }
  if (quitRisk.runningScheduledTasksCount > 0) {
    reasons.push(`${quitRisk.runningScheduledTasksCount} running scheduled task${quitRisk.runningScheduledTasksCount === 1 ? '' : 's'}`);
  }
  if (quitRisk.enabledScheduledTasksCount > 0) {
    reasons.push(`${quitRisk.enabledScheduledTasksCount} enabled scheduled task${quitRisk.enabledScheduledTasksCount === 1 ? '' : 's'}`);
  }
  if (reasons.length === 0) {
    return 'Background processes (sidecar, SSH sessions) will be stopped.';
  }
  return `OpenChamber detected ${reasons.join(', ')}. Quitting now will stop sidecar/background processes and may interrupt pending work.`;
};

const prepareForQuit = async ({ installingUpdate = false, stopManagedOpenCode } = {}) => {
  state.quitRequested = true;
  state.quitConfirmed = true;
  state.stopManagedOpenCodeOnQuit = typeof stopManagedOpenCode === 'boolean'
    ? stopManagedOpenCode
    : !shouldKeepManagedOpenCodeAliveByDefault();
  state.installingUpdate = installingUpdate;
  state.quitConfirmationPending = false;
  setDesktopKeepAwakeActive(false);

  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    try {
      debounceWindowStatePersist(state.mainWindow, true);
    } catch {
    }
  }

  if (!installingUpdate) {
    try {
      await killSidecar({ stopOpenCode: state.stopManagedOpenCodeOnQuit });
    } catch {
    }
    void sshManager.shutdownAll().catch(() => {});
  }
};

const performConfirmedQuit = async ({ stopManagedOpenCode } = {}) => {
  if (state.quitConfirmed) return;

  // Hide all windows immediately so the user sees instant feedback after
  // confirming quit — the async shutdown below can take several seconds
  // (OpenCode SIGTERM/SIGKILL, port release, HTTP server drain).
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.hide();
    }
  }

  await prepareForQuit({ stopManagedOpenCode });

  // Safety net: force-exit if normal quit sequence stalls (e.g. background
  // handles in electron-updater / fetch refs) after a short grace period.
  const safety = setTimeout(() => {
    app.exit(0);
  }, 1500);
  if (typeof safety?.unref === 'function') safety.unref();

  app.quit();
};

const requestQuitWithConfirmation = async () => {
  await refreshQuitRiskFlags();

  if (state.quitConfirmationPending) {
    return;
  }
  state.quitConfirmationPending = true;

  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  const visible = windows.find((window) => window.isVisible());
  if (!visible) {
    const hidden = windows.find((window) => !window.isVisible());
    if (hidden) {
      hidden.show();
      hidden.focus();
    }
  }

  try {
    const keepManagedOpenCode = shouldKeepManagedOpenCodeAliveByDefault();
    const buttons = keepManagedOpenCode
      ? ['Quit, Keep OpenCode Running', 'Quit and Stop OpenCode', 'Cancel']
      : ['Quit and Stop OpenCode', 'Quit, Keep OpenCode Running', 'Cancel'];
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'Quit OpenChamber?',
      message: 'Quit OpenChamber?',
      detail: `${quitConfirmationMessage()}\n\nOpenCode can keep running in the background so OpenChamber can reuse the same server after restart.`,
      buttons,
      defaultId: 0,
      cancelId: 2,
    });
    state.quitConfirmationPending = false;
    if (result.response === 2) {
      return;
    }
    const stopManagedOpenCode = keepManagedOpenCode
      ? result.response === 1
      : result.response === 0;
    if (result.response === 0 || result.response === 1) {
      void performConfirmedQuit({ stopManagedOpenCode });
    }
  } catch (error) {
    state.quitConfirmationPending = false;
    log.warn('[electron] quit confirmation dialog failed:', error);
  }
};

const refreshQuitRiskFlags = async () => {
  if (state.serverHandle && typeof state.serverHandle.getQuitRiskStatus === 'function') {
    try {
      const status = await state.serverHandle.getQuitRiskStatus();
      const scheduled = status?.scheduledTasks;
      if (scheduled && typeof scheduled === 'object') {
        const enabledCount = Number(scheduled.enabledScheduledTasksCount ?? 0);
        const runningCount = Number(scheduled.runningScheduledTasksCount ?? 0);
        quitRisk.enabledScheduledTasksCount = Number.isFinite(enabledCount) ? enabledCount : 0;
        quitRisk.runningScheduledTasksCount = Number.isFinite(runningCount) ? runningCount : 0;
        quitRisk.hasEnabledScheduledTasks = Boolean(scheduled.hasEnabledScheduledTasks) || quitRisk.enabledScheduledTasksCount > 0;
        quitRisk.hasRunningScheduledTasks = Boolean(scheduled.hasRunningScheduledTasks) || quitRisk.runningScheduledTasksCount > 0;
      }
      quitRisk.hasActiveTunnel = Boolean(status?.tunnel?.active);
      return;
    } catch {
    }
  }

  const base = typeof state.sidecarUrl === 'string' ? state.sidecarUrl.trim().replace(/\/$/, '') : '';
  if (!base) return;

  const scheduledUrl = `${base}/api/openchamber/scheduled-tasks/status`;
  const tunnelUrl = `${base}/api/openchamber/tunnel/status`;

  const fetchJson = async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  };

  const [scheduled, tunnel] = await Promise.all([fetchJson(scheduledUrl), fetchJson(tunnelUrl)]);

  if (scheduled && typeof scheduled === 'object') {
    const enabledCount = Number(scheduled.enabledScheduledTasksCount ?? 0);
    const runningCount = Number(scheduled.runningScheduledTasksCount ?? 0);
    quitRisk.enabledScheduledTasksCount = Number.isFinite(enabledCount) ? enabledCount : 0;
    quitRisk.runningScheduledTasksCount = Number.isFinite(runningCount) ? runningCount : 0;
    quitRisk.hasEnabledScheduledTasks = Boolean(scheduled.hasEnabledScheduledTasks) || quitRisk.enabledScheduledTasksCount > 0;
    quitRisk.hasRunningScheduledTasks = Boolean(scheduled.hasRunningScheduledTasks) || quitRisk.runningScheduledTasksCount > 0;
  }

  if (tunnel && typeof tunnel === 'object') {
    quitRisk.hasActiveTunnel = Boolean(tunnel.active);
  }
};

const settingsFilePath = () => {
  if (typeof process.env.OPENCHAMBER_DATA_DIR === 'string' && process.env.OPENCHAMBER_DATA_DIR.trim()) {
    return path.join(process.env.OPENCHAMBER_DATA_DIR.trim(), 'settings.json');
  }
  return path.join(os.homedir(), '.config', 'openchamber', 'settings.json');
};

const sshManager = new ElectronSshManager({
  settingsFilePath: settingsFilePath(),
  appVersion: APP_VERSION,
  // Thunk: withSettingsLock is defined later in this module.
  settingsWriter: (fn) => withSettingsLock(fn),
  emit: (event, detail) => emitToAllWindows(event, detail),
  onStatusChanged: async (status) => {
    const remoteRuntime = state.serverHandle?.remoteInstances;
    if (!remoteRuntime || !status?.id) return;

    if (status.phase === 'ready' && status.localUrl) {
      await remoteRuntime.refreshCache();
      const instance = await remoteRuntime.getInstance(status.id);
      if (instance) {
        await remoteRuntime.probeHealth(instance);
      }
      return;
    }

    remoteRuntime.setHealthStatus(status.id, {
      healthy: false,
      latencyMs: 0,
      error: status.detail || `SSH status: ${status.phase}`,
    });
  },
});

const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    // Parse errors can happen if a concurrent writer just truncated the file
    // and hasn't finished writing yet. Log loudly so we notice, then return
    // {} as before. Writes are atomic (tmp + rename) so this race is rare.
    log.warn?.('[electron] failed to read JSON file', filePath, error);
    return {};
  }
};

const writeJsonFile = async (filePath, data) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  // Atomic: write to a temp file then rename. Readers never see a partial
  // JSON file that could parse-error and get coerced to {}.
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
    // Keep one previous generation as a local recovery point (best-effort).
    await copyPreviousGeneration(filePath);
    await replaceFileWithRetry(tmp, filePath);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
};

const readSettingsRoot = () => {
  const root = readJsonFile(settingsFilePath());
  return root && typeof root === 'object' && !Array.isArray(root) ? root : {};
};

// Serializes read-modify-write of the settings file within this process.
// Multiple call sites (spawnLocalServer, writeDesktopHostsConfig, theme
// preference saves, ssh manager imports, etc.) would otherwise have their
// RMW pairs interleave across awaits, letting one writer's stale copy
// overwrite another writer's just-persisted changes.
//
// The lock is shared with the embedded web server's `persistSettings` via
// the `settingsWriter` callback passed to `startWebUiServer`. Without a
// shared lock, the web server's read-merge-write and Electron's
// read-modify-write can interleave and silently drop keys neither side
// knows about (e.g. `desktopSshInstances` written by Electron gets
// overwritten when the web server writes `localStore`).
//
// Outer layer acquires a cross-process file lock so VS Code (separate
// extension host) and standalone server instances can't interleave their
// RMW with ours either.
import { withSettingsLock as withCrossProcessSettingsLock, defaultSettingsLockPath } from '@openchamber/shared/settings-lock';
import { assertJsonFileReadableForWrite, copyPreviousGeneration } from '@openchamber/shared/settings-file';
let sharedSettingsLock = Promise.resolve();
const withSettingsLock = (fn) => {
  const next = sharedSettingsLock.then(() => withCrossProcessSettingsLock(defaultSettingsLockPath(settingsFilePath()), fn));
  sharedSettingsLock = next.catch(() => {});
  return next;
};
const mutateSettingsRoot = (mutator) => {
  return withSettingsLock(async () => {
    // Fail-closed write guard, re-verified at write time: readSettingsRoot()
    // is lenient ({} on corrupt content), so persisting the mutated root
    // without this check would wipe every key absent from the write (the
    // historical desktopSshInstances loss). Reads stay lenient; writers
    // refuse until the file is repaired or removed.
    await assertJsonFileReadableForWrite(settingsFilePath(), 'settings');
    const current = readSettingsRoot();
    const result = await mutator(current);
    const nextRoot = result ?? current;
    await writeJsonFile(settingsFilePath(), nextRoot);
    return nextRoot;
  });
};

const writeSettingsRoot = async (root) => {
  await assertJsonFileReadableForWrite(settingsFilePath(), 'settings');
  await writeJsonFile(settingsFilePath(), root);
};

const normalizeHostUrl = (raw) => {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
};

const sanitizeHostUrlForStorage = (raw) => normalizeHostUrl(raw);

const sanitizeClientTokenForStorage = (raw) => {
  const token = typeof raw === 'string' ? raw.trim() : '';
  return token.length > 0 ? token : null;
};

const isReservedRequestHeaderName = (name) => String(name || '').trim().toLowerCase() === 'authorization';

const sanitizeRuntimeRequestHeaders = (headers) => {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  const next = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = typeof key === 'string' ? key.trim() : '';
    const headerValue = typeof value === 'string' ? value.trim() : '';
    if (!name || !headerValue || /[\r\n:]/.test(name) || /[\r\n]/.test(headerValue)) continue;
    if (isReservedRequestHeaderName(name)) continue;
    next[name] = headerValue;
  }
  return next;
};

const sanitizeHostRelayForStorage = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const relayUrl = typeof value.relayUrl === 'string' ? value.relayUrl.trim() : '';
  const serverId = typeof value.serverId === 'string' ? value.serverId.trim() : '';
  const jwk = value.hostEncPubJwk;
  if (!relayUrl || !serverId || !jwk || typeof jwk !== 'object' || Array.isArray(jwk)) return null;
  if (typeof jwk.kty !== 'string' || typeof jwk.crv !== 'string' || typeof jwk.x !== 'string') return null;
  try {
    const parsed = new URL(relayUrl);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return null;
  } catch {
    return null;
  }
  return { relayUrl, serverId, hostEncPubJwk: jwk };
};

// Host may carry direct HTTP, relay, or both (LAN at home / E2EE away).
const buildStoredHostEntry = (entry) => {
  const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
  if (!id || id === LOCAL_HOST_ID) return null;
  const clientToken = sanitizeClientTokenForStorage(entry?.clientToken);
  const requestHeaders = sanitizeRuntimeRequestHeaders(entry?.requestHeaders);
  const headerFields = Object.keys(requestHeaders).length > 0 ? { requestHeaders } : {};
  const tokenField = clientToken ? { clientToken } : {};
  const labelRaw = typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : '';

  const relay = sanitizeHostRelayForStorage(entry?.relay);
  const relayField = relay ? { relay } : {};
  const directUrl = sanitizeHostUrlForStorage(entry?.url);
  const apiUrl = directUrl ? (sanitizeHostUrlForStorage(entry?.apiUrl) || directUrl) : sanitizeHostUrlForStorage(entry?.apiUrl);

  if (directUrl) {
    return { id, label: labelRaw || directUrl, url: directUrl, apiUrl: apiUrl || directUrl, ...tokenField, ...headerFields, ...relayField };
  }
  if (relay) {
    const url = `relay://${relay.serverId}`;
    return {
      id,
      label: labelRaw || url,
      url,
      ...(apiUrl ? { apiUrl } : {}),
      ...tokenField,
      ...headerFields,
      relay,
    };
  }
  return null;
};

const getOrCreateDesktopInstallId = async () => {
  const existing = readSettingsRoot().desktopInstallId;
  if (typeof existing === 'string' && existing.trim()) return existing.trim();
  const generated = globalThis.crypto.randomUUID();
  // Best-effort persist: if the settings file is unreadable the write is
  // refused; fall back to the generated id for this process lifetime.
  await mutateSettingsRoot((root) => {
    if (typeof root.desktopInstallId === 'string' && root.desktopInstallId.trim()) return root;
    root.desktopInstallId = generated;
    return root;
  }).catch((error) => log.warn?.('[electron] failed to persist desktopInstallId', error));
  const after = readSettingsRoot().desktopInstallId;
  return typeof after === 'string' && after.trim() ? after.trim() : generated;
};

const readDesktopLocalClientToken = () => {
  return sanitizeClientTokenForStorage(readSettingsRoot().desktopLocalClientToken) || '';
};

const readDesktopHostsConfig = () => {
  const root = readSettingsRoot();
  const hostsRaw = Array.isArray(root.desktopHosts) ? root.desktopHosts : [];
  const hosts = hostsRaw
    .map(buildStoredHostEntry)
    .filter(Boolean);

  return {
    hosts,
    defaultHostId: typeof root.desktopDefaultHostId === 'string' && root.desktopDefaultHostId.trim()
      ? root.desktopDefaultHostId.trim()
      : null,
    initialHostChoiceCompleted: root.desktopInitialHostChoiceCompleted === true,
  };
};

const writeDesktopHostsConfig = async (config) => {
  await mutateSettingsRoot((root) => {
    root.desktopHosts = Array.isArray(config?.hosts)
      ? config.hosts
          .map(buildStoredHostEntry)
          .filter(Boolean)
      : [];
    root.desktopDefaultHostId = typeof config?.defaultHostId === 'string' && config.defaultHostId.trim()
      ? config.defaultHostId.trim()
      : null;
    if (typeof config?.initialHostChoiceCompleted === 'boolean') {
      root.desktopInitialHostChoiceCompleted = config.initialHostChoiceCompleted;
    }
    if (Object.prototype.hasOwnProperty.call(config || {}, 'localClientToken')) {
      const localClientToken = sanitizeClientTokenForStorage(config.localClientToken);
      if (localClientToken) {
        root.desktopLocalClientToken = localClientToken;
      } else {
        delete root.desktopLocalClientToken;
      }
    }
  });
};

const readWindowState = () => {
  const stateValue = readSettingsRoot().desktopWindowState;
  return stateValue && typeof stateValue === 'object' ? stateValue : null;
};

let devTunnelClientPromise = null;
const devTunnelTargetByKey = new Map();

const getDevTunnelClient = async () => {
  if (!devTunnelClientPromise) {
    devTunnelClientPromise = import('@openchamber/web/server/lib/dev-tunnel/client.js')
      .then(({ createDevTunnelClient }) => createDevTunnelClient({ logger: log }))
      .catch((error) => {
        devTunnelClientPromise = null;
        throw error;
      });
  }
  return devTunnelClientPromise;
};

const resolveDevTunnelTarget = (serverId) => {
  const id = typeof serverId === 'string' ? serverId.trim() : '';
  return resolveDesktopDevTunnelAuthority({
    serverId: id,
    status: sshManager.statusSnapshotForInstance(id),
    hosts: readDesktopHostsConfig().hosts,
    localHostId: LOCAL_HOST_ID,
  });
};

const closeDevTunnelsForServer = async (serverId) => {
  if (!devTunnelClientPromise) return;
  const client = await getDevTunnelClient();
  for (const [key, target] of [...devTunnelTargetByKey.entries()]) {
    if (target.serverId !== serverId) continue;
    client.close({ baseUrl: target.baseUrl, port: target.port });
    devTunnelTargetByKey.delete(key);
  }
};

const closeAllDevTunnels = () => {
  devTunnelTargetByKey.clear();
  if (!devTunnelClientPromise) return;
  const pending = devTunnelClientPromise;
  devTunnelClientPromise = null;
  pending.then((client) => client.closeAll()).catch(() => {});
};

const writeWindowState = async (browserWindow) => {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  if (!state.mainWindow || browserWindow.id !== state.mainWindow.id) return;

  const bounds = browserWindow.getBounds();
  await mutateSettingsRoot((root) => {
    if (!browserWindow || browserWindow.isDestroyed()) return root;
    root.desktopWindowState = {
      x: bounds.x,
      y: bounds.y,
      width: Math.max(bounds.width, MIN_WINDOW_WIDTH),
      height: Math.max(bounds.height, MIN_WINDOW_HEIGHT),
      maximized: browserWindow.isMaximized(),
      fullscreen: browserWindow.isFullScreen(),
    };
  });
};

const debounceWindowStatePersist = (browserWindow, immediate = false) => {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  const key = String(browserWindow.id);
  const revision = (state.windowGeometryRevisions.get(key) || 0) + 1;
  state.windowGeometryRevisions.set(key, revision);

  const persist = async () => {
    if (state.windowGeometryRevisions.get(key) !== revision) return;
    // Best-effort: a refused write (unreadable settings file) must not turn
    // every window move/resize into an unhandled rejection.
    await writeWindowState(browserWindow).catch((error) => log.warn?.('[electron] failed to persist window state', error));
  };

  if (immediate) {
    void persist();
    return;
  }

  setTimeout(() => {
    void persist();
  }, 300);
};

const buildHealthUrl = (url) => {
  try {
    const parsed = new URL(url);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '') || ''}/health`;
    return parsed.toString();
  } catch {
    return null;
  }
};

const probeHostWithTimeout = async (url, timeoutMs, clientToken = '', requestHeaders = {}, expectedServerId = '') => {
  const healthUrl = buildHealthUrl(url);
  if (!healthUrl) {
    throw new Error('Invalid URL');
  }

  const started = Date.now();

  // Identity gate for learned/untrusted addresses: verify UNAUTHENTICATED
  // /health serverId before sending the bearer token.
  if (typeof expectedServerId === 'string' && expectedServerId.trim()) {
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        const reported = typeof payload?.serverId === 'string' ? payload.serverId.trim() : '';
        if (reported && reported !== expectedServerId.trim()) {
          return { status: 'wrong-service', latencyMs: Date.now() - started };
        }
      }
    } catch {
      // Unreachable/timeout surfaces in the authenticated health fetch below.
    }
  }

  try {
    const headers = { ...sanitizeRuntimeRequestHeaders(requestHeaders), Accept: 'application/json' };
    const token = typeof clientToken === 'string' ? clientToken.trim() : '';
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs), headers });
    const status = response.status;
    return {
      status: status >= 200 && status < 300 ? 'ok' : (status === 401 || status === 403 ? 'auth' : 'unreachable'),
      latencyMs: Date.now() - started,
    };
  } catch {
    return { status: 'unreachable', latencyMs: Date.now() - started };
  }
};

const waitForHealth = async (url, timeoutMs = 20_000, initialPollMs = 250, maxPollMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  let pollMs = initialPollMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(buildHealthUrl(url), { signal: AbortSignal.timeout(Math.min(pollMs * 4, 1500)) });
      if (response.ok) {
        return true;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    pollMs = Math.min(pollMs * 2, maxPollMs);
  }
  return false;
};

const pickUnusedPort = async () => {
  const net = await import('node:net');
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
};

const isPortFree = async (port) => {
  if (!Number.isFinite(port) || port <= 0) return false;
  const net = await import('node:net');
  return await new Promise((resolve) => {
    const test = net.createServer();
    const done = (value) => {
      try { test.close(); } catch {}
      resolve(value);
    };
    test.once('error', () => done(false));
    test.listen(port, '127.0.0.1', () => done(true));
  });
};

// Return the LAN IPv4 of the interface that routes to the public internet.
// UDP "connect" is a kernel-side route lookup — no packet actually goes out —
// and it picks the same interface as a real outbound connection, which is what
// a phone on the same Wi-Fi needs to reach us. Falls back to scanning
// os.networkInterfaces() if the socket trick fails (e.g. no default route).
const detectLanIPv4Address = async () => {
  const ip = await new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const finish = (value) => {
      try { socket.close(); } catch {}
      resolve(value);
    };
    socket.once('error', () => finish(null));
    try {
      socket.connect(80, '8.8.8.8', (error) => {
        if (error) return finish(null);
        try {
          const addr = socket.address();
          finish(addr && typeof addr.address === 'string' ? addr.address : null);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
  if (ip && ip !== '0.0.0.0' && !ip.startsWith('127.')) return ip;

  for (const entries of Object.values(os.networkInterfaces() || {})) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        return entry.address;
      }
    }
  }
  return null;
};

const isMachineLocalHostname = (hostname) => {
  const clean = String(hostname || '').replace(/^\[|\]$/g, '');
  if (!clean) return false;
  if (clean === 'localhost' || clean === '127.0.0.1' || clean === '::1' || clean === '0.0.0.0' || clean === '::') {
    return true;
  }
  try {
    return Object.values(os.networkInterfaces() || {}).some((entries) =>
      (entries || []).some((entry) => entry?.address === clean));
  } catch {
    return false;
  }
};

const isLocalRuntimeUrl = (targetUrl) => {
  try {
    const target = new URL(targetUrl);
    const portOf = (url) => url.port || (url.protocol === 'https:' ? '443' : '80');
    return [state.sidecarUrl, state.localOrigin].filter(Boolean).some((localUrl) => {
      const local = new URL(localUrl);
      if (target.origin === local.origin) return true;
      return portOf(target) === portOf(local) && isMachineLocalHostname(target.hostname);
    });
  } catch {
    return false;
  }
};

const isSpaReloadNavigation = (currentUrl, targetUrl) => {
  try {
    const target = new URL(targetUrl);
    if (target.protocol === 'about:' || target.protocol === 'devtools:') return true;
    const current = new URL(currentUrl);
    return target.origin === current.origin && target.pathname === current.pathname;
  } catch {
    return false;
  }
};

const buildLocalUrl = (port) => `http://127.0.0.1:${port}`;

const resourceRoot = () => {
  if (isDev) return path.join(__dirname, 'resources');
  return externalRuntimeRoot || process.resourcesPath;
};
const resolveWebDistDir = () => path.join(resourceRoot(), 'web-dist');
const resolvePreloadPath = () => {
  if (isDev) return path.join(__dirname, 'preload.mjs');
  return externalRuntimeRoot
    ? path.join(externalRuntimeRoot, 'preload.mjs')
    : path.join(app.getAppPath(), 'preload.mjs');
};

const isMacMenuBarEnabled = () => readSettingsRoot().desktopMacMenuBarEnabled !== false;

const isTrayEnabledForPlatform = () =>
  (process.platform === 'darwin' && isMacMenuBarEnabled())
  || process.platform === 'win32'
  || process.platform === 'linux';

const readDesktopMinimizeToTrayStatus = () => {
  const supported = process.platform === 'win32' || process.platform === 'linux';
  return {
    supported,
    enabled: supported && readSettingsRoot().desktopMinimizeToTrayEnabled === true,
  };
};

const shouldHideMainWindowToTray = (browserWindow) => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return false;
  if (!state.trayController) return false;
  if (!browserWindow || browserWindow.isDestroyed()) return false;
  if (browserWindow.__ocMiniChat === true) return false;
  return readSettingsRoot().desktopMinimizeToTrayEnabled === true;
};

const getWindowIconPath = () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    return undefined;
  }
  const iconName = process.platform === 'linux' ? 'icon.png' : 'icon.ico';
  const iconPath = isDev
    ? path.join(__dirname, 'resources', 'icons', iconName)
    : path.join(process.resourcesPath, 'icons', iconName);
  return fs.existsSync(iconPath) ? iconPath : undefined;
};

const TRAY_BREATH_FRAME_COUNT = 16;

const destroyTray = () => {
  if (state.trayController) {
    try {
      state.trayController.destroy();
    } catch (error) {
      log.warn('[electron] tray destroy failed', error);
    }
    state.trayController = null;
  }
  if (state.trayFocusListener) {
    app.removeListener('browser-window-focus', state.trayFocusListener);
    state.trayFocusListener = null;
  }
};

const trayIconAssets = () => {
  const dir = path.join(resourceRoot(), 'icons', 'tray');
  const statusDir = path.join(dir, 'status');
  if (process.platform === 'win32') {
    const iconPath = getWindowIconPath() || path.join(resourceRoot(), 'icons', 'icon.ico');
    return {
      idleIconPath: iconPath,
      unseenIconPath: iconPath,
      breathIconPaths: [iconPath],
      statusIconPaths: {
        busy: path.join(statusDir, 'busy.png'),
        retry: path.join(statusDir, 'retry.png'),
        error: path.join(statusDir, 'error.png'),
        unseen: path.join(statusDir, 'unseen.png'),
        blank: path.join(statusDir, 'blank.png'),
      },
    };
  }
  return {
    idleIconPath: path.join(dir, 'trayTemplate-idle.png'),
    unseenIconPath: path.join(dir, 'trayTemplate-unseen.png'),
    breathIconPaths: Array.from({ length: TRAY_BREATH_FRAME_COUNT }, (_, i) =>
      path.join(dir, `trayTemplate-breath-${String(i).padStart(2, '0')}.png`)),
    statusIconPaths: {
      busy: path.join(statusDir, 'busy.png'),
      retry: path.join(statusDir, 'retry.png'),
      error: path.join(statusDir, 'error.png'),
      unseen: path.join(statusDir, 'unseen.png'),
      blank: path.join(statusDir, 'blank.png'),
    },
  };
};

const resolveTraySurface = () => {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  if (state.lastFocusedWindowId != null) {
    const remembered = BrowserWindow.fromId(state.lastFocusedWindowId);
    if (remembered && !remembered.isDestroyed()) return remembered;
  }
  return null;
};

const revealMainWindow = async () => {
  let target = state.mainWindow;
  if (!target || target.isDestroyed()) {
    target = await openMainWindow().catch(() => null) || state.mainWindow;
  }
  if (target && !target.isDestroyed()) {
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
  }
  return target;
};

const focusMainWindowWithSession = async (sessionId, directory, serverId = '') => {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore();
    state.mainWindow.show();
    state.mainWindow.focus();
    if (sessionId) {
      emitToWindow(state.mainWindow, 'openchamber:open-session', {
        sessionId,
        directory: directory || '',
        serverId: serverId || '',
      });
    }
    return;
  }
  if (sessionId) pendingDeepLinks.push({ type: 'session', value: sessionId });
  await openMainWindow();
};

const dispatchOpenMiniChat = (browserWindow) => {
  const target = browserWindow && !browserWindow.isDestroyed() ? browserWindow : getMenuTargetWindow();
  void createMiniChatWindow({ mode: 'draft' }).catch((error) => {
    log.warn('[electron] failed to open mini chat from tray', error);
    if (target && !target.isDestroyed()) {
      emitToWindow(target, 'openchamber:open-draft-session', { directory: '', projectId: '' });
    }
  });
};

const dispatchTrayAction = async (action) => {
  if (!action || typeof action !== 'object') return;

  if (action.type === 'quit') {
    void requestQuitWithConfirmation();
    return;
  }

  if (action.type === 'hide-main-window') {
    const target = (state.mainWindow && !state.mainWindow.isDestroyed())
      ? state.mainWindow
      : BrowserWindow.getFocusedWindow();
    if (target && !target.isDestroyed() && target.isVisible()) {
      debounceWindowStatePersist(target, true);
      target.hide();
    }
    return;
  }

  if (action.type === 'toggle-main-window') {
    const target = (state.mainWindow && !state.mainWindow.isDestroyed())
      ? state.mainWindow
      : null;
    if (target && target.isVisible() && !target.isMinimized()) {
      debounceWindowStatePersist(target, true);
      target.hide();
      return;
    }
    await revealMainWindow();
    return;
  }

  if (action.type === 'respond-permission') {
    const target = (state.mainWindow && !state.mainWindow.isDestroyed())
      ? state.mainWindow
      : await revealMainWindow();
    emitToWindow(target, 'openchamber:tray-action', action);
    return;
  }

  if (action.type === 'new-mini-chat') {
    let target = getMenuTargetWindow();
    if (!target) target = await revealMainWindow();
    dispatchOpenMiniChat(target);
    return;
  }

  if (action.type === 'focus-session') {
    const surface = resolveTraySurface();
    if (surface && surface.__ocMiniChat === true && action.sessionId) {
      if (surface.isMinimized()) surface.restore();
      surface.show();
      surface.focus();
      emitToWindow(surface, 'openchamber:open-session', {
        sessionId: action.sessionId,
        directory: action.directory || '',
        serverId: action.serverId || '',
      });
      return;
    }
    await focusMainWindowWithSession(action.sessionId, action.directory || '', action.serverId || '');
    return;
  }

  const target = await revealMainWindow();
  if (!target || target.isDestroyed()) return;

  if (action.type === 'new-session') {
    emitToWindow(target, 'openchamber:open-draft-session', { directory: '', projectId: '' });
  }
};

const setupTray = () => {
  if (!['darwin', 'win32', 'linux'].includes(process.platform) || state.trayController) return;
  if (process.platform === 'darwin' && !isMacMenuBarEnabled()) return;
  const assets = trayIconAssets();
  if (!fs.existsSync(assets.idleIconPath)) {
    log.warn('[electron] tray icon missing, skipping tray setup', { iconPath: assets.idleIconPath });
    return;
  }
  try {
    state.trayController = createTrayController({
      ...assets,
      onAction: (action) => { void dispatchTrayAction(action); },
    });
    state.trayController.update({ sessions: [], approvals: [] });
    if (!state.trayFocusListener) {
      state.trayFocusListener = (_event, browserWindow) => {
        if (browserWindow && !browserWindow.isDestroyed()) {
          state.lastFocusedWindowId = browserWindow.id;
        }
      };
      app.on('browser-window-focus', state.trayFocusListener);
    }
  } catch (error) {
    log.warn('[electron] failed to set up tray', error);
    state.trayController = null;
  }
};

const normalizeNotificationInput = (raw) => {
  if (!raw || typeof raw !== 'object') return {};
  // UI IPC path wraps in { payload: {...} }; sidecar stdout path is flat.
  if (raw.payload && typeof raw.payload === 'object') {
    return { ...raw, ...raw.payload };
  }
  return raw;
};

const isAnyWindowFocused = () =>
  BrowserWindow.getAllWindows().some(
    (window) => !window.isDestroyed() && window.isFocused(),
  );

const focusForegroundWindow = () => {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  if (windows.length === 0) return;
  const target = state.mainWindow && !state.mainWindow.isDestroyed()
    ? state.mainWindow
    : windows.find((window) => window.isVisible()) || windows[0];
  // macOS: bring the app to foreground FIRST. When the window is minimized
  // to the Dock or hidden via Cmd+H, the app is in the background, and
  // subsequent window.show/restore/focus calls won't pull it forward
  // unless app.focus runs first.
  if (process.platform === 'darwin') app.focus({ steal: true });
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  if (typeof target.moveTop === 'function') target.moveTop();
};

// Keep references to live notifications so they aren't garbage-collected
// before the OS fires click/close. On macOS, losing the JS reference causes
// click events to silently stop firing after ~1 min.
// See https://blog.bloomca.me/2025/02/22/electron-mac-notifications
const activeNotifications = new Set();

const maybeShowNativeNotification = (rawInput) => {
  const payload = normalizeNotificationInput(rawInput);
  const requireHidden = Boolean(payload.requireHidden ?? payload.require_hidden);

  if (requireHidden && isAnyWindowFocused()) {
    return;
  }

  if (!Notification.isSupported()) {
    return;
  }

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : 'OpenChamber';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const sessionId = typeof payload.sessionId === 'string' && payload.sessionId.trim()
    ? payload.sessionId.trim()
    : null;

  const notification = new Notification({
    title,
    body,
    silent: false,
    ...(process.platform === 'darwin' ? { sound: 'Glass' } : {}),
  });

  activeNotifications.add(notification);
  const release = () => { activeNotifications.delete(notification); };

  notification.on('click', () => {
    focusForegroundWindow();
    if (sessionId) {
      emitToAllWindows('openchamber:open-session', { sessionId });
    }
    release();
  });
  notification.on('close', release);
  notification.on('failed', release);

  notification.show();
};

const mapUpdaterProgressEvent = (payload) => ({
  event: payload.event,
  data: payload.data,
});

const SHELL_ENV_TIMEOUT_MS = 5_000;
let cachedShellEnv = null;
let shellEnvProbed = false;

const isNushell = (shell) => {
  const name = path.basename(shell).toLowerCase();
  return name === 'nu' || name === 'nu.exe';
};

const parseShellEnv = (buf) => {
  const result = {};
  for (const line of buf.toString('utf8').split('\0')) {
    if (!line) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    result[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return result;
};

const probeShellEnv = (shell, mode) => {
  const result = spawnSync(shell, [mode, '-c', 'env -0'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: SHELL_ENV_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  const env = parseShellEnv(result.stdout);
  return Object.keys(env).length > 0 ? env : null;
};

// Finder-launched apps on macOS inherit a minimal PATH (no /opt/homebrew, mise, asdf, etc.).
// Probe the user's login shell once so the sidecar sees the same PATH / tool env as `$SHELL -il`.
const loadShellEnv = () => {
  if (shellEnvProbed) return cachedShellEnv;
  shellEnvProbed = true;
  if (process.platform === 'win32') return null;
  const shell = process.env.SHELL || '/bin/sh';
  if (isNushell(shell)) return null;
  cachedShellEnv = probeShellEnv(shell, '-il') || probeShellEnv(shell, '-l');
  return cachedShellEnv;
};

// Merge the user's login-shell env (PATH, etc.) into this process before we
import { pathLooksUserConfigured, mergePathValues } from '@openchamber/web/server/lib/opencode/path-utils.js';
import { clearAppImageArgv0FromProcessEnv } from '@openchamber/web/server/lib/inherited-env.js';

// import/start the server in-process. The server and its children (opencode
// CLI, git, etc.) inherit process.env directly now — there is no sidecar
// subprocess to hand a custom env to.
const inheritUserShellEnv = () => {
  // Clear before probing/merging so login-shell snapshots and children never
  // inherit the AppImage path as argv[0] via zsh's ARGV0 parameter (#2588).
  clearAppImageArgv0FromProcessEnv();

  const shellEnv = loadShellEnv();
  if (!shellEnv) return;

  const homeDir = os.homedir();
  const currentPath = process.env.PATH || '';
  const currentPathLooksUserConfigured = pathLooksUserConfigured(currentPath, homeDir, ':');

  for (const [key, value] of Object.entries(shellEnv)) {
    if (key === 'PATH' || key === 'ARGV0') continue;
    if (typeof process.env[key] === 'undefined') {
      process.env[key] = value;
    }
  }

  const shellPath = typeof shellEnv.PATH === 'string' ? shellEnv.PATH : '';
  if (!currentPathLooksUserConfigured && shellPath) {
    process.env.PATH = mergePathValues(shellPath, currentPath, ':');
  }
};

const spawnLocalServer = async () => {
  inheritUserShellEnv();

  const settings = readSettingsRoot();
  const storedPort = Number.isFinite(settings.desktopLocalPort) ? settings.desktopLocalPort : null;
  // When the user enables "Desktop Network Access" we bind on all interfaces
  // so phones/tablets on the same Wi-Fi can reach the app. UI shows a clear
  // warning and persists the flag via /api/config/settings.
  const lanAccessEnabled = settings.desktopLanAccessEnabled === true;
  setDesktopKeepAwakeActive(settings.desktopKeepAwakeEnabled === true);
  const bindHost = lanAccessEnabled ? '0.0.0.0' : '127.0.0.1';

  // Probe before starting the server — main() in the server module sets up a
  // lot of global state before binding, and calling it twice after a listen
  // failure would double-wire runtimes. Pick a known-free port in one shot.
  const candidates = [storedPort, DEFAULT_DESKTOP_PORT].filter((v) => Number.isFinite(v) && v > 0);
  let chosenPort = 0;
  for (const candidate of candidates) {
    if (await isPortFree(candidate)) {
      chosenPort = candidate;
      break;
    }
  }
  if (chosenPort === 0) {
    chosenPort = await pickUnusedPort();
  }

  // The server module reads ENV_DESKTOP_NOTIFY / OPENCHAMBER_DIST_DIR /
  // OPENCHAMBER_RUNTIME at import time (top-level const), so these must be
  // set before the first import. After this point, the same env is used by
  // both the Electron main and the server running inside it.
  process.env.OPENCHAMBER_HOST = bindHost;
  process.env.OPENCHAMBER_DIST_DIR = resolveWebDistDir();
  process.env.OPENCHAMBER_RUNTIME = 'desktop';
  process.env.OPENCHAMBER_VERSION = APP_VERSION;
  process.env.OPENCHAMBER_OPENCODE_CWD = app.getPath('userData');
  process.env.OPENCHAMBER_DESKTOP_NOTIFY = 'true';
  if (externalRuntimeManifest?.opencode?.mode === 'bun-source') {
    process.env.OPENCHAMBER_BUN_ENGINE = path.join(process.resourcesPath, 'engine', 'bun');
    process.env.OPENCHAMBER_OPENCODE_SOURCE_ROOT = externalRuntimeManifest.opencode.sourceRoot;
    process.env.OPENCHAMBER_OPENCODE_VERSION = externalRuntimeManifest.opencode.version;
    process.env.OPENCHAMBER_OPENCODE_CHANNEL = externalRuntimeManifest.opencode.channel || 'latest';
  }
  const bundledOpenCodeBinary = path.join(
    resourceRoot(),
    'opencode',
    process.platform === 'win32' ? 'opencode.exe' : 'opencode',
  );
  if (!isDev && fs.existsSync(bundledOpenCodeBinary)) {
    process.env.OPENCHAMBER_BUNDLED_OPENCODE_BINARY = bundledOpenCodeBinary;
  }
  try {
    fs.mkdirSync(process.env.OPENCHAMBER_OPENCODE_CWD, { recursive: true });
  } catch {
  }
  process.env.OPENCHAMBER_SKIP_API_COMPRESSION = process.env.OPENCHAMBER_SKIP_API_COMPRESSION || 'true';
  process.env.NO_PROXY = process.env.NO_PROXY || 'localhost,127.0.0.1';
  process.env.no_proxy = process.env.no_proxy || 'localhost,127.0.0.1';

  // Keep UI/proxy; skip managed OpenCode when remote-only or default host is remote.
  if (shouldSkipManagedOpenCodeStart(settings)) {
    process.env.OPENCHAMBER_SKIP_OPENCODE_START = 'true';
    process.env.OPENCODE_SKIP_START = process.env.OPENCODE_SKIP_START || 'true';
    log.info('[electron] skipping managed OpenCode start', {
      remoteOnly: isDesktopRemoteOnlyPolicy(settings),
    });
  }

  const { startWebUiServer } = await import('@openchamber/web/server/index.js');

  const handle = await startWebUiServer({
    port: chosenPort,
    host: bindHost,
    attachSignals: false,
    exitOnShutdown: false,
    onDesktopNotification: (payload) => maybeShowNativeNotification(payload),
    getIsWindowFocused: isAnyWindowFocused,
    settingsWriter: withSettingsLock,
  });

  const port = handle.getPort();
  const url = buildLocalUrl(port);

  state.serverHandle = handle;
  state.sidecarUrl = url;

  await mutateSettingsRoot((root) => {
    root.desktopLocalPort = port;
  }).catch((error) => log.warn?.('[electron] failed to persist desktopLocalPort', error));

  return url;
};

const spawnLocalServerOnce = createSingleFlight(spawnLocalServer);

const killSidecar = async ({ stopOpenCode = !shouldKeepManagedOpenCodeAliveByDefault() } = {}) => {
  if (state.serverHandle) {
    try {
      const result = state.serverHandle.stop({ exitProcess: false, stopOpenCode });
      if (result && typeof result.then === 'function') {
        await result;
      }
    } catch {
    }
    state.serverHandle = null;
  }
  state.sidecarUrl = null;
};

const macosMajorVersion = () => {
  if (process.platform !== 'darwin') return 0;
  const result = spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' });
  const raw = (result.stdout || '').trim();
  const [majorRaw, minorRaw] = raw.split('.');
  const major = Number.parseInt(majorRaw || '0', 10);
  const minor = Number.parseInt(minorRaw || '0', 10);
  return major === 10 ? minor : major;
};

const buildInitScript = (localOrigin, bootOutcome) => {
  const home = JSON.stringify(os.homedir() || '');
  const local = JSON.stringify(localOrigin || '');
  const macVersion = macosMajorVersion();
  const outcome = JSON.stringify(bootOutcome ?? null);
  return [
    '(function(){',
    `try{window.__OPENCHAMBER_HOME__=${home};window.__OPENCHAMBER_MACOS_MAJOR__=${macVersion};window.__OPENCHAMBER_LOCAL_ORIGIN__=${local};var __oc_bo=${outcome};if(__oc_bo){window.__OPENCHAMBER_DESKTOP_BOOT_OUTCOME__=__oc_bo;}}catch(_e){}`,
    '}())',
  ].join('');
};

const computeBootOutcome = ({
  envTargetUrl,
  probe,
  config,
  localAvailable,
  localOpenCodeAvailable = true,
}) => {
  const availability = localOpenCodeAvailable === false
    ? { localOpenCodeAvailable: false }
    : {};

  if (envTargetUrl) {
    const status = probe && probe.status === 'unreachable' ? 'unreachable' : 'ok';
    return { target: 'remote', status, hostId: ENV_OVERRIDE_HOST_ID, url: envTargetUrl, ...availability };
  }

  const defaultId = config.defaultHostId || '';
  if (!defaultId) {
    return { target: null, status: 'not-configured', ...availability };
  }

  if (defaultId === LOCAL_HOST_ID) {
    if (localOpenCodeAvailable === false) {
      // Remote-only policy with local default → chooser (via unreachable + flag).
      return { target: 'local', status: 'unreachable', ...availability };
    }
    return localAvailable
      ? { target: 'local', status: 'ok', ...availability }
      : { target: 'local', status: 'unreachable', ...availability };
  }

  const host = config.hosts.find((entry) => entry.id === defaultId);
  if (!host) {
    return { target: 'remote', status: 'missing', hostId: defaultId, ...availability };
  }

  const relayCapable = Boolean(sanitizeHostRelayForStorage(host.relay));
  const status = resolveDefaultHostBootStatus(probe?.status, relayCapable);
  return { target: 'remote', status, hostId: host.id, url: host.apiUrl || host.url, ...availability };
};

const buildStartupSplashHtml = () => {
  const settings = readSettingsRoot();
  const splashBgLight = typeof settings.splashBgLight === 'string' ? settings.splashBgLight.trim() : '#f5f5f4';
  const splashFgLight = typeof settings.splashFgLight === 'string' ? settings.splashFgLight.trim() : '#1c1917';
  const splashBgDark = typeof settings.splashBgDark === 'string' ? settings.splashBgDark.trim() : '#0c0a09';
  const splashFgDark = typeof settings.splashFgDark === 'string' ? settings.splashFgDark.trim() : '#fafaf9';

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light dark; }
      :root {
        --splash-background: ${splashBgLight};
        --splash-stroke: ${splashFgLight};
        --splash-face-fill: rgba(0, 0, 0, 0.15);
        --splash-cell-fill: rgba(0, 0, 0, 0.4);
        --splash-logo-fill: var(--splash-stroke);
      }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", sans-serif;
        display: grid;
        place-items: center;
        height: 100vh;
        background: var(--splash-background);
        color: var(--splash-stroke);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --splash-background: ${splashBgDark};
          --splash-stroke: ${splashFgDark};
          --splash-face-fill: rgba(255, 255, 255, 0.15);
          --splash-cell-fill: rgba(255, 255, 255, 0.35);
        }
      }
      @supports (color: color-mix(in srgb, white 50%, transparent)) {
        :root {
          --splash-face-fill: color-mix(in srgb, var(--splash-stroke) 15%, transparent);
          --splash-cell-fill: color-mix(in srgb, var(--splash-stroke) 35%, transparent);
        }
      }
      .stack {
        display: grid;
        justify-items: center;
      }
    </style>
  </head>
  <body>
    <div class="stack">
      <svg width="120" height="120" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="OpenChamber loading icon">
        <path d="M50 50 L8.432 26 L8.432 74 L50 98 Z" fill="var(--splash-face-fill)" stroke="var(--splash-stroke)" stroke-width="2" stroke-linejoin="round"/>
        <path d="M50 50 L39.608 44 L39.608 56 L50 62 Z" fill="var(--splash-cell-fill)" opacity="0.2"/>
        <path d="M39.608 44 L29.216 38 L29.216 50 L39.608 56 Z" fill="var(--splash-cell-fill)" opacity="0.45"/>
        <path d="M29.216 38 L18.824 32 L18.824 44 L29.216 50 Z" fill="var(--splash-cell-fill)" opacity="0.15"/>
        <path d="M18.824 32 L8.432 26 L8.432 38 L18.824 44 Z" fill="var(--splash-cell-fill)" opacity="0.55"/>
        <path d="M50 62 L39.608 56 L39.608 68 L50 74 Z" fill="var(--splash-cell-fill)" opacity="0.35"/>
        <path d="M39.608 56 L29.216 50 L29.216 62 L39.608 68 Z" fill="var(--splash-cell-fill)" opacity="0.1"/>
        <path d="M29.216 50 L18.824 44 L18.824 56 L29.216 62 Z" fill="var(--splash-cell-fill)" opacity="0.5"/>
        <path d="M18.824 44 L8.432 38 L8.432 50 L18.824 56 Z" fill="var(--splash-cell-fill)" opacity="0.25"/>
        <path d="M50 74 L39.608 68 L39.608 80 L50 86 Z" fill="var(--splash-cell-fill)" opacity="0.4"/>
        <path d="M39.608 68 L29.216 62 L29.216 74 L39.608 80 Z" fill="var(--splash-cell-fill)" opacity="0.3"/>
        <path d="M29.216 62 L18.824 56 L18.824 68 L29.216 74 Z" fill="var(--splash-cell-fill)" opacity="0.45"/>
        <path d="M18.824 56 L8.432 50 L8.432 62 L18.824 68 Z" fill="var(--splash-cell-fill)" opacity="0.15"/>
        <path d="M50 86 L39.608 80 L39.608 92 L50 98 Z" fill="var(--splash-cell-fill)" opacity="0.55"/>
        <path d="M39.608 80 L29.216 74 L29.216 86 L39.608 92 Z" fill="var(--splash-cell-fill)" opacity="0.2"/>
        <path d="M29.216 74 L18.824 68 L18.824 80 L29.216 86 Z" fill="var(--splash-cell-fill)" opacity="0.35"/>
        <path d="M18.824 68 L8.432 62 L8.432 74 L18.824 80 Z" fill="var(--splash-cell-fill)" opacity="0.1"/>
        <path d="M50 50 L91.568 26 L91.568 74 L50 98 Z" fill="var(--splash-face-fill)" stroke="var(--splash-stroke)" stroke-width="2" stroke-linejoin="round"/>
        <path d="M50 50 L60.392 44 L60.392 56 L50 62 Z" fill="var(--splash-cell-fill)" opacity="0.3"/>
        <path d="M60.392 44 L70.784 38 L70.784 50 L60.392 56 Z" fill="var(--splash-cell-fill)" opacity="0.15"/>
        <path d="M70.784 38 L81.176 32 L81.176 44 L70.784 50 Z" fill="var(--splash-cell-fill)" opacity="0.45"/>
        <path d="M81.176 32 L91.568 26 L91.568 38 L81.176 44 Z" fill="var(--splash-cell-fill)" opacity="0.25"/>
        <path d="M50 62 L60.392 56 L60.392 68 L50 74 Z" fill="var(--splash-cell-fill)" opacity="0.5"/>
        <path d="M60.392 56 L70.784 50 L70.784 62 L60.392 68 Z" fill="var(--splash-cell-fill)" opacity="0.35"/>
        <path d="M70.784 50 L81.176 44 L81.176 56 L70.784 62 Z" fill="var(--splash-cell-fill)" opacity="0.1"/>
        <path d="M81.176 44 L91.568 38 L91.568 50 L81.176 56 Z" fill="var(--splash-cell-fill)" opacity="0.4"/>
        <path d="M50 74 L60.392 68 L60.392 80 L50 86 Z" fill="var(--splash-cell-fill)" opacity="0.2"/>
        <path d="M60.392 68 L70.784 62 L70.784 74 L60.392 80 Z" fill="var(--splash-cell-fill)" opacity="0.55"/>
        <path d="M70.784 62 L81.176 56 L81.176 68 L70.784 74 Z" fill="var(--splash-cell-fill)" opacity="0.3"/>
        <path d="M81.176 56 L91.568 50 L91.568 62 L81.176 68 Z" fill="var(--splash-cell-fill)" opacity="0.15"/>
        <path d="M50 86 L60.392 80 L60.392 92 L50 98 Z" fill="var(--splash-cell-fill)" opacity="0.45"/>
        <path d="M60.392 80 L70.784 74 L70.784 86 L60.392 92 Z" fill="var(--splash-cell-fill)" opacity="0.25"/>
        <path d="M70.784 74 L81.176 68 L81.176 80 L70.784 86 Z" fill="var(--splash-cell-fill)" opacity="0.4"/>
        <path d="M81.176 68 L91.568 62 L91.568 74 L81.176 80 Z" fill="var(--splash-cell-fill)" opacity="0.2"/>
        <path d="M50 2 L8.432 26 L50 50 L91.568 26 Z" fill="none" stroke="var(--splash-stroke)" stroke-width="2" stroke-linejoin="round"/>
        <g transform="matrix(0.866, 0.5, -0.866, 0.5, 50, 26) scale(0.75)">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M-16 -20 L16 -20 L16 20 L-16 20 Z M-8 -12 L-8 12 L8 12 L8 -12 Z" fill="var(--splash-logo-fill)"/>
          <path d="M-8 -4 L8 -4 L8 12 L-8 12 Z" fill="var(--splash-logo-fill)" fill-opacity="0.4"/>
        </g>
      </svg>
    </div>
  </body>
  </html>`;
};

const isBenignNavigationAbort = (error) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if (error.errno === -3) {
    return true;
  }

  const message = typeof error.message === 'string' ? error.message : '';
  return message.includes('ERR_ABORTED') || message.includes(' (-3) loading ');
};

const navigateWindow = async (browserWindow, url, { allowAbort = false } = {}) => {
  try {
    await browserWindow.loadURL(url);
  } catch (error) {
    if (allowAbort && isBenignNavigationAbort(error)) {
      return;
    }
    throw error;
  }
};

const emitToWindow = (browserWindow, event, detail) => {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  browserWindow.webContents.send('openchamber:emit', { event, detail });
};

const emitToAllWindows = (event, detail) => {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    emitToWindow(browserWindow, event, detail);
  }
};

const setTaskbarProgress = (value) => {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (browserWindow.isDestroyed()) continue;
    try {
      browserWindow.setProgressBar(value);
    } catch (error) {
      log.debug('[electron] failed to update taskbar progress', error);
    }
  }
};

const pendingDeepLinks = [];

const parseDeepLink = (raw) => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== `${DEEP_LINK_PROTOCOL}:`) return null;
    const type = url.hostname;
    if (!type) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const value = segments.length > 0
      ? decodeURIComponent(segments.join('/'))
      : '';
    return { type, value };
  } catch {
    return null;
  }
};

const switchToHostById = async (rawId) => {
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id) return;
  const config = readDesktopHostsConfig();
  let targetUrl = null;
  if (id === LOCAL_HOST_ID) {
    targetUrl = state.sidecarUrl || state.localOrigin;
  } else {
    const host = config.hosts.find((entry) => entry.id === id);
    if (!host) {
      log.warn('[electron] deep-link host not found:', id);
      return;
    }
    targetUrl = host.url;
  }
  if (!targetUrl) {
    log.warn('[electron] deep-link host has no target URL:', id);
    return;
  }
  const localOpenCodeAvailable = !isDesktopRemoteOnlyPolicy();
  const availability = localOpenCodeAvailable === false
    ? { localOpenCodeAvailable: false }
    : {};
  const bootOutcome = id === LOCAL_HOST_ID
    ? (localOpenCodeAvailable
      ? { target: 'local', status: 'ok', ...availability }
      : { target: 'local', status: 'unreachable', ...availability })
    : { target: 'remote', status: 'ok', hostId: id, url: targetUrl, ...availability };
  log.info('[electron] switching to host', { id, bootOutcome });
  await activateMainWindow(targetUrl, state.localOrigin, bootOutcome);
};

const dispatchDeepLink = (link) => {
  if (!link) return;
  log.info('[electron] dispatching deep-link', { type: link.type, valueLen: link.value?.length || 0 });
  if (link.type === 'session' && link.value) {
    emitToAllWindows('openchamber:open-session', { sessionId: link.value });
    return;
  }
  if (link.type === 'host' && link.value) {
    void switchToHostById(link.value);
    return;
  }
  log.warn('[electron] unknown deep-link action:', link.type);
};

const flushPendingDeepLinks = () => {
  while (pendingDeepLinks.length > 0) {
    dispatchDeepLink(pendingDeepLinks.shift());
  }
};

const isMainWindowReadyForDeepLink = () =>
  Boolean(state.mainWindow)
  && !state.mainWindow.isDestroyed()
  && !state.mainWindow.webContents.isLoading();

const handleDeepLinks = (urls) => {
  for (const raw of urls) {
    const parsed = parseDeepLink(raw);
    if (!parsed) continue;
    if (isMainWindowReadyForDeepLink()) {
      dispatchDeepLink(parsed);
    } else {
      pendingDeepLinks.push(parsed);
    }
  }
};

const extractInitialDeepLinks = () =>
  process.argv.filter((arg) => typeof arg === 'string' && arg.startsWith(`${DEEP_LINK_PROTOCOL}://`));

const dispatchDomEventToWindow = (browserWindow, event, detail) => {
  if (!browserWindow || browserWindow.isDestroyed()) return;

  const eventLiteral = JSON.stringify(event);
  const script = detail === undefined
    ? `window.dispatchEvent(new Event(${eventLiteral}));`
    : `window.dispatchEvent(new CustomEvent(${eventLiteral}, { detail: ${JSON.stringify(detail)} }));`;

  void browserWindow.webContents.executeJavaScript(script, true).catch(() => {});
};

const getMenuTargetWindow = () => {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  if (state.mainWindow && !state.mainWindow.isDestroyed()) return state.mainWindow;
  const [firstWindow] = BrowserWindow.getAllWindows();
  return firstWindow && !firstWindow.isDestroyed() ? firstWindow : null;
};

const dispatchMenuAction = (action) => {
  const target = getMenuTargetWindow();
  emitToWindow(target, 'openchamber:menu-action', action);
  dispatchDomEventToWindow(target, 'openchamber:menu-action', action);
};

const dispatchAddSelectionToChat = () => {
  const target = getMenuTargetWindow();
  if (target) emitToWindow(target, 'openchamber:menu-action', 'add-selection-to-chat');
};

const dispatchCheckForUpdates = () => {
  emitToAllWindows('openchamber:check-for-updates');
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    dispatchDomEventToWindow(browserWindow, 'openchamber:check-for-updates');
  }
};

const reloadMenuTargetWindow = () => {
  const target = getMenuTargetWindow();
  if (!target || target.isDestroyed()) return;
  target.webContents.reload();
};

const openDevToolsForMenuTarget = () => {
  const target = getMenuTargetWindow();
  if (!target || target.isDestroyed()) return;
  target.webContents.toggleDevTools();
};

const relaunchFromMenu = () => {
  prepareForQuit();
  setImmediate(() => {
    app.relaunch();
    app.exit(0);
  });
};

const nextWindowLabel = () => {
  const value = state.windowCounter++;
  return value === 1 ? 'main' : `main-${value}`;
};

const readThemeSource = () => {
  const settings = readSettingsRoot();
  // themeMode is the user's intent; themeVariant is only the resolved
  // concrete appearance at persist time. When mode === 'system', we must
  // follow the OS even if variant was saved as a specific value.
  if (settings.themeMode === 'system' || settings.useSystemTheme === true) return 'system';
  if (settings.themeMode === 'light') return 'light';
  if (settings.themeMode === 'dark') return 'dark';
  if (settings.themeVariant === 'light') return 'light';
  if (settings.themeVariant === 'dark') return 'dark';
  return 'system';
};

const createBrowserWindow = ({ label, restoreGeometry, url }) => {
  const saved = restoreGeometry ? readWindowState() : null;
  const useSaved = saved && typeof saved.width === 'number' && typeof saved.height === 'number';
  const desktopLocalOrigin = state.localOrigin || '';
  const desktopHome = os.homedir() || '';
  const desktopMacosMajor = String(macosMajorVersion());
  const trayEnabled = isTrayEnabledForPlatform();
  const windowIconPath = getWindowIconPath();
  const usesFramelessChrome = process.platform === 'win32' || process.platform === 'linux';
  const options = {
    title: 'OpenChamber',
    width: useSaved ? Math.max(saved.width, MIN_RESTORE_WINDOW_WIDTH) : 1280,
    height: useSaved ? Math.max(saved.height, MIN_RESTORE_WINDOW_HEIGHT) : 800,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    icon: windowIconPath,
    frame: usesFramelessChrome ? false : undefined,
    autoHideMenuBar: process.platform !== 'darwin',
    show: false,
    backgroundColor: '#151313',
    // The previous desktop shell used an overlay title bar with explicit traffic-light placement.
    // Electron's hiddenInset adds its own extra inset, which leaves the controls
    // visibly lower than the app header. Use a plain hidden title bar instead.
    titleBarStyle: process.platform === 'darwin' || usesFramelessChrome ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 17 } : undefined,
    webPreferences: {
      additionalArguments: [
        `--openchamber-local-origin=${desktopLocalOrigin}`,
        `--openchamber-home=${desktopHome}`,
        `--openchamber-macos-major=${desktopMacosMajor}`,
        `--openchamber-boot-outcome=${JSON.stringify(state.bootOutcome || null)}`,
        `--openchamber-tray-enabled=${trayEnabled ? '1' : '0'}`,
        `--openchamber-platform=${process.platform}`,
      ],
      preload: resolvePreloadPath(),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      // sandbox must stay off: the preload uses contextBridge + ipcRenderer
      // from Electron's Node layer. contextIsolation + nodeIntegration:false
      // keep the renderer world walled off from Node. Do NOT flip to true —
      // the preload would fail to load and __OPENCHAMBER_DESKTOP__ would go undefined.
      sandbox: false,
    },
  };

  const browserWindow = new BrowserWindow(options);
  browserWindow.__ocLabel = label || nextWindowLabel();

  if (useSaved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    browserWindow.setPosition(saved.x, saved.y);
  }

  if (useSaved && saved.maximized) {
    browserWindow.maximize();
  }

  browserWindow.on('focus', () => {
    state.focusedWindowIds.add(browserWindow.id);
  });
  browserWindow.on('blur', () => {
    state.focusedWindowIds.delete(browserWindow.id);
  });

  // Traffic lights disappear during dock-restore animation when using
  // titleBarStyle:'hidden' + custom trafficLightPosition. macOS caches a
  // snapshot of the window at miniaturize time and plays it during the
  // genie-restore animation. We re-assert button position on 'minimize'
  // (before the snapshot) and 'restore'/'show'/'focus' to cover other
  // transient reset states AppKit puts the buttons in.
  if (process.platform === 'darwin') {
    const refreshTrafficLights = () => {
      if (browserWindow.isDestroyed()) return;
      try {
        browserWindow.setWindowButtonVisibility(true);
        browserWindow.setTrafficLightPosition({ x: 16, y: 17 });
      } catch {}
    };
    browserWindow.on('minimize', refreshTrafficLights);
    browserWindow.on('restore', () => {
      refreshTrafficLights();
      setTimeout(refreshTrafficLights, 250);
    });
    browserWindow.on('show', refreshTrafficLights);
    browserWindow.on('focus', refreshTrafficLights);
  }

  browserWindow.on('resize', () => {
    emitToWindow(browserWindow, 'openchamber:window-resized');
    debounceWindowStatePersist(browserWindow, false);
  });
  browserWindow.on('move', () => {
    debounceWindowStatePersist(browserWindow, false);
  });
  const emitMaximizedState = () => {
    emitToWindow(browserWindow, 'openchamber:window-maximized-changed', {
      maximized: browserWindow.isMaximized(),
    });
  };
  browserWindow.on('maximize', emitMaximizedState);
  browserWindow.on('unmaximize', emitMaximizedState);
  browserWindow.on('minimize', (event) => {
    if (!shouldHideMainWindowToTray(browserWindow)) return;
    debounceWindowStatePersist(browserWindow, true);
    event.preventDefault();
    browserWindow.hide();
  });
  browserWindow.on('close', (event) => {
    if (!state.quitRequested && shouldHideMainWindowToTray(browserWindow)) {
      debounceWindowStatePersist(browserWindow, true);
      event.preventDefault();
      browserWindow.hide();
      return;
    }

    if (process.platform === 'darwin' && !state.quitRequested) {
      const url = browserWindow.webContents.getURL();
      if (url && (url.includes('?settings=') || url.includes('&settings='))) {
        event.preventDefault();
        dispatchDomEventToWindow(browserWindow, 'openchamber:menu-action', 'close');
        return;
      }

      const remainingVisible = BrowserWindow.getAllWindows().filter(
        (window) => !window.isDestroyed() && window.isVisible(),
      ).length;

      if (remainingVisible <= 1) {
        debounceWindowStatePersist(browserWindow, true);
        event.preventDefault();
        browserWindow.hide();
        return;
      }
    }

    debounceWindowStatePersist(browserWindow, true);
  });
  browserWindow.on('closed', async () => {
    state.focusedWindowIds.delete(browserWindow.id);
    if (state.mainWindow && browserWindow.id === state.mainWindow.id) {
      state.mainWindow = null;
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!state.installingUpdate) {
        await killSidecar();
      }
      if (process.platform !== 'darwin') {
        app.quit();
      }
    }
  });

  // Any navigation target that isn't our own UI (local server / configured
  // desktop hosts) should open in the user's default browser, not spawn
  // another Electron window loading arbitrary web content.
  const isAllowedNavigationUrl = (raw) => {
    try {
      const url = new URL(raw);
      if (url.protocol === 'about:' || url.protocol === 'devtools:') return true;
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      if (isLocalRuntimeUrl(url.toString())) return true;
      const hosts = readDesktopHostsConfig()?.hosts || [];
      for (const entry of hosts) {
        if (typeof entry?.url !== 'string') continue;
        try {
          if (new URL(entry.url).origin === url.origin) return true;
        } catch {
        }
      }
      return false;
    } catch {
      return false;
    }
  };

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigationUrl(url)) {
      return { action: 'allow' };
    }
    void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  browserWindow.webContents.on('will-navigate', (event, url) => {
    // The main window is an SPA whose in-app routing uses the History API and never
    // triggers will-navigate. Any top-level navigation here is a clicked <a> (often an
    // agent-generated malformed href) resolved against the loopback origin — allowing it
    // reloads the whole app. Only true reloads and reserved protocols may proceed.
    if (isSpaReloadNavigation(browserWindow.webContents.getURL(), url)) return;
    event.preventDefault();
    if (!isLocalRuntimeUrl(url)) {
      void shell.openExternal(url).catch(() => {});
    }
  });

  browserWindow.webContents.setZoomFactor(1);
  browserWindow.webContents.on('zoom-changed', () => {
    browserWindow.webContents.setZoomFactor(1);
  });

  browserWindow.webContents.on('dom-ready', () => {
    if (state.initScript) {
      void browserWindow.webContents.executeJavaScript(state.initScript).catch(() => {});
    }
  });

  browserWindow.webContents.on('did-finish-load', () => {
    browserWindow.webContents.setZoomFactor(1);
    if (state.mainWindow && browserWindow.id === state.mainWindow.id && pendingDeepLinks.length > 0) {
      const timer = setTimeout(flushPendingDeepLinks, 400);
      if (typeof timer?.unref === 'function') timer.unref();
    }
  });

  // Auto-reload on renderer crash. Upstream Electron 41 + macOS 26.5 has a V8
  // Oilpan GC bug that deterministically crashes the renderer every ~1-2h under
  // SSE/stream load (fontations_ffi / cppgc::CollectGarbageInYoungGenerationForTesting
  // + brk 0). Without this handler the user sees a black window with
  // "DevTools disconnected from the page" and must reload manually.
  // Crash-loop guard prevents infinite reload if a deeper problem exists.
  {
    let crashCountInWindow = 0;
    let crashWindowStart = 0;
    const CRASH_WINDOW_MS = 60_000;
    const CRASH_LOOP_THRESHOLD = 5;
    browserWindow.webContents.on('render-process-gone', (event, details) => {
      const now = Date.now();
      if (now - crashWindowStart > CRASH_WINDOW_MS) {
        crashCountInWindow = 0;
        crashWindowStart = now;
      }
      crashCountInWindow += 1;
      log.error('renderer-process-gone', {
        windowId: browserWindow.id,
        windowLabel: label,
        reason: details?.reason,
        exitCode: details?.exitCode,
        crashCountInWindow,
      });
      if (crashCountInWindow > CRASH_LOOP_THRESHOLD) {
        log.error('renderer crash loop detected, not reloading', { crashCountInWindow });
        return;
      }
      const reloadTimer = setTimeout(() => {
        if (!browserWindow.isDestroyed()) {
          browserWindow.webContents.reload();
        }
      }, 250);
      if (typeof reloadTimer?.unref === 'function') reloadTimer.unref();
    });
  }

  browserWindow.once('ready-to-show', () => {
    browserWindow.show();
    browserWindow.focus();
  });

  if (url) {
    void navigateWindow(browserWindow, url);
  } else {
    void navigateWindow(
      browserWindow,
      `data:text/html;charset=utf-8,${encodeURIComponent(buildStartupSplashHtml())}`,
      { allowAbort: true },
    );
  }

  return browserWindow;
};

const activateMainWindow = async (url, localOrigin, bootOutcome) => {
  state.localOrigin = localOrigin;
  state.bootOutcome = bootOutcome ?? null;
  state.initScript = buildInitScript(localOrigin, state.bootOutcome);

  const mainWindow = state.mainWindow;
  if (mainWindow && !mainWindow.isDestroyed()) {
    await navigateWindow(mainWindow, url, { allowAbort: true });
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  state.mainWindow = createBrowserWindow({
    label: 'main',
    restoreGeometry: true,
    url,
  });
  return state.mainWindow;
};

const openMainWindow = async () => {
  if (!state.localOrigin) {
    const { initialUrl, localOrigin, bootOutcome } = await resolveInitialUrl();
    return activateMainWindow(initialUrl, localOrigin, bootOutcome);
  }

  const config = readDesktopHostsConfig();
  const localUiUrl = state.sidecarUrl || state.localOrigin;
  const host = config.defaultHostId && config.defaultHostId !== LOCAL_HOST_ID
    ? config.hosts.find((entry) => entry.id === config.defaultHostId)
    : null;
  const targetUrl = host?.url && !state.unreachableHosts.has(host.url) ? host.url : localUiUrl;
  return activateMainWindow(targetUrl, state.localOrigin, state.bootOutcome);
};

const createAdditionalWindow = async (url) => {
  if (!state.localOrigin) {
    return null;
  }
  const browserWindow = createBrowserWindow({
    label: nextWindowLabel(),
    restoreGeometry: false,
    url,
  });
  return browserWindow;
};

const buildMiniChatUrl = ({ mode, sessionId, directory, projectId }) => {
  const base = state.localOrigin || state.sidecarUrl;
  if (!base) {
    throw new Error('Local UI is not available');
  }

  const url = new URL('/mini-chat.html', base);
  url.searchParams.set('mode', mode === 'session' ? 'session' : 'draft');
  if (sessionId) url.searchParams.set('sessionId', sessionId);
  if (directory) url.searchParams.set('directory', directory);
  if (projectId) url.searchParams.set('projectId', projectId);
  return url.toString();
};

const createMiniChatWindow = async ({ mode, sessionId = '', directory = '', projectId = '' } = {}) => {
  if (mode === 'session' && sessionId) {
    const existing = state.miniChatWindowsBySession.get(sessionId);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return existing;
    }
    state.miniChatWindowsBySession.delete(sessionId);
  }

  const desktopLocalOrigin = state.localOrigin || '';
  const desktopHome = os.homedir() || '';
  const desktopMacosMajor = String(macosMajorVersion());
  const trayEnabled = isTrayEnabledForPlatform();
  const browserWindow = new BrowserWindow({
    title: 'OpenChamber Mini Chat',
    width: MINI_CHAT_WINDOW_WIDTH,
    height: MINI_CHAT_WINDOW_HEIGHT,
    minWidth: MINI_CHAT_MIN_WINDOW_WIDTH,
    minHeight: MINI_CHAT_MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: '#151313',
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 17 } : undefined,
    webPreferences: {
      additionalArguments: [
        `--openchamber-local-origin=${desktopLocalOrigin}`,
        `--openchamber-home=${desktopHome}`,
        `--openchamber-macos-major=${desktopMacosMajor}`,
        `--openchamber-tray-enabled=${trayEnabled ? '1' : '0'}`,
        `--openchamber-platform=${process.platform}`,
      ],
      preload: resolvePreloadPath(),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      // sandbox must stay off
      sandbox: false,
    },
  });
  browserWindow.__ocLabel = nextWindowLabel();
  browserWindow.__ocMiniChat = true;
  browserWindow.__ocMiniChatSessionId = mode === 'session' ? sessionId : '';
  browserWindow.__ocPinned = false;

  if (mode === 'session' && sessionId) {
    state.miniChatWindowsBySession.set(sessionId, browserWindow);
  }

  browserWindow.on('closed', () => {
    if (browserWindow.__ocMiniChatSessionId) {
      const existing = state.miniChatWindowsBySession.get(browserWindow.__ocMiniChatSessionId);
      if (existing?.id === browserWindow.id) {
        state.miniChatWindowsBySession.delete(browserWindow.__ocMiniChatSessionId);
      }
    }
  });

  if (process.platform === 'darwin') {
    const refreshTrafficLights = () => {
      if (browserWindow.isDestroyed()) return;
      try {
        browserWindow.setWindowButtonVisibility(true);
        browserWindow.setTrafficLightPosition({ x: 16, y: 17 });
      } catch {}
    };
    browserWindow.on('show', refreshTrafficLights);
    browserWindow.on('focus', refreshTrafficLights);
  }

  browserWindow.once('ready-to-show', () => {
    browserWindow.show();
    browserWindow.focus();
  });

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  browserWindow.webContents.on('will-navigate', (event, url) => {
    // Same SPA discipline as the main window: only reloads and reserved protocols pass.
    if (isSpaReloadNavigation(browserWindow.webContents.getURL(), url)) return;
    event.preventDefault();
    if (!isLocalRuntimeUrl(url)) {
      void shell.openExternal(url).catch(() => {});
    }
  });
  browserWindow.webContents.on('dom-ready', () => {
    if (state.initScript) {
      void browserWindow.webContents.executeJavaScript(state.initScript).catch(() => {});
    }
  });

  await navigateWindow(browserWindow, buildMiniChatUrl({ mode, sessionId, directory, projectId }));
  return browserWindow;
};

const setMiniChatPinned = (browserWindow, pinned) => {
  if (!browserWindow || browserWindow.isDestroyed()) {
    throw new Error('Window is not available');
  }
  if (browserWindow.__ocMiniChat !== true) {
    throw new Error('Pinning is only available for Mini Chat windows');
  }
  const nextPinned = pinned === true;
  browserWindow.__ocPinned = nextPinned;
  if (nextPinned) {
    browserWindow.setAlwaysOnTop(true, 'floating');
  } else {
    browserWindow.setAlwaysOnTop(false);
    if (process.platform === 'darwin') {
      browserWindow.setVisibleOnAllWorkspaces(false);
    }
  }
  return { pinned: nextPinned };
};

const resolveInitialUrl = async () => {
  const hmrApiPort = process.env.OPENCHAMBER_HMR_API_PORT || '3901';
  const hmrApiOrigin = `http://127.0.0.1:${hmrApiPort}`;
  const localUrl = isDev && await waitForHealth(hmrApiOrigin, 5_000, 100)
    ? hmrApiOrigin
    : await spawnLocalServerOnce();

  const hmrUiPort = process.env.OPENCHAMBER_HMR_UI_PORT || '5173';
  const hmrUiOrigin = `http://127.0.0.1:${hmrUiPort}`;
  const localUiUrl = isDev && await waitForHealth(hmrUiOrigin, 8_000, 100)
    ? hmrUiOrigin
    : localUrl;

  state.sidecarUrl = localUrl;
  const localAvailable = Boolean(localUrl);
  // Only explicit remote-only hides local recovery actions; default-remote skip still allows "Use Local" + restart.
  const localOpenCodeAvailable = !isDesktopRemoteOnlyPolicy();

  const localOrigin = new URL(localUiUrl).origin;
  let initialUrl = localUiUrl;
  let remoteProbe = null;

  const envTarget = normalizeHostUrl(process.env.OPENCHAMBER_SERVER_URL || '');
  const config = readDesktopHostsConfig();
  const defaultHost = config.defaultHostId && config.defaultHostId !== LOCAL_HOST_ID
    ? config.hosts.find((entry) => entry.id === config.defaultHostId)
    : null;
  const defaultHostRelayCapable = Boolean(sanitizeHostRelayForStorage(defaultHost?.relay));
  if (envTarget) {
    initialUrl = envTarget;
  } else if (defaultHost) {
    initialUrl = normalizeHostUrl(defaultHost.apiUrl || defaultHost.url) || localUiUrl;
  }

  if (initialUrl !== localUiUrl) {
    remoteProbe = await probeHostWithTimeout(initialUrl, 2_000);
    if (shouldRetryDefaultHostProbe(remoteProbe.status, defaultHostRelayCapable)) {
      remoteProbe = await probeHostWithTimeout(initialUrl, 10_000);
    }
    if (shouldUseLocalSubstrateForDefaultHost(remoteProbe.status, defaultHostRelayCapable)) {
      initialUrl = localUiUrl;
    } else if (remoteProbe.status === 'unreachable' || remoteProbe.status === 'wrong-service') {
      state.unreachableHosts.add(initialUrl);
      // Keep UI on local origin for chooser/recovery; do not mutate remote catalogs.
      initialUrl = localUiUrl;
    }
  }

  const bootOutcome = computeBootOutcome({
    envTargetUrl: envTarget || null,
    probe: remoteProbe,
    config,
    localAvailable,
    localOpenCodeAvailable,
  });

  return { initialUrl, localOrigin, localUiUrl, bootOutcome };
};

const compareSemver = (left, right) => {
  const a = String(left || '').replace(/^v/, '').split('.').map((value) => Number.parseInt(value || '0', 10));
  const b = String(right || '').replace(/^v/, '').split('.').map((value) => Number.parseInt(value || '0', 10));
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const setupAutoUpdater = () => {
  if (!app.isPackaged) {
    return;
  }

  // electron-updater validates app.getVersion() as semver on first property
  // access. A bad packaged version must not take down the whole desktop shell.
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = APP_VERSION.includes('-');
    autoUpdater.fullChangelog = true;
    autoUpdater.disableWebInstaller = false;
    autoUpdater.logger = log;

    const feed = resolveUpdaterFeed({
      productionUrl: EMBEDDED_UPDATER_FEED_URL,
      testBuild: UPDATER_E2E_BUILD,
    });
    if (!feed) {
      state.updaterConfigured = false;
      log.info('[electron] updater disabled: no internal feed was embedded at build time');
      return;
    }
    const updaterChannel = feed.provider === 'github'
      ? resolveUpdaterChannel({ platform: process.platform, architecture: process.arch })
      : null;
    if (updaterChannel) {
      autoUpdater.channel = updaterChannel;
    }
    autoUpdater.setFeedURL(feed);
    state.updaterConfigured = true;
    log.info('[electron] updater feed configured', {
      provider: feed.provider,
      target: feed.provider === 'github' ? `${feed.owner}/${feed.repo}` : feed.url,
      channel: updaterChannel || 'latest',
    });

    autoUpdater.on('download-progress', (progress) => {
      const total = Number(progress.total || 0);
      const transferred = Number(progress.transferred || 0);
      setTaskbarProgress(total > 0 ? Math.max(0, Math.min(1, transferred / total)) : 0.01);
      emitToAllWindows('openchamber:update-progress', mapUpdaterProgressEvent({
        event: 'Progress',
        data: {
          chunkLength: Math.max(0, Math.round(progress.bytesPerSecond || 0)),
          downloaded: Math.round(progress.transferred || 0),
          total: Math.round(progress.total || 0),
        },
      }));
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info(`[electron] update-downloaded version=${info?.version || 'unknown'}`);
      setTaskbarProgress(-1);
      if (state.pendingUpdate) {
        state.pendingUpdate.downloaded = true;
      }
    });

    autoUpdater.on('error', (err) => {
      setTaskbarProgress(-1);
      log.error('[electron] autoUpdater error', err);
    });
  } catch (error) {
    state.updaterConfigured = false;
    log.error('[electron] autoUpdater setup failed; continuing without updates', {
      version: APP_VERSION,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const parseRelevantChangelogNotes = async (fromVersion, toVersion) => {
  try {
    const response = await fetch(CHANGELOG_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const changelog = await response.text();
    const sections = changelog.split(/^##\s+\[/m).slice(1);
    const relevant = [];
    for (const section of sections) {
      const version = section.split(']')[0];
      if (compareSemver(version, fromVersion) > 0 && compareSemver(version, toVersion) <= 0) {
        relevant.push(`## [${section}`.trim());
      }
    }
    return relevant.length > 0 ? relevant.join('\n\n') : null;
  } catch {
    return null;
  }
};

const buildInstalledAppsCachePath = () => path.join(path.dirname(settingsFilePath()), INSTALLED_APPS_CACHE_FILE);

// Async variants keep child-process waits off the Electron main event loop.
// Avoid broad filesystem searches here: macOS may treat probes under
// ~/Library as "other app data" access and repeatedly show a TCC prompt.
const pathExists = async (candidate) => {
  try {
    await fsp.access(candidate);
    return true;
  } catch {
    return false;
  }
};

const normalizeAppBundlePath = (candidate) => {
  const normalized = String(candidate || '').trim().replace(/\/+$/, '');
  return normalized.toLowerCase().endsWith('.app') ? normalized : null;
};

const isUserLibraryPath = (candidate) => {
  const home = String(os.homedir() || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!home) return false;
  const normalized = String(candidate || '').replace(/\\/g, '/');
  return normalized === `${home}/Library` || normalized.startsWith(`${home}/Library/`);
};

const resolveExistingAppBundlePath = async (candidate) => {
  const normalized = normalizeAppBundlePath(candidate);
  if (!normalized || isUserLibraryPath(normalized)) return null;
  return (await pathExists(normalized)) ? normalized : null;
};

const resolveAppBundlePathFromLaunchServices = async (appName) => {
  const lookupName = String(appName || '').trim().replace(/\.app$/i, '');
  if (!lookupName) return null;
  try {
    const script = `POSIX path of (path to application ${JSON.stringify(lookupName)})`;
    const { stdout } = await execFileAsync('osascript', ['-e', script], { encoding: 'utf8' });
    return resolveExistingAppBundlePath(stdout);
  } catch {
    return null;
  }
};

const resolveAppBundlePath = async (appName) => {
  if (process.platform !== 'darwin') return null;
  const bundleName = appName.endsWith('.app') ? appName : `${appName}.app`;
  const candidates = [
    `/Applications/${bundleName}`,
    `/System/Applications/${bundleName}`,
    `/System/Applications/Utilities/${bundleName}`,
    `/System/Library/CoreServices/${bundleName}`,
    path.join(os.homedir(), 'Applications', bundleName),
  ];
  for (const candidate of candidates) {
    const resolved = await resolveExistingAppBundlePath(candidate);
    if (resolved) return resolved;
  }
  return resolveAppBundlePathFromLaunchServices(appName);
};

const isAppBundleInstalled = async (appName) => Boolean(await resolveAppBundlePath(appName));

const iconToDataUrl = async (iconPath, appName) => {
  if (!iconPath || !(await pathExists(iconPath))) return null;
  const safeName = String(appName || 'app').replace(/[^a-z0-9]/gi, '_');
  const tempPath = path.join(os.tmpdir(), `openchamber-icon-${safeName}-${Date.now()}.png`);
  try {
    await execFileAsync('sips', ['-s', 'format', 'png', '-Z', '32', iconPath, '--out', tempPath], { stdio: 'ignore' });
  } catch {
    return null;
  }
  if (!(await pathExists(tempPath))) return null;
  try {
    const bytes = await fsp.readFile(tempPath);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
  }
};

const resolveAppIconPath = async (appPath) => {
  if (!appPath || !(await pathExists(appPath))) return null;
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  if (!(await pathExists(resourcesPath))) return null;
  let entries;
  try {
    entries = await fsp.readdir(resourcesPath);
  } catch {
    return null;
  }
  const icon = entries.find((entry) => entry.toLowerCase().endsWith('.icns'));
  return icon ? path.join(resourcesPath, icon) : null;
};

const buildInstalledApps = async (apps) => {
  const seen = new Set();
  const names = apps
    .map((raw) => String(raw || '').trim())
    .filter((raw) => raw && !seen.has(raw) && seen.add(raw));
  const results = [];
  for (const name of names) {
    const appPath = await resolveAppBundlePath(name);
    if (!appPath) continue;
    const iconDataUrl = await iconToDataUrl(await resolveAppIconPath(appPath), name);
    results.push({ name, iconDataUrl });
  }
  return results;
};

let linuxDesktopEntriesCache = { expiresAt: 0, entries: null };

const getLinuxDesktopEntries = async () => {
  const now = Date.now();
  if (linuxDesktopEntriesCache.entries && linuxDesktopEntriesCache.expiresAt > now) {
    return linuxDesktopEntriesCache.entries;
  }
  const entries = await readLinuxDesktopEntries();
  linuxDesktopEntriesCache = {
    entries,
    expiresAt: now + LINUX_DESKTOP_ENTRIES_CACHE_TTL_MS,
  };
  return entries;
};

const buildPlatformInstalledApps = async (apps) => {
  if (process.platform === 'linux') {
    return buildLinuxInstalledApps(apps);
  }
  return buildInstalledApps(apps);
};

const spawnDetachedLinux = (program, args) => new Promise((resolve, reject) => {
  const child = spawn(program, args, {
    detached: true,
    stdio: 'ignore',
  });
  let settled = false;
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    callback(value);
  };
  child.once('error', (error) => finish(reject, error));
  child.once('spawn', () => {
    child.unref();
    finish(resolve);
  });
});

const runLinuxSpecChain = async (specs, appName) => {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error(`Failed to open in ${appName}: no launch candidates`);
  }

  const failures = [];
  for (const spec of specs) {
    if (spec.kind === 'default') {
      if (spec.targetKind === 'file') {
        shell.showItemInFolder(spec.targetPath);
        return;
      }
      const errorMessage = await shell.openPath(spec.targetPath);
      if (!errorMessage) return;
      failures.push(`default opener: ${errorMessage}`);
      continue;
    }

    try {
      await spawnDetachedLinux(spec.program, spec.args);
      return;
    } catch (error) {
      failures.push(`${spec.program}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Failed to open in ${appName}: ${failures.join('; ')}`);
};

const parseSshConfigImports = () => {
  const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
  if (!fs.existsSync(sshConfigPath)) return [];
  const lines = fs.readFileSync(sshConfigPath, 'utf8').split(/\r?\n/);
  const results = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.toLowerCase().startsWith('host ')) {
      continue;
    }
    const hosts = trimmed.slice(5).trim().split(/\s+/).filter(Boolean);
    for (const host of hosts) {
      results.push({
        host,
        pattern: /[*?]/.test(host),
        source: sshConfigPath,
        sshCommand: `ssh ${host}`,
      });
    }
  }
  return results;
};

const readDesktopSshInstances = () => {
  const root = readSettingsRoot();
  return { instances: Array.isArray(root.desktopSshInstances) ? root.desktopSshInstances : [] };
};

const writeDesktopSshInstances = async (config) => {
  const nextInstances = Array.isArray(config?.instances) ? config.instances : [];
  await mutateSettingsRoot((root) => {
    root.desktopSshInstances = nextInstances;
  });
  return { instances: nextInstances };
};

const updateHostUrlForSshInstance = async (id, label, localUrl) => {
  const config = readDesktopHostsConfig();
  const nextHosts = config.hosts.filter((entry) => entry.id !== id);
  nextHosts.push({ id, label, url: localUrl });
  await writeDesktopHostsConfig({ hosts: nextHosts, defaultHostId: config.defaultHostId });
};

const JETBRAINS_APP_IDS = new Set([
  'pycharm',
  'intellij',
  'webstorm',
  'phpstorm',
  'rider',
  'rustrover',
  'android-studio',
]);

const CLI_BY_APP_ID = {
  vscode: 'code',
  cursor: 'cursor',
  vscodium: 'codium',
  windsurf: 'windsurf',
  zed: 'zed',
};

const buildOpenProjectSpecs = ({ projectPath, appId, appName }) => {
  if (appId === 'finder') {
    return [{ program: 'open', args: [projectPath] }];
  }

  if (appId === 'terminal' || appId === 'iterm2' || appId === 'ghostty') {
    return [{ program: 'open', args: ['-a', appName, projectPath] }];
  }
  if (appId === 'warp') {
    return [{ program: 'open', args: [`warp://action/new_tab?path=${encodeURIComponent(projectPath)}`] }];
  }

  const specs = [];

  const cli = CLI_BY_APP_ID[appId];
  if (cli) {
    specs.push({ program: cli, args: ['-n', projectPath] });
  }

  if (JETBRAINS_APP_IDS.has(appId)) {
    specs.push({ program: 'open', args: ['-na', appName, '--args', projectPath] });
  }

  specs.push({ program: 'open', args: ['-a', appName, projectPath] });
  return specs;
};

const buildOpenFileSpecs = ({ filePath, appId, appName }) => {
  if (appId === 'finder') {
    return [{ program: 'open', args: ['-R', filePath] }];
  }

  const parentDir = path.dirname(filePath);
  if (appId === 'terminal' || appId === 'iterm2' || appId === 'ghostty') {
    return [{ program: 'open', args: ['-a', appName, parentDir] }];
  }
  if (appId === 'warp') {
    return [{ program: 'open', args: [`warp://action/new_tab?path=${encodeURIComponent(parentDir)}`] }];
  }

  const specs = [];

  const cli = CLI_BY_APP_ID[appId];
  if (cli) {
    specs.push({ program: cli, args: [filePath] });
  }

  specs.push({ program: 'open', args: ['-a', appName, filePath] });
  return specs;
};

const runSpecChain = (specs, appName) => {
  const failures = [];
  for (const spec of specs) {
    const result = spawnSync(spec.program, spec.args, { stdio: 'ignore' });
    if (result.error) {
      failures.push(`${spec.program}: ${result.error.message}`);
      continue;
    }
    if (result.status === 0) {
      return;
    }
    failures.push(`${spec.program} exited ${result.status}`);
  }
  throw new Error(`Failed to open in ${appName}: ${failures.join('; ')}`);
};

const handleInvoke = async (browserWindow, command, args = {}) => {
  switch (command) {
    case 'desktop_start_window_drag':
      return null;

    case 'desktop_is_window_fullscreen':
      return Boolean(browserWindow?.isFullScreen());

    case 'desktop_set_window_title':
      if (browserWindow && typeof args.title === 'string') {
        browserWindow.setTitle(args.title);
      }
      return null;

    case 'desktop_set_dock_badge': {
      if (process.platform !== 'darwin' || !app.dock) {
        return { supported: false };
      }
      const count = Number.isFinite(args.count) ? Math.max(0, Math.trunc(args.count)) : 0;
      const label = count > 999 ? '999+' : (count > 0 ? String(count) : '');
      app.dock.setBadge(label);
      return { supported: true, count };
    }

    case 'desktop_tray_update': {
      if (state.trayController) {
        try {
          state.trayController.update(args || {});
        } catch (error) {
          log.warn('[electron] tray update failed', error);
        }
      }
      if (process.platform === 'darwin' && app.dock) {
        try {
          const rawCount = args && typeof args.dockBadgeCount === 'number' ? args.dockBadgeCount : 0;
          const badgeCount = Number.isFinite(rawCount) ? Math.max(0, Math.floor(rawCount)) : 0;
          const label = badgeCount > 999 ? '999+' : (badgeCount > 0 ? String(badgeCount) : '');
          app.dock.setBadge(label);
        } catch (error) {
          log.warn('[electron] dock badge update failed', error);
        }
      }
      return null;
    }

    case 'desktop_get_app_version':
      return APP_VERSION;

    case 'desktop_get_launch_at_login': {
      if (process.platform === 'linux') {
        return { supported: true, enabled: await readLinuxAutostartEnabled() };
      }
      if (process.platform !== 'darwin' && process.platform !== 'win32') return { supported: false, enabled: false };
      const settings = app.getLoginItemSettings(getLoginItemOptions());
      return { supported: true, enabled: settings.openAtLogin === true };
    }

    case 'desktop_set_launch_at_login': {
      if (process.platform === 'linux') {
        return setLinuxAutostartEnabled({
          enabled: args.enabled === true,
          appName: app.getName(),
          backgroundArg: BACKGROUND_START_ARG,
        });
      }
      if (process.platform !== 'darwin' && process.platform !== 'win32') return { supported: false, enabled: false };
      const enabled = args.enabled === true;
      const settingsArgs = {
        openAtLogin: enabled,
        ...(process.platform === 'darwin' ? { openAsHidden: enabled } : {}),
        ...(process.platform === 'win32' ? getLoginItemOptions() : { args: enabled ? [BACKGROUND_START_ARG] : [] }),
        ...(process.platform === 'win32' ? { enabled } : {}),
      };
      app.setLoginItemSettings(settingsArgs);
      const settings = app.getLoginItemSettings(getLoginItemOptions());
      return { supported: true, enabled: settings.openAtLogin === true };
    }

    case 'desktop_get_minimize_to_tray': {
      return readDesktopMinimizeToTrayStatus();
    }

    case 'desktop_set_minimize_to_tray': {
      if (process.platform !== 'win32' && process.platform !== 'linux') return { supported: false, enabled: false };
      const enabled = args.enabled === true;
      await mutateSettingsRoot((root) => {
        root.desktopMinimizeToTrayEnabled = enabled;
      });
      setupTray();
      return readDesktopMinimizeToTrayStatus();
    }

    case 'desktop_get_keep_awake':
      return readDesktopKeepAwakeStatus();

    case 'desktop_set_keep_awake': {
      const enabled = args.enabled === true;
      await mutateSettingsRoot((root) => {
        root.desktopKeepAwakeEnabled = enabled;
      });
      const active = setDesktopKeepAwakeActive(enabled);
      return { supported: true, enabled, active };
    }

    case 'desktop_dev_tunnel_open': {
      const port = Number.parseInt(String(args.port || ''), 10);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error('A valid remote port is required');
      }
      const target = resolveDevTunnelTarget(args.serverId);
      const key = `${target.id}|${port}`;
      const previous = devTunnelTargetByKey.get(key);
      const client = await getDevTunnelClient();
      if (previous && previous.baseUrl !== target.baseUrl) {
        client.close({ baseUrl: previous.baseUrl, port });
        devTunnelTargetByKey.delete(key);
      }
      const result = await client.open({
        baseUrl: target.baseUrl,
        port,
        headers: { Authorization: `Bearer ${target.clientToken}` },
      });
      devTunnelTargetByKey.set(key, { serverId: target.id, baseUrl: target.baseUrl, port });
      return {
        localPort: result.localPort,
        reused: result.reused,
        url: `http://127.0.0.1:${result.localPort}/`,
      };
    }

    case 'desktop_dev_tunnel_close': {
      const serverId = typeof args.serverId === 'string' ? args.serverId.trim() : '';
      const port = Number.parseInt(String(args.port || ''), 10);
      const key = `${serverId}|${port}`;
      const target = devTunnelTargetByKey.get(key);
      if (!target || !devTunnelClientPromise) return { closed: false };
      const client = await getDevTunnelClient();
      const closed = client.close({ baseUrl: target.baseUrl, port: target.port });
      devTunnelTargetByKey.delete(key);
      return { closed };
    }

    case 'desktop_browser_capture_page': {
      const wcId = Number.isFinite(args.webContentsId) ? Math.trunc(args.webContentsId) : null;
      if (wcId === null || wcId < 0) throw new Error('webContentsId is required');
      const wc = webContents.fromId(wcId);
      if (!wc || wc.isDestroyed()) throw new Error('WebContents not found');
      const image = await wc.capturePage();
      const buffer = image.toJPEG(82);
      return {
        mime: 'image/jpeg',
        base64: buffer.toString('base64'),
        width: image.getSize().width,
        height: image.getSize().height,
      };
    }

    case 'desktop_capture_page_rect': {
      if (!browserWindow || browserWindow.isDestroyed()) {
        throw new Error('Window is not available');
      }

      const bounds = browserWindow.getContentBounds();
      const x = Number.isFinite(args.x) ? Math.max(0, Math.floor(args.x)) : 0;
      const y = Number.isFinite(args.y) ? Math.max(0, Math.floor(args.y)) : 0;
      const width = Number.isFinite(args.width) ? Math.max(1, Math.floor(args.width)) : 1;
      const height = Number.isFinite(args.height) ? Math.max(1, Math.floor(args.height)) : 1;
      const clampedX = Math.min(x, Math.max(0, bounds.width - 1));
      const clampedY = Math.min(y, Math.max(0, bounds.height - 1));
      const rect = {
        x: clampedX,
        y: clampedY,
        width: Math.min(width, Math.max(1, bounds.width - clampedX)),
        height: Math.min(height, Math.max(1, bounds.height - clampedY)),
      };
      if (rect.width * rect.height > MAX_CAPTURE_PAGE_RECT_AREA) {
        throw new Error('Capture area is too large');
      }

      const image = await browserWindow.webContents.capturePage(rect);
      const buffer = image.toJPEG(82);
      return {
        mime: 'image/jpeg',
        base64: buffer.toString('base64'),
        width: image.getSize().width,
        height: image.getSize().height,
      };
    }

    case 'desktop_save_markdown_file': {
      const defaultPath = typeof args.defaultFileName === 'string' ? args.defaultFileName.trim() : '';
      if (!defaultPath) {
        throw new Error('Default file name is required');
      }

      const content = typeof args.content === 'string' ? args.content : '';
      const result = await dialog.showSaveDialog(browserWindow || undefined, {
        defaultPath,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled || !result.filePath) {
        return null;
      }

      await fsp.writeFile(result.filePath, content, 'utf8');
      return result.filePath;
    }

    case 'desktop_read_file': {
      const rawPath = typeof args.path === 'string' ? args.path : '';
      if (!rawPath) throw new Error('Path is required');
      // Defense in depth behind the IPC origin gate: even our own UI (or a
      // prompt-injected agent) can't read credential stores. Resolve the
      // path, require it under $HOME or tmpdir, and refuse known secret dirs
      // / dotfiles commonly holding keys.
      const filePath = path.resolve(rawPath);
      const home = os.homedir() || '';
      const tmp = os.tmpdir() || '';
      const underHome = home && (filePath === home || filePath.startsWith(home + path.sep));
      const underTmp = tmp && (filePath === tmp || filePath.startsWith(tmp + path.sep));
      if (!underHome && !underTmp) {
        throw new Error('File is outside the allowed workspace');
      }
      const DENIED_SEGMENTS = ['.ssh', '.aws', '.gnupg', '.gpg', '.config/gh', '.config/openchamber/credentials'];
      const relFromHome = underHome ? filePath.slice(home.length + 1) : '';
      const relNormalized = relFromHome.split(path.sep).join('/');
      if (DENIED_SEGMENTS.some((segment) => relNormalized === segment || relNormalized.startsWith(`${segment}/`))) {
        throw new Error('Access to this path is not allowed');
      }
      const basename = path.basename(filePath).toLowerCase();
      if (basename === '.env' || basename.startsWith('.env.') || basename.endsWith('.pem') || basename.endsWith('.key')) {
        throw new Error('Access to this path is not allowed');
      }
      const stats = await fsp.stat(filePath);
      if (stats.size > 50 * 1024 * 1024) {
        throw new Error('File is too large. Maximum size is 50MB.');
      }
      const bytes = await fsp.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = ({
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.json': 'application/json',
        '.js': 'text/javascript',
        '.ts': 'text/typescript',
        '.tsx': 'text/typescript-jsx',
        '.jsx': 'text/javascript-jsx',
        '.html': 'text/html',
        '.css': 'text/css',
        '.py': 'text/x-python',
      })[ext] || 'application/octet-stream';
      return { mime, base64: bytes.toString('base64'), size: bytes.length };
    }

    case 'desktop_notify':
      maybeShowNativeNotification(args);
      return null;

    case 'desktop_clear_cache':
      await session.defaultSession.clearStorageData();
      for (const browserWindow of BrowserWindow.getAllWindows()) {
        browserWindow.webContents.reload();
      }
      return null;

    case 'desktop_open_path': {
      const targetPath = typeof args.path === 'string' ? args.path.trim() : '';
      const appName = typeof args.app === 'string' ? args.app.trim() : '';
      if (!targetPath) throw new Error('Path is required');
      if (process.platform === 'darwin') {
        const openArgs = appName ? ['-a', appName, targetPath] : [targetPath];
        spawn('open', openArgs, { detached: true, stdio: 'ignore' }).unref();
        return null;
      }
      await shell.openPath(targetPath);
      return null;
    }

    case 'desktop_open_external_url': {
      const target = typeof args.url === 'string' ? args.url.trim() : '';
      if (!target) throw new Error('URL is required');

      const parsed = new URL(target);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only HTTP URLs can be opened externally');
      }

      await shell.openExternal(parsed.toString());
      return null;
    }

    case 'desktop_reveal_path': {
      const targetPath = typeof args.path === 'string' ? args.path.trim() : '';
      if (!targetPath) {
        throw new Error('Path is required');
      }

      const stats = await fsp.stat(targetPath).catch(() => null);
      if (stats?.isDirectory()) {
        await shell.openPath(targetPath);
        return null;
      }

      shell.showItemInFolder(targetPath);
      return null;
    }

    case 'desktop_open_in_app': {
      const projectPath = typeof args.projectPath === 'string' ? args.projectPath.trim() : '';
      const appId = typeof args.appId === 'string' ? args.appId.trim().toLowerCase() : '';
      const appName = typeof args.appName === 'string' ? args.appName.trim() : '';
      if (!projectPath || !appId || !appName) {
        throw new Error('Project path, app id, and app name are required');
      }
      await fsp.access(projectPath, fs.constants.R_OK);
      if (process.platform === 'linux') {
        const entries = await getLinuxDesktopEntries();
        await runLinuxSpecChain(buildLinuxOpenSpecs({
          targetPath: projectPath,
          appId,
          appName,
          targetKind: 'project',
          entries,
        }), appName);
        return null;
      }
      if (process.platform !== 'darwin') {
        throw new Error('desktop_open_in_app is only supported on macOS and Linux');
      }
      runSpecChain(buildOpenProjectSpecs({ projectPath, appId, appName }), appName);
      return null;
    }

    case 'desktop_open_file_in_app': {
      const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
      const appId = typeof args.appId === 'string' ? args.appId.trim().toLowerCase() : '';
      const appName = typeof args.appName === 'string' ? args.appName.trim() : '';
      if (!filePath || !appId || !appName) {
        throw new Error('File path, app id, and app name are required');
      }
      await fsp.access(filePath, fs.constants.R_OK);
      if (process.platform === 'linux') {
        const entries = await getLinuxDesktopEntries();
        await runLinuxSpecChain(buildLinuxOpenSpecs({
          targetPath: filePath,
          appId,
          appName,
          targetKind: 'file',
          entries,
        }), appName);
        return null;
      }
      if (process.platform !== 'darwin') {
        throw new Error('desktop_open_file_in_app is only supported on macOS and Linux');
      }
      runSpecChain(buildOpenFileSpecs({ filePath, appId, appName }), appName);
      return null;
    }

    case 'desktop_ssh_open_terminal': {
      const sshDestination = typeof args.sshDestination === 'string' ? args.sshDestination.trim() : '';
      const sshArgsRaw = Array.isArray(args.sshArgs) ? args.sshArgs : [];
      const sshArgs = sshArgsRaw.filter((a) => typeof a === 'string').map((a) => a.trim()).filter(Boolean);
      const remotePath = typeof args.remotePath === 'string' ? args.remotePath.trim() : '';
      const appName = typeof args.appName === 'string' ? args.appName.trim() : 'Terminal';
      if (!sshDestination || !remotePath) {
        throw new Error('SSH destination and remote path are required');
      }

      const sshCmd = ['ssh', ...sshArgs, sshDestination, '-t', `cd ${remotePath} && exec $SHELL`];
      const sshLine = sshCmd.map((a) => /[\s"']/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a).join(' ');

      let script;
      if (appName.toLowerCase() === 'iterm2' || appName.toLowerCase() === 'iterm') {
        script = `tell application "iTerm"
  activate
  tell current window
    create tab with default profile
    tell current session
      write text ${JSON.stringify(sshLine)}
    end tell
  end tell
end tell`;
      } else if (appName.toLowerCase() === 'warp') {
        // Warp has no AppleScript dictionary — use tab config + URI scheme
        const tcName = `openchamber-ssh-${Date.now()}`;
        const tcDir = path.join(os.homedir(), '.warp', 'tab_configs');
        const tcPath = path.join(tcDir, `${tcName}.toml`);
        const tcEscaped = sshLine.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const tomlContent = `name = "${tcName}"\n\n[[panes]]\nid = "main"\ntype = "terminal"\ndirectory = "~"\ncommands = ["${tcEscaped}"]\nis_focused = true\n`;
        fs.mkdirSync(tcDir, { recursive: true });
        fs.writeFileSync(tcPath, tomlContent, 'utf8');
        const openResult = spawnSync('open', [`warp://tab_config/${tcName}`], { stdio: 'ignore' });
        // Clean up the tab config after Warp has had time to read it
        setTimeout(() => { try { fs.unlinkSync(tcPath); } catch {} }, 5000);
        if (openResult.error) {
          throw new Error(`Failed to open Warp: ${openResult.error.message}`);
        }
        return null;
      } else {
        script = `tell application "${appName}"
  activate
  do script ${JSON.stringify(sshLine)}
end tell`;
      }

      const result = spawnSync('osascript', ['-e', script], { stdio: 'pipe', timeout: 10000 });
      if (result.error || result.status !== 0) {
        const stderr = result.stderr?.toString().trim() || '';
        throw new Error(`Failed to open SSH terminal: ${stderr || result.error?.message || 'unknown error'}`);
      }
      return null;
    }

    case 'desktop_filter_installed_apps': {
      if (process.platform === 'linux') {
        return filterLinuxInstalledApps(args.apps);
      }
      if (process.platform !== 'darwin') {
        throw new Error('desktop_filter_installed_apps is only supported on macOS and Linux');
      }
      if (!Array.isArray(args.apps)) return [];
      const results = await Promise.all(
        args.apps.map(async (appName) => (await isAppBundleInstalled(String(appName))) ? String(appName) : null)
      );
      return results.filter(Boolean);
    }

    case 'desktop_fetch_app_icons': {
      if (process.platform === 'linux') {
        return fetchLinuxAppIcons(Array.isArray(args.apps) ? args.apps : []);
      }
      if (process.platform !== 'darwin') {
        throw new Error('desktop_fetch_app_icons is only supported on macOS and Linux');
      }
      const names = Array.isArray(args.apps) ? args.apps : [];
      const results = [];
      for (const name of names) {
        const appPath = await resolveAppBundlePath(String(name));
        if (!appPath) continue;
        const dataUrl = await iconToDataUrl(await resolveAppIconPath(appPath), String(name));
        if (dataUrl) results.push({ app: String(name), dataUrl });
      }
      return results;
    }

    case 'desktop_get_installed_apps': {
      if (process.platform !== 'darwin' && process.platform !== 'linux') {
        return { apps: [], hasCache: false, isCacheStale: false, supported: false };
      }
      const cachePath = buildInstalledAppsCachePath();
      const now = Math.floor(Date.now() / 1000);
      let cache = null;
      try {
        cache = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      } catch {
      }
      const cachedApps = Array.isArray(cache?.apps) ? cache.apps : [];
      const hasCache = Boolean(cache);
      const isCacheStale = !cache || (now - Number(cache.updatedAt || 0)) > INSTALLED_APPS_CACHE_TTL_SECS;
      const refresh = async () => {
        const apps = await buildPlatformInstalledApps(Array.isArray(args.apps) ? args.apps : []);
        await fsp.mkdir(path.dirname(cachePath), { recursive: true });
        await fsp.writeFile(cachePath, JSON.stringify({ updatedAt: now, apps }, null, 2));
        emitToAllWindows('openchamber:installed-apps-updated', apps);
      };
      if (!hasCache || isCacheStale || args.force === true) {
        void refresh();
      }
      return { apps: cachedApps, hasCache, isCacheStale };
    }

    case 'desktop_hosts_get':
      return readDesktopHostsConfig();

    case 'desktop_hosts_set': {
      await writeDesktopHostsConfig(args.input || args.config || {});
      const updatedConfig = readDesktopHostsConfig();
      const envTarget = normalizeHostUrl(process.env.OPENCHAMBER_SERVER_URL || '');
      state.bootOutcome = computeBootOutcome({
        envTargetUrl: envTarget || null,
        probe: null,
        config: updatedConfig,
        localAvailable: Boolean(state.sidecarUrl || state.localOrigin),
        localOpenCodeAvailable: !isDesktopRemoteOnlyPolicy(),
      });
      state.initScript = buildInitScript(state.localOrigin, state.bootOutcome);
      log.info('[electron] hosts config updated, recomputed bootOutcome', state.bootOutcome);
      return null;
    }

    case 'desktop_local_client_token_get':
      return readDesktopLocalClientToken();

    case 'desktop_install_id_get':
      return getOrCreateDesktopInstallId();

    case 'desktop_host_probe':
      return probeHostWithTimeout(
        String(args.url || ''),
        2_000,
        String(args.clientToken || ''),
        args.requestHeaders || {},
        String(args.expectedServerId || ''),
      );

    case 'desktop_remote_password_login': {
      if (!browserWindow || browserWindow.isDestroyed()) {
        throw new Error('Window is not available');
      }
      return loginRemotePasswordAndPersistSession({
        url: args.url,
        password: args.password,
        trustDevice: args.trustDevice === true,
        cookieStore: browserWindow.webContents.session.cookies,
      });
    }

    case 'desktop_set_window_theme': {
      const mode = typeof args.themeMode === 'string' ? args.themeMode : '';
      const variant = typeof args.themeVariant === 'string' ? args.themeVariant : '';
      // Priority order: themeMode expresses the user's intent (including
      // "follow OS"). Variant is just the resolved variant at send time;
      // when mode === 'system' with variant === 'dark' (because OS is
      // currently dark), we must still pin themeSource to 'system' so
      // Chromium keeps reacting to OS theme changes.
      if (mode === 'system') {
        nativeTheme.themeSource = 'system';
      } else if (mode === 'light') {
        nativeTheme.themeSource = 'light';
      } else if (mode === 'dark') {
        nativeTheme.themeSource = 'dark';
      } else if (variant === 'light') {
        nativeTheme.themeSource = 'light';
      } else if (variant === 'dark') {
        nativeTheme.themeSource = 'dark';
      } else {
        nativeTheme.themeSource = 'system';
      }
      return null;
    }

    case 'desktop_check_for_updates': {
      assertUpdaterCapability({ packaged: app.isPackaged });
      if (!state.updaterConfigured) {
        throw new Error('Desktop updates are not configured for this internal build');
      }
      const currentVersion = APP_VERSION;
      const {
        available,
        updateInfo,
        updateResult,
        nextVersion,
        pendingUpdate,
      } = await checkForDesktopUpdate({
        autoUpdater,
        currentVersion,
        pendingUpdate: state.pendingUpdate,
        compareVersions: compareSemver,
      });
      const body =
        (typeof updateInfo?.releaseNotes === 'string' && updateInfo.releaseNotes.trim() ? updateInfo.releaseNotes : null) ||
        await parseRelevantChangelogNotes(currentVersion, nextVersion);
      state.pendingUpdate = pendingUpdate;
      return {
        available,
        currentVersion,
        version: available ? nextVersion : null,
        body: body || null,
        date:
          (typeof updateInfo?.releaseDate === 'string' && updateInfo.releaseDate) ||
          null,
      };
    }

    case 'desktop_download_and_install_update':
      assertUpdaterCapability({ packaged: app.isPackaged });
      if (!state.pendingUpdate) {
        throw new Error('No pending update');
      }
      setTaskbarProgress(0.01);
      emitToAllWindows('openchamber:update-progress', mapUpdaterProgressEvent({
        event: 'Started',
        data: {
          contentLength: null,
        },
      }));
      try {
        if (!state.pendingUpdate.electronUpdate) {
          throw new Error('Electron updater metadata is not available for this build');
        }
        if (!state.pendingUpdate.downloaded) {
          await new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
              autoUpdater.off('update-downloaded', onDownloaded);
              autoUpdater.off('error', onError);
            };
            const finish = (callback, value) => {
              if (settled) return;
              settled = true;
              cleanup();
              callback(value);
            };
            const onDownloaded = () => finish(resolve, null);
            const onError = (error) => finish(reject, error);
            autoUpdater.on('update-downloaded', onDownloaded);
            autoUpdater.on('error', onError);
            Promise.resolve(autoUpdater.downloadUpdate()).catch((error) => finish(reject, error));
          });
        }
        emitToAllWindows('openchamber:update-progress', mapUpdaterProgressEvent({
          event: 'Finished',
          data: {},
        }));
        return null;
      } finally {
        setTaskbarProgress(-1);
      }

    case 'desktop_restart': {
      const applyUpdate = Boolean(state.pendingUpdate?.downloaded && app.isPackaged);
      if (applyUpdate) {
        assertUpdaterCapability({ packaged: app.isPackaged });
      }
      log.info(`[electron] desktop_restart applyUpdate=${applyUpdate} packaged=${app.isPackaged}`);
      if (applyUpdate && process.platform === 'darwin' && typeof app.isInApplicationsFolder === 'function') {
        try {
          if (!app.isInApplicationsFolder()) {
            throw new Error('Desktop update requires OpenChamber.app to be installed in /Applications');
          }
        } catch (error) {
          log.warn('[electron] desktop_restart blocked', error);
          throw error;
        }
      }
      if (applyUpdate) {
        // Match the working updater pattern closely: only bypass the macOS
        // hide-on-close / quit-confirmation guards, leave the rest of the
        // updater-driven quit/install sequence alone.
        state.quitRequested = true;
        state.installingUpdate = true;
        state.quitConfirmationPending = false;
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          try {
            debounceWindowStatePersist(state.mainWindow, true);
          } catch {
          }
        }
      }
      // Defer so the IPC reply flushes before the app starts shutting down.
      // Without this, quitAndInstall() can race with the renderer's pending
      // invoke and the restart appears to do nothing from the UI side.
      setImmediate(() => {
        try {
          if (applyUpdate) {
            autoUpdater.quitAndInstall();
          } else {
            app.relaunch();
            app.exit(0);
          }
        } catch (err) {
          log.error('[electron] desktop_restart failed', err);
        }
      });
      return null;
    }

    case 'desktop_get_lan_address':
      return await detectLanIPv4Address();

    case 'desktop_new_window': {
      const config = readDesktopHostsConfig();
      const localUiUrl = state.sidecarUrl || state.localOrigin;
      let targetUrl = localUiUrl;
      if (config.defaultHostId && config.defaultHostId !== LOCAL_HOST_ID) {
        const host = config.hosts.find((entry) => entry.id === config.defaultHostId);
        if (host?.url && !state.unreachableHosts.has(host.url)) {
          targetUrl = host.url;
        }
      }
      await createAdditionalWindow(targetUrl);
      return null;
    }

    case 'desktop_new_window_at_url': {
      const targetUrl = normalizeHostUrl(String(args.url || ''));
      if (!targetUrl) {
        throw new Error('Invalid URL');
      }
      await createAdditionalWindow(targetUrl);
      return null;
    }

    case 'desktop_open_session_mini_chat_window': {
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
      if (!sessionId) throw new Error('Session id is required');
      const directory = typeof args.directory === 'string' ? args.directory.trim() : '';
      await createMiniChatWindow({ mode: 'session', sessionId, directory });
      return null;
    }

    case 'desktop_open_draft_mini_chat_window': {
      const directory = typeof args.directory === 'string' ? args.directory.trim() : '';
      const projectId = typeof args.projectId === 'string' ? args.projectId.trim() : '';
      await createMiniChatWindow({ mode: 'draft', directory, projectId });
      return null;
    }

    case 'desktop_set_window_pinned':
      return setMiniChatPinned(browserWindow, args.pinned === true);

    case 'desktop_get_window_pinned':
      return { pinned: Boolean(browserWindow?.__ocPinned) };

    case 'desktop_focus_main_window':
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        if (state.mainWindow.isMinimized()) state.mainWindow.restore();
        state.mainWindow.show();
        state.mainWindow.focus();
        const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
        const directory = typeof args.directory === 'string' ? args.directory.trim() : '';
        const mode = typeof args.mode === 'string' ? args.mode.trim() : '';
        if (sessionId) {
          emitToWindow(state.mainWindow, 'openchamber:open-session', { sessionId, directory });
        } else if (mode === 'draft') {
          const projectId = typeof args.projectId === 'string' ? args.projectId.trim() : '';
          emitToWindow(state.mainWindow, 'openchamber:open-draft-session', { directory, projectId });
        }
        return { focused: true };
      }
      return { focused: false };

    case 'desktop_close_current_window':
      if (browserWindow && !browserWindow.isDestroyed()) {
        browserWindow.close();
      }
      return null;

    case 'desktop_minimize_current_window':
      if (browserWindow && !browserWindow.isDestroyed()) {
        browserWindow.minimize();
      }
      return null;

    case 'desktop_toggle_current_window_maximized':
      if (browserWindow && !browserWindow.isDestroyed()) {
        if (browserWindow.isMaximized()) {
          browserWindow.unmaximize();
        } else {
          browserWindow.maximize();
        }
        return { maximized: browserWindow.isMaximized() };
      }
      return { maximized: false };

    case 'desktop_get_current_window_state':
      return {
        maximized: Boolean(
          browserWindow
          && !browserWindow.isDestroyed()
          && browserWindow.isMaximized()
        ),
      };

    case 'desktop_show_app_menu': {
      if (!browserWindow || browserWindow.isDestroyed()) {
        return null;
      }
      const menu = Menu.getApplicationMenu() || buildAutoHiddenMenu();
      const x = Number.isFinite(Number(args.x)) ? Math.max(0, Math.round(Number(args.x))) : undefined;
      const y = Number.isFinite(Number(args.y)) ? Math.max(0, Math.round(Number(args.y))) : undefined;
      menu.popup({ window: browserWindow, x, y });
      return null;
    }

    case 'desktop_ssh_instances_get':
      return sshManager.readInstances();

    case 'desktop_ssh_instances_set':
      await sshManager.setInstances(args.config || {});
      await state.serverHandle?.remoteInstances?.refreshCache?.();
      return null;

    case 'desktop_ssh_import_hosts':
      return await sshManager.importHosts();

    case 'desktop_ssh_connect': {
      const id = String(args.id || '').trim();
      await sshManager.connect(id);
      return null;
    }

    case 'desktop_ssh_disconnect': {
      const id = String(args.id || '').trim();
      await closeDevTunnelsForServer(id);
      await sshManager.disconnect(id);
      state.serverHandle?.remoteInstances?.setHealthStatus?.(id, {
        healthy: false,
        latencyMs: 0,
        error: 'Disconnected by user',
      });
      return null;
    }

    case 'desktop_ssh_status': {
      const id = String(args.id || '').trim();
      return await sshManager.statusesWithDefaults(id || undefined);
    }

    case 'desktop_ssh_logs':
      return sshManager.logsForInstance(String(args.id || '').trim(), Number(args.limit) || 200);

    case 'desktop_ssh_logs_clear':
      sshManager.clearLogsForInstance(String(args.id || '').trim());
      return null;

    default:
      throw new Error(`Unknown desktop command: ${command}`);
  }
};

const buildMacMenu = () => {
  const dispatchAction = (action) => dispatchMenuAction(action);
  const handleCopyAction = () => {
    BrowserWindow.getFocusedWindow()?.webContents.copy();
    dispatchAction('copy');
  };

  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { label: 'About OpenChamber', click: () => dispatchAction('about') },
        {
          label: 'Check for Updates',
          click: () => dispatchCheckForUpdates(),
        },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'Cmd+,', click: () => dispatchAction('settings') },
        { label: 'Reload Webview', click: () => reloadMenuTargetWindow() },
        { label: 'Restart', click: () => relaunchFromMenu() },
        { label: 'Command Palette', accelerator: 'Cmd+P', click: () => dispatchAction('command-palette') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'Cmd+Shift+Alt+N', click: () => void handleInvoke(null, 'desktop_new_window') },
        { type: 'separator' },
        { label: 'New Session', accelerator: 'Cmd+N', click: () => dispatchAction('new-session') },
        { label: 'New Worktree', accelerator: 'Cmd+Shift+N', click: () => dispatchAction('new-worktree-session') },
        { type: 'separator' },
        { label: 'Add Workspace', click: () => dispatchAction('change-workspace') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { label: 'Copy', accelerator: 'Cmd+C', click: () => handleCopyAction() },
        { label: 'Add Selection to Chat', accelerator: 'Cmd+L', registerAccelerator: false, click: () => dispatchAddSelectionToChat() },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Terminal Dock', accelerator: 'Cmd+J', click: () => dispatchAction('toggle-terminal') },
        { label: 'Toggle Terminal Expanded', accelerator: 'Cmd+Shift+J', click: () => dispatchAction('toggle-terminal-expanded') },
        { type: 'separator' },
        { label: 'Light Theme', click: () => dispatchAction('theme-light') },
        { label: 'Dark Theme', click: () => dispatchAction('theme-dark') },
        { label: 'System Theme', click: () => dispatchAction('theme-system') },
        { type: 'separator' },
        { label: 'Add Selection to Chat', accelerator: 'Cmd+L', registerAccelerator: false, click: () => dispatchAddSelectionToChat() },
        { label: 'Toggle Session Sidebar', accelerator: 'Cmd+Alt+L', click: () => dispatchAction('toggle-sidebar') },
        { label: 'Toggle Memory Debug', accelerator: 'Cmd+Shift+D', click: () => dispatchAction('toggle-memory-debug') },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: 'Cmd+Option+I', click: () => { BrowserWindow.getFocusedWindow()?.webContents.openDevTools(); } },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'Cmd+.', click: () => dispatchAction('help-dialog') },
        { label: 'Show Diagnostics', accelerator: 'Cmd+Shift+L', click: () => dispatchAction('download-logs') },
        { label: 'Toggle Developer Tools', accelerator: 'Cmd+Alt+I', click: () => openDevToolsForMenuTarget() },
        { type: 'separator' },
        { label: 'Clear Cache', click: () => void handleInvoke(null, 'desktop_clear_cache') },
        { type: 'separator' },
        { label: 'Report a Bug', click: () => shell.openExternal(GITHUB_BUG_REPORT_URL) },
        { label: 'Request a Feature', click: () => shell.openExternal(GITHUB_FEATURE_REQUEST_URL) },
        { type: 'separator' },
        { label: 'Join Discord', click: () => shell.openExternal(DISCORD_INVITE_URL) },
      ],
    },
  ]);
};

const buildAutoHiddenMenu = () => {
  const dispatchAction = (action) => dispatchMenuAction(action);
  const handleCopyAction = () => {
    BrowserWindow.getFocusedWindow()?.webContents.copy();
    dispatchAction('copy');
  };

  return Menu.buildFromTemplate([
    {
      label: 'OpenChamber',
      submenu: [
        { label: 'About OpenChamber', click: () => dispatchAction('about') },
        { label: 'Check for Updates', click: () => dispatchCheckForUpdates() },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'Ctrl+,', click: () => dispatchAction('settings') },
        { label: 'Reload Webview', click: () => reloadMenuTargetWindow() },
        { label: 'Restart', click: () => relaunchFromMenu() },
        { label: 'Command Palette', accelerator: 'Ctrl+P', click: () => dispatchAction('command-palette') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'Ctrl+Shift+Alt+N', click: () => void handleInvoke(null, 'desktop_new_window') },
        { type: 'separator' },
        { label: 'New Session', accelerator: 'Ctrl+N', click: () => dispatchAction('new-session') },
        { label: 'New Worktree', accelerator: 'Ctrl+Shift+N', click: () => dispatchAction('new-worktree-session') },
        { type: 'separator' },
        { label: 'Add Workspace', click: () => dispatchAction('change-workspace') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { label: 'Copy', accelerator: 'Ctrl+C', click: () => handleCopyAction() },
        { label: 'Add Selection to Chat', accelerator: 'Ctrl+L', registerAccelerator: false, click: () => dispatchAddSelectionToChat() },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { label: 'Toggle Developer Tools', accelerator: 'Ctrl+Alt+I', click: () => openDevToolsForMenuTarget() },
        { type: 'separator' },
        { label: 'Toggle Terminal Dock', accelerator: 'Ctrl+J', click: () => dispatchAction('toggle-terminal') },
        { label: 'Toggle Terminal Expanded', accelerator: 'Ctrl+Shift+J', click: () => dispatchAction('toggle-terminal-expanded') },
        { type: 'separator' },
        { label: 'Light Theme', click: () => dispatchAction('theme-light') },
        { label: 'Dark Theme', click: () => dispatchAction('theme-dark') },
        { label: 'System Theme', click: () => dispatchAction('theme-system') },
        { type: 'separator' },
        { label: 'Add Selection to Chat', accelerator: 'Ctrl+L', registerAccelerator: false, click: () => dispatchAddSelectionToChat() },
        { label: 'Toggle Session Sidebar', accelerator: 'Ctrl+Alt+L', click: () => dispatchAction('toggle-sidebar') },
        { label: 'Toggle Memory Debug', accelerator: 'Ctrl+Shift+D', click: () => dispatchAction('toggle-memory-debug') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: 'Ctrl+[', click: () => dispatchAction('go-back') },
        { label: 'Forward', accelerator: 'Ctrl+]', click: () => dispatchAction('go-forward') },
        { type: 'separator' },
        { label: 'Previous Session', accelerator: 'Alt+Up', click: () => dispatchAction('previous-session') },
        { label: 'Next Session', accelerator: 'Alt+Down', click: () => dispatchAction('next-session') },
        { type: 'separator' },
        { label: 'Previous Project', accelerator: 'Ctrl+Alt+Up', click: () => dispatchAction('previous-project') },
        { label: 'Next Project', accelerator: 'Ctrl+Alt+Down', click: () => dispatchAction('next-project') },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'Ctrl+.', click: () => dispatchAction('help-dialog') },
        { label: 'Show Diagnostics', accelerator: 'Ctrl+Shift+L', click: () => dispatchAction('download-logs') },
        { type: 'separator' },
        { label: 'Clear Cache', click: () => void handleInvoke(null, 'desktop_clear_cache') },
        { type: 'separator' },
        { label: 'Report a Bug', click: () => shell.openExternal(GITHUB_BUG_REPORT_URL) },
        { label: 'Request a Feature', click: () => shell.openExternal(GITHUB_FEATURE_REQUEST_URL) },
        { type: 'separator' },
        { label: 'Join Discord', click: () => shell.openExternal(DISCORD_INVITE_URL) },
      ],
    },
  ]);
};

contextMenu({
  showInspectElement: isDev,
  showSaveImageAs: true,
  showCopyImage: true,
  showCopyLink: true,
});

// All desktop_* IPC and dialog:open run with full Electron main privileges
// (fs access, shell.openPath, spawn, app.relaunch, …). The preload shim is
// injected into every webContents in the window, including remote hosts the
// user switches to via DesktopHostSwitcher. Without a gate, a malicious
// remote page could read arbitrary local files, open arbitrary apps, etc.
//
// Strategy: commands fall into two buckets by capability, not by origin.
// Window/host-switcher operations (probe a URL, open a new window, set
// title, read the hosts list) are safe for any renderer. Filesystem,
// shell.openPath, installed-app scans, app relaunch, and file dialogs
// are gated to local senders — even the user's own remote UI shouldn't
// need them, and a compromised remote can't use them either.
const isLocalSender = (webContents) => {
  try {
    const raw = typeof webContents?.getURL === 'function' ? webContents.getURL() : '';
    if (!raw) return false;
    if (raw.startsWith('file://') || raw === 'about:blank') return true;
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (isLocalRuntimeUrl(url.toString())) return true;
    return false;
  } catch {
    return false;
  }
};

const COMMANDS_SAFE_FOR_REMOTE = new Set([
  'desktop_hosts_get',
  'desktop_host_probe',
  'desktop_local_client_token_get',
  'desktop_install_id_get',
  'desktop_remote_password_login',
  'desktop_new_window',
  'desktop_new_window_at_url',
  'desktop_set_window_title',
  'desktop_set_window_theme',
  'desktop_is_window_fullscreen',
  'desktop_start_window_drag',
  'desktop_minimize_current_window',
  'desktop_toggle_current_window_maximized',
  'desktop_close_current_window',
  'desktop_get_current_window_state',
  'desktop_get_app_version',
  'desktop_get_lan_address',
  'desktop_capture_page_rect',
]);

ipcMain.handle('openchamber:invoke', async (event, command, args) => {
  const localSender = isLocalSender(event.sender);
  if (!localSender && !COMMANDS_SAFE_FOR_REMOTE.has(command)) {
    log.warn(`[ipc] rejected ${command} from non-local origin: ${event.sender?.getURL?.() || '(unknown)'}`);
    throw new Error('IPC not available for this origin');
  }
  if (!localSender && command === 'desktop_remote_password_login' && !hasSameHttpOrigin(event.sender?.getURL?.(), args?.url)) {
    log.warn(`[ipc] rejected cross-origin remote password login from: ${event.sender?.getURL?.() || '(unknown)'}`);
    throw new Error('Remote password login target must match the current origin');
  }
  const browserWindow = BrowserWindow.fromWebContents(event.sender);
  return handleInvoke(browserWindow, command, args);
});

ipcMain.handle('openchamber:dialog:open', async (event, options) => {
  // Native file dialogs expose absolute local paths; never grant to remote.
  if (!isLocalSender(event.sender)) {
    log.warn(`[ipc] rejected dialog:open from non-local origin: ${event.sender?.getURL?.() || '(unknown)'}`);
    throw new Error('IPC not available for this origin');
  }
  const browserWindow = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(browserWindow || undefined, {
    title: typeof options?.title === 'string' ? options.title : undefined,
    defaultPath: typeof options?.defaultPath === 'string' && options.defaultPath.trim().length > 0
      ? options.defaultPath.trim()
      : undefined,
    filters: Array.isArray(options?.filters)
      ? options.filters
          .filter((filter) => filter && typeof filter === 'object')
          .map((filter) => ({
            name: typeof filter.name === 'string' && filter.name.trim().length > 0 ? filter.name : 'Files',
            extensions: Array.isArray(filter.extensions)
              ? filter.extensions.filter((extension) => typeof extension === 'string' && extension.trim().length > 0)
              : [],
          }))
      : undefined,
    properties: [
      options?.directory ? 'openDirectory' : 'openFile',
      options?.multiple ? 'multiSelections' : null,
      'createDirectory',
    ].filter(Boolean),
  });
  if (result.canceled) return null;
  if (options?.multiple) return result.filePaths;
  return result.filePaths[0] || null;
});

app.on('window-all-closed', async () => {
  if (process.platform === 'darwin' && !state.quitRequested) {
    return;
  }

  if (!state.installingUpdate) {
    closeAllDevTunnels();
    await killSidecar();
    void sshManager.shutdownAll();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (state.quitConfirmed || state.installingUpdate || process.platform !== 'darwin') {
    state.quitRequested = true;
    return;
  }
  event.preventDefault();
  void requestQuitWithConfirmation();
});

app.on('second-instance', (_event, argv) => {
  const urls = Array.isArray(argv)
    ? argv.filter((arg) => typeof arg === 'string' && arg.startsWith(`${DEEP_LINK_PROTOCOL}://`))
    : [];
  if (urls.length > 0) handleDeepLinks(urls);
  if (BrowserWindow.getAllWindows().length > 0) {
    focusForegroundWindow();
  } else {
    void openMainWindow();
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLinks([url]);
  if (BrowserWindow.getAllWindows().length === 0) {
    void openMainWindow();
  }
});

app.on('activate', async () => {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  if (windows.length > 0) {
    const visibleWindow = windows.find((window) => window.isVisible());
    const targetWindow = visibleWindow || state.mainWindow || windows[0];
    if (targetWindow.isMinimized()) targetWindow.restore();
    targetWindow.show();
    targetWindow.focus();
    return;
  }

  await openMainWindow();
});

app.whenReady().then(async () => {
  const loginItemSettings = readLoginItemSettings();
  const isBackgroundStart = shouldStartInBackground(loginItemSettings);
  log.info('[electron] app starting', {
    version: APP_VERSION,
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    argv: process.argv,
    isBackgroundStart,
    loginItemSettings,
  });
  // Bypass system proxy for localhost/loopback so the Chromium renderer can
  // reach the embedded web server. process.env.NO_PROXY only affects Node.js
  // — without this, tools like Surge/Clash/mihomo intercept the renderer's
  // fetch to 127.0.0.1:<port> and every API request hangs.
  await session.defaultSession.setProxy({
    proxyBypassRules: 'localhost,127.0.0.1,::1,<local>',
  });
  hardenBrowserPanelSession();
  await clearDesktopWebCacheStorage();

  nativeTheme.themeSource = readThemeSource();
  setupAutoUpdater();

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(buildMacMenu());
  } else {
    Menu.setApplicationMenu(buildAutoHiddenMenu());
  }

  if ((process.platform === 'darwin' || process.platform === 'win32') && app.isPackaged) {
    const openAtLogin = loginItemSettings?.openAtLogin === true;
    app.setLoginItemSettings({
      openAtLogin,
      ...(process.platform === 'darwin' ? { openAsHidden: openAtLogin, args: openAtLogin ? [BACKGROUND_START_ARG] : [] } : {}),
      ...(process.platform === 'win32' ? { ...getLoginItemOptions(), enabled: openAtLogin } : {}),
    });
  }

  if (isBackgroundStart) {
    const { localOrigin, bootOutcome } = await resolveInitialUrl();
    state.localOrigin = localOrigin;
    state.bootOutcome = bootOutcome ?? null;
    state.initScript = buildInitScript(localOrigin, state.bootOutcome);
    setupTray();
    log.info('[electron] started in background without window');
    return;
  }

  state.mainWindow = createBrowserWindow({
    label: 'main',
    restoreGeometry: true,
    url: null,
  });

  const initial = extractInitialDeepLinks();
  if (initial.length > 0) handleDeepLinks(initial);

  const { initialUrl, localOrigin, bootOutcome } = await resolveInitialUrl();
  await activateMainWindow(initialUrl, localOrigin, bootOutcome);
  setupTray();

  // Auto-connect all configured SSH instances in parallel.
  try {
    const sshInstances = sshManager.readInstances();
    if (sshInstances.instances.length > 0) {
      log.info('[electron] auto-connecting SSH instances', { count: sshInstances.instances.length });
      for (const instance of sshInstances.instances) {
        sshManager.connect(instance.id).catch((err) => {
          log.warn('[electron] auto-connect SSH failed', { id: instance.id, error: String(err) });
        });
      }
    }
  } catch (err) {
    log.warn('[electron] SSH auto-connect setup failed:', err);
  }

  // Notify renderer on OS wake-from-sleep so the SSE event pipeline can
  // reconnect immediately instead of waiting for the heartbeat watchdog.
  powerMonitor.on('resume', () => {
    emitToAllWindows('openchamber:system-resume', { timestamp: Date.now() });
  });
}).catch((error) => {
  log.error('[electron] startup failed:', error);
  app.exit(1);
});
