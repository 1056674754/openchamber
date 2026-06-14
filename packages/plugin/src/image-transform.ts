/**
 * experimental.chat.messages.transform handler.
 *
 * This is the heart of the image fallback: for every message batch about to
 * reach the LLM, we check whether the target model supports image input. If
 * it does NOT, we find image-bearing file parts, save them to disk, and
 * replace them with text parts that tell the model where the image lives and
 * how to access it via the `describe_image` tool.
 *
 * Vision-capable models are passed through unchanged — zero behavior change.
 */

import type { ModelCapabilityChecker } from "./model-capability.js"
import type { ImageStore, SavedImage } from "./image-store.js"
import type { CacheDb } from "./cache/database.js"
import { log } from "./logger.js"

// -- Minimal Part shapes ----------------------------------------------------
// We define these locally rather than importing the full SDK Part union,
// because the messages.transform hook gives us loosely-typed mutable output
// and we only need to recognize and replace file parts.

interface FileLikePart {
  type: string
  mime?: string
  url?: string
  filename?: string
  [key: string]: unknown
}

interface TextLikePart {
  type: "text"
  text: string
  [key: string]: unknown
}

type AnyPart = FileLikePart | TextLikePart | Record<string, unknown>

type MessageWithParts = {
  info: {
    role?: string
    model?: { providerID?: string; modelID?: string } | undefined
    [key: string]: unknown
  }
  parts: AnyPart[]
}

type MessagesTransformOutput = {
  messages: MessageWithParts[]
}

// -- Helpers ----------------------------------------------------------------

function isImageFilePart(part: AnyPart): part is FileLikePart {
  if (typeof part !== "object" || part === null) return false
  if ((part as FileLikePart).type !== "file") return false
  const mime = (part as FileLikePart).mime
  return typeof mime === "string" && mime.startsWith("image/")
}

function extractModelKey(info: MessageWithParts["info"]): { providerID: string; modelID: string } | null {
  const model = info.model
  if (!model || typeof model !== "object") return null
  const providerID = model.providerID
  const modelID = model.modelID
  if (typeof providerID !== "string" || typeof modelID !== "string") return null
  if (providerID.length === 0 || modelID.length === 0) return null
  return { providerID, modelID }
}

function buildReplacementText(
  saved: SavedImage,
  part: FileLikePart,
  priorAnalyses?: Array<{ goal: string | null; result: string; backend: string }> | null,
): string {
  const filename = saved.originalFilename ?? part.filename ?? "image"
  const mime = saved.mime
  const path = saved.filePath
  const hash = saved.hash.slice(0, 12)

  const analysisSection = priorAnalyses && priorAnalyses.length > 0
    ? [
        ``,
        `Prior analyses available for this image (call describe_image for full text):`,
        ...priorAnalyses.map((a, i) =>
          `  ${i + 1}. ${a.goal ? `[${a.goal}]` : "[general]"}: ${a.result.slice(0, 300)}${a.result.length > 300 ? "..." : ""}`,
        ),
        ``,
      ].join("\n")
    : ""

  return [
    `[Image attachment: "${filename}" (${mime})]`,
    `The current model does not support direct image input.`,
    `The image has been saved to: ${path}`,
    `Content hash: ${hash}`,
    analysisSection,
    `To analyze this image, call the describe_image tool with path="${path}".`,
  ].filter(Boolean).join("\n")
}

function buildAlreadyOnDiskText(part: FileLikePart): string {
  const filename = part.filename ?? "image"
  const mime = part.mime ?? "image"
  const url = part.url ?? ""
  return [
    `[Image attachment: "${filename}" (${mime})]`,
    `The current model does not support direct image input.`,
    `The image is available at: ${url}`,
    ``,
    `To analyze this image, call the describe_image tool with path="${url}".`,
  ].join("\n")
}

function isDataUrl(url: unknown): url is string {
  return typeof url === "string" && url.startsWith("data:")
}

function isFileUrl(url: unknown): url is string {
  return typeof url === "string" && (url.startsWith("file:") || url.startsWith("/"))
}

// -- Handler factory --------------------------------------------------------

export type ImageTransformDeps = {
  modelSupportsImage: ModelCapabilityChecker
  imageStore: ImageStore
  cacheDb?: CacheDb
}

export function createImageTransformHandler(deps: ImageTransformDeps) {
  return async (_input: Record<string, never>, output: MessagesTransformOutput): Promise<void> => {
    // Cache model capability per-transform-invocation so we don't re-query
    // the provider API for every message that shares the same model.
    const capabilityCache = new Map<string, boolean>()

    for (const message of output.messages) {
      const modelKey = extractModelKey(message.info)
      if (!modelKey) continue

      const cacheKey = `${modelKey.providerID}/${modelKey.modelID}`
      let supportsImage = capabilityCache.get(cacheKey)
      if (supportsImage === undefined) {
        const result = await deps.modelSupportsImage(modelKey.providerID, modelKey.modelID)
        supportsImage = result.supportsImage
        capabilityCache.set(cacheKey, supportsImage)
      }

      // Vision-capable model — pass through unchanged.
      if (supportsImage) continue

      // Non-vision model — find and transform image parts.
      const parts = message.parts
      let transformedCount = 0

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (!isImageFilePart(part)) continue

        const url = part.url
        try {
          let replacementText: string

          if (isDataUrl(url)) {
            const saved = await deps.imageStore.saveFromDataUrl(url, part.filename)
            const priorAnalyses = deps.cacheDb?.getAnalyses(saved.hash) ?? []
            if (priorAnalyses.length > 0) {
              log("[image-transform] dedup hit", { hash: saved.hash.slice(0, 12), analyses: priorAnalyses.length })
            }
            replacementText = buildReplacementText(
              saved,
              part,
              priorAnalyses.map((a) => ({ goal: a.goal, result: a.result, backend: a.backend })),
            )
          } else if (isFileUrl(url)) {
            // Already on disk (e.g. @-mention of a workspace file) — just reference it.
            replacementText = buildAlreadyOnDiskText(part)
          } else {
            // Unknown URL scheme (http, etc.) — skip for now, let the provider handle or reject.
            continue
          }

          parts[i] = {
            ...part,
            type: "text" as const,
            text: replacementText,
            // Preserve original metadata for debugging, but clear file-specific fields.
            mime: undefined,
            url: undefined,
            filename: undefined,
            _openchamberOriginalType: "file",
          } as TextLikePart
          transformedCount++
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          log("[image-transform] failed to save image", {
            error: message,
            filename: part.filename,
          })
          // On failure, replace with a minimal error text so the model still
          // gets something useful instead of an opaque provider 400.
          parts[i] = {
            ...part,
            type: "text" as const,
            text: `[Image attachment "${part.filename ?? "image"}" could not be processed. Error: ${message}]`,
            mime: undefined,
            url: undefined,
            filename: undefined,
          } as TextLikePart
          transformedCount++
        }
      }

      if (transformedCount > 0) {
        log("[image-transform] replaced image parts with text", {
          model: cacheKey,
          count: transformedCount,
        })
      }
    }
  }
}
