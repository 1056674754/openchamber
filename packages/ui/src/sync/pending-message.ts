/**
 * Pending message persistence — best-effort disk persistence for user messages
 * sent to new sessions, so they survive OpenChamber/OpenCode restarts.
 *
 * Server API contract:
 *   POST   /api/pending-messages          { sessionId, content, ... , createdAt }
 *   GET    /api/pending-messages           { messages: [...] }
 *   DELETE /api/pending-messages/:sessionId { success: true }
 *
 * All operations are best-effort: errors are caught and logged, never propagated.
 */

export interface PendingMessagePayload {
  sessionId: string
  content: string
  providerID: string
  modelID: string
  agent?: string
  variant?: string
  inputMode?: "normal" | "shell"
  directory?: string | null
  serverId?: string | null
  files?: Array<{ type: "file"; mime: string; url: string; filename: string }>
  additionalParts?: Array<{
    text: string
    synthetic?: boolean
    files?: Array<{ type: "file"; mime: string; url: string; filename: string }>
  }>
}

interface StoredPendingMessage extends PendingMessagePayload {
  createdAt: number
}

// ---------------------------------------------------------------------------
// Save — best-effort write before the send attempt
// ---------------------------------------------------------------------------

export async function savePendingMessage(
  params: PendingMessagePayload,
): Promise<void> {
  try {
    const body: StoredPendingMessage = { ...params, createdAt: Date.now() }
    const res = await fetch("/api/pending-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(
        "[pending-message] save failed",
        res.status,
        await res.text().catch(() => ""),
      )
    }
  } catch (err) {
    console.warn("[pending-message] save error", err)
  }
}

// ---------------------------------------------------------------------------
// Delete — best-effort cleanup after successful send
// ---------------------------------------------------------------------------

export async function deletePendingMessage(
  sessionId: string,
): Promise<void> {
  try {
    const res = await fetch(
      `/api/pending-messages/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    )
    if (!res.ok) {
      console.warn(
        "[pending-message] delete failed",
        res.status,
        await res.text().catch(() => ""),
      )
    }
  } catch (err) {
    console.warn("[pending-message] delete error", err)
  }
}

// ---------------------------------------------------------------------------
// Recover — retry all pending messages after SSE connection is established
// ---------------------------------------------------------------------------

// Prevent concurrent recovery runs
let recoveryInProgress = false

export async function recoverPendingMessages(): Promise<void> {
  if (recoveryInProgress) return
  recoveryInProgress = true

  try {
    // Lazy import to avoid circular dependencies at module evaluation time.
    // routeMessage lives in session-ui-store which is already imported by the
    // sync layer. We only need it inside this function body.
    const { routeMessage: routeMessageFn } = await import(
      "./session-ui-store"
    )

    const res = await fetch("/api/pending-messages")
    if (!res.ok) {
      console.warn(
        "[pending-message] recover fetch failed",
        res.status,
        await res.text().catch(() => ""),
      )
      return
    }

    const data = (await res.json()) as {
      messages?: StoredPendingMessage[]
    }
    const messages = data.messages ?? []

    // Sort by createdAt so we retry in original order
    messages.sort((a, b) => a.createdAt - b.createdAt)

    for (const msg of messages) {
      try {
        await routeMessageFn({
          sessionId: msg.sessionId,
          content: msg.content,
          providerID: msg.providerID,
          modelID: msg.modelID,
          agent: msg.agent,
          variant: msg.variant,
          inputMode: msg.inputMode,
          directory: msg.directory,
          serverId: msg.serverId,
          files: msg.files,
          additionalParts: msg.additionalParts,
        })

        // Success — remove from disk
        await deletePendingMessage(msg.sessionId)
      } catch (err) {
        // Retry failed — keep the file for next restart
        console.warn(
          "[pending-message] recover retry failed for session",
          msg.sessionId,
          err,
        )
      }

      // Small delay between retries to avoid overwhelming the server
      await new Promise((r) => setTimeout(r, 100))
    }
  } catch (err) {
    console.warn("[pending-message] recover error", err)
  } finally {
    recoveryInProgress = false
  }
}
