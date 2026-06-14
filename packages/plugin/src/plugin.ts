/**
 * Plugin factory: receives PluginInput from the OpenCode server and returns
 * the Hooks object that wires our transform handlers and tools.
 *
 * This is the single entry point that assembles the plugin's hook surface.
 * Individual concerns (image transform, system prompt, tools) live in their
 * own modules to keep this file thin.
 */

import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"

import { createImageTransformHandler } from "./image-transform.js"
import { createSystemTransformHandler } from "./system-transform.js"
import { createDescribeImageTool } from "./tools/describe-image.js"
import { createSearchImagesTool } from "./tools/search-images.js"
import { createModelCapabilityChecker } from "./model-capability.js"
import { createImageStore } from "./image-store.js"
import { openCacheDb, type CacheDb } from "./cache/database.js"
import { log } from "./logger.js"

export function createPlugin(input: PluginInput): Promise<Hooks> {
  const modelSupportsImage = createModelCapabilityChecker(input.client)

  let cacheDb: CacheDb | undefined
  try {
    cacheDb = openCacheDb()
    log("[cache] opened openchamber.db")
  } catch (error) {
    log("[cache] failed to open, running without cache", { error: String(error) })
  }

  const imageStore = createImageStore({ cacheDb })

  const imageTransform = createImageTransformHandler({
    modelSupportsImage,
    imageStore,
    cacheDb,
  })

  const systemTransform = createSystemTransformHandler()

  const describeImage = createDescribeImageTool({ client: input.client, cacheDb })
  const searchImages = createSearchImagesTool({ cacheDb })

  const hooks: Hooks = {
    "experimental.chat.messages.transform": imageTransform,
    "experimental.chat.system.transform": systemTransform,
    tool: {
      describe_image: describeImage,
      search_images: searchImages,
    },
    dispose: async () => {
      cacheDb?.close()
    },
  }

  return Promise.resolve(hooks)
}

export type { Plugin, PluginInput }
