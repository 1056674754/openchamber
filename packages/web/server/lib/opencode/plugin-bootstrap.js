import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeOpenChamberOverlay as writeOpenChamberOverlayFile, writeOpenChamberV2Overlay } from './plugin-overlay.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from './protocol-mode.js';

export function resolveOpenChamberPluginPaths(env = process.env, homeDirectory = homedir()) {
  const overlayDir = env.OPENCHAMBER_DATA_DIR
    ? resolve(env.OPENCHAMBER_DATA_DIR)
    : resolve(homeDirectory, '.config', 'openchamber');
  const pluginInstallDir = resolve(overlayDir, 'plugin');
  const openCodeConfigDir = env.OPENCODE_CONFIG_DIR
    ? resolve(env.OPENCODE_CONFIG_DIR)
    : resolve(homeDirectory, '.config', 'opencode');
  return {
    overlayDir,
    overlayFile: resolve(overlayDir, 'opencode-overlay.json'),
    pluginInstallDir,
    pluginEntry: resolve(overlayDir, 'opencode-notifier'),
    pluginStatusFile: resolve(pluginInstallDir, 'status.json'),
    openCodeConfigDir,
  };
}

const {
  overlayDir: OVERLAY_DIR,
  overlayFile: OVERLAY_FILE,
  pluginInstallDir: PLUGIN_INSTALL_DIR,
  pluginEntry: PLUGIN_ENTRY,
  pluginStatusFile: PLUGIN_STATUS_FILE,
  openCodeConfigDir: OPENCODE_CONFIG_DIR,
} = resolveOpenChamberPluginPaths();
const OPENCHAMBER_PLUGIN_ID = '@openchamber/plugin';
const V2_PLUGIN_DIRECTORY_NAME = 'openchamber-plugin';
const V2_PLUGIN_DIRECTORY = resolve(OVERLAY_DIR, V2_PLUGIN_DIRECTORY_NAME);
const V2_PLUGIN_DIST_ENTRY = resolve(V2_PLUGIN_DIRECTORY, 'dist', 'index.js');
const V2_PLUGIN_SERVER_FILE = resolve(V2_PLUGIN_DIRECTORY, 'server.js');
const V2_PLUGIN_PACKAGE_FILE = resolve(V2_PLUGIN_DIRECTORY, 'package.json');
const REQUIRED_TOOLS = ['describe_image', 'save_image_analysis'];
const OPTIONAL_TOOLS = ['publish_artifact'];
const EXPECTED_TOOLS = [...REQUIRED_TOOLS, ...OPTIONAL_TOOLS];
const REQUIRED_RUNTIME_FEATURES = ['liveSteer'];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function needsRebuild(sourcePath) {
  if (!existsSync(PLUGIN_ENTRY)) return true;
  const sourceMtime = statSync(sourcePath).mtimeMs;
  const entryMtime = statSync(PLUGIN_ENTRY).mtimeMs;
  return sourceMtime > entryMtime;
}

function findPluginSourceDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '..', '..', '..', '..', 'packages', 'plugin'),
    resolve(here, '..', '..', '..', '..', '..', '..', 'packages', 'plugin'),
  ];
  // Packaged runtimes deploy the workspace plugin beside the server inside the
  // same node_modules root; resolving it through the server's own module graph
  // is layout-independent (repo workspace link and runtime install both work).
  try {
    candidates.unshift(dirname(createRequire(import.meta.url).resolve('@openchamber/plugin/package.json')));
  } catch {
  }
  if (process.cwd().includes('openchamber')) {
    candidates.push(resolve(process.cwd(), 'packages', 'plugin'));
  }
  for (const c of candidates) {
    if (existsSync(resolve(c, 'package.json'))) return c;
  }
  return null;
}

function buildPlugin(sourceDir) {
  const entry = resolve(sourceDir, 'src', 'index.ts');
  mkdirSync(PLUGIN_INSTALL_DIR, { recursive: true });
  const result = spawnSync(bunBinaryForPluginBuild(), [
    'build', entry,
    '--outfile', PLUGIN_ENTRY,
    '--target', 'bun',
  ], { stdio: 'pipe', timeout: 30000 });
  return result.status === 0 && existsSync(PLUGIN_ENTRY);
}

