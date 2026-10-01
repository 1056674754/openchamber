/**
 * OpenCode v2 promise-plugin entry.
 *
 * OpenCode restructured its plugin system for the v2 architecture: the loader
 * (core/src/plugin/module.ts) accepts a default export of `{ id, effect }` or
 * `{ id, setup }` where `setup` receives capability domains instead of the v1
 * hooks table. The v1 `server` shape and this v2 `setup` shape coexist on the
 * same default export — each loader reads its own key and ignores the other.
 *
 * Port status vs the v1 hooks implementation:
 * - offer_task / session_send — native v2 (context.session).
 * - session_list — registry fed by the server event stream; v2 does not
 *   expose a session-list API to plugins, so only sessions observed since
 *   startup are listed.
 * - publish_artifact — artifact store reused; the session directory comes
 *   from context.session.get. Outside-worktree publication raises instead of
 *   asking (v2 has no in-tool ask; gate with the tool's permission option if
 *   needed).
 * - describe_image / search_images / save_image_analysis — cache database
 *   and vision-tool discovery reused; discovery reads context.tool.list().
 * - compaction focus — session "compaction" hook.
 * - system prompt guidance + image fallback rewriting — session "context"
 *   hook with model capabilities read through the model editor.
 * - system prompt optimizer — session "prompt" hook + "context" transform,
 *   gated on the `optimizeSystemPrompt` plugin option.
 * - steer-transform — NOT ported: v2's session input queue promotes steers
 *   mid-turn natively.
 *
 * The context/domains are typed structurally here so this module does not
 * depend on the @opencode-ai/plugin v2 package; the server passes the real
 * domains, which satisfy these shapes.
 */

import { z } from "zod"

import { createArtifactStore, type ArtifactStore } from "./artifact-store.js"
import { openCacheDb, type CacheDb } from "./cache/database.js"
import { log } from "./logger.js"
import { createImageStore, type ImageStore } from "./image-store.js"

// -- Structural v2 context types ---------------------------------------------

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface V2ToolContext {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  readonly progress: (update: Record<string, unknown>) => Promise<void>
}

export interface V2Context {
  readonly location: { readonly directory: string }
  readonly options: Record<string, unknown>
  readonly session: {
    get(sessionID: string): Promise<{ directory?: string; agent?: string } | undefined>
    prompt(input: {
      sessionID: string
      prompt: { text: string }
      delivery?: "steer" | "queue"
    }): Promise<unknown>
    hook: (<K extends "context">(
      name: K,
      callback: (input: {
        readonly sessionID: string
        readonly model: { providerID: string; id: string }
        system: Array<{ type: "text"; text: string }>
        messages: Array<{ role: string; content: unknown }>
      }) => Promise<void> | void,
    ) => Promise<{ dispose(): Promise<void> }>) &
      (<K extends "prompt">(
        name: K,
        callback: (input: {
          readonly sessionID: string
          readonly metadata?: Record<string, unknown>
        }) => Promise<void> | void,
      ) => Promise<{ dispose(): Promise<void> }>) &
      (<K extends "compaction">(
        name: K,
        callback: (input: {
          readonly sessionID: string
          system: Array<{ type: "text"; text: string }>
          messages: Array<{ role: string; content: unknown }>
        }) => Promise<void> | void,
      ) => Promise<{ dispose(): Promise<void> }>)
  }
  readonly tool: {
    transform(callback: (editor: {
      add(tool: {
        readonly name: string
        readonly input: unknown
        readonly description: string
        execute(input: unknown, context: V2ToolContext): Promise<unknown>
        readonly options?: { readonly permission?: string }
      }): void
    }) => void): Promise<{ dispose(): Promise<void> }>
    list(): Promise<readonly { readonly name: string; readonly description?: string }[]>
  }
  readonly event: { subscribe(): AsyncIterable<{ type?: string; properties?: unknown }> }
  readonly model: {
    transform(callback: (editor: {
      get(providerID: string, modelID: string):
        | { capabilities?: { input?: ReadonlyArray<string>; attachment?: boolean } }
        | undefined
    }) => void): Promise<{ dispose(): Promise<void> }>
  }
  readonly agent: {
    list(): Promise<readonly { readonly id: string }[]>
  }
}

