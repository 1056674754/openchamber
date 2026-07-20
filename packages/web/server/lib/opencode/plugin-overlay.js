import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseJsonc } from 'jsonc-parser';

const OPENCHAMBER_PLUGIN_ID = '@openchamber/plugin';
const OPENCODE_CONFIG_DIR = resolve(homedir(), '.config', 'opencode');
const USER_CONFIG_CANDIDATES = [
  resolve(OPENCODE_CONFIG_DIR, 'config.json'),
  resolve(OPENCODE_CONFIG_DIR, 'opencode.json'),
  resolve(OPENCODE_CONFIG_DIR, 'opencode.jsonc'),
];

function readUserConfigPlugins() {
  const plugins = [];
  for (const configPath of USER_CONFIG_CANDIDATES) {
    if (!existsSync(configPath)) continue;
    try {
      const config = parseJsonc(readFileSync(configPath, 'utf8'), [], { allowTrailingComma: true });
      if (Array.isArray(config?.plugin)) {
        plugins.push(...config.plugin);
      }
    } catch (error) {
      console.warn('[openchamber] failed to read user plugin config:', configPath, error?.message || error);
    }
  }
  return plugins;
}

function pluginSpec(raw) {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
}

function isOpenChamberPluginSpec(spec, openChamberPlugin) {
  return spec === OPENCHAMBER_PLUGIN_ID
    || spec === openChamberPlugin
    || spec.includes('/packages/plugin/src/index.ts')
    || spec.includes('/openchamber/plugin/index.js')
    || spec.endsWith('/openchamber/opencode-notifier');
}

export function mergeOpenChamberPluginEntries(existingPlugins, openChamberPlugin) {
  const merged = [];
  const seen = new Set();

  for (const raw of existingPlugins) {
    const spec = pluginSpec(raw);
    if (!spec || isOpenChamberPluginSpec(spec, openChamberPlugin) || seen.has(spec)) continue;
    seen.add(spec);
    merged.push(raw);
  }

  merged.push(openChamberPlugin);
  return merged;
}

export function writeOpenChamberOverlay({ overlayDir, overlayFile, pluginEntry }) {
  const openChamberPlugin = pathToFileURL(pluginEntry).href;
  const overlay = {
    plugin: mergeOpenChamberPluginEntries(readUserConfigPlugins(), openChamberPlugin),
  };
  mkdirSync(overlayDir, { recursive: true });
  writeFileSync(overlayFile, JSON.stringify(overlay, null, 2), 'utf8');
  return overlayFile;
}