function bunBinaryForPluginBuild() {
  return process.env.OPENCHAMBER_BUN_BINARY
    || process.env.OPENCHAMBER_BUN_ENGINE
    || process.env.BUN_BINARY
    || 'bun';
}

function writeIfChanged(filePath, content) {
  try {
    if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) return;
  } catch {
  }
  writeFileSync(filePath, content, 'utf8');
}

function fileMtime(filePath) {
  try {
    return existsSync(filePath) ? statSync(filePath).mtimeMs : 0;
  } catch {
    return 0;
  }
}

/**
 * Materialize the v2 plugin DIRECTORY inside the overlay: a self-contained
 * bundle of the workspace plugin plus the `server.js` entrypoint OpenCode 2's
 * Host.resolve looks for. Rebuilt from source when any source file is newer
 * than the bundle; a stale cached bundle is reused when the source is
 * unavailable (packaged runtime without the workspace source) or a rebuild
 * fails, mirroring the v1 notifier behavior.
 */
function prepareV2PluginDirectory() {
  const sourceDir = findPluginSourceDir();
  if (!sourceDir) {
    if (existsSync(V2_PLUGIN_DIST_ENTRY)) return V2_PLUGIN_DIRECTORY;
    console.warn('[openchamber] could not find plugin source and no cached v2 bundle');
    return null;
  }

  const latestSourceMtime = Math.max(
    getLatestSourceMtime(sourceDir),
    fileMtime(resolve(sourceDir, 'server.ts')),
    fileMtime(resolve(sourceDir, 'package.json')),
  );
  if (latestSourceMtime > fileMtime(V2_PLUGIN_DIST_ENTRY)) {
    mkdirSync(resolve(V2_PLUGIN_DIST_ENTRY, '..'), { recursive: true });
    const result = spawnSync(bunBinaryForPluginBuild(), [
      'build', resolve(sourceDir, 'src', 'index.ts'),
      '--outfile', V2_PLUGIN_DIST_ENTRY,
      '--target', 'bun',
    ], { stdio: 'pipe', timeout: 60000 });
    if (result.status !== 0 || !existsSync(V2_PLUGIN_DIST_ENTRY)) {
      const detail = result.stderr?.toString().trim().split('\n').slice(-3).join(' ');
      if (!existsSync(V2_PLUGIN_DIST_ENTRY)) {
        console.warn('[openchamber] v2 plugin bundle failed:', detail || `exit ${result.status}`);
        return null;
      }
      console.warn('[openchamber] v2 plugin rebuild failed, using stale bundle:', detail || `exit ${result.status}`);
    } else {
      console.log('[openchamber] v2 plugin bundled');
    }
  }

  // `server.*` at the package root is the entry OpenCode 2 resolves for a
  // configured directory plugin; the manifest stays minimal so module
  // resolution is not restricted by an exports map.
  writeIfChanged(V2_PLUGIN_SERVER_FILE, `export { default } from './dist/index.js';\n`);
  writeIfChanged(V2_PLUGIN_PACKAGE_FILE, `${JSON.stringify({
    name: OPENCHAMBER_PLUGIN_ID,
    private: true,
    type: 'module',
    main: './dist/index.js',
  }, null, 2)}\n`);
  return V2_PLUGIN_DIRECTORY;
}

export function readOpenChamberPluginOptions(settingsPath) {
  if (!existsSync(settingsPath)) return undefined;
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  if (settings?.optimizeSystemPrompt !== true) return undefined;
  return { optimizeSystemPrompt: true };
}

