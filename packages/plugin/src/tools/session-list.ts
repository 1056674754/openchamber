import { tool, type ToolResult } from "@opencode-ai/plugin"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

import { log } from "../logger.js"

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 15

type SessionListDeps = {
  readonly client: OpencodeClient
}

type SessionSummary = {
  readonly id: string
  readonly title: string
  readonly location?: { readonly directory?: string }
  readonly parentID?: string
  readonly agent?: string
  readonly time?: { readonly updated?: number }
}

type ActiveMap = Record<string, { readonly type?: string }>

function basename(directory: string): string {
  const trimmed = directory.replace(/\/+$/, "")
  const index = trimmed.lastIndexOf("/")
  return index === -1 ? trimmed : trimmed.slice(index + 1) || trimmed
}

function formatTime(millis?: number): string {
  if (typeof millis !== "number") return ""
  const deltaSeconds = Math.max(0, Math.round((Date.now() - millis) / 1000))
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`
  return `${Math.floor(deltaSeconds / 86400)}d ago`
}

export function createSessionListTool({ client }: SessionListDeps) {
  return tool({
    description: [
      "List recent root sessions on this OpenCode server that you can message with session_send.",
      "Root sessions are top-level conversations (no subagent parent); each entry has its id, title, directory and running state.",
      "Use this to find the session id before calling session_send.",
    ].join(" "),
    args: {
      search: tool.schema.string().optional().describe("Case-insensitive title substring filter"),
      limit: tool.schema.number().int().min(1).max(MAX_LIMIT).optional().describe(`Maximum results (default ${DEFAULT_LIMIT})`),
    },
    async execute(args, context): Promise<ToolResult> {
      context.abort.throwIfAborted()

      let sessions: SessionSummary[] = []
      let active: ActiveMap = {}
      try {
        const [listResult, activeResult] = await Promise.all([
          client.v2.session.list(
            {
              limit: MAX_LIMIT,
              order: "desc",
              ...(args.search ? { search: args.search } : {}),
            },
            { throwOnError: true },
          ),
          client.v2.session.active({ throwOnError: true }),
        ])
        const list = (listResult.data as { data?: unknown } | undefined)?.data
        sessions = Array.isArray(list) ? (list as SessionSummary[]) : []
        const activeData = (activeResult.data as { data?: unknown } | undefined)?.data
        active = activeData && typeof activeData === "object" ? (activeData as ActiveMap) : {}
      } catch (error) {
        log("[session_list] request failed", { error: String(error) })
        return {
          title: "session_list",
          output: `Failed to list sessions: ${String(error)}`,
        }
      }

      const roots = sessions.filter((session) => !session.parentID && session.id !== context.sessionID)
      const limited = roots.slice(0, args.limit ?? DEFAULT_LIMIT)
      if (limited.length === 0) {
        return {
          title: "session_list",
          output: "No other root sessions found on this server.",
        }
      }

      const lines = limited.map((session, index) => {
        const running = active[session.id]?.type === "running" ? " [running]" : ""
        const directory = session.location?.directory
        const updated = formatTime(session.time?.updated)
        const suffix = [directory ? basename(directory) : undefined, updated].filter(Boolean).join(", ")
        return `${index + 1}. ${session.id} — "${session.title}"${suffix ? ` (${suffix})` : ""}${running}`
      })

      return {
        title: `session_list: ${limited.length} root sessions`,
        output: [
          `Found ${limited.length} root session(s):`,
          "",
          ...lines,
          "",
          "Send with session_send(session_id, message).",
        ].join("\n"),
        metadata: {
          count: limited.length,
          sessions: limited.map((session) => ({
            id: session.id,
            title: session.title,
            directory: session.location?.directory ?? null,
            running: active[session.id]?.type === "running",
          })),
        },
      }
    },
  })
}
