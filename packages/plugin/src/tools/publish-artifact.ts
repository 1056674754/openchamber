import { realpath } from "node:fs/promises"
import type { ToolResult } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import {
  createArtifactStore,
  isPathWithinRoot,
  resolvePublishSourcePath,
  type ArtifactStore,
} from "../artifact-store.js"

type PublishArtifactToolOptions = {
  readonly store?: ArtifactStore
  readonly now?: () => Date
}

export function createPublishArtifactTool(options: PublishArtifactToolOptions = {}) {
  const store = options.store ?? createArtifactStore()
  const now = options.now ?? (() => new Date())

  return tool({
    description:
      "Publish a completed user-facing file or evidence image to OpenChamber's persistent artifact store. Use this for deliverables that must survive temporary-directory cleanup.",
    args: {
      path: tool.schema.string().min(1).describe("Path to the completed file, relative to the session directory or absolute"),
      title: tool.schema.string().min(1).optional().describe("Short user-facing artifact title"),
      description: tool.schema.string().min(1).optional().describe("Optional concise description of the artifact"),
    },
    async execute(args, context): Promise<ToolResult> {
      context.abort.throwIfAborted()
      const sourcePath = await resolvePublishSourcePath(args.path, context.directory)
      const canonicalWorktree = await realpath(context.worktree)

      if (!isPathWithinRoot(sourcePath, canonicalWorktree)) {
        await context.ask({
          permission: "artifact_publish",
          patterns: [sourcePath],
          always: [sourcePath],
          metadata: {
            path: sourcePath,
            outsideWorktree: true,
          },
        })
      }

      const artifact = await store.publish({
        sourcePath,
        ...(args.title ? { title: args.title } : {}),
        ...(args.description ? { description: args.description } : {}),
        sessionID: context.sessionID,
        messageID: context.messageID,
        createdAt: now(),
      })

      return {
        title: `Published ${artifact.name}`,
        output: `Published artifact ${artifact.name} (${artifact.size} bytes).`,
        metadata: {
          openchamberArtifact: artifact,
        },
      }
    },
  })
}
