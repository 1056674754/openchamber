/**
 * Async summarizer: uses OpenCode's small_model to generate a 1-2 sentence
 * summary of a look_at analysis result.
 *
 * Creates an ephemeral session, sends a summarization prompt with the
 * small_model, polls for completion, extracts the text, then deletes
 * the session. All failures are silent — the caller falls back to
 * truncation if the summary never arrives.
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "./logger.js"

const POLL_INTERVAL_MS = 500
const MAX_POLL_DURATION_MS = 15_000
const SUMMARIZATION_SYSTEM = "You are a summarization assistant. Reply with a concise 1-2 sentence summary. No preamble, no markdown, just the summary."

type SmallModel = { providerID: string; modelID: string } | null

async function resolveSmallModel(client: PluginInput["client"], directory: string): Promise<SmallModel> {
  try {
    const response = await client.config.get({ query: { directory } })
    const config = response.data as Record<string, unknown> | undefined
    const raw = config?.small_model
    if (typeof raw !== "string" || !raw.includes("/")) return null
    const slashIdx = raw.indexOf("/")
    return { providerID: raw.slice(0, slashIdx), modelID: raw.slice(slashIdx + 1) }
  } catch {
    return null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollUntilIdle(
  client: PluginInput["client"],
  sessionId: string,
  directory: string,
): Promise<boolean> {
  const deadline = Date.now() + MAX_POLL_DURATION_MS
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS)
    try {
      const response = await client.session.status({ query: { directory } })
      const statuses = response.data as Record<string, { type: string }> | undefined
      const status = statuses?.[sessionId]
      if (!status) continue
      if (status.type === "idle") return true
      if (status.type === "retry") continue
    } catch {
      // keep polling
    }
  }
  return false
}

async function extractLastAssistantText(
  client: PluginInput["client"],
  sessionId: string,
  directory: string,
): Promise<string | null> {
  try {
    const response = await client.session.messages({
      path: { id: sessionId },
      query: { directory },
    })
    const messages = response.data as Array<{
      info: { role?: string }
      parts: Array<{ type: string; text?: string }>
    }> | undefined
    if (!Array.isArray(messages)) return null

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!
      if (msg.info?.role !== "assistant") continue
      for (const part of msg.parts ?? []) {
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
          return part.text.trim()
        }
      }
    }
    return null
  } catch {
    return null
  }
}

export type Summarizer = {
  summarize(text: string): Promise<string | null>
}

export function createSummarizer(
  client: PluginInput["client"],
  directory: string,
): Summarizer {
  let cachedModel: SmallModel | undefined

  async function getModel(): Promise<SmallModel> {
    if (cachedModel !== undefined) return cachedModel
    cachedModel = await resolveSmallModel(client, directory)
    return cachedModel
  }

  return {
    summarize: async (text: string): Promise<string | null> => {
      if (text.trim().length < 100) return null

      const model = await getModel()
      if (!model) return null

      let sessionId: string | null = null
      try {
        const createResponse = await client.session.create({ query: { directory } })
        sessionId = (createResponse.data as { id?: string } | undefined)?.id ?? null
        if (!sessionId) return null

        await client.session.promptAsync({
          path: { id: sessionId },
          query: { directory },
          body: {
            parts: [{ type: "text", text: `Summarize this image analysis in 1-2 sentences:\n\n${text}` }],
            model,
            system: SUMMARIZATION_SYSTEM,
            tools: {},
          },
        })

        const done = await pollUntilIdle(client, sessionId, directory)
        if (!done) return null

        return await extractLastAssistantText(client, sessionId, directory)
      } catch (error) {
        log("[summarizer] failed", { error: String(error) })
        return null
      } finally {
        if (sessionId) {
          try {
            await client.session.delete({ path: { id: sessionId }, query: { directory } })
          } catch {
            // best-effort cleanup
          }
        }
      }
    },
  }
}
