import React from "react"

import { canUseElectronDesktopIPC, invokeDesktop } from "@/lib/desktop"

export function useDesktopDockUnreadBadge(unreadCount: number): void {
  React.useEffect(() => {
    if (!canUseElectronDesktopIPC()) return

    void invokeDesktop("desktop_set_dock_badge", { count: unreadCount }).then(undefined, () => {
      // Dock badges are best-effort; unread state remains server-backed.
    })
  }, [unreadCount])
}