function writeOpenChamberOverlay() {
  let pluginOptions;
  try {
    const settingsPath = resolve(OVERLAY_DIR, 'settings.json');
    pluginOptions = readOpenChamberPluginOptions(settingsPath);
  } catch (error) {
    console.warn('[openchamber] failed to read system prompt optimization setting:', error?.message || error);
  }

  // v2 track: write the `plugins` key with the bundled plugin directory; the
  // v1 file entries OpenCode 2 would skip anyway are reported as degraded.
  // A missing v2 plugin directory degrades to the v1 overlay shape (explicitly
  // logged) rather than blocking startup.
  if (resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2') {
    const pluginDirectory = prepareV2PluginDirectory();
    if (pluginDirectory) {
      const { overlayFile, skippedFilePlugins } = writeOpenChamberV2Overlay({
        overlayDir: OVERLAY_DIR,
        overlayFile: OVERLAY_FILE,
        pluginDirectory,
        userConfigDir: OPENCODE_CONFIG_DIR,
        pluginOptions,
      });
      recordDegradedFilePlugins(skippedFilePlugins);
      return overlayFile;
    }
    console.warn('[openchamber] v2 plugin directory unavailable; overlay keeps the v1 shape');
  }

  // The v1 overlay loads the file-form plugins as-is; nothing is degraded.
  recordDegradedFilePlugins([]);
  return writeOpenChamberOverlayFile({
    overlayDir: OVERLAY_DIR,
    overlayFile: OVERLAY_FILE,
    pluginEntry: PLUGIN_ENTRY,
    userConfigDir: OPENCODE_CONFIG_DIR,
    pluginOptions,
  });
}

function getLatestSourceMtime(dir) {
  const srcDir = resolve(dir, 'src');
  if (!existsSync(srcDir)) return 0;
  let latest = 0;
  for (const file of readdirSync(srcDir, { withFileTypes: true })) {
    const fullPath = resolve(srcDir, file.name);
    if (file.isFile() && file.name.endsWith('.ts')) {
      latest = Math.max(latest, statSync(fullPath).mtimeMs);
    } else if (file.isDirectory()) {
      latest = Math.max(latest, getLatestSourceMtime(resolve(srcDir, file.name)) ?? 0);
    }
  }
  return latest;
}

export function prepareOpenChamberConfig() {
  // v2 track: the managed child loads the bundled plugin directory from the
  // overlay's `plugins` key; the v1 notifier bundle is not registered there,
  // so its build state must not block (or gate) the overlay write.
  if (resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2') {
    return writeOpenChamberOverlay();
  }

  const sourceDir = findPluginSourceDir();
  if (!sourceDir) {
    if (existsSync(PLUGIN_ENTRY)) {
      return writeOpenChamberOverlay();
    }
    console.warn('[openchamber] could not find plugin source and no cached build');
    return null;
  }

  const sourceMtime = getLatestSourceMtime(sourceDir);
  const entryMtime = existsSync(PLUGIN_ENTRY) ? statSync(PLUGIN_ENTRY).mtimeMs : 0;

  if (sourceMtime > entryMtime) {
    if (!buildPlugin(sourceDir)) {
      if (existsSync(PLUGIN_ENTRY)) {
        console.warn('[openchamber] rebuild failed, using stale build');
      } else {
        console.warn('[openchamber] plugin build failed');
        return null;
      }
    } else {
      console.log('[openchamber] plugin rebuilt');
    }
  }

  return writeOpenChamberOverlay();
}

export function cleanupOpenChamberPluginFromUserConfig() {
  const userConfigPath = resolve(OPENCODE_CONFIG_DIR, 'opencode.json');
  if (!existsSync(userConfigPath)) return;

  try {
    const raw = readFileSync(userConfigPath, 'utf8');
    const config = JSON.parse(raw);
    if (!Array.isArray(config.plugin)) return;

    const before = config.plugin.length;
    config.plugin = config.plugin.filter((p) => {
      if (typeof p === 'string') return p !== '@openchamber/plugin' && !p.includes('packages/plugin/src/index.ts');
      return true;
    });

    if (config.plugin.length !== before) {
      writeFileSync(userConfigPath, JSON.stringify(config, null, 2), 'utf8');
      console.log('[openchamber] removed stale plugin entry from user opencode.json');
    }
  } catch {
    // best-effort cleanup
  }
}

let _pluginStatus = { loaded: false, reason: 'not-checked' };
let _degradedFilePlugins = [];

const FILE_PLUGIN_DEGRADED_REASON = 'OpenCode 2 skips file-form configured plugins; the plugin needs its own directory form.';

function recordDegradedFilePlugins(specs) {
  _degradedFilePlugins = (Array.isArray(specs) ? specs : [])
    .filter((spec) => typeof spec === 'string' && spec.length > 0)
    .map((plugin) => ({ plugin, reason: FILE_PLUGIN_DEGRADED_REASON }));
}

export function getPluginStatus() {
  if (_degradedFilePlugins.length === 0) return _pluginStatus;
  return { ..._pluginStatus, degradedPlugins: _degradedFilePlugins };
}

