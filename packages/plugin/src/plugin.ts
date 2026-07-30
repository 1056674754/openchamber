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
import { createSystemPromptOptimizer } from "./system-prompt-optimizer.js"
import { createSteerTransformHandler } from "./steer-transform.js"
import { createDescribeImageTool } from "./tools/describe-image.js"
import { createSearchImagesTool } from "./tools/search-images.js"
import { createSaveImageAnalysisTool } from "./tools/save-image-analysis.js"
import { createPublishArtifactTool } from "./tools/publish-artifact.js"
import { createModelCapabilityChecker } from "./model-capability.js"
import { createImageStore } from "./image-store.js"
import { openCacheDb, type CacheDb } from "./cache/database.js"
import { writeOpenChamberPluginRuntimeStatus } from "./runtime-status.js"

export function createPlugin(
  input: PluginInput,
  options?: Record<string, unknown>,
): Promise<Hooks> {
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
  const systemPromptOptimizer = createSystemPromptOptimizer({
    client: input.client,
    directory: input.directory,
    enabled: options?.optimizeSystemPrompt === true,
  })
  const compactionFocus = createCompactionFocusHandler()
  const steerTransform = createSteerTransformHandler()
  const describeImage = createDescribeImageTool({ client: input.client, cacheDb })
  const searchImages = createSearchImagesTool({ cacheDb })
  const saveAnalysis = createSaveImageAnalysisTool({
    cacheDb,
    imageDirectory: imageStore.getDirectory(),
  })
  const publishArtifact = createPublishArtifactTool()

  const hooks: Hooks = {
    "chat.message": systemPromptOptimizer.chatMessage,
    event: async (input) => {
      await steerTransform.event(input)
      await systemPromptOptimizer.event(input)
    },
    "experimental.chat.messages.transform": async (input, output) => {
      await imageTransform(input, output)
      await steerTransform.messages(input, output)
    },
    "experimental.chat.system.transform": async (input, output) => {
      await systemTransform(input, output)
      await systemPromptOptimizer.transform(input, output)
    },
    "experimental.session.compacting": compactionFocus,
    tool: {
      describe_image: describeImage,
      search_images: searchImages,
      save_image_analysis: saveAnalysis,
      publish_artifact: publishArtifact,
    },
    dispose: async () => {
      cacheDb?.close()
    },
  }

  try {
    writeOpenChamberPluginRuntimeStatus()
    console.error("[openchamber-plugin] loaded successfully")
  } catch (error) {
    console.error("[openchamber-plugin] failed to write runtime status", error)
  }

  return Promise.resolve(hooks)
}

export type { Plugin, PluginInput }
