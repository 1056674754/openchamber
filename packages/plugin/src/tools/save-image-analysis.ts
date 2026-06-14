import { tool, type ToolResult } from "@opencode-ai/plugin"
import { basename, dirname, extname } from "node:path"
import type { CacheDb } from "../cache/database.js"
import { log } from "../logger.js"

export type SaveImageAnalysisDeps = {
  cacheDb?: CacheDb
  imageDirectory: string
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff"])

function extractHash(filePath: string, imageDirectory: string): string | null {
  if (dirname(filePath) !== imageDirectory) return null
  const name = basename(filePath)
  const ext = extname(name)
  if (!IMAGE_EXTS.has(ext.toLowerCase())) return null
  return ext ? name.slice(0, name.length - ext.length) : name
}

export function createSaveImageAnalysisTool(deps: SaveImageAnalysisDeps) {
  return tool({
    description: [
      "Save an image analysis to the cross-session cache for future reuse.",
      "Call this after you receive an image analysis from look_at or any other vision tool.",
      "The cached analysis will be available in future sessions when the same image appears,",
      "avoiding redundant vision API calls.",
    ].join(" "),
    args: {
      path: tool.schema.string().describe("Absolute file path of the analyzed image (same path from describe_image)"),
      goal: tool.schema.string().describe("The question or goal that was used for the analysis (e.g. 'Describe the UI layout')"),
      analysis: tool.schema.string().describe("The full analysis text returned by the vision tool"),
      summary: tool.schema
        .string()
        .optional()
        .describe("A concise 1-2 sentence summary of the analysis. If omitted, the first 200 characters of analysis will be used."),
    },
    async execute(args): Promise<ToolResult> {
      if (!deps.cacheDb) {
        return { title: "save_image_analysis", output: "Cache database unavailable. Nothing saved." }
      }

      const hash = extractHash(args.path, deps.imageDirectory)
      if (!hash) {
        return {
          title: "save_image_analysis",
          output: `Path "${args.path}" is not in the OpenChamber image directory. Nothing saved.`,
        }
      }

      deps.cacheDb.saveAnalysis({
        image_sha256: hash,
        backend: "model-saved",
        goal: args.goal,
        result: args.analysis,
      })

      log("[save_image_analysis] cached", { hash: hash.slice(0, 16), goal: args.goal })

      return {
        title: "save_image_analysis: cached",
        output: `Analysis cached for image ${hash.slice(0, 12)}. Future sessions will reuse this result when the same image appears.`,
      }
    },
  })
}
