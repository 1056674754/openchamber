/**
 * experimental.chat.system.transform handler.
 *
 * Injects model-aware image guidance. Native multimodal models should read
 * local images directly so OpenCode returns them as file attachments, while
 * text-only models use the image-analysis fallback tools.
 */

type SystemTransformOutput = {
  system: string[]
}

type SystemTransformInput = {
  sessionID?: string
  model: {
    capabilities?: {
      attachment?: boolean
      input?: {
        image?: boolean
      }
    }
  }
}

const NATIVE_IMAGE_PROMPT_ADDITION = [
  ``,
  `## Image Handling`,
  `This model supports image input. For a local image or PDF, use the built-in read tool so OpenCode attaches the media directly to this session.`,
  `Do not use external image-analysis or OCR fallback tools; they are reserved for models without native image input.`,
].join("\n")

const FALLBACK_IMAGE_PROMPT_ADDITION = [
  ``,
  `## Image Handling`,
  `When a message contains "[Image attachment: ...]" with a prior analysis, use it directly.`,
  `When no analysis is included, use any available vision tool (look_at, analyze_image, etc.) to analyze the image.`,
  `After receiving a vision analysis, call save_image_analysis to cache it for future sessions.`,
].join("\n")

const ARTIFACT_PROMPT_ADDITION = [
  ``,
  `## Artifact Publishing`,
  `When you create a completed user-facing deliverable or evidence file that must survive temporary-directory cleanup, call publish_artifact before handing it off.`,
  `Do not use a temporary filesystem path as the final handoff when publish_artifact is available.`,
].join("\n")

function supportsNativeImageInput(model: SystemTransformInput["model"]): boolean {
  const capabilities = model.capabilities
  if (capabilities?.input?.image === true || capabilities?.attachment === true) {
    return true
  }

  return capabilities?.input?.image !== false
}

export function createSystemTransformHandler() {
  return async (
    input: SystemTransformInput,
    output: SystemTransformOutput,
  ): Promise<void> => {
    if (!Array.isArray(output.system)) return
    const imagePrompt = supportsNativeImageInput(input.model)
      ? NATIVE_IMAGE_PROMPT_ADDITION
      : FALLBACK_IMAGE_PROMPT_ADDITION
    const addition = `${imagePrompt}\n${ARTIFACT_PROMPT_ADDITION}`

    // Avoid duplicate injection if the hook fires multiple times.
    if (output.system.includes(addition)) return
    output.system.push(addition)
  }
}
