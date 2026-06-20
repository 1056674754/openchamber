import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeOpenChamberOverlay as writeOpenChamberOverlayFile } from './plugin-overlay.js';

const OVERLAY_DIR = resolve(homedir(), '.config', 'openchamber');
const OVERLAY_FILE = resolve(OVERLAY_DIR, 'opencode-overlay.json');
const PLUGIN_INSTALL_DIR = resolve(OVERLAY_DIR, 'plugin');
const PLUGIN_ENTRY = resolve(PLUGIN_INSTALL_DIR, 'index.js');
const PLUGIN_STATUS_FILE = resolve(PLUGIN_INSTALL_DIR, 'status.json');
const OPENCHAMBER_PLUGIN_ID = '@openchamber/plugin';
const REQUIRED_TOOLS = ['describe_image', 'save_image_analysis'];
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
  const result = spawnSync('bun', [
    'build', entry,
    '--outfile', PLUGIN_ENTRY,
    '--target', 'bun',
  ], { stdio: 'pipe', timeout: 30000 });
  return result.status === 0 && existsSync(PLUGIN_ENTRY);
}

function writeOpenChamberOverlay() {
  return writeOpenChamberOverlayFile({
    overlayDir: OVERLAY_DIR,
    overlayFile: OVERLAY_FILE,
    pluginEntry: PLUGIN_ENTRY,
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
  const userConfigPath = resolve(homedir(), '.config', 'opencode', 'opencode.json');
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

export function getPluginStatus() {
  return _pluginStatus;
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

export async function checkPluginLoaded(openCodeUrl, authHeaders, options = {}) {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(`${openCodeUrl}/experimental/tool/ids`, {
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
    const missing = REQUIRED_TOOLS.filter((t) => !ids.includes(t));
    if (missing.length > 0) {
      console.warn('[openchamber] plugin not fully loaded, missing tools:', missing);
      _pluginStatus = {
        loaded: false,
        reason: `missing tools: ${missing.join(', ')}`,
        missingTools: missing,
        checkedAt,
      };
      return _pluginStatus;
    }

    const runtimeStatus = readPluginRuntimeStatus();
    if (!runtimeStatus) {
      _pluginStatus = {
        loaded: false,
        reason: 'missing runtime status',
        tools: REQUIRED_TOOLS,
        checkedAt,
      };
      return _pluginStatus;
    }
    if (runtimeStatus.id !== OPENCHAMBER_PLUGIN_ID) {
      _pluginStatus = {
        loaded: false,
        reason: 'unexpected plugin runtime status',
        tools: REQUIRED_TOOLS,
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
        tools: REQUIRED_TOOLS,
        missingFeatures: getMissingRequiredPluginRuntimeFeatures(runtimeStatus),
        checkedAt,
        runtime: runtimeStatus,
      };
      return _pluginStatus;
    }

    _pluginStatus = {
      loaded: true,
      tools: REQUIRED_TOOLS,
      features: runtimeStatus.features,
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
