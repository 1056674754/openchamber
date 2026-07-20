const RETRY_DELAYS_MS = [0, 250, 1000] as const
const RECENT_OUTCOME_TTL_MS = 5000

export type VSCodePermissionTarget = {
  readonly directory?: string
  readonly serverId?: string
}

type PermissionIdentity = {
  readonly id: string
  readonly sessionID: string
}

type SessionLineage = {
  readonly id: string
  readonly parentID?: string
  readonly directory?: string
}

type Dependencies = {
  readonly getPolicy: () => Readonly<Record<string, boolean>>
  readonly getSessions: () => ReadonlyMap<string, SessionLineage>
  readonly getSession: (sessionId: string, target: VSCodePermissionTarget) => Promise<SessionLineage>
  readonly reply: (
    sessionId: string,
    requestId: string,
    target: VSCodePermissionTarget,
  ) => Promise<void>
  readonly wait: (delayMs: number) => Promise<void>
}

const getRequestKey = (permission: PermissionIdentity, target: VSCodePermissionTarget): string => (
  `${target.serverId ?? "default"}\u0000${target.directory ?? ""}\u0000${permission.id}`
)

export function createVSCodePermissionAutoAcceptRuntime(dependencies: Dependencies) {
  const inFlight = new Map<string, Promise<boolean>>()
  const recentOutcomes = new Set<string>()

  const isEnabled = async (sessionId: string, target: VSCodePermissionTarget): Promise<boolean> => {
    const policy = dependencies.getPolicy()
    const syncedSessions = dependencies.getSessions()
    const fetchedSessions = new Map<string, SessionLineage>()
    const seen = new Set<string>()
    let current: string | undefined = sessionId
    let currentTarget = target

    while (current && !seen.has(current)) {
      if (Object.prototype.hasOwnProperty.call(policy, current)) {
        return policy[current] === true
      }
      seen.add(current)

      let session: SessionLineage | undefined = syncedSessions.get(current) ?? fetchedSessions.get(current)
      if (!session) {
        try {
          session = await dependencies.getSession(current, currentTarget)
          fetchedSessions.set(session.id, session)
        } catch {
          return false
        }
      }

      current = session.parentID
      currentTarget = {
        ...currentTarget,
        directory: session.directory || currentTarget.directory,
      }
    }

    return false
  }

  const processPermission = (
    permission: PermissionIdentity,
    target: VSCodePermissionTarget,
  ): Promise<boolean> => {
    const requestKey = getRequestKey(permission, target)
    if (recentOutcomes.has(requestKey)) return Promise.resolve(true)

    const existing = inFlight.get(requestKey)
    if (existing) return existing

    const task = (async () => {
      if (!(await isEnabled(permission.sessionID, target))) return false

      for (const delay of RETRY_DELAYS_MS) {
        if (delay > 0) await dependencies.wait(delay)
        try {
          await dependencies.reply(permission.sessionID, permission.id, target)
          return true
        } catch {
          continue
        }
      }

      return false
    })().then((accepted) => {
      if (accepted) {
        recentOutcomes.add(requestKey)
        setTimeout(() => recentOutcomes.delete(requestKey), RECENT_OUTCOME_TTL_MS)
      }
      return accepted
    }).finally(() => inFlight.delete(requestKey))

    inFlight.set(requestKey, task)
    return task
  }

  return { processPermission }
}
