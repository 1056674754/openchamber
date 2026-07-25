import { beforeEach, describe, expect, test } from "bun:test"
import { useMessageQueueStore } from "@/stores/messageQueueStore"
import { useSessionFoldersStore } from "@/stores/useSessionFoldersStore"
import {
  migrateQueuedSendTargetsForMove,
  migrateSessionFoldersForMove,
} from "@/lib/worktrees/sessionWorktreeMoveMigrations"

describe("sessionWorktreeMove migrations", () => {
  beforeEach(() => {
    useSessionFoldersStore.setState({
      foldersMap: {},
      collapsedFolderIds: new Set(),
      archivedAutoCollapsedScopes: new Set(),
    })
    useMessageQueueStore.setState({
      queuedMessages: {},
      followUpBehavior: "steer",
    })
  })

  test("rewrites folder membership from source scope to destination scope by name", () => {
    const store = useSessionFoldersStore.getState()
    const folder = store.createFolder("/source", "Active")
    store.addSessionToFolder("/source", folder.id, "ses_root")
    store.addSessionToFolder("/source", folder.id, "ses_child")

    migrateSessionFoldersForMove(["ses_root", "ses_child"], "/source", "/dest")

    expect(store.getSessionFolderId("/source", "ses_root")).toBe(null)
    expect(store.getSessionFolderId("/source", "ses_child")).toBe(null)
    const destFolderId = store.getSessionFolderId("/dest", "ses_root")
    expect(destFolderId).toBeTruthy()
    expect(store.getSessionFolderId("/dest", "ses_child")).toBe(destFolderId)
    expect(store.getFoldersForScope("/dest").find((entry) => entry.id === destFolderId)?.name).toBe("Active")
  })

  test("rewrites queue sendTarget.directory only when it matches the source", () => {
    useMessageQueueStore.setState({
      queuedMessages: {
        ses_root: [
          {
            id: "q1",
            content: "keep going",
            createdAt: 1,
            sendTarget: { directory: "/source", serverId: "remote-1" },
          },
          {
            id: "q2",
            content: "other dir",
            createdAt: 2,
            sendTarget: { directory: "/other", serverId: "remote-1" },
          },
        ],
      },
      followUpBehavior: "steer",
    })

    migrateQueuedSendTargetsForMove(["ses_root"], "/source", "/dest")

    const queue = useMessageQueueStore.getState().queuedMessages.ses_root
    expect(queue?.[0]?.sendTarget).toEqual({ directory: "/dest", serverId: "remote-1" })
    expect(queue?.[1]?.sendTarget).toEqual({ directory: "/other", serverId: "remote-1" })
  })
})
