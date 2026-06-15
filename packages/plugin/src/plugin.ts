/**
 * Plugin factory: receives PluginInput from the OpenCode server and returns
 * the Hooks object that wires our transform handlers and tools.
 *
 * This is the single entry point that assembles the plugin's hook surface.
 * Individual concerns (image transform, system prompt, tools) live in their
 * own modules to keep this file thin.
 */

import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"

import { createCompactionFocusHandler } from "./compaction-focus.js"
import { createImageTransformHandler } from "./image-transform.js"
import { createSystemTransformHandler } from "./system-transform.js"
import { createDescribeImageTool } from "./tools/describe-image.js"
import { createSearchImagesTool } from "./tools/search-images.js"
import { createSaveImageAnalysisTool } from "./tools/save-image-analysis.js"
import { createModelCapabilityChecker } from "./model-capability.js"
import { createImageStore } from "./image-store.js"
import { openCacheDb, type CacheDb } from "./cache/database.js"

export function createPlugin(input: PluginInput): Promise<Hooks> {
  console.error("[openchamber-plugin] loaded successfully")
  const modelSupportsImage = createModelCapabilityChecker(input.client)

  let cacheDb: CacheDb | undefined
  try {
    cacheDb = openCacheDb()
  } catch {
    // Cache is optional — all features degrade gracefully without it
  }

  const imageStore = createImageStore({ cacheDb })

  const imageTransform = createImageTransformHandler({
    modelSupportsImage,
    imageStore,
    cacheDb,
  })

  const systemTransform = createSystemTransformHandler()
  const compactionFocus = createCompactionFocusHandler()
  const describeImage = createDescribeImageTool({ client: input.client, cacheDb })
  const searchImages = createSearchImagesTool({ cacheDb })
  const saveAnalysis = createSaveImageAnalysisTool({
    cacheDb,
    imageDirectory: imageStore.getDirectory(),
  })

  const hooks: Hooks = {
    "experimental.chat.messages.transform": imageTransform,
    "experimental.chat.system.transform": systemTransform,
    "experimental.session.compacting": compactionFocus,
    tool: {
      describe_image: describeImage,
      search_images: searchImages,
      save_image_analysis: saveAnalysis,
    },
    dispose: async () => {
      cacheDb?.close()
    },
  }

  return Promise.resolve(hooks)
}

export type { Plugin, PluginInput }
