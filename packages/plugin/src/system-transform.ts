/**
 * experimental.chat.system.transform handler.
 *
 * Injects a brief system-prompt addition that tells the model about the
 * `describe_image` tool. This runs on every LLM call, but the injected text
 * is short (~3 lines) and only meaningful for models that received
 * image-fallback text parts.
 *
 * We unconditionally inject because:
 *   1. The hook doesn't tell us whether any image fallback occurred in the
 *      same transform pass (hooks fire independently).
 *   2. The tool definition is always registered, so the model should always
 *      know how to use it — the system prompt guidance is cheap insurance.
 *   3. If no image fallback occurred, the model simply ignores the guidance.
 */

type SystemTransformOutput = {
  system: string[]
}

const SYSTEM_PROMPT_ADDITION = [
  ``,
  `## Image Handling`,
  `When a message contains "[Image attachment: ...]" with a prior analysis, use it directly.`,
  `When no analysis is included, use any available vision tool (look_at, analyze_image, etc.) to analyze the image.`,
  `After receiving a vision analysis, call save_image_analysis to cache it for future sessions.`,
].join("\n")

export function createSystemTransformHandler() {
  return async (
    _input: { sessionID?: string; model?: unknown },
    output: SystemTransformOutput,
  ): Promise<void> => {
    if (!Array.isArray(output.system)) return
    // Avoid duplicate injection if the hook fires multiple times.
    if (output.system.includes(SYSTEM_PROMPT_ADDITION)) return
    output.system.push(SYSTEM_PROMPT_ADDITION)
  }
}