export function normalizePluginRuntimeStatus(raw) {
  if (!isRecord(raw)) return null;
  const features = isRecord(raw.features) ? raw.features : null;
  if (!features) return null;
  const tools = Array.isArray(raw.tools) ? raw.tools.filter((tool) => typeof tool === 'string') : [];
  return {
    id: typeof raw.id === 'string' ? raw.id : null,
    version: typeof raw.version === 'number' ? raw.version : null,
    loadedAt: typeof raw.loadedAt === 'string' ? raw.loadedAt : null,
    pid: typeof raw.pid === 'number' ? raw.pid : null,
    features,
    tools,
  };
}

export function getMissingRequiredPluginRuntimeFeatures(status) {
  return REQUIRED_RUNTIME_FEATURES.filter((feature) => status?.features?.[feature] !== true);
}

export function getPluginRuntimeStatusFailureReason(status, expectedPid) {
  if (typeof expectedPid === 'number') {
    if (typeof status?.pid !== 'number') {
      return 'missing runtime pid';
    }
    if (status.pid !== expectedPid) {
      return `runtime pid mismatch: ${status.pid} !== ${expectedPid}`;
    }
  }

  const missingFeatures = getMissingRequiredPluginRuntimeFeatures(status);
  return missingFeatures.length > 0 ? `missing runtime features: ${missingFeatures.join(', ')}` : null;
}

