import { tool, type ToolResult } from "@opencode-ai/plugin"

type OfferTaskDeps = {
  readonly now?: () => Date
}

export type OfferedTaskCard = {
  readonly version: 1
  readonly title: string
  readonly tldr?: string
  readonly prompt: string
  readonly agent?: string
  readonly sessionID: string
  readonly directory?: string
  readonly createdAt: string
}

/**
 * Emits an openchamberTaskCard in tool metadata. The OpenChamber UI renders it
 * as a clickable card; clicking creates a new ROOT session pre-filled with the
 * prompt. The tool never creates the session itself — starting the
 * conversation stays the user's choice.
 */
export function createOfferTaskTool(options: OfferTaskDeps = {}) {
  const now = options.now ?? (() => new Date())

  return tool({
    description: [
      "Offer the user a task card: a one-click launcher for a separate conversation.",
      "Use for follow-up work you noticed but should not do in this conversation —",
      "out-of-scope fixes, independent investigations, larger refactors.",
      "The card shows title/tldr and a start button; clicking spawns a new root session with your prompt.",
      "The prompt must be fully self-contained: it is the first message of the new conversation.",
    ].join(" "),
    args: {
      title: tool.schema.string().min(2).max(120).describe("Short imperative card title, e.g. 'Fix stale README badge'"),
      prompt: tool.schema.string().min(10).describe("Self-contained first message for the new conversation"),
      tldr: tool.schema.string().min(1).max(400).optional().describe("One-sentence summary shown under the title"),
      agent: tool.schema.string().min(1).optional().describe("Agent id for the new session (e.g. 'build', 'plan')"),
    },
    async execute(args, context): Promise<ToolResult> {
      context.abort.throwIfAborted()

      const card: OfferedTaskCard = {
        version: 1,
        title: args.title.trim(),
        prompt: args.prompt,
        ...(args.tldr ? { tldr: args.tldr } : {}),
        ...(args.agent ? { agent: args.agent } : {}),
        sessionID: context.sessionID,
        ...(context.directory ? { directory: context.directory } : {}),
        createdAt: now().toISOString(),
      }

      return {
        title: `Task card: ${card.title}`,
        output: [
          `Task card "${card.title}" shown to the user.`,
          args.agent ? `New conversation would use agent "${args.agent}".` : null,
          "Starting it is the user's choice; do not assume it was started or wait for its result.",
        ]
          .filter(Boolean)
          .join(" "),
        metadata: {
          openchamberTaskCard: card,
        },
      }
    },
  })
}
