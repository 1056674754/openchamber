import React from "react"

import { useSessionUIStore } from "@/sync/session-ui-store"
import {
  createSessionPresenceController,
  isPageActivelyViewed,
  type SessionPresenceAction,
} from "@/sync/session-presence"

const HEARTBEAT_MS = 20_000
const CLIENT_ID_STORAGE_KEY = "openchamber:session-presence-client-id"

function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function getClientId(): string {
  if (typeof sessionStorage === "undefined") return createClientId()
  try {
    const existing = sessionStorage.getItem(CLIENT_ID_STORAGE_KEY)
    if (existing) return existing
    const created = createClientId()
    sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, created)
    return created
  } catch {
    return createClientId()
  }
}

function sendSessionPresence(action: SessionPresenceAction, sessionId: string, clientId: string): void {
  void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/${action}`, {
    method: "POST",
    headers: { "x-client-id": clientId },
    keepalive: true,
  }).catch(() => undefined)
}

export function useSessionPresenceBeacon(options?: { readonly enabled?: boolean }): void {
  const enabled = options?.enabled ?? true
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId)

  React.useEffect(() => {
    if (!enabled || typeof document === "undefined" || typeof window === "undefined") return

    const clientId = getClientId()
    let pageHidden = false
    const controller = createSessionPresenceController({
      getSnapshot: () => ({
        sessionId: currentSessionId,
        active: !pageHidden && isPageActivelyViewed(),
      }),
      send: (action, sessionId) => sendSessionPresence(action, sessionId, clientId),
    })

    const refresh = () => controller.refresh()
    const handlePageHide = () => {
      pageHidden = true
      controller.refresh()
    }
    const handlePageShow = () => {
      pageHidden = false
      controller.refresh()
    }

    controller.refresh()
    const interval = window.setInterval(() => controller.heartbeat(), HEARTBEAT_MS)
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener("focus", refresh)
    window.addEventListener("blur", refresh)
    window.addEventListener("pagehide", handlePageHide)
    window.addEventListener("pageshow", handlePageShow)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("blur", refresh)
      window.removeEventListener("pagehide", handlePageHide)
      window.removeEventListener("pageshow", handlePageShow)
      controller.dispose()
    }
  }, [currentSessionId, enabled])
}
