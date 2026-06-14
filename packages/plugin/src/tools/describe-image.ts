/**
 * describe_image tool.
 *
 * Registered for every model so that non-vision models always have a way to
 * "see" images that were saved to disk by the image-transform hook.
 *
 * Stage 1 behavior: Returns file metadata and a note that no vision backend
 * is configured. This gives the model a deterministic, honest response rather
 * than a missing-tool error.
 *
 * Stage 1.5 (future): If a vision MCP server is connected, proxy the call
 * to its analyze/describe tool. The plugin will detect connected MCP tools
 * by name (vision_describe, describe_image, analyze_image, etc.) and call
 * the first match.
 */

import { tool, type ToolResult } from "@opencode-ai/plugin"
import { stat } from "node:fs/promises"
import { basename, extname } from "node:path"
import { log } from "../logger.js"

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff", ".ico"])

function isLikelyImagePath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

export function createDescribeImageTool() {
  return tool({
    description: [
      "Analyze an image file and return a text description of its contents.",
      "Use this when a message contains an image that was saved to disk because the current model does not support direct image input.",
      "Pass the absolute file path that was provided in the image attachment message.",
    ].join(" "),
    args: {
      path: tool.schema.string().describe("Absolute path to the image file to analyze"),
      question: tool.schema
        .string()
        .optional()
        .describe("Optional question about the image (e.g. 'What text is shown?' or 'Describe the UI layout')"),
    },
    async execute(args): Promise<ToolResult> {
      const { path: imagePath, question } = args

      if (!imagePath || imagePath.trim().length === 0) {
        return { title: "describe_image", output: "Error: no file path provided." }
      }

      if (!isLikelyImagePath(imagePath)) {
        return {
          title: "describe_image",
          output: `Error: "${imagePath}" does not appear to be an image file (unrecognized extension).`,
        }
      }

      let fileSize: number
      try {
        const stats = await stat(imagePath)
        fileSize = stats.size
      } catch {
        return {
          title: "describe_image",
          output: `Error: file not found at "${imagePath}". The image may have been cleaned up. Please ask the user to re-attach it.`,
        }
      }

      const filename = basename(imagePath)

      // Stage 1: No vision backend wired up yet.
      // Return honest metadata + setup guidance.
      const questionHint = question ? ` (Question: "${question}")` : ""
      const output = [
        `Image file confirmed: "${filename}" (${formatBytes(fileSize)}) at ${imagePath}${questionHint}`,
        ``,
        `No vision analysis backend is currently configured in this OpenCode instance.`,
        `The image exists on disk but cannot be visually analyzed without a vision MCP server.`,
        ``,
        `To enable image analysis, configure a vision MCP server such as:`,
        `  - opencode-vision (PaddleOCR + Gemini, built for OpenCode)`,
        `  - agent-vision-mcp (OpenAI-compatible vision proxy)`,
        `  - vision-sidecar-mcp (local Ollama-based VLM)`,
        ``,
        `For now, if the user can describe what's in the image, that would help.`,
      ].join("\n")

      log("[describe_image] served stage-1 placeholder", { path: imagePath, size: fileSize })

      return {
        title: `describe_image: ${filename}`,
        output,
        metadata: {
          path: imagePath,
          size: fileSize,
          stage: "1-placeholder",
        },
      }
    },
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
