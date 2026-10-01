/**
 * OpenChamber first-party OpenCode plugin.
 *
 * Default export is a PluginModule whose `server` field is loaded by the OpenCode
 * plugin loader when `"@openchamber/plugin"` (or an absolute path to this package)
 * is listed in the `plugin` array of `opencode.json`.
 *
 * See docs/OPENCHAMBER_PLUGIN.md for the full architecture.
 */

import type { PluginModule } from "@opencode-ai/plugin"

import { createPlugin } from "./plugin.js"
import { createV2Setup } from "./v2.js"

/**
 * Dual-shape default export:
 * - `server` — the v1 hooks plugin, loaded by OpenCode v1.18-line servers.
 * - `setup` — the v2 promise plugin (domains-based), loaded by OpenCode v2
 *   servers whose Module loader decodes `{ id, effect | setup }` and ignores
 *   the other shape's key.
 */
const pluginModule: PluginModule & { readonly setup: ReturnType<typeof createV2Setup> } = {
  id: "@openchamber/plugin",
  server: createPlugin,
  setup: createV2Setup(),
}

export default pluginModule
