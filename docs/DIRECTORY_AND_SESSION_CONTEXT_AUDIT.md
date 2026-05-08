# Directory and Session Context Audit

This document records the audited current-working-directory sources, OpenChamber session storage flow, and fallback policy for local, remote, and session-scoped work.

## Scope

- Current working directory means any project/workspace directory passed to OpenCode as `directory`, any filesystem `cwd`, or any UI directory used to scope Git, files, terminal, MCP, config, skills, or session actions.
- Local means the default server registered as `DEFAULT_SERVER_ID`.
- Remote means a project whose `ProjectEntry.serverId` points to a non-default `serverRegistry` connection.
- The dangerous bug class is cross-scope fallback: missing remote/session context becomes local `lastDirectory`, home, current UI directory, first project, or default SDK.

## Directory Sources And Getters

### Client Singleton

File: `packages/ui/src/lib/opencode/client.ts`

- `OpencodeService.currentDirectory`: global mutable directory used by most wrapper methods.
- `setDirectory(directory)`: normalizes and stores the singleton directory.
- `getDirectory()`: returns the singleton directory.
- `withDirectory(directory, fn)`: temporarily swaps `currentDirectory`; tries to swap to a remote SDK via `resolveSdkForDirectory`.
- `getScopedSdkClient(directory)` / `getScopedApiClient(directory)`: creates a directory-scoped SDK client against the current base URL.
- `getSystemInfo()`: derives home from `/path`, `/project/current`, session directories, current directory, `localStorage.lastDirectory`, `localStorage.homeDirectory`, `process.cwd()`, then `/`.
- Session APIs (`listSessions`, `createSession`, `getSession`, `deleteSession`, `messages`, `abort`, `fork`, etc.) pass `currentDirectory` when set.
- Prompt and command sends use `resolveBaseUrl(currentDirectory) ?? this.baseUrl`, so missing remote mapping becomes local/default base URL.

Risk: `currentDirectory` is global UI state, not authoritative session state.

### Directory Store

File: `packages/ui/src/stores/useDirectoryStore.ts`

- `currentDirectory`, `homeDirectory`, `directoryHistory`, `historyIndex` are the UI directory state.
- `getStoredLastDirectory()` reads `localStorage.lastDirectory`.
- `getStoredHomeDirectory()` reads `localStorage.homeDirectory`.
- `getProcessHomeDirectory()` reads `HOME` / `USERPROFILE`, then `process.cwd()`.
- `getHomeDirectory()` checks desktop-injected home, stored home except VS Code, process home, then `/`.
- `initializeHomeDirectory()` checks `/api/fs/home`, `opencodeClient.getSystemInfo()`, desktop home, then `getHomeDirectory()`.
- Initial directory is VS Code workspace, else `lastDirectory`, else home.
- `setDirectory`, `goBack`, `goForward`, `goHome`, `synchronizeHomeDirectory` all update `opencodeClient.currentDirectory`, `localStorage.lastDirectory`, and persisted desktop settings.

Risk: `lastDirectory` is a restoration hint. It is not authorization for server-side workspace operations.

### Projects Store

File: `packages/ui/src/stores/useProjectsStore.ts`

- `projects`: persisted project registry; remote entries carry `serverId`.
- `activeProjectId`: current selected project.
- `getVSCodeWorkspaceProject()`: forces VS Code to a single workspace project.
- Initial active project is persisted active id if valid; otherwise `projects[0]`.
- `addProject(path)`: adds local project and activates it.
- `ensureRemoteProject(path, serverId)`: adds remote project and currently activates it.
- `removeProject(id)`: active removal falls back to `nextProjects[0]` or home.
- `setActiveProject(id)`: sets active project and writes the project path into `DirectoryStore` and `opencodeClient`.
- `setActiveProjectIdOnly(id)`: changes active id without changing directory.
- `synchronizeFromSettings(settings)`: if active id is invalid, falls back to `mergedProjects[0]` and sets directory.

Risk: `projects[0]` is acceptable for visual selection only. It must not route actions.

### Session UI Store

File: `packages/ui/src/sync/session-ui-store.ts`

- `resolveDirectoryKey(session)`: `session.directory`, then `session.project.worktree`.
- `resolveSessionDirectory(sessionId)`: worktree attachment, worktree metadata, then all synced session records.
- `setCurrentSession(id, directoryHint)`: explicit hint, session directory, then fallback to `opencodeClient.getDirectory()` or `DirectoryStore.currentDirectory`.
- `openNewSessionDraft(options)`: explicit directory/project, current directory, persisted draft target, active project, then `projects[0]`.
- `createSession(...)`: `directoryOverride ?? opencodeClient.getDirectory()`.
- `getDirectoryForSession(sessionId)`: worktree attachment or synced session directory.

