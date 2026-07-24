import type { Message, Part } from "@opencode-ai/sdk/v2"

export type SessionTitleCandidateResult = {
  candidates: string[]
  generated: boolean
  reason?: string
  providerID?: string
  modelID?: string
  source?: string
}

export type FetchSessionTitleCandidatesInput = {
  text: string
  directory?: string | null
  preferredProviderID?: string | null
  preferredModelID?: string | null
}

/**
 * Concatenate message texts into a single string, truncated to maxLength.
 */
export function buildSessionText(
  messages: { info: Message; parts: Part[] }[],
  maxLength = 8000,
): string {
  let text = ""
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        text += part.text + "\n"
      }
    }
    if (text.length >= maxLength) break
  }
  return text.slice(0, maxLength)
}

/**
 * POST to the session-title-candidates endpoint and return candidates.
 * Failures return empty candidates + an explicit reason — never fake titles.
 */
export async function fetchSessionTitleCandidates(
  input: FetchSessionTitleCandidatesInput,
): Promise<SessionTitleCandidateResult> {
  const text = typeof input.text === "string" ? input.text : ""
  if (!text.trim()) {
    return { candidates: [], generated: false, reason: "No text to summarize" }
  }

  try {
    const res = await fetch("/api/text/session-title-candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        count: 3,
        maxLength: 60,
        ...(typeof input.directory === "string" && input.directory.trim()
          ? { directory: input.directory.trim() }
          : {}),
        ...(typeof input.preferredProviderID === "string" && input.preferredProviderID.trim()
          ? { preferredProviderID: input.preferredProviderID.trim() }
          : {}),
        ...(typeof input.preferredModelID === "string" && input.preferredModelID.trim()
          ? { preferredModelID: input.preferredModelID.trim() }
          : {}),
      }),
    })

    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { reason?: unknown; error?: unknown } | null
      const reason =
        (typeof payload?.reason === "string" && payload.reason.trim())
        || (typeof payload?.error === "string" && payload.error.trim())
        || `HTTP ${res.status}: ${res.statusText}`
      return { candidates: [], generated: false, reason }
    }

    const data = await res.json()
    const candidates = Array.isArray(data?.candidates) ? data.candidates.filter((c: unknown): c is string => typeof c === "string" && c.trim().length > 0) : []
    const generated = data?.generated === true
    if (!generated || candidates.length === 0) {
      return {
        candidates: [],
        generated: false,
        reason: typeof data?.reason === "string" && data.reason.trim()
          ? data.reason
          : "Small model did not return titles",
        providerID: typeof data?.providerID === "string" ? data.providerID : undefined,
        modelID: typeof data?.modelID === "string" ? data.modelID : undefined,
        source: typeof data?.source === "string" ? data.source : undefined,
      }
    }

    return {
      candidates,
      generated: true,
      reason: typeof data?.reason === "string" ? data.reason : undefined,
      providerID: typeof data?.providerID === "string" ? data.providerID : undefined,
      modelID: typeof data?.modelID === "string" ? data.modelID : undefined,
      source: typeof data?.source === "string" ? data.source : undefined,
    }
  } catch (err) {
    return { candidates: [], generated: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
