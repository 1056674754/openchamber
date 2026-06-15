import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const OVERLAY_DIR = resolve(homedir(), '.config', 'openchamber');
const OVERLAY_FILE = resolve(OVERLAY_DIR, 'opencode-overlay.json');
const PLUGIN_INSTALL_DIR = resolve(OVERLAY_DIR, 'plugin');
const PLUGIN_ENTRY = resolve(PLUGIN_INSTALL_DIR, 'index.js');

function findPluginSource() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '..', '..', '..', '..', 'packages', 'plugin', 'src', 'index.ts'),
    resolve(here, '..', '..', '..', '..', '..', '..', 'packages', 'plugin', 'src', 'index.ts'),
  ];
  if (process.cwd().includes('openchamber')) {
    candidates.push(resolve(process.cwd(), 'packages', 'plugin', 'src', 'index.ts'));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function buildPlugin(sourcePath) {
  mkdirSync(PLUGIN_INSTALL_DIR, { recursive: true });
  const result = spawnSync('bun', [
    'build',
    sourcePath,
    '--outfile', PLUGIN_ENTRY,
    '--target', 'bun',
  ], { stdio: 'pipe', timeout: 30000 });
  return existsSync(PLUGIN_ENTRY);
}

export function prepareOpenChamberConfig() {
  if (!existsSync(PLUGIN_ENTRY)) {
    const source = findPluginSource();
    if (!source) {
      console.warn('[openchamber] could not find plugin source to build');
      return null;
    }
    if (!buildPlugin(source)) {
      console.warn('[openchamber] plugin build failed');
      return null;
    }
    console.log('[openchamber] plugin built to', PLUGIN_ENTRY);
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
