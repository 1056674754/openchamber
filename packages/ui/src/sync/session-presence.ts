export type SessionPresenceAction = "view" | "unview"

type SessionPresenceSnapshot = {
  readonly sessionId: string | null
  readonly active: boolean
}

type SessionPresenceControllerOptions = {
  readonly getSnapshot: () => SessionPresenceSnapshot
  readonly send: (action: SessionPresenceAction, sessionId: string) => void
}

export type SessionPresenceController = {
  readonly refresh: () => void
  readonly heartbeat: () => void
  readonly dispose: () => void
}

type PageVisibilityDocument = {
  readonly visibilityState: string
  readonly hasFocus: () => boolean
}

export function isPageActivelyViewed(
  documentLike: PageVisibilityDocument | undefined = typeof document === "undefined" ? undefined : document,
): boolean {
  if (!documentLike) return true
  return documentLike.visibilityState === "visible" && documentLike.hasFocus()
}

export function createSessionPresenceController(
  options: SessionPresenceControllerOptions,
): SessionPresenceController {
  let viewedSessionId: string | null = null

  const resolveNextViewedSession = (): string | null => {
    const snapshot = options.getSnapshot()
    return snapshot.active && snapshot.sessionId ? snapshot.sessionId : null
  }

  const refresh = () => {
    const nextSessionId = resolveNextViewedSession()
    if (nextSessionId === viewedSessionId) return

    const previousSessionId = viewedSessionId
    viewedSessionId = nextSessionId

    if (previousSessionId) {
      options.send("unview", previousSessionId)
    }
    if (nextSessionId) {
      options.send("view", nextSessionId)
    }
  }

  const heartbeat = () => {
    const nextSessionId = resolveNextViewedSession()
    if (nextSessionId !== viewedSessionId) {
      refresh()
      return
    }
    if (nextSessionId) {
      options.send("view", nextSessionId)
    }
  }

  const dispose = () => {
    if (!viewedSessionId) return
    const previousSessionId = viewedSessionId
    viewedSessionId = null
    options.send("unview", previousSessionId)
  }

  return { refresh, heartbeat, dispose }
}
