import { normalizePath } from "@/lib/pathNormalization"
import { useMessageQueueStore } from "@/stores/messageQueueStore"
import { useSessionFoldersStore } from "@/stores/useSessionFoldersStore"

/** Re-scope folder membership from the source directory to the destination. */
export const migrateSessionFoldersForMove = (
  sessionIds: readonly string[],
  sourceDirectory: string,
  destinationDirectory: string,
): void => {
  const sourceScope = normalizePath(sourceDirectory) ?? sourceDirectory
  const destScope = normalizePath(destinationDirectory) ?? destinationDirectory
  if (!sourceScope || !destScope || sourceScope === destScope) return

  const store = useSessionFoldersStore.getState()
  const sourceFolders = store.getFoldersForScope(sourceScope)
  if (sourceFolders.length === 0) return

  for (const sessionId of sessionIds) {
    const folderId = store.getSessionFolderId(sourceScope, sessionId)
    if (!folderId) continue
    const sourceFolder = sourceFolders.find((folder) => folder.id === folderId)
    if (!sourceFolder) continue

    let destFolder = store.getFoldersForScope(destScope).find((folder) => folder.name === sourceFolder.name)
    if (!destFolder) {
      destFolder = store.createFolder(destScope, sourceFolder.name)
    }
    store.removeSessionFromFolder(sourceScope, sessionId)
    store.addSessionToFolder(destScope, destFolder.id, sessionId)
  }
}

/** Rewrite queue sendTarget.directory for moved sessions that still point at the source. */
export const migrateQueuedSendTargetsForMove = (
  sessionIds: readonly string[],
  sourceDirectory: string,
  destinationDirectory: string,
): void => {
  const source = normalizePath(sourceDirectory) ?? sourceDirectory
  const destination = normalizePath(destinationDirectory) ?? destinationDirectory
  if (!source || !destination || source === destination) return

  const sessionIdSet = new Set(sessionIds)
  useMessageQueueStore.setState((state) => {
    let changed = false
    const nextQueued: typeof state.queuedMessages = { ...state.queuedMessages }

    for (const sessionId of sessionIdSet) {
      const queue = nextQueued[sessionId]
      if (!queue?.length) continue

      let queueChanged = false
      const rewritten = queue.map((message) => {
        const currentDirectory = normalizePath(message.sendTarget?.directory ?? null)
        if (!currentDirectory || currentDirectory !== source) return message
        queueChanged = true
        return {
          ...message,
          sendTarget: {
            ...message.sendTarget,
            directory: destination,
          },
        }
      })
      if (queueChanged) {
        changed = true
        nextQueued[sessionId] = rewritten
      }
    }

    return changed ? { queuedMessages: nextQueued } : state
  })
}
