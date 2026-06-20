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
  reason: string
}

export type ModelCapabilityChecker = (
  providerID: string,
  modelID: string,
) => Promise<ModelCapabilityResult>

type ProviderModelEntry = {
  capabilities?: {
    attachment?: boolean
    input?: { image?: boolean; text?: boolean; audio?: boolean; video?: boolean; pdf?: boolean }
    output?: Record<string, boolean>
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

      const model = provider.models?.[modelID] as ProviderModelEntry | undefined
      if (!model) {
        return { supportsImage: true, reason: "unknown" }
      }

      const caps = model.capabilities
      if (!caps) {
        return { supportsImage: true, reason: "unknown" }
      }

      const hasImageInput = caps.input?.image === true
      const hasAttachment = caps.attachment === true

      if (hasImageInput || hasAttachment) {
        return { supportsImage: true, reason: hasImageInput ? "capabilities.input.image" : "capabilities.attachment" }
      }

      if (caps.input && typeof caps.input.image === "boolean") {
        return { supportsImage: false, reason: "capabilities.input.image=false" }
      }

      return { supportsImage: true, reason: "unknown" }
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
