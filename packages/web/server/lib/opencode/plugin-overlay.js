import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseJsonc } from 'jsonc-parser';

const OPENCHAMBER_PLUGIN_ID = '@openchamber/plugin';

function readUserConfigPlugins(userConfigDir) {
  const plugins = [];
  const configCandidates = [
    resolve(userConfigDir, 'config.json'),
    resolve(userConfigDir, 'opencode.json'),
    resolve(userConfigDir, 'opencode.jsonc'),
  ];
  for (const configPath of configCandidates) {
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

export function mergeOpenChamberPluginEntries(existingPlugins, openChamberPlugin, pluginOptions) {
  const merged = [];
  const seen = new Set();

  for (const raw of existingPlugins) {
    const spec = pluginSpec(raw);
    if (!spec || isOpenChamberPluginSpec(spec, openChamberPlugin) || seen.has(spec)) continue;
    seen.add(spec);
    merged.push(raw);
  }

  merged.push(pluginOptions ? [openChamberPlugin, pluginOptions] : openChamberPlugin);
  return merged;
}

export function writeOpenChamberOverlay({
  overlayDir,
  overlayFile,
  pluginEntry,
  userConfigDir = process.env.OPENCODE_CONFIG_DIR
    ? resolve(process.env.OPENCODE_CONFIG_DIR)
    : resolve(homedir(), '.config', 'opencode'),
  pluginOptions,
}) {
  const openChamberPlugin = pathToFileURL(pluginEntry).href;
  const overlay = {
    plugin: mergeOpenChamberPluginEntries(
      readUserConfigPlugins(userConfigDir),
      openChamberPlugin,
      pluginOptions,
    ),
  };
  mkdirSync(overlayDir, { recursive: true });
  writeFileSync(overlayFile, JSON.stringify(overlay, null, 2), 'utf8');
  return overlayFile;
}

// ---------------------------------------------------------------------------
// v2-track overlay (spine finale)
//
// OpenCode 2 reads the v1 `plugin` key for compatibility, but a configured
// entry must resolve to a DIRECTORY (a `server.*` entrypoint at its root);
// file entries are dropped with a "configured plugin path must be a directory"
// warning. The v2 overlay therefore writes the `plugins` key with the bundled
// OpenChamber plugin directory plus the user's directory-form entries, and
// reports the file-form user plugins it had to skip so plugin-status can mark
// them degraded instead of failing silently.
// ---------------------------------------------------------------------------

const FILE_PLUGIN_PATTERN = /\.(?:[cm]?js|tsx?)$/;

function isOpenChamberV2PluginSpec(spec, openChamberPluginDirectory) {
  return spec === '@openchamber/plugin'
    || spec === openChamberPluginDirectory
    || spec.includes('/openchamber-plugin')
    || isOpenChamberPluginSpec(spec, '');
}

/**
 * Merge the user's plugin entries into the v2 `plugins` list.
 * File-form entries (which OpenCode 2 skips anyway) are left out and reported;
 * directory-form and npm-spec entries are preserved ahead of OpenChamber's own
 * directory, deduplicated like the v1 overlay does.
 */
export function mergeOpenChamberV2PluginEntries(existingPlugins, openChamberPluginDirectory, pluginOptions) {
  const entries = [];
  const skippedFilePlugins = [];
  const seen = new Set();

  for (const raw of existingPlugins) {
    const spec = pluginSpec(raw);
    if (!spec || isOpenChamberV2PluginSpec(spec, openChamberPluginDirectory) || seen.has(spec)) continue;
    if (spec.startsWith('file://') || (spec.startsWith('/') && FILE_PLUGIN_PATTERN.test(spec))) {
      skippedFilePlugins.push(spec);
      continue;
    }
    seen.add(spec);
    entries.push(raw);
  }

  entries.push(
    pluginOptions ? { package: openChamberPluginDirectory, options: pluginOptions } : openChamberPluginDirectory,
  );
  return { entries, skippedFilePlugins };
}

export function writeOpenChamberV2Overlay({
  overlayDir,
  overlayFile,
  pluginDirectory,
  userConfigDir = process.env.OPENCODE_CONFIG_DIR
    ? resolve(process.env.OPENCODE_CONFIG_DIR)
    : resolve(homedir(), '.config', 'opencode'),
  pluginOptions,
}) {
  const { entries, skippedFilePlugins } = mergeOpenChamberV2PluginEntries(
    readUserConfigPlugins(userConfigDir),
    pluginDirectory,
    pluginOptions,
  );
  mkdirSync(overlayDir, { recursive: true });
  writeFileSync(overlayFile, JSON.stringify({ plugins: entries }, null, 2), 'utf8');
  return { overlayFile, skippedFilePlugins };
}
