import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const OVERLAY_DIR = resolve(homedir(), '.config', 'openchamber');
const OVERLAY_FILE = resolve(OVERLAY_DIR, 'opencode-overlay.json');

function resolvePluginSpec() {
  const here = dirname(fileURLToPath(import.meta.url));
  const monorepoRoot = resolve(here, '..', '..', '..', '..', '..');
  const pluginEntry = resolve(monorepoRoot, 'packages', 'plugin', 'src', 'index.ts');
  return pathToFileURL(pluginEntry).href;
}

export function prepareOpenChamberConfig() {
  const spec = resolvePluginSpec();
  const overlay = { plugin: [spec] };

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
