import type { OpencodeClient, PermissionRequest, Project } from "@opencode-ai/sdk/v2/client"
import type { FormRequest } from "@/types/form"
import type { SessionStatus } from "@opencode-ai/sdk/v2/client"
import { retry } from "./retry"
import type { GlobalState, State } from "./types"
import { formatSdkError } from "./sdk-error"
import { emitSyncConfigChanged } from "./sync-refs"
import { reconcileSessionActivityTiming } from "./session-activity-timing"

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const BOOTSTRAP_REQUEST_TIMEOUT_MS = 8_000
const GLOBAL_BOOTSTRAP_RETRY_OPTIONS = {
  attempts: 10,
  delay: 500,
  factor: 1.5,
  maxDelay: 3_000,
} as const

const readErrorStatus = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined
  return typeof error.status === "number" ? error.status : undefined
}

export const shouldLogBootstrapFailureAsInfo = (error: unknown): boolean => readErrorStatus(error) === 503

const logBootstrapFailure = (message: string, error: unknown): void => {
  if (shouldLogBootstrapFailureAsInfo(error)) {
    console.info(message, error)
    return
  }
  console.error(message, error)
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`${label} timed out`)
      ;(err as Error & { status?: number }).status = 503
      reject(err)
    }, BOOTSTRAP_REQUEST_TIMEOUT_MS)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * SDK returns `{ data, error, response }` without throwing on non-2xx.
 * The silent `x.data!` / `x.data ?? []` pattern lets HTTP 5xx warmup
 * errors become empty state. Wrap into a real Error so retry() fires.
 */
function unwrap<T>(
  result: { data?: T; error?: unknown; response?: { status?: number } },
  name: string,
): T {
  if (result.error) {
    const rawError = result.error
    const status = result.response?.status
    const message = formatSdkError(rawError)
    const err = new Error(`${name} failed${status ? ` (${status})` : ""}: ${message}`)
    if (status !== undefined) {
      ;(err as Error & { status?: number }).status = status
    }
    throw err
  }
  if (result.data === undefined) {
    // No error + no data: ambiguous, treat as transient so retry fires.
    const err = new Error(`${name} returned no data`)
    ;(err as Error & { status?: number }).status = 503
    throw err
  }
  return result.data
}

const requestSignature = (items: Array<{ id: string }> | undefined): string => {
  if (!items || items.length === 0) return ""
  return items
    .map((item) => item.id)
    .sort(cmp)
    .join("|")
}

function groupBySession<T extends { id: string; sessionID: string }>(input: T[]) {
  return input.reduce<Record<string, T[]>>((acc, item) => {
    if (!item?.id || !item.sessionID) return acc
    const list = acc[item.sessionID]
    if (list) list.push(item)
    else acc[item.sessionID] = [item]
    return acc
  }, {})
}

function projectID(directory: string, projects: Project[]) {
  return projects.find(
    (project) => project.worktree === directory || project.sandboxes?.includes(directory),
  )?.id
}

// ---------------------------------------------------------------------------
// Bootstrap global state
// ---------------------------------------------------------------------------

export async function bootstrapGlobal(
  sdk: OpencodeClient,
  set: (patch: Partial<GlobalState>) => void,
) {
  const retryGlobal = <T>(operation: () => Promise<T>) => retry(operation, GLOBAL_BOOTSTRAP_RETRY_OPTIONS)
  const results = await Promise.allSettled([
    retryGlobal(() => sdk.path.get().then((x) => set({ path: unwrap(x, "path.get") }))),
    retryGlobal(() => sdk.global.config.get().then((x) => set({ config: unwrap(x, "global.config.get") }))),
    retryGlobal(() =>
      sdk.project.list().then((x) => {
        const data = unwrap(x, "project.list")
        const projects = data
          .filter((p): p is Project => !!p?.id)
          .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
          .sort((a, b) => cmp(a.id, b.id))
        set({ projects })
      }),
    ),
    retryGlobal(() => sdk.provider.list().then((x) => set({ providers: unwrap(x, "provider.list") }))),
  ])

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason)
  if (errors.length) {
    console.error("[bootstrap] global bootstrap failed", errors[0])
  }

  // If ALL requests failed, OpenCode is likely down — fetch the OpenChamber
  // health endpoint (outside the readiness gate) to get the actual error reason.
  if (errors.length === results.length) {
    let message = errors[0] instanceof Error ? errors[0].message : String(errors[0])
    try {
      const healthRes = await fetch("/health", { signal: AbortSignal.timeout(4000) })
      if (healthRes.ok) {
        const health = await healthRes.json()
        if (health.lastOpenCodeError) {
          message = health.lastOpenCodeError
        } else if (!health.openCodeRunning) {
          message = "OpenCode process is not running"
        }
      }
    } catch {
      // health endpoint itself unreachable — use the original error
    }
    set({ ready: true, error: { type: "init", message } })
  } else {
    set({ ready: true, error: undefined })
  }
}

