import React from "react"

import { canUseElectronDesktopIPC, invokeDesktop } from "@/lib/desktop"

type DockBadgeSession = {
  readonly id: string
  readonly parentID?: string
}

export function countDockBadgeChats(input: {
  readonly sessions: readonly DockBadgeSession[]
  readonly unseenCount: Readonly<Record<string, number>>
  readonly notifyOnSubtasks: boolean
}): number {
  const sessionsById = new Map<string, DockBadgeSession>()
  const childrenByParent = new Map<string, string[]>()

  for (const session of input.sessions) {
    if (!session.id || sessionsById.has(session.id)) continue
    sessionsById.set(session.id, session)
    if (!session.parentID) continue
    const children = childrenByParent.get(session.parentID) ?? []
    children.push(session.id)
    childrenByParent.set(session.parentID, children)
  }

  let count = 0
  for (const session of sessionsById.values()) {
    if (session.parentID) continue
    if ((input.unseenCount[session.id] ?? 0) > 0) {
      count += 1
      continue
    }
    if (!input.notifyOnSubtasks) continue

    const pending = [...(childrenByParent.get(session.id) ?? [])]
    const visited = new Set<string>()
    let familyHasUnseen = false
    while (pending.length > 0) {
      const sessionId = pending.pop()
      if (!sessionId || visited.has(sessionId)) continue
      visited.add(sessionId)
      if ((input.unseenCount[sessionId] ?? 0) > 0) {
        familyHasUnseen = true
        break
      }
      pending.push(...(childrenByParent.get(sessionId) ?? []))
    }
    if (familyHasUnseen) count += 1
  }

  return count
}

export function useDesktopDockUnreadBadge(unreadCount: number, enabled: boolean): void {
  React.useEffect(() => {
    if (!canUseElectronDesktopIPC()) return

    void invokeDesktop("desktop_set_dock_badge", { count: enabled ? unreadCount : 0 }).then(undefined, () => {
      // Dock badges are best-effort; unread state remains server-backed.
    })
  }, [enabled, unreadCount])
}