// -- Shared plumbing ----------------------------------------------------------

type ToolResult = { title?: string; output?: string; metadata?: Record<string, unknown> }

const OPTIMIZABLE_AGENT_IDS = new Set(["build", "plan"])
const PROVIDER_PROMPT_BOUNDARY = "You are powered by the model named"
const MINIMAL_IDENTITY = "You are OpenCode, a coding agent."

function supportsNativeImageInput(model: {
  capabilities?: { input?: ReadonlyArray<string>; attachment?: boolean }
}): boolean {
  const capabilities = model.capabilities
  if (capabilities?.input?.includes("image") === true || capabilities?.attachment === true) return true
  return capabilities?.input?.includes("image") !== false
}

async function sessionDirectory(
  context: V2Context,
  sessionID: string,
): Promise<string | undefined> {
  try {
    const session = await context.session.get(sessionID)
    return session?.directory
  } catch {
    return undefined
  }
}

// -- Tools --------------------------------------------------------------------

function createV2SessionSendTool(context: V2Context) {
  return {
    name: "session_send",
    input: z.object({
      session_id: z.string().min(1).describe("Target root session id (ses_...), from session_list"),
      message: z.string().min(1).describe("Message text delivered to the target session"),
      delivery: z.enum(["queue", "steer"]).optional().describe("queue (default) or steer"),
    }),
    description: [
      "Send a message to another root session on this OpenCode server (peer-to-peer, not a subagent spawn).",
      "A busy target queues the message durably (delivery 'queue') or you can steer mid-run (delivery 'steer').",
      "The target sees the source session id and can reply with session_send.",
      "Use session_list to discover ids.",
    ].join(" "),
    execute: (input: { session_id: string; message: string; delivery?: "queue" | "steer" }, toolContext: V2ToolContext): Promise<ToolResult> =>
      (async () => {
        if (input.session_id === toolContext.sessionID) {
          return {
            output:
              "Refusing to send to the current session — cross-session messaging targets a different root session.",
          }
        }
        try {
          const [target, own] = await Promise.all([
            context.session.get(input.session_id),
            context.session.get(toolContext.sessionID),
          ])
          if (!target) {
            return {
              output: `Could not resolve session ${input.session_id}. Use session_list to find a valid root session id.`,
            }
          }
          const label = own?.agent ?? toolContext.agent
          const framed = [
            `[message from session "${label}" (${toolContext.sessionID})]`,
            input.message,
            `[reply with session_send to session ${toolContext.sessionID}]`,
          ].join("\n")
          await context.session.prompt({
            sessionID: input.session_id,
            prompt: { text: framed },
            delivery: input.delivery ?? "queue",
          })
          log("[session_send] delivered", { target: input.session_id, delivery: input.delivery ?? "queue" })
          return {
            output: `Delivered to session ${input.session_id} via ${input.delivery ?? "queue"}. It can reply with session_send.`,
            metadata: {
              openchamberSessionMessage: {
                targetSessionID: input.session_id,
                sourceSessionID: toolContext.sessionID,
                delivery: input.delivery ?? "queue",
              },
            },
          }
        } catch (error) {
          return { output: `Delivery to ${input.session_id} failed: ${String(error)}` }
        }
      })(),
  }
}

function createV2SessionListTool(registry: { known(): Array<{ id: string; title?: string }> }) {
  return {
    name: "session_list",
    input: z.object({
      limit: z.number().int().min(1).max(50).optional().describe("Maximum results (default 15)"),
    }),
    description: [
      "List recent root sessions on this OpenCode server that you can message with session_send.",
      "Only sessions observed since startup are listed (v2 plugins have no session-list API).",
    ].join(" "),
    execute: (input: { limit?: number }): Promise<ToolResult> =>
      (async () => {
        const known = registry.known()
        if (known.length === 0) {
          return { output: "No other sessions observed since startup. Try session_send with a known session id." }
        }
        const limited = known.slice(0, input.limit ?? 15)
        const lines = limited.map(
          (session, index) => `${index + 1}. ${session.id}${session.title ? ` — "${session.title}"` : ""}`,
        )
        return {
          output: [`Found ${limited.length} session(s):`, "", ...lines, "", "Send with session_send(session_id, message)."].join(
            "\n",
          ),
          metadata: { count: limited.length, sessions: limited },
        }
      })(),
  }
}

