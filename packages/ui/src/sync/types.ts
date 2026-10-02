import type { FormInfo } from "@opencode/client"
import type {
  Agent,
  Config,
  Event,
  LspStatus,
  Message,
  Part,
  Path,
  PermissionRequest,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from "@opencode-ai/sdk/v2/client"
import type { FormRequest } from "@/types/form"

export type FileDiff = {
  file?: string
  status?: string
  additions?: number
  deletions?: number
  patch?: string
  [key: string]: unknown
}

export type ProjectMeta = {
  name?: string
  icon?: {
    override?: string
    color?: string
  }
  commands?: {
    start?: string
  }
}

/** Per-directory store state */
export type State = {
  status: "loading" | "partial" | "complete"
  agent: Agent[]
  project: string
  projectMeta: ProjectMeta | undefined
  icon: string | undefined
  provider: ProviderListResponse
  config: Config
  path: Path
  session: Session[]
  sessionTotal: number
  session_status: Record<string, SessionStatus>
  /**
   * Wall-clock ms of the last `message.part.updated` / `message.part.delta`
   * we saw per session. Used as a recency gate by `useSessionActivity`: if the
   * server reports idle but parts are still streaming, the UI treats it as
   * busy so the Stop button stays available during provider-side desync
   * (premature session.idle, subagent boundary races, etc.).
   */
  session_activity: Record<string, number>
  session_diff: Record<string, FileDiff[]>
  todo: Record<string, Todo[]>
  permission: Record<string, PermissionRequest[]>
  /**
   * Pending blocking forms keyed by session. Holds the v1 protocol track's
   * payloads (the wire keeps the `question.*` event names there). The v2
   * track's typed forms ride the adjacent `nativeForm` channel so the two
   * wire shapes never merge.
   */
  form: Record<string, FormRequest[]>
  /**
   * Pending v2 typed forms (`@/lib/opencode/model` `FormRequest`), fed by the
   * server-translated `form.created` / `form.settled` events (S2
   * translate-v2). Always empty on the v1 track; consumed by
   * `useScopedBlockingForms` and the v2 dock surfaces.
   */
  nativeForm: Record<string, FormInfo[]>
  lsp: LspStatus[]
  vcs: VcsInfo | undefined
  limit: number
  message: Record<string, Message[]>
  part: Record<string, Part[]>
}

/** Global store state */
export type GlobalState = {
  ready: boolean
  error?: InitError
  path: Path
  projects: Project[]
  providers: ProviderListResponse
  providerAuth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
  sessionTodo: Record<string, Todo[]>
}

export type InitError = {
  type: "init"
  message: string
}

/**
 * The v2 blocking-form frames the OpenChamber server translates from
 * OpenCode 2.x `session.form.*` events (S2 translate-v2). They ride the same
 * stream as the SDK's v1 `Event` union but are not part of it, so the
 * directory reducer and the cold-directory classifier take
 * `Event | FormEventFrame`.
 */
export type FormEventFrame =
  | { type: "form.created"; properties: { sessionID: string; form: FormInfo } }
  | { type: "form.settled"; properties: { sessionID: string; formID: string } }

/**
 * OC2 bridge-only frames (spine S6): the wire bridge emits these names for
 * v2-mode servers; the v1 wire never produces them, so they ride the same
 * adjacent channel the `form.*` frames established. Carrying them here lets
 * the reducer switch over `Event | FormEventFrame` exhaustively without
 * widening the v1 `Event` union.
 */
export type BridgeEventFrame =
  | { type: "session.patched"; properties: { sessionID: string; patch: Record<string, unknown> } }
  | { type: "message.patched"; properties: { sessionID: string; messageID: string; patch: Record<string, unknown> } }
  | {
      type: "message.tool.transition"
      properties: { sessionID?: string; messageID: string; partID: string; transition: Record<string, unknown> }
    }

export type DirectoryEventFrame = Event | FormEventFrame | BridgeEventFrame

export type DirState = {
  lastAccessAt: number
}

export type EvictPlan = {
  stores: string[]
  state: Map<string, DirState>
  pins: Set<string>
  max: number
  ttl: number
  now: number
  hasActiveSessions?: (directory: string) => boolean
  hasPendingBlockingRequests?: (directory: string) => boolean
}

export type DisposeCheck = {
  directory: string
  hasStore: boolean
  pinned: boolean
  booting: boolean
  loadingSessions: boolean
  hasActiveSessions: boolean
  hasPendingBlockingRequests: boolean
}

export type ChildOptions = {
  bootstrap?: boolean
}

export const MAX_DIR_STORES = 30
export const DIR_IDLE_TTL_MS = 20 * 60 * 1000
export const SESSION_RECENT_WINDOW = 4 * 60 * 60 * 1000
export const SESSION_RECENT_LIMIT = 50
export const SESSION_CACHE_LIMIT = 40

export const INITIAL_STATE: State = {
  project: "",
  projectMeta: undefined,
  icon: undefined,
  provider: { all: [], connected: [], default: {} },
  config: {},
  path: { state: "", config: "", worktree: "", directory: "", home: "" },
  status: "loading",
  agent: [],
  session: [],
  sessionTotal: 0,
  session_status: {},
  session_activity: {},
  session_diff: {},
  todo: {},
  permission: {},
  form: {},
  nativeForm: {},
  lsp: [],
  vcs: undefined,
  limit: 5,
  message: {},
  part: {},
}

export const INITIAL_GLOBAL_STATE: GlobalState = {
  ready: false,
  path: { state: "", config: "", worktree: "", directory: "", home: "" },
  projects: [],
  providers: { all: [], connected: [], default: {} },
  providerAuth: {},
  config: {},
  reload: undefined,
  sessionTodo: {},
}