// ---------------------------------------------------------------------------
// Bootstrap per-directory state
// ---------------------------------------------------------------------------

export async function bootstrapDirectory(input: {
  directory: string
  serverId: string
  sdk: OpencodeClient
  getState: () => State
  set: (patch: Partial<State>) => void
  global: {
    config: Record<string, unknown>
    projects: Project[]
    providers: { all: unknown[]; connected: unknown[]; default: Record<string, unknown> }
  }
  loadSessions: (directory: string) => Promise<unknown> | unknown
  loadMetadata?: boolean
}): Promise<boolean> {
  const { directory, serverId, sdk, getState, set, global: g } = input
  const state = getState()
  const loading = state.status !== "complete"

  // Seed from global state while we fetch directory-specific data
  const seededProject = projectID(directory, g.projects)
  if (seededProject) set({ project: seededProject })
  // [fork-port] guard: the providers snapshot can be malformed outside the
  // normal provider (e.g. thin test doubles).
  if (state.provider?.all && g.providers?.all && state.provider.all.length === 0 && g.providers.all.length > 0) {
    set({ provider: g.providers as State["provider"] })
  }
  if (Object.keys(state.config ?? {}).length === 0 && Object.keys(g.config ?? {}).length > 0) {
    const seededConfig = g.config as State["config"]
    set({ config: seededConfig })
    emitSyncConfigChanged(directory, seededConfig)
  }
  if (loading) set({ status: "partial" })

  const sessionLoad = Promise.resolve(input.loadSessions(directory)).catch((err) => {
    logBootstrapFailure(`[bootstrap] session load failed for ${directory}`, err)
    throw err
  })

  // ---------------------------------------------------------------------------
  // Phase 1: Critical path — only wait for the small, directory-authoritative
  // calls and session list. Heavy provider/config payloads are deferred so
  // remote sidebars can show sessions without waiting on large settings data.
  // ---------------------------------------------------------------------------
  const shouldLoadMetadata = input.loadMetadata !== false
  const metadataLoads = shouldLoadMetadata
    ? [
        retry(() =>
          withTimeout(sdk.path.get({ directory }), "path.get").then((x) => {
            const data = unwrap(x, "path.get")
            set({ path: data })
            const next = projectID(data?.directory ?? directory, g.projects)
            if (next) set({ project: next })
          }),
        ),
        retry(() =>
          withTimeout(sdk.session.status({ directory }), "session.status").then((x) => {
            const sessionStatus = unwrap(x, "session.status")
            set({ session_status: sessionStatus })
            reconcileTimingFromSnapshot(serverId, directory, sessionStatus, getState)
          }),
        ),
      ]
    : []

  const phase1Results = await Promise.allSettled([
    ...metadataLoads,
    sessionLoad,
  ])

  const phase1Errors = phase1Results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason)

  // Session list is the UI-critical payload. Path/status enrich the directory,
  // but they must not keep a remote sidebar stuck in "partial" when sessions are available.
  const sessionLoadResult = phase1Results[phase1Results.length - 1]
  const criticalPhase1Failed = sessionLoadResult.status === "rejected"

  if (phase1Errors.length === phase1Results.length || criticalPhase1Failed) {
    logBootstrapFailure(`[bootstrap] directory bootstrap failed for ${directory}`, phase1Errors[0])
    if (loading) set({ status: "loading" })
    return false
  }

  if (phase1Errors.length) {
    console.warn(`[bootstrap] directory metadata partially failed for ${directory}`, phase1Errors[0])
  }

  // Mark ready after critical data arrives so the UI can paint.
  if (loading) set({ status: "complete" })

  if (input.loadMetadata === false) {
    return true
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Deferrable — fetch after first paint without blocking.
  // These enrich the UI but aren't required for basic functionality.
  // ---------------------------------------------------------------------------
  void Promise.allSettled([
    seededProject
      ? Promise.resolve()
      : retry(() => sdk.project.current({ directory }).then((x) => set({ project: unwrap(x, "project.current").id }))),
    retry(() => sdk.provider.list({ directory }).then((x) => set({ provider: unwrap(x, "provider.list") }))),
    retry(() => sdk.config.get({ directory }).then((x) => {
      const config = unwrap(x, "config.get")
      set({ config })
      emitSyncConfigChanged(directory, config)
    })),
    retry(() => sdk.app.agents({ directory }).then((x) => set({ agent: unwrap(x, "app.agents") }))),
    // MCP status and the command list are deliberately not read here. Reading
    // MCP state initializes the directory's whole stdio server fleet as an
    // OpenCode side effect, and listing commands enumerates MCP prompts,
    // which touches that same state. Every directory bootstrapped at startup
    // would otherwise launch one full fleet per project. Both surfaces fetch
    // on demand through their own stores (useMcpStore, useCommandsStore).
    retry(() => sdk.lsp.status({ directory }).then((x) => set({ lsp: unwrap(x, "lsp.status") }))),
    retry(() =>
      sdk.vcs.get({ directory }).then((x) => {
        const current = getState()
        if (x.error) {
          throw new Error(`vcs.get failed: ${String(x.error)}`)
        }
        set({ vcs: x.data ?? current.vcs })
      }),
    ),
    retry(async () => {
      const before = getState()
      const beforeSignatures = new Map(
        Object.entries(before.form ?? {}).map(([sessionID, forms]) => [sessionID, requestSignature(forms)]),
      )
      const x = await sdk.question.list(directory ? { directory } : undefined)
      if (x.error) {
        const status = (x as { response?: { status?: number } }).response?.status
        const err = new Error(`question.list failed${status ? ` (${status})` : ""}: ${String(x.error)}`)
        if (status !== undefined) (err as Error & { status?: number }).status = status
        throw err
      }
      const grouped = groupBySession(
        (x.data ?? []).filter((q): q is FormRequest => !!q?.id && !!q.sessionID),
      )
      const current = getState()
      const merged = { ...current.form }
      for (const [sessionID, forms] of Object.entries(grouped)) {
        merged[sessionID] = forms
          .filter((q) => !!q?.id)
          .sort((a, b) => cmp(a.id, b.id))
      }
      for (const sessionID of beforeSignatures.keys()) {
        if (grouped[sessionID]) continue
        const beforeSignature = beforeSignatures.get(sessionID) ?? ""
        const currentSignature = requestSignature(current.form[sessionID])
        if (currentSignature !== beforeSignature) continue
        delete merged[sessionID]
      }
      set({ form: merged })
    }),
    retry(async () => {
      const before = getState()
      const beforeSignatures = new Map(
        Object.entries(before.permission ?? {}).map(([sessionID, permissions]) => [sessionID, requestSignature(permissions)]),
      )
      const x = await sdk.permission.list(directory ? { directory } : undefined)
      if (x.error) {
        const status = (x as { response?: { status?: number } }).response?.status
        const err = new Error(`permission.list failed${status ? ` (${status})` : ""}: ${String(x.error)}`)
        if (status !== undefined) (err as Error & { status?: number }).status = status
        throw err
      }
      const grouped = groupBySession(
        (x.data ?? []).filter((perm): perm is PermissionRequest => !!perm?.id && !!perm?.sessionID),
      )
      const current = getState()
      const merged = { ...current.permission }
      for (const [sessionID, perms] of Object.entries(grouped)) {
        merged[sessionID] = perms
          .filter((p) => !!p?.id)
          .sort((a, b) => cmp(a.id, b.id))
      }
      for (const sessionID of beforeSignatures.keys()) {
        if (grouped[sessionID]) continue
        const beforeSignature = beforeSignatures.get(sessionID) ?? ""
        const currentSignature = requestSignature(current.permission[sessionID])
        if (currentSignature !== beforeSignature) continue
        delete merged[sessionID]
      }
      set({ permission: merged })
    }),
  ]).then((results) => {
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason)
    if (errors.length) {
      console.error(`[bootstrap] deferred phase failed for ${directory}`, errors[0])
    }
  })

  return true
}

function reconcileTimingFromSnapshot(
  serverId: string,
  directory: string,
  sessionStatus: Record<string, SessionStatus>,
  getState: () => State,
): void {
  const activeIds = new Set<string>()
  for (const [id, status] of Object.entries(sessionStatus)) {
    if (status?.type !== "idle") activeIds.add(id)
  }
  const knownSessions = new Set(
    getState().session.map((s) => s.id).filter(Boolean),
  )
  reconcileSessionActivityTiming(
    serverId,
    directory,
    activeIds,
    (sessionId) => knownSessions.has(sessionId) || sessionId in sessionStatus,
  )
}
