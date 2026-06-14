import { tool, type ToolResult } from "@opencode-ai/plugin"
import type { CacheDb } from "../cache/database.js"
import { log } from "../logger.js"

export type SearchImagesDeps = {
  cacheDb?: CacheDb
}

export function createSearchImagesTool(deps: SearchImagesDeps) {
  return tool({
    description: [
      "Search previously saved images across all sessions.",
      "Returns file paths, filenames, MIME types, and timestamps.",
      "Useful when a user references an image from a previous conversation.",
    ].join(" "),
    args: {
      filename: tool.schema
        .string()
        .optional()
        .describe("Partial filename to search for (case-insensitive substring match)"),
      session_id: tool.schema
        .string()
        .optional()
        .describe("Restrict results to images seen in a specific session"),
      limit: tool.schema
        .number()
        .optional()
        .describe("Maximum number of results (default 20)"),
    },
    async execute(args): Promise<ToolResult> {
      if (!deps.cacheDb) {
        return {
          title: "search_images",
          output: "Image cache database is not available in this session.",
        }
      }

      if (!args.filename && !args.session_id) {
        return {
          title: "search_images",
          output: "Provide at least a filename or session_id to search.",
        }
      }

      const results = deps.cacheDb.searchImages({
        filename: args.filename,
        sessionId: args.session_id,
        limit: args.limit ?? 20,
      })

      if (results.length === 0) {
        log("[search_images] no results", { filename: args.filename, session: args.session_id })
        return {
          title: "search_images",
          output: "No matching images found in the cache.",
        }
      }

      log("[search_images] found results", { count: results.length })

      const lines = results.map((r, i) => {
        const date = new Date(r.time_saved).toISOString().slice(0, 19)
        return `${i + 1}. ${r.original_filename ?? "(unnamed)"} — ${r.mime}, ${r.size_bytes} bytes, saved ${date}\n   Path: ${r.file_path}\n   Hash: ${r.sha256.slice(0, 16)}...`
      })

      return {
        title: `search_images: ${results.length} found`,
        output: `Found ${results.length} image(s):\n\n${lines.join("\n\n")}`,
        metadata: {
          count: results.length,
          hashes: results.map((r) => r.sha256),
        },
      }
    },
  })
}
