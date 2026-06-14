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

const pluginModule: PluginModule = {
  id: "@openchamber/plugin",
  server: createPlugin,
}

export default pluginModule