// -- Setup --------------------------------------------------------------------

export interface V2PluginEntry {
  readonly id: string
  readonly setup: (context: V2Context) => Promise<(() => void) | void> | (() => void) | void
}

export function createV2Setup(): V2PluginEntry["setup"] {
  return async (context: V2Context) => {
    console.error("[openchamber-plugin] v2 setup loaded")
    let cacheDb: CacheDb | undefined
    try {
      cacheDb = openCacheDb()
    } catch {
      cacheDb = undefined
    }
    const imageStore: ImageStore = createImageStore({ cacheDb })
    const artifacts: ArtifactStore = createArtifactStore()

    // Session registry for session_list — fed by the event stream.
    const knownSessions = new Map<string, { id: string; title?: string }>()

    // Optimizer state (mirrors the v1 system-prompt-optimizer).
    const optimizeEnabled = context.options?.optimizeSystemPrompt === true
    const optimizedSessions = new Set<string>()

    // Subscribe to the server event stream: registry + optimizer cleanup.
    const eventLoop = (async () => {
      try {
        for await (const frame of context.event.subscribe()) {
          const type = typeof frame?.type === "string" ? frame.type : undefined
          const properties =
            frame?.properties && typeof frame.properties === "object" ? (frame.properties as Record<string, unknown>) : undefined
          if (!type || !properties) continue

          if (type === "session.updated" || type === "session.created") {
            const info = properties.info
            if (info && typeof info === "object" && typeof (info as { id?: unknown }).id === "string") {
              const record = info as { id: string; title?: unknown }
              knownSessions.set(record.id, {
                id: record.id,
                ...(typeof record.title === "string" ? { title: record.title } : {}),
              })
            }
          }
          if (type === "session.deleted") {
            const info = properties.info
            if (info && typeof info === "object" && typeof (info as { id?: unknown }).id === "string")
              knownSessions.delete((info as { id: string }).id)
            if (isRecord(info)) {
              const id = (info as { id?: unknown }).id
              if (typeof id === "string") optimizedSessions.delete(id)
            }
          }
        }
      } catch (error) {
        log("[v2] event stream ended", { error: String(error) })
      }
    })()
    void eventLoop

    // -- Tools ----------------------------------------------------------------

    await context.tool.transform((editor) => {
      editor.add(createV2SessionSendTool(context))
      editor.add(createV2SessionListTool({ known: () => Array.from(knownSessions.values()) }))

      editor.add({
        name: "offer_task",
        input: z.object({
          title: z.string().min(2).max(120).describe("Short imperative card title"),
          prompt: z.string().min(10).describe("Self-contained first message for the new conversation"),
          tldr: z.string().min(1).max(400).optional().describe("One-sentence summary shown under the title"),
          agent: z.string().min(1).optional().describe("Agent id for the new session"),
        }),
        description: [
          "Offer the user a task card: a one-click launcher for a separate conversation.",
          "Use for follow-up work you noticed but should not do in this conversation.",
          "The prompt must be fully self-contained: it is the first message of the new conversation.",
        ].join(" "),
        options: { permission: "openchamber_offer_task" },
        execute: (rawInput: unknown, toolContext: V2ToolContext): Promise<ToolResult> =>
          (async () => {
            const args = rawInput as { title: string; prompt: string; tldr?: string; agent?: string }
            return {
              output: `Task card "${args.title}" shown to the user. Starting it is the user's choice; do not assume it was started.`,
              metadata: {
                openchamberTaskCard: {
                  version: 1,
                  title: args.title.trim(),
                  prompt: args.prompt,
                  ...(args.tldr ? { tldr: args.tldr } : {}),
                  ...(args.agent ? { agent: args.agent } : {}),
                  sessionID: toolContext.sessionID,
                  createdAt: new Date().toISOString(),
                },
              },
            }
          })(),
      })

      editor.add({
        name: "publish_artifact",
        input: z.object({
          path: z.string().min(1).describe("Path to the completed file, relative to the session directory or absolute"),
          title: z.string().min(1).optional().describe("Short user-facing artifact title"),
          description: z.string().min(1).optional().describe("Optional concise description of the artifact"),
        }),
        description: [
          "Publish a completed user-facing file or evidence image to OpenChamber's persistent artifact store.",
          "Use this for deliverables that must survive temporary-directory cleanup.",
        ].join(" "),
        execute: (rawInput: unknown, toolContext: V2ToolContext): Promise<ToolResult> =>
          (async () => {
            const args = rawInput as { path: string; title?: string; description?: string }
            const directory = await sessionDirectory(context, toolContext.sessionID)
            if (!directory) return { output: "Error: session directory is unavailable; cannot resolve the artifact path." }
            const path = args.path.startsWith("/") ? args.path : `${directory.replace(/\/$/, "")}/${args.path}`
            try {
              const artifact = await artifacts.publish({
                sourcePath: path,
                ...(args.title ? { title: args.title } : {}),
                ...(args.description ? { description: args.description } : {}),
                sessionID: toolContext.sessionID,
                messageID: toolContext.messageID,
                createdAt: new Date(),
              })
              return {
                output: `Published artifact ${artifact.name} (${artifact.size} bytes).`,
                metadata: { openchamberArtifact: artifact },
              }
            } catch (error) {
              return { output: `Publish failed: ${error instanceof Error ? error.message : String(error)}` }
            }
          })(),
      })

      if (cacheDb) {
        editor.add({
          name: "search_images",
          input: z.object({
            filename: z.string().optional().describe("Partial filename to search for (case-insensitive)"),
            session_id: z.string().optional().describe("Restrict results to a specific session"),
            limit: z.number().int().min(1).max(100).optional().describe("Maximum results (default 20)"),
          }),
          description:
            "Search previously saved images across all sessions. Returns file paths, filenames, MIME types, and timestamps.",
          execute: (rawInput: unknown): Promise<ToolResult> =>
            (async () => {
              const args = rawInput as { filename?: string; session_id?: string; limit?: number }
              if (!args.filename && !args.session_id) return { output: "Provide at least a filename or session_id to search." }
              const results = cacheDb!.searchImages({
                filename: args.filename,
                sessionId: args.session_id,
                limit: args.limit ?? 20,
              })
              if (results.length === 0) return { output: "No matching images found in the cache." }
              const lines = results.map((r, i) => {
                const date = new Date(r.time_saved).toISOString().slice(0, 19)
                return `${i + 1}. ${r.original_filename ?? "(unnamed)"} — ${r.mime}, ${r.size_bytes} bytes, saved ${date}\n   Path: ${r.file_path}`
              })
              return {
                title: `search_images: ${results.length} found`,
                output: `Found ${results.length} image(s):\n\n${lines.join("\n\n")}`,
                metadata: { count: results.length },
              }
            })(),
        })

        editor.add({
          name: "save_image_analysis",
          input: z.object({
            path: z.string().min(1).describe("Absolute file path of the analyzed image (same path from describe_image)"),
            goal: z.string().describe("The question or goal that was used for the analysis"),
            analysis: z.string().min(1).describe("The full analysis text returned by the vision tool"),
            summary: z.string().optional().describe("Concise 1-2 sentence summary of the analysis"),
          }),
          description:
            "Save an image analysis to the cross-session cache for future reuse. Call this after you receive an image analysis from a vision tool.",
          execute: (rawInput: unknown): Promise<ToolResult> =>
            (async () => {
              const args = rawInput as { path: string; goal: string; analysis: string; summary?: string }
              const imageDirectory = imageStore.getDirectory()
              const name = args.path.split("/").pop() ?? ""
              const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : ""
              const hash = imageDirectory && args.path.startsWith(`${imageDirectory}/`) && ext ? name.slice(0, name.length - ext.length) : null
              if (!hash) {
                return { output: `Path "${args.path}" is not in the OpenChamber image directory. Nothing saved.` }
              }
              const id = cacheDb!.saveAnalysis({
                image_sha256: hash,
                backend: "model-saved",
                goal: args.goal,
                result: args.analysis,
              })
              if (args.summary) cacheDb!.updateSummary(id, args.summary)
              return {
                output: `Analysis cached for image ${hash.slice(0, 12)}. Future sessions will reuse this result when the same image appears.`,
              }
            })(),
        })

        editor.add({
          name: "describe_image",
          input: z.object({
            path: z.string().min(1).describe("Absolute path to the image file to analyze"),
            question: z.string().optional().describe("Optional question about the image"),
          }),
          description: [
            "Analyze an image file and return a text description of its contents.",
            "Discovers available vision tools and returns their names plus usage instructions.",
          ].join(" "),
          execute: (rawInput: unknown): Promise<ToolResult> =>
            (async () => {
              const args = rawInput as { path: string; question?: string }
              if (!args.path.trim()) return { output: "Error: no file path provided." }
              let visionTools: Array<{ name: string }> = []
              try {
                const listed = await context.tool.list()
                const patterns = [
                  "vision_describe",
                  "vision_ocr",
                  "vision_analyze",
                  "describe_image",
                  "analyze_image",
                  "ocr_image",
                  "read_image",
                  "look_at",
                  "image_analyz",
                ]
                visionTools = listed
                  .filter((tool) => patterns.some((pattern) => tool.name.toLowerCase().includes(pattern)))
                  .map((tool) => ({ name: tool.name }))
              } catch {
                visionTools = []
              }
              const questionHint = args.question ? ` (Question: "${args.question}")` : ""
              if (visionTools.length > 0) {
                return {
                  output: [
                    `Image confirmed at ${args.path}${questionHint}`,
                    ``,
                    `Available vision tools:\n${visionTools.map((tool) => `- ${tool.name}`).join("\n")}`,
                  ].join("\n"),
                  metadata: { path: args.path, visionTools: visionTools.map((tool) => tool.name) },
                }
              }
              return {
                output: `Image file confirmed at ${args.path}${questionHint}. No vision analysis tool is currently available in this session.`,
              }
            })(),
        })
      }
    })

    // -- Hooks ----------------------------------------------------------------

    const imageGuidanceFor = async (ref: { providerID: string; id: string }): Promise<string> => {
      let nativeImage: boolean | undefined
      try {
        await context.model.transform((editor) => {
          const info = editor.get(ref.providerID, ref.id)
          nativeImage = info ? supportsNativeImageInput(info) : undefined
        })
      } catch {
        nativeImage = undefined
      }
      const imagePrompt =
        nativeImage === true
          ? [
              `## Image Handling`,
              `This model supports image input. For a local image or PDF, use the built-in read tool so OpenCode attaches the media directly to this session.`,
              `Do not use external image-analysis or OCR fallback tools; they are reserved for models without native image input.`,
            ].join("\n")
          : [
              `## Image Handling`,
              `When a message contains "[Image attachment: ...]" with a prior analysis, use it directly.`,
              `When no analysis is included, use any available vision tool (look_at, analyze_image, etc.) to analyze the image.`,
              `After receiving a vision analysis, call save_image_analysis to cache it for future sessions.`,
            ].join("\n")
      return `${imagePrompt}\n${[
        `## Artifact Publishing`,
        `When you create a completed user-facing deliverable or evidence file that must survive temporary-directory cleanup, call publish_artifact before handing it off.`,
      ].join("\n")}`
    }

    await context.session.hook("context", async (input) => {
      // Model-aware guidance (image handling + artifacts).
      const guidance = await imageGuidanceFor(input.model)
      if (!input.system.some((part) => part.text === guidance)) {
        input.system.push({ type: "text", text: guidance } as (typeof input.system)[number])
      }

      // System-prompt optimizer (opt-in).
      if (optimizeEnabled && optimizedSessions.has(input.sessionID)) {
        const boundary = input.system.findIndex((part) => part.text.includes(PROVIDER_PROMPT_BOUNDARY))
        if (boundary >= 0) {
          const kept = input.system.slice(boundary)
          input.system.length = 0
          input.system.push({ type: "text", text: `${MINIMAL_IDENTITY}\n\n${kept.map((part) => part.text).join("\n")}` } as (typeof input.system)[number])
        }
      }

      // Image fallback rewriting for non-vision models.
      let nativeImage: boolean | undefined
      try {
        await context.model.transform((editor) => {
          const info = editor.get(input.model.providerID, input.model.id)
          nativeImage = info ? supportsNativeImageInput(info) : undefined
        })
      } catch {
        nativeImage = undefined
      }
      if (nativeImage === false) {
        for (const message of input.messages) {
          if (message.role !== "user" || !Array.isArray(message.content)) continue
          for (let index = 0; index < message.content.length; index++) {
            const part = message.content[index] as {
              type?: string
              mime?: string
              mediaType?: string
              url?: string
              filename?: string
              text?: string
            }
            if (part?.type !== "file") continue
            const mime = part.mime ?? part.mediaType
            if (typeof mime !== "string" || !mime.startsWith("image/")) continue
            const url = part.url
            try {
              let replacement: string
              if (typeof url === "string" && url.startsWith("data:")) {
                const saved = await imageStore.saveFromDataUrl(url, part.filename)
                replacement = [
                  `[Image attachment: "${saved.originalFilename ?? part.filename ?? "image"}" (${saved.mime}), saved to: ${saved.filePath}]`,
                  `This model does not support direct image input.`,
                  `No prior analysis exists. Use any available vision tool to analyze this image.`,
                ].join("\n")
              } else if (typeof url === "string" && (url.startsWith("file:") || url.startsWith("/"))) {
                replacement = [
                  `[Image attachment: "${part.filename ?? "image"}" (${mime})]`,
                  `The current model does not support direct image input.`,
                  `The image is available at: ${url}`,
                  ``,
                  `To analyze this image, call the describe_image tool with path="${url}".`,
                ].join("\n")
              } else {
                continue
              }
              message.content[index] = { type: "text", text: replacement } as (typeof message.content)[number]
            } catch (error) {
              message.content[index] = {
                type: "text",
                text: `[Image attachment "${part.filename ?? "image"}" could not be processed. Error: ${error instanceof Error ? error.message : String(error)}]`,
              } as (typeof message.content)[number]
            }
          }
        }
      }
    })

    await context.session.hook("prompt", async (input) => {
      if (!optimizeEnabled) return
      let agentId: string | undefined
      try {
        const session = await context.session.get(input.sessionID)
        agentId = session?.agent
      } catch {
        return
      }
      if (agentId && OPTIMIZABLE_AGENT_IDS.has(agentId)) optimizedSessions.add(input.sessionID)
      else optimizedSessions.delete(input.sessionID)
    })

    await context.session.hook("compaction", async (input) => {
      const focusFile = `${process.env.HOME ?? ""}/.config/openchamber/compact-focus/${input.sessionID}.txt`
      try {
        const file = await import("node:fs")
        if (!file.existsSync(focusFile)) return
        const focus = file.readFileSync(focusFile, "utf8").trim()
        if (focus) {
          input.system.push({
            type: "text",
            text: `## User-specified compaction focus\n\n${focus}`,
          } as (typeof input.system)[number])
          log("compaction-focus: injected focus", { sessionID: input.sessionID })
        }
        file.unlinkSync(focusFile)
      } catch (error) {
        if (!(error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT")) {
          log("compaction-focus: failed", { error: String(error) })
        }
      }
    })

    return () => {
      cacheDb?.close()
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
