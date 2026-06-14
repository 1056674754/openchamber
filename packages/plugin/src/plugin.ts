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
import { createModelCapabilityChecker } from "./model-capability.js"
import { createImageStore } from "./image-store.js"

export function createPlugin(input: PluginInput): Promise<Hooks> {
  const modelSupportsImage = createModelCapabilityChecker(input.client)
  const imageStore = createImageStore()

  const imageTransform = createImageTransformHandler({
    modelSupportsImage,
    imageStore,
  })

  const systemTransform = createSystemTransformHandler()

  const describeImage = createDescribeImageTool()

  const hooks: Hooks = {
    "experimental.chat.messages.transform": imageTransform,
    "experimental.chat.system.transform": systemTransform,
    tool: {
      describe_image: describeImage,
    },
    dispose: async () => {},
  }

  return Promise.resolve(hooks)
}

// Re-export the Plugin type for external consumers.
export type { Plugin, PluginInput }
