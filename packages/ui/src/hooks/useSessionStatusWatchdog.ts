import React from "react"

import {
  useSessionStatus,
  useSessionActivityTimestamp,
} from "@/sync/sync-context"
import { useSessionStallStore } from "@/stores/useSessionStallStore"
import type { SessionStatus } from "@opencode-ai/sdk/v2/client"

const STALL_THRESHOLD_MS = 2 * 60 * 1000

type StallStatusType = "busy" | "retry"

function statusTypeForRecord(status: SessionStatus | undefined): StallStatusType | null {
  if (!status) return null
  if (status.type === "busy") return "busy"
  if (status.type === "retry") return "retry"
  return null
}

export function useSessionStatusWatchdog(sessionId: string | null | undefined): void {
  const safeSessionId = sessionId ?? ""
  const status = useSessionStatus(safeSessionId, undefined)
  const lastActivityAt = useSessionActivityTimestamp(safeSessionId, undefined)
  const markStalled = useSessionStallStore((s) => s.markStalled)
  const clearStall = useSessionStallStore((s) => s.clearStall)

  React.useEffect(() => {
    if (!sessionId) return

    const statusType = statusTypeForRecord(status)
    if (!statusType) {
      clearStall(sessionId)
      return
    }

    const referenceActivityAt = typeof lastActivityAt === "number" ? lastActivityAt : Date.now()
    const stallAt = referenceActivityAt + STALL_THRESHOLD_MS
    const remaining = stallAt - Date.now()

    const snapshot = status

    if (remaining <= 0) {
      markStalled({
        sessionId,
        lastActivityAt: referenceActivityAt,
        detectedAt: Date.now(),
        statusType,
        statusAttempt: snapshot?.type === "retry" ? snapshot.attempt : undefined,
        statusMessage: snapshot?.type === "retry" ? snapshot.message : undefined,
      })
      return
    }

    const timer = window.setTimeout(() => {
      markStalled({
        sessionId,
        lastActivityAt: referenceActivityAt,
        detectedAt: Date.now(),
        statusType,
        statusAttempt: snapshot?.type === "retry" ? snapshot.attempt : undefined,
        statusMessage: snapshot?.type === "retry" ? snapshot.message : undefined,
      })
    }, remaining + 100)

    return () => window.clearTimeout(timer)
  }, [sessionId, status, lastActivityAt, markStalled, clearStall])
}
