/**
 * describe_image tool (Stage 1.5).
 *
 * When called, discovers available vision-capable tools in the current OpenCode
 * instance and either proxies to them or instructs the model how to call them.
 *
 * Discovery order:
 *   1. MCP tools with known vision names (vision_describe, analyze_image, ocr, etc.)
 *   2. OMA's look_at tool (multimodal-looker agent)
 *   3. Any tool whose description mentions image analysis
 *
 * If a vision tool is found, returns its name + instructions so the model can
 * call it directly. This avoids cross-tool invocation complexity.
 *
 * If no vision tool is found, returns the Stage 1 placeholder.
 */

import { tool, type ToolResult } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import { stat } from "node:fs/promises"
import { basename, extname } from "node:path"
import { log } from "../logger.js"
import type { CacheDb } from "../cache/database.js"

export type DescribeImageDeps = {
  client: PluginInput["client"]
  cacheDb?: CacheDb
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff", ".ico"])

const VISION_TOOL_PATTERNS = [
  "vision_describe",
  "vision_ocr",
  "vision_analyze",
  "describe_image",
  "analyze_image",
  "ocr_image",
  "read_image",
  "image_ocr",
  "look_at",
]

type ToolInfo = {
  name: string
  description?: string
  source?: string
}

function isLikelyImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())
}

async function discoverVisionTools(client: PluginInput["client"]): Promise<ToolInfo[]> {
  const found: ToolInfo[] = []
  try {
    const response = await client.tool.ids()
    const ids = (response.data as string[] | undefined) ?? []
    for (const name of ids) {
      if (typeof name !== "string") continue
      const lower = name.toLowerCase()
      if (VISION_TOOL_PATTERNS.some((p) => lower === p || lower.includes(p))) {
        found.push({ name })
      }
    }
  } catch {
    // Tool ids endpoint might not be available in all versions
  }
  return found
}

export function createDescribeImageTool(deps: DescribeImageDeps) {
  let visionToolsCache: ToolInfo[] | null = null
  let cacheTime = 0
  const CACHE_TTL_MS = 30_000

  async function getVisionTools(): Promise<ToolInfo[]> {
    const now = Date.now()
    if (visionToolsCache !== null && now - cacheTime < CACHE_TTL_MS) {
      return visionToolsCache
    }
    visionToolsCache = await discoverVisionTools(deps.client)
    cacheTime = now
    return visionToolsCache
  }

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
      const questionHint = question ? ` (Question: "${question}")` : ""

      const hashFromFile = extname(filename) ? filename.slice(0, filename.lastIndexOf(".")) : filename
      const priorAnalyses = deps.cacheDb?.getAnalyses(hashFromFile) ?? []

      if (priorAnalyses.length > 0) {
        log("[describe_image] cache hit", { hash: hashFromFile.slice(0, 16), count: priorAnalyses.length })

        const analysisLines = priorAnalyses.map((a, i) => {
          const goalLabel = a.goal ? `[Goal: ${a.goal}]` : "[General analysis]"
          const date = new Date(a.time_analyzed).toISOString().slice(0, 10)
          const preview = a.result.slice(0, 500)
          const truncated = a.result.length > 500 ? "..." : ""
          return `${i + 1}. ${goalLabel} (${a.backend}, ${date}):\n   ${preview}${truncated}`
        })

        return {
          title: `describe_image: ${filename} (${priorAnalyses.length} cached)`,
          output: [
            `Image: "${filename}" (${formatBytes(fileSize)})${questionHint}`,
            ``,
            `${priorAnalyses.length} prior analysis/analyses exist for this image:`,
            ``,
            analysisLines.join("\n\n"),
            ``,
            `If one of these already answers your current question, use it directly.`,
            `If none of them are relevant, call look_at with file_path="${imagePath}" and a goal that reflects your specific question.`,
          ].join("\n"),
          metadata: {
            path: imagePath,
            size: fileSize,
            hash: hashFromFile,
            cachedCount: priorAnalyses.length,
          },
        }
      }

      const visionTools = await getVisionTools()

      if (visionTools.length > 0) {
        const primary = visionTools[0]!
        const toolList = visionTools.map((t) => `- ${t.name}${t.description ? `: ${t.description.slice(0, 80)}` : ""}`).join("\n")
        log("[describe_image] found vision tools, delegating", { tool: primary.name, path: imagePath })

        return {
          title: `describe_image → ${primary.name}`,
          output: [
            `Image confirmed: "${filename}" (${formatBytes(fileSize)})${questionHint}`,
            ``,
            `The following vision tool(s) are available in this session:`,
            toolList,
            ``,
            `Call the tool "${primary.name}" with the file path "${imagePath}"${question ? ` and question "${question}"` : ""} to get a visual analysis.`,
          ].join("\n"),
          metadata: {
            path: imagePath,
            size: fileSize,
            visionTools: visionTools.map((t) => t.name),
            stage: "1.5-delegated",
          },
        }
      }

      log("[describe_image] no vision tools found, serving placeholder", { path: imagePath })

      return {
        title: `describe_image: ${filename}`,
        output: [
          `Image file confirmed: "${filename}" (${formatBytes(fileSize)}) at ${imagePath}${questionHint}`,
          ``,
          `No vision analysis tool is currently available in this session.`,
          `To enable image analysis, configure a vision MCP server such as:`,
          `  - opencode-vision (PaddleOCR + Gemini, built for OpenCode)`,
          `  - agent-vision-mcp (OpenAI-compatible vision proxy)`,
          `  - vision-sidecar-mcp (local Ollama-based VLM)`,
          ``,
          `Alternatively, ask the user to describe the image contents.`,
        ].join("\n"),
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
