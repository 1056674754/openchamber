/**
 * tool.execute.after hook: captures look_at results and caches them.
 *
 * When the model calls OMA's `look_at` tool on an image that was saved by our
 * image-transform, the result is stored in image_analyses. Next time the same
 * image appears (same sha256), the cached analysis is injected directly —
 * no look_at call needed.
 */

import { basename, dirname, extname } from "node:path"
import type { CacheDb } from "./cache/database.js"
import type { Summarizer } from "./summarizer.js"
import { log } from "./logger.js"

const LOOK_AT_TOOL_NAMES = new Set(["look_at", "vision_describe", "describe_image", "analyze_image", "vision_analyze"])
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff"])

export type AnalysisCollectorDeps = {
  cacheDb?: CacheDb
  imageDirectory: string
  summarizer: Summarizer
}

function extractImageHash(filePath: string, imageDirectory: string): string | null {
  const dir = dirname(filePath)
  if (dir !== imageDirectory) return null
  const name = basename(filePath)
  const ext = extname(name)
  if (!IMAGE_EXTS.has(ext.toLowerCase())) return null
  return ext ? name.slice(0, name.length - ext.length) : name
}

function extractFilePathsFromArgs(args: unknown): string[] {
  if (!args || typeof args !== "object") return []
  const a = args as Record<string, unknown>
  const paths: string[] = []
  if (typeof a.file_path === "string") paths.push(a.file_path)
  if (typeof a.path === "string") paths.push(a.path)
  if (Array.isArray(a.file_paths)) {
    for (const p of a.file_paths) {
      if (typeof p === "string") paths.push(p)
    }
  }
  return paths
}

function extractGoalFromArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null
  const a = args as Record<string, unknown>
  if (typeof a.goal === "string" && a.goal.trim()) return a.goal.trim()
  if (typeof a.question === "string" && a.question.trim()) return a.question.trim()
  if (typeof a.prompt === "string" && a.prompt.trim()) return a.prompt.trim()
  return null
}

export function createAnalysisCollectorHook(deps: AnalysisCollectorDeps) {
  return async (
    input: { tool: string; sessionID: string; callID: string; args: unknown },
    output: { title: string; output: string; metadata: unknown },
  ): Promise<void> => {
    if (!deps.cacheDb) return
    if (!LOOK_AT_TOOL_NAMES.has(input.tool)) return

    const resultText = output.output
    if (!resultText || resultText.trim().length === 0) return

    const filePaths = extractFilePathsFromArgs(input.args)
    const goal = extractGoalFromArgs(input.args)

    for (const fp of filePaths) {
      const hash = extractImageHash(fp, deps.imageDirectory)
      if (!hash) continue

      const rowId = deps.cacheDb.saveAnalysis({
        image_sha256: hash,
        backend: input.tool,
        goal,
        result: resultText,
      })

      deps.summarizer.summarize(resultText).then((summary) => {
        if (summary && deps.cacheDb) {
          deps.cacheDb.updateSummary(rowId, summary)
          log("[analysis-collector] summary cached", { rowId, summary: summary.slice(0, 80) })
        }
      }).catch(() => {})

      log("[analysis-collector] cached", { tool: input.tool, hash: hash.slice(0, 16), goal })
    }
  }
}
