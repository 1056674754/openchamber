import type { Message, Part } from "@opencode-ai/sdk/v2"

export type SessionTitleCandidateResult = {
  candidates: string[]
  generated: boolean
  reason?: string
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
 */
export async function fetchSessionTitleCandidates(text: string): Promise<SessionTitleCandidateResult> {
  if (!text.trim()) {
    return { candidates: [], generated: false, reason: "No text to summarize" }
  }

  try {
    const res = await fetch("/api/text/session-title-candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, count: 3, maxLength: 60 }),
    })

    if (!res.ok) {
      return { candidates: [], generated: false, reason: `HTTP ${res.status}: ${res.statusText}` }
    }

    const data = await res.json()
    return {
      candidates: Array.isArray(data?.candidates) ? data.candidates : [],
      generated: !!data?.generated,
      reason: data?.reason,
    }
  } catch (err) {
    return { candidates: [], generated: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