Risk: selecting or creating a session must not fall back to a global directory when authoritative session/project context is missing.

### Sync Context And Event Routing

File: `packages/ui/src/sync/sync-context.tsx`

- `SyncProvider` owns a `ChildStoreManager` keyed by directory.
- Per-directory bootstrap calls `sdk.session.list({ directory, roots: true, limit: 50 })`.
- Remote `SyncProvider`s mount with `directory=""` and ensure child stores for remote project directories.
- `setSyncRefs(...)` exposes SDK, child stores, and session-directory registration to non-React code.
- `setActionRefs(..., () => opencodeClient.getDirectory() || props.directory)` makes session actions inherit mutable global directory.
- Event routing index maps `sessionID -> directory` and `messageID -> sessionID`.
- `resolveDirectoryFromRoutingIndex`: indexed session, scan child stores, indexed message, scan parts, single-store fallback, then raw event directory.

Risk: the single-store fallback is acceptable only for event routing. The action ref fallback is not safe for existing-session mutations.

### Session Actions

File: `packages/ui/src/sync/session-actions.ts`

- `dir()`: dynamic global directory from `SyncProvider` refs.
- `sdkForSession(sessionId)`: session server index, then default server, then current SDK.
- `resolveSdkForDirectory(directory)`: exact project path with non-default `serverId`, otherwise default local SDK.
- `resolveBaseUrl(directory)`: exact remote project path, otherwise `undefined`.
- `getSessionDirectory(sessionId)`: session UI directory, then `dir()`.
- `createSession`: `directoryOverride ?? dir()`.
- Permission/question replies: request-id scan, session directory, then `dir()`.
- Revert/unrevert/fork often pass `directory: dir()` despite knowing `sessionId`.

Risk: existing session actions and permission/question replies must fail closed if the authoritative session/request directory is unknown.

### Server Directory Runtime

File: `packages/web/server/lib/opencode/project-directory-runtime.js`

- `resolveDirectoryCandidate(value)`: normalize and `path.resolve`.
- `validateDirectoryPath(candidate)`: requires existing directory.
- `resolveProjectDirectory(req)`: header/query directory, then `settings.lastDirectory`, then active project, then `projects[0]`.
- `resolveOptionalProjectDirectory(req)`: validates only explicit header/query directory; absent directory returns null.

Risk: `resolveProjectDirectory` is the highest-risk server fallback. It converts unscoped requests into stale/first-project local filesystem authority.

### Server Route Consumers

Files:

- `packages/web/server/lib/fs/routes.js`
- `packages/web/server/lib/opencode/routes.js`
- `packages/web/server/lib/git/service.js`
- `packages/web/server/lib/opencode/shared.js`
- `packages/web/server/lib/opencode/agents.js`
- `packages/web/server/lib/opencode/commands.js`
- `packages/web/server/lib/opencode/skills.js`
- `packages/web/server/lib/scheduled-tasks/runtime.js`

Findings:

- `/api/fs/write`, `/api/fs/delete`, `/api/fs/rename`, `/api/fs/mkdir`, normal `read/stat/raw` inherit `resolveProjectDirectory` through `resolveWorkspacePathFromContext`.
- `/api/fs/list` defaults missing `path` to `os.homedir()`.
- `/api/fs/exec` requires `cwd`, validates existence, but does not enforce workspace membership.
- `/api/fs/reveal` opens any existing local path.
- Provider source/disconnect routes can use `resolveProjectDirectory`; project/all config removal without explicit directory can affect the wrong project.
- Git `createGit()` without directory creates `simple-git` without a baseDir, which uses process cwd.
- Config/agent/command/skill project scope often becomes user scope when `workingDirectory` is missing; skills can resolve configured relative paths against `workingDirectory || process.cwd()`.

### OpenCode Lifecycle

Files:

- `packages/web/server/lib/opencode/lifecycle.js`
- `packages/web/server/lib/opencode/env-config.js`
- `packages/web/server/lib/opencode/network-runtime.js`
- `packages/web/server/lib/opencode/proxy.js`
- `packages/web/server/index.js`

Findings:

- `openCodeWorkingDirectory` defaults through HMR state to `os.homedir()` and is used as managed OpenCode spawn `cwd`.
- Invalid `OPENCODE_HOST` is logged and ignored, allowing fallback to port/local behavior.
- `OPENCODE_SKIP_START=true` with an effective port marks external ready without a readiness probe.
- Startup auto-detects configured/effective port, default local `4096`, and persisted `last-opencode-port` before starting managed OpenCode.
- `buildOpenCodeUrl` uses `openCodeBaseUrl ?? http://localhost:${openCodePort}`.
- Proxy target resolution can ultimately fall back to local port or hardcoded `http://127.0.0.1:3902`.

