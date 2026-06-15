import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const OVERLAY_DIR = resolve(homedir(), '.config', 'openchamber');
const OVERLAY_FILE = resolve(OVERLAY_DIR, 'opencode-overlay.json');

function resolvePluginSpec() {
  const candidates = [];

  const envOverride = process.env.OPENCHAMBER_PLUGIN_PATH;
  if (envOverride) candidates.push(envOverride);

  const here = dirname(fileURLToPath(import.meta.url));
  candidates.push(resolve(here, '..', '..', '..', '..', '..', 'packages', 'plugin'));
  candidates.push(resolve(here, '..', '..', '..', '..', '..', '..', 'packages', 'plugin'));

  if (process.cwd().includes('openchamber')) {
    candidates.push(resolve(process.cwd(), 'packages', 'plugin'));
  }

  for (const c of candidates) {
    if (existsSync(resolve(c, 'package.json'))) return pathToFileURL(c).href;
  }

  console.warn('[openchamber] could not locate plugin package');
  return pathToFileURL(candidates[0]).href;
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
