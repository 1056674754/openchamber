import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const OVERLAY_DIR = resolve(homedir(), '.config', 'openchamber');
const OVERLAY_FILE = resolve(OVERLAY_DIR, 'opencode-overlay.json');
const PLUGIN_INSTALL_DIR = resolve(OVERLAY_DIR, 'plugin');
const PLUGIN_ENTRY = resolve(PLUGIN_INSTALL_DIR, 'index.js');

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
      const overlay = { plugin: [pathToFileURL(PLUGIN_ENTRY).href] };
      mkdirSync(OVERLAY_DIR, { recursive: true });
      writeFileSync(OVERLAY_FILE, JSON.stringify(overlay, null, 2), 'utf8');
      return OVERLAY_FILE;
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

  const overlay = { plugin: [pathToFileURL(PLUGIN_ENTRY).href] };
  mkdirSync(OVERLAY_DIR, { recursive: true });
  writeFileSync(OVERLAY_FILE, JSON.stringify(overlay, null, 2), 'utf8');
  return OVERLAY_FILE;
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