Risk: remote/external intent must never degrade into an unrelated local OpenCode server.

### Desktop And VS Code

Files:

- `packages/electron/main.mjs`
- `packages/electron/preload.mjs`
- `packages/vscode/src/opencode.ts`
- `packages/vscode/src/bridge-fs-runtime.ts`
- `packages/vscode/src/bridge-fs-helpers-runtime.ts`
- `packages/vscode/src/bridge-settings-runtime.ts`

Findings:

- Electron calls `process.chdir(os.homedir())` to avoid app-bundle cwd.
- Electron preload exposes local home only on local pages; remote pages get local origin but not local home.
- Electron host boot reports remote unreachable instead of silently choosing local, but local server still runs.
- VS Code working directory is first workspace folder or `os.homedir()`.
- VS Code `setWorkingDirectory(newPath)` currently ignores `newPath` and resets to workspace/home.
- VS Code FS bridges often use first workspace folder or home as root.

Risk: local home/workspace fallbacks are acceptable for local runtime bootstrap only, not remote or multi-root authority.

## Session Storage In OpenChamber

OpenChamber does not persist authoritative session transcripts. Authoritative session records, messages, parts, permissions, questions, todos, and status are owned by OpenCode through `@opencode-ai/sdk/v2` and proxied `/api/session*` routes.

OpenChamber stores derived/session-adjacent data:

- Per-directory sync child stores in memory: `session`, `message`, `part`, `session_status`, `permission`, `question`, etc.
- `useGlobalSessionsStore`: global/archive session row cache across directories.
- `useSessionUIStore`: current selection, draft state, abort prompts, UI-only state, worktree metadata mirror.
- `useSessionWorktreeStore`: in-memory authoritative session-worktree attachment mapping.
- `serverRegistry.sessionServerIndex`: in-memory `sessionId -> serverId` routing.
- `SyncProvider` event routing index: in-memory `sessionId -> directory` and `messageId -> sessionId`.
- LocalStorage/settings: `lastDirectory`, `homeDirectory`, `projects`, `activeProjectId`, session folders/preferences, draft target.
- `messageCursorPersistence`: IndexedDB cursor records keyed by session id, with localStorage fallback.
- `useTodosPersistStore`: local persisted todo fallback/cache capped by session count.
- Session folders: localStorage plus server disk file through `/api/session-folders`.

### Session Load Flow

1. `App.tsx` mounts the default `SyncProvider` with the current directory and default SDK.
2. `MultiServerSyncLayer` mounts remote `SyncProvider`s for registered remote servers.
3. Each directory child store bootstraps with `session.list({ directory, roots: true, limit: 50 })`.
4. Sessions are sorted, stored, and indexed into server/event routing maps.
5. SSE/WS events update child stores and routing indexes.
6. Reconnect recovery resyncs candidate sessions, status, and messages.

### Session Create And Send Flow

1. Draft target chooses explicit directory/project first, then current/persisted/active/first fallback.
2. `session-actions.createSession` calls the SDK with `{ directory, title, parentID }`.
3. Remote SDK is selected only if `projects` has an exact path match with non-default `serverId`.
4. OpenChamber pre-registers `sessionId -> directory`, indexes server ownership, sets current session, and upserts global cache.
5. First prompt uses `opencodeClient.sendMessage`; remote base URL comes from `resolveBaseUrl(currentDirectory)`, else local base URL.

Risk: remote worktrees/subdirectories without exact project mapping can fall back to the default local SDK/base URL.

### Session Switch Flow

1. `setCurrentSession(id, directoryHint)` sets UI selection immediately.
2. Directory resolves from hint, session/worktree data, then global current directory fallback.
3. It updates global `DirectoryStore`, singleton `opencodeClient.currentDirectory`, viewed notification state, and active sync refs.

Risk: if session directory is not yet loaded, the session can be bound to whichever directory is globally active.

## Fallback Policy

### Allowed

| Location | Fallback | Reason |
|---|---|---|
| `useEffectiveDirectory` | session/worktree/draft -> active/current directory | Read-only tab display/search default only. |
| `useChatSearchDirectory` | session/draft -> active project -> current directory | File mention search default only. |
| `SyncProvider.resolveDirectoryFromRoutingIndex` | exactly one child store for global/empty event | Event routing only, scoped to a single possible target. |
| Home discovery | fs/system/desktop/stored/process -> `/` | Startup/home display only. |
| Electron `process.chdir(os.homedir())` | app cwd reset to home | Prevents app bundle cwd leakage. |
| `POST /api/opencode/directory` | explicit path only | User-selected and validated. |

### Conditionally Allowed

