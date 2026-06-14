import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPluginEntry, listPluginEntries } from './plugins.js';

const PLUGIN_SPEC = '@openchamber/plugin';

function resolvePluginSpec() {
  // Walk up from this file to find the monorepo root, then resolve the plugin.
  // plugin-bootstrap.js is at packages/web/server/lib/opencode/
  const here = dirname(fileURLToPath(import.meta.url));
  const monorepoRoot = resolve(here, '..', '..', '..', '..', '..');
  const pluginEntry = resolve(monorepoRoot, 'packages', 'plugin', 'src', 'index.ts');
  return pathToFileURL(pluginEntry).href;
}

export function ensureOpenChamberPluginRegistered(workingDirectory) {
  const spec = resolvePluginSpec();

  try {
    const existing = listPluginEntries(workingDirectory);
    const alreadyRegistered = existing.some(
      (entry) => entry.spec === spec || entry.spec === PLUGIN_SPEC,
    );
    if (alreadyRegistered) return false;

    createPluginEntry({ spec, scope: 'user' }, workingDirectory);
    console.log(`[openchamber] registered plugin: ${spec}`);
    return true;
  } catch (error) {
    if (error?.code === 'ENTRY_EXISTS') return false;
    console.error('[openchamber] failed to register plugin:', error?.message || error);
    return false;
  }
}
