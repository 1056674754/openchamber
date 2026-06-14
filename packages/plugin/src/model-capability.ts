/**
 * Model vision-capability checker.
 *
 * Queries the OpenCode provider API once per (providerID, modelID) pair and
 * caches the result. The provider list endpoint returns model metadata
 * including `modalities.input` and the `attachment` flag — both of which
 * indicate whether a model can process images natively.
 */

import type { PluginInput } from "@opencode-ai/plugin"

type ModelCapabilityResult = {
  supportsImage: boolean
  reason: "modalities" | "attachment" | "unknown" | "error"
}

export type ModelCapabilityChecker = (
  providerID: string,
  modelID: string,
) => Promise<ModelCapabilityResult>

type ProviderModelEntry = {
  id: string
  name: string
  attachment: boolean
  modalities?: {
    input?: Array<"text" | "audio" | "image" | "video" | "pdf">
    output?: Array<"text" | "audio" | "image" | "video" | "pdf">
  }
}

type ProviderListItem = {
  id: string
  models: Record<string, ProviderModelEntry>
}

/**
 * Create a cached model-capability checker backed by the provider list API.
 *
 * Uses the client type derived from PluginInput so we stay compatible with
 * whatever SDK version the plugin package resolves, avoiding version drift
 * between the plugin's SDK and the host project's SDK.
 */
export function createModelCapabilityChecker(client: PluginInput["client"]): ModelCapabilityChecker {
  const cache = new Map<string, ModelCapabilityResult>()

  async function lookup(providerID: string, modelID: string): Promise<ModelCapabilityResult> {
    try {
      const response = await client.provider.list()
      const responseBody = response.data as { all?: ProviderListItem[] } | undefined
      const providers = responseBody?.all ?? []
      const provider = providers.find((p) => p.id === providerID)
      if (!provider) {
        return { supportsImage: true, reason: "unknown" }
      }

      const model = provider.models?.[modelID]
      if (!model) {
        return { supportsImage: true, reason: "unknown" }
      }

      // Primary signal: modalities.input includes "image"
      if (model.modalities?.input && Array.isArray(model.modalities.input)) {
        const hasImage = model.modalities.input.includes("image")
        return { supportsImage: hasImage, reason: "modalities" }
      }

      // Fallback signal: attachment capability flag
      return { supportsImage: model.attachment === true, reason: "attachment" }
    } catch {
      // On lookup failure, assume vision-capable to avoid blocking legitimate sends.
      return { supportsImage: true, reason: "error" }
    }
  }

  return async (providerID: string, modelID: string) => {
    const key = `${providerID}/${modelID}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached

    const result = await lookup(providerID, modelID)
    cache.set(key, result)
    return result
  }
}