| Location | Fallback | Conditions |
|---|---|---|
| Projects initial active id | `projects[0]` | UI selection only; no automatic action routing. |
| Project removal | next project or home | UI recovery only; no automatic session/file operations. |
| OpenCode local port autodetect | 4096 or persisted port | Local web mode only; not when remote/external was explicitly requested. |
| `/api/fs/list` | missing path -> home | Directory picker/browsing only. |
| Settings migration | legacy `lastDirectory` -> first project | One-time migration only. |
| Worktree fallback | worktree root/cwd fallback | Only when explicitly tied to known session/worktree metadata. |

### Forbidden

| Location | Current fallback | Why forbidden | Required direction |
|---|---|---|---|
| `resolveProjectDirectory(req)` | no directory -> `lastDirectory` -> active project -> `projects[0]` | Grants server action authority from stale UI state. | Add explicit-only resolver for mutations/sensitive reads. |
| `/api/fs` mutations | inherit server fallback | Writes/deletes/renames can hit stale/first workspace. | Require explicit directory/header and workspace membership. |
| `/api/fs` normal reads | inherit server fallback | Can read wrong workspace. | Require explicit directory except documented picker/local-only flows. |
| `/api/fs/exec` | any existing cwd | Executes outside approved workspace. | Require cwd inside explicit project/worktree. |
| Provider project/all disconnect | fallback project | Can remove wrong project config. | Require explicit directory for project-affecting scopes. |
| `setCurrentSession` | missing session dir -> global directory | Binds session to wrong project/server. | Do not change directory; show unresolved/loading or fetch authoritative session. |
| `session-ui-store.createSession` | `directoryOverride ?? opencodeClient.getDirectory()` | Creates in stale singleton directory. | Require explicit draft/project directory. |
| `getSessionDirectory` | session dir -> `dir()` | Existing-session action can target active UI dir. | Fail if session directory is unknown. |
| Permission/question replies | request scan -> session dir -> `dir()` | Reply can go to wrong session/server. | Require observed request directory or authoritative session directory. |
| `resolveSdkForDirectory` | no remote match -> default SDK | Remote path can become local. | Pass expected `serverId`; fail if mapping missing. |
| `resolveBaseUrl` callers | no remote match -> local base URL | Remote prompt/command can post locally. | Route by session/project server id, not directory string alone. |
| `ensureRemoteProject` | discovered remote project becomes active | Background discovery changes active context. | Add without activation unless user initiated it. |
| Invalid `OPENCODE_HOST` | ignore and continue | Mistyped remote can become local. | Fail closed when explicit remote host is invalid. |
| Startup default/persisted OpenCode port | adopt unrelated local OpenCode | Remote/external intent can become local. | Only probe local ports in explicit local mode. |
| VS Code `setWorkingDirectory(newPath)` | ignores `newPath` | Explicit directory change is discarded. | Honor explicit path or reject. |

## Remediation Checklist

1. Add `resolveRequiredExplicitProjectDirectory(req)` for mutations and sensitive reads. It should accept only request-supplied directory and never inspect settings.
2. Rename current server fallback resolver to `resolveProjectDirectoryWithUiFallback(req)` and restrict it to documented UI reads.
3. Update `/api/fs/*` so mutations and normal reads require explicit directory and workspace membership.
4. Enforce `/api/fs/exec` cwd inside explicit project/worktree.
5. Remove `|| dir()` fallback from existing-session actions.
6. Add `requireSessionDirectory(sessionId)` and fail loudly when unresolved.
7. Make permission/question replies request-authoritative.
8. Store/pass `serverId` through session, draft, worktree, prompt, command, and reply paths.
9. Replace directory-only remote SDK/base URL resolution with server-id-aware routing.
10. Stop background remote discovery from activating projects.
11. Fail closed on invalid explicit `OPENCODE_HOST` or explicit remote host startup failure.
12. Add regression tests for remote project prompt send, permission reply, `/api/fs` mutation without directory, and session switch before directory metadata is loaded.

## High-Risk Files To Fix First

1. `packages/web/server/lib/opencode/project-directory-runtime.js`
2. `packages/web/server/lib/fs/routes.js`
3. `packages/ui/src/sync/session-actions.ts`
4. `packages/ui/src/sync/session-ui-store.ts`
5. `packages/ui/src/lib/opencode/client.ts`
6. `packages/ui/src/sync/RemoteProjectDiscovery.tsx`
7. `packages/web/server/lib/opencode/lifecycle.js`
8. `packages/web/server/lib/opencode/env-config.js`
9. `packages/vscode/src/opencode.ts`

## Notes

- The strongest existing safe pattern is `resolveOptionalProjectDirectory(req)`: explicit-only, no fallback.
- The most dangerous current pattern is mixing authoritative session/project/server context with mutable singleton `opencodeClient.currentDirectory`.
- Remote routing by exact directory path is insufficient for worktrees and nested directories; route by server/project/session identity instead.