function readPluginRuntimeStatus() {
  if (!existsSync(PLUGIN_STATUS_FILE)) return null;
  try {
    return normalizePluginRuntimeStatus(JSON.parse(readFileSync(PLUGIN_STATUS_FILE, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * v2-track probe (spine finale): OpenCode 2 has no `/experimental/tool/ids`
 * (the v1 probe path answers 404 there), so loaded state is read from the
 * server's own plugin inventory (`GET /api/plugin` → `{ data: [Plugin.Info] }`,
 * with a bare-array fallback). The v2 `setup` does not write the runtime
 * status file the v1 hooks plugin maintains — when a fresh, pid-matching
 * status exists it enriches the answer, but its absence is not a v2 failure.
 */
async function checkPluginLoadedV2(openCodeUrl, authHeaders, options, checkedAt) {
  try {
    const fetchPluginList = options.fetch ?? fetch;
    const response = await fetchPluginList(`${openCodeUrl}/api/plugin`, {
      headers: { Accept: 'application/json', ...authHeaders },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      _pluginStatus = { loaded: false, reason: `HTTP ${response.status}`, checkedAt, protocolMode: 'v2' };
      return _pluginStatus;
    }
    const body = await response.json();
    const listings = Array.isArray(body)
      ? body
      : (body && typeof body === 'object' && Array.isArray(body.data) ? body.data : null);
    if (!listings) {
      _pluginStatus = { loaded: false, reason: 'unexpected response', checkedAt, protocolMode: 'v2' };
      return _pluginStatus;
    }
    const listedIds = listings.map((item) => (item && typeof item.id === 'string' ? item.id : null)).filter(Boolean);
    const entry = listings.find((item) => item?.id === OPENCHAMBER_PLUGIN_ID);
    if (!entry) {
      console.warn('[openchamber] plugin not registered in the OpenCode 2 plugin inventory');
      _pluginStatus = { loaded: false, reason: 'plugin not registered', checkedAt, protocolMode: 'v2', plugins: listedIds };
      return _pluginStatus;
    }
    if (entry?.state?.status === 'failed') {
      _pluginStatus = {
        loaded: false,
        reason: `plugin failed: ${typeof entry.state.error === 'string' ? entry.state.error : 'unknown error'}`,
        checkedAt,
        protocolMode: 'v2',
        plugins: listedIds,
      };
      return _pluginStatus;
    }

    const readRuntimeStatus = options.readRuntimeStatus ?? readPluginRuntimeStatus;
    const runtimeStatus = readRuntimeStatus();
    const runtimeFailureReason = runtimeStatus
      ? getPluginRuntimeStatusFailureReason(runtimeStatus, options.expectedPid)
      : null;

    _pluginStatus = {
      loaded: true,
      checkedAt,
      protocolMode: 'v2',
      plugins: listedIds,
      ...(runtimeStatus && !runtimeFailureReason
        ? {
          features: { ...runtimeStatus.features },
          runtime: {
            loadedAt: runtimeStatus.loadedAt,
            pid: runtimeStatus.pid,
            version: runtimeStatus.version,
          },
        }
        : {}),
      ...(runtimeFailureReason ? { runtimeWarning: runtimeFailureReason } : {}),
    };
    return _pluginStatus;
  } catch (error) {
    _pluginStatus = { loaded: false, reason: error?.message || String(error), checkedAt, protocolMode: 'v2' };
    return _pluginStatus;
  }
}

export async function checkPluginLoaded(openCodeUrl, authHeaders, options = {}) {
  const checkedAt = new Date().toISOString();
  const protocolMode = options.mode ?? resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID);
  if (protocolMode === 'v2') {
    return checkPluginLoadedV2(openCodeUrl, authHeaders, options, checkedAt);
  }
  try {
    const fetchPluginTools = options.fetch ?? fetch;
    const response = await fetchPluginTools(`${openCodeUrl}/experimental/tool/ids`, {
      headers: { Accept: 'application/json', ...authHeaders },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      _pluginStatus = { loaded: false, reason: `HTTP ${response.status}`, checkedAt };
      return _pluginStatus;
    }
    const ids = await response.json();
    if (!Array.isArray(ids)) {
      _pluginStatus = { loaded: false, reason: 'unexpected response', checkedAt };
      return _pluginStatus;
    }
    const missingRequiredTools = REQUIRED_TOOLS.filter((tool) => !ids.includes(tool));
    const missingOptionalTools = OPTIONAL_TOOLS.filter((tool) => !ids.includes(tool));
    const availableTools = EXPECTED_TOOLS.filter((tool) => ids.includes(tool));
    if (missingRequiredTools.length > 0) {
      console.warn('[openchamber] plugin not fully loaded, missing tools:', missingRequiredTools);
      _pluginStatus = {
        loaded: false,
        reason: `missing tools: ${missingRequiredTools.join(', ')}`,
        tools: availableTools,
        missingTools: missingRequiredTools,
        checkedAt,
      };
      return _pluginStatus;
    }

    const readRuntimeStatus = options.readRuntimeStatus ?? readPluginRuntimeStatus;
    const runtimeStatus = readRuntimeStatus();
    if (!runtimeStatus) {
      _pluginStatus = {
        loaded: false,
        reason: 'missing runtime status',
        tools: availableTools,
        ...(missingOptionalTools.length > 0 ? { missingTools: missingOptionalTools } : {}),
        checkedAt,
      };
      return _pluginStatus;
    }
    if (runtimeStatus.id !== OPENCHAMBER_PLUGIN_ID) {
      _pluginStatus = {
        loaded: false,
        reason: 'unexpected plugin runtime status',
        tools: availableTools,
        ...(missingOptionalTools.length > 0 ? { missingTools: missingOptionalTools } : {}),
        checkedAt,
        runtime: runtimeStatus,
      };
      return _pluginStatus;
    }
    const runtimeFailureReason = getPluginRuntimeStatusFailureReason(runtimeStatus, options.expectedPid);
    if (runtimeFailureReason) {
      _pluginStatus = {
        loaded: false,
        reason: runtimeFailureReason,
        tools: availableTools,
        ...(missingOptionalTools.length > 0 ? { missingTools: missingOptionalTools } : {}),
        missingFeatures: getMissingRequiredPluginRuntimeFeatures(runtimeStatus),
        checkedAt,
        runtime: runtimeStatus,
      };
      return _pluginStatus;
    }

    _pluginStatus = {
      loaded: true,
      tools: availableTools,
      ...(missingOptionalTools.length > 0 ? { missingTools: missingOptionalTools } : {}),
      features: {
        ...runtimeStatus.features,
        artifactPublishing: missingOptionalTools.length === 0,
      },
      checkedAt,
      runtime: {
        loadedAt: runtimeStatus.loadedAt,
        pid: runtimeStatus.pid,
        version: runtimeStatus.version,
      },
    };
    return _pluginStatus;
  } catch (error) {
    _pluginStatus = { loaded: false, reason: error?.message || String(error), checkedAt };
    return _pluginStatus;
  }
}
