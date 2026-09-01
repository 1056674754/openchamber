import { tool, type ToolResult } from "@opencode-ai/plugin"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

import { log } from "../logger.js"

type SessionSendDeps = {
  readonly client: OpencodeClient
}

type SessionInfo = {
  readonly id: string
  readonly title?: string
  readonly parentID?: string
  readonly directory?: string
}

function unwrapSession(payload: unknown): SessionInfo {
  const envelope = payload as { data?: unknown } | undefined
  const info = (envelope?.data ?? payload) as SessionInfo | undefined
  if (!info || typeof info !== "object" || typeof info.id !== "string") {
    throw new Error("unexpected session response")
  }
  return info
}

function frameMessage(message: string, own: SessionInfo): string {
  const label = own.title?.trim() || own.id
  return [
    `[message from session "${label}" (${own.id})]`,
    message,
    `[reply with session_send to session ${own.id}]`,
  ].join("\n")
}

export function createSessionSendTool({ client }: SessionSendDeps) {
  return tool({
    description: [
      "Send a message to another root session on this OpenCode server (peer-to-peer, not a subagent spawn).",
      "The message is delivered to the target session as a user turn and its agent will process it;",
      "a busy target queues the message durably (delivery 'queue') or you can steer mid-run (delivery 'steer').",
      "The target sees the source session id and can reply with session_send.",
      "Only root sessions (no subagent parent) are valid targets; use session_list to discover ids.",
    ].join(" "),
    args: {
      session_id: tool.schema.string().min(1).describe("Target root session id (ses_...), from session_list"),
      message: tool.schema.string().min(1).describe("Message text delivered to the target session"),
      delivery: tool.schema
        .enum(["queue", "steer"])
        .optional()
        .describe("queue (default): durably queued for the target loop; steer: injected into a running loop mid-turn"),
    },
    async execute(args, context): Promise<ToolResult> {
      context.abort.throwIfAborted()

      if (args.session_id === context.sessionID) {
        return {
          title: "session_send",
          output: "Refusing to send to the current session — cross-session messaging targets a different root session.",
        }
      }

      let target: SessionInfo
      let own: SessionInfo
      try {
        const [targetResult, ownResult] = await Promise.all([
          client.v2.session.get({ sessionID: args.session_id }, { throwOnError: true }),
          client.v2.session.get({ sessionID: context.sessionID }, { throwOnError: true }),
        ])
        target = unwrapSession(targetResult.data)
        own = unwrapSession(ownResult.data)
      } catch (error) {
        return {
          title: "session_send",
          output: `Could not resolve session ${args.session_id}: ${String(error)}. Use session_list to find a valid root session id.`,
        }
      }

      if (target.parentID) {
        return {
          title: "session_send",
          output: `Session ${args.session_id} is a subagent child of ${target.parentID}; cross-session messaging only targets root sessions. Message the root session instead.`,
        }
      }

      const delivery = args.delivery ?? "queue"
      try {
        const admitted = await client.v2.session.prompt(
          {
            sessionID: args.session_id,
            prompt: { text: frameMessage(args.message, own) },
            delivery,
          },
          { throwOnError: true },
        )
        const admittedId = (admitted.data as { data?: { id?: string } } | undefined)?.data?.id
        log("[session_send] delivered", { target: args.session_id, delivery, admittedId })
        return {
          title: `session_send → ${target.title ?? args.session_id}`,
          output: [
            `Delivered to root session "${target.title ?? args.session_id}" (${args.session_id}) via ${delivery}.`,
            delivery === "queue" && "The target agent will process it as its next user message (queued if busy).",
            "It can reply to you with session_send.",
          ]
            .filter(Boolean)
            .join(" "),
          metadata: {
            openchamberSessionMessage: {
              targetSessionID: args.session_id,
              targetTitle: target.title ?? null,
              sourceSessionID: context.sessionID,
              delivery,
            },
          },
        }
      } catch (error) {
        log("[session_send] delivery failed", { target: args.session_id, error: String(error) })
        return {
          title: "session_send",
          output: `Delivery to ${args.session_id} failed: ${String(error)}`,
        }
      }
    },
  })
}
