/** Module-level temp session tracker (not Zustand — no render subscribers, avoids store type sprawl). */

const tempSessionDirectories = new Map<string, string>()
const renamedSessions = new Set<string>()

export function registerTempSession(sessionId: string, directory: string): void {
  tempSessionDirectories.set(sessionId, directory)
}

export function unregisterTempSession(sessionId: string): void {
  tempSessionDirectories.delete(sessionId)
  renamedSessions.delete(sessionId)
}

export function getTempSessionDirectory(sessionId: string): string | undefined {
  return tempSessionDirectories.get(sessionId)
}

export function isTempSession(sessionId: string): boolean {
  return tempSessionDirectories.has(sessionId)
}

export function markTempSessionRenamed(sessionId: string): void {
  renamedSessions.add(sessionId)
}

export function isTempSessionRenamed(sessionId: string): boolean {
  return renamedSessions.has(sessionId)
}
