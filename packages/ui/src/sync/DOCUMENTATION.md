# Sync architecture, event handling & store update rules

## Scope

This document covers the current client-side session/data architecture in `packages/ui/src/sync` and the rules for updating stores safely.

There are **two distinct session data scopes** in the UI:

1. **Directory-scoped sync stores**
   - Owned by the sync layer child stores created in `sync-context.tsx`
   - Source for per-directory live session/message/part/permission/form state (`form` holds the v1 wire payloads, `nativeForm` the v2 typed ones)
   - Backed by SSE / directory-scoped polling
   - Read via hooks like `useSessions()`, `useDirectorySync()`, `getSyncSessions()`, `getDirectoryState()`

2. **Global sessions cache**
   - Owned by `packages/ui/src/stores/useGlobalSessionsStore.ts`
   - Shared source of truth for the Sessions sidebar global lists and Session Retention cleanup
   - Holds:
     - global active sessions
     - global archived sessions
     - active sessions indexed by directory

These two scopes are intentionally different, but they are no longer equal peers for live UI truth.

### Why both exist

The directory-scoped sync stores are **not** a complete global view.

- They are created lazily per directory
- They only contain data for directories initialized in the current app session
- They are optimized for live per-directory domain data
- They do not maintain the complete global active+archived session view needed by the sidebar and retention settings

So:

- Use the **directory sync stores** for per-directory live session/message state
- Use the **global sessions store** for cold/global session coverage (especially archived pages and unopened directories)
- Use **aggregated child-store snapshots** for live session/status truth across already initialized directories

Local and remote instances keep the same boundary explicitly: discovering a project or worktree, or receiving summary/status events for an unopened directory, updates only the global cache. It does not create a directory child store. A full child store is materialized only when the directory is opened or receives an event that requires blocking-request state. Streaming message/part events for unopened local directories are ignored because opening the directory performs an authoritative bootstrap.

Directory child stores are bounded by count and idle TTL. Eviction refuses pinned, booting, loading, actively running, or blocking-request directories. After a safe eviction, the sync provider calls OpenCode's directory-scoped `instance.dispose` endpoint so directory plugins, watchers, and subprocesses do not remain alive after their UI state is gone.

## Ownership map

| Layer / Store | Owns | Scope |
|---|---|---|
| child directory stores in `sync-context.tsx` | `session`, `message`, `part`, `permission`, `form`, `nativeForm`, etc. | One directory |
| `session-ui-store.ts` | Session selection, draft lifecycle, abort prompts, worktree metadata, SDK-facing action entrypoints | App UI state |
| `useGlobalSessionsStore.ts` | Global active sessions, global archived sessions, `sessionsByDirectory` | All opened project/worktree session lists |
| `viewport-store.ts` | Scroll anchors, session memory, loading indicators | App UI state |
| `input-store.ts` | Draft input state, attached files, synthetic parts | App UI state |
| `selection-store.ts` | Model/agent/variant selections | App UI state |
| `voice-store.ts` | Voice state | App UI state |

## Session list rules

### Directory-scoped session list

Use the directory-scoped sync store when the UI needs the live session list for the **current directory**.

Examples:

- current chat/session switching
- per-directory session/message bootstrap
- session/message/part SSE updates

### Global session list

Use `useGlobalSessionsStore` when the UI needs a **shared partial session catalog**.
The catalog is intentionally not a complete database snapshot:

- startup loads one page of active roots
- expanding a session loads its direct children
- expanding an archive group loads archived roots for that server
- SSE and successful mutations incrementally maintain entries already in memory

Code that deletes or reconciles by absence must not use this catalog. Retention
cleanup performs its own paginated root scan only when cleanup actually runs.

### Live cross-directory session/status view

Use the sync hooks backed by aggregated child stores when the UI needs **live truth** for sessions or statuses across all initialized directories.

Current consumers:

- `SessionSidebar.tsx`
- `Header.tsx`
- agent/session activity surfaces using `useGlobalSessionStatus()` / `useAllSessionStatuses()`

### Mutation responsibility

`useGlobalSessionsStore` is kept correct by:

1. one-page root bootstrap via `loadSessions()` / `refreshGlobalSessions()`
2. explicit child and archived-root demand loads
3. paced remote directory summary scans for unopened remote directories
4. selected session/status SSE projections that can be represented without materializing a directory store
5. direct mutation from session actions after successful SDK calls:
   - create
   - title update
   - share
   - unshare
   - archive
   - delete
   - retention cleanup batch archive/delete

This keeps cold/global lists responsive without requiring a refetch after every change.

Resident sessions prefer child-store state. Sidebar rows use the global session/status cache and directory-specific permission/form subscriptions so one streaming directory does not repaint every row. Cold local and remote rows can use global SSE/status summaries until the session is activated.

### Bootstrap hierarchy and catalog isolation

Directory bootstrap loads roots (`roots: true`) and the broader tree (`roots: false`), then builds a closed hierarchy with `mergeBootstrapSessions`:

- Recover `parentID` ancestors from the broader response or existing cache when roots temporarily lag.
- `allSessions === null` (child/full list failed) keeps known children from cache; it must not be treated as an empty success.
- A successful empty list is authoritative for that scope and drops stale store-only roots.
- Optional catalog `eventRevision` / `deletedRevision` overlays preserve in-flight creates/updates and suppress deletes that raced the list.

Authoritative delete-missing and completeness are scoped by `serverId + directory` (`applyDirectorySnapshot` / `completeSnapshotScopes`). Same path on local vs remote never prune each other. Fetch failure must not write an authoritative empty catalog for that scope. Folder cleanup consumers only reconcile scopes whose matching snapshot is complete.

Persisted child-store metadata (`persist-cache`) keys include `serverId` (`oc.dir.v2.*`) with one-shot migrate from legacy `oc.dir.*` for the default server. Clearing one server's bucket must not clear another's.

### Composer attachment preparation

Local pick/drop/paste attachments go through `prepareAttachmentFiles` before entering the session-scoped input-store bucket:

- Shared allowlist (`ATTACHMENT_ACCEPT` / `ACCEPTED_ATTACHMENT_EXTENSIONS`) filters picker MIME/extensions.
- HEIC/HEIF converts to JPEG; notebooks/HAR sanitize to `text/plain`; other text-like formats normalize MIME.
- Office/ODF (`docx`/`pptx`/`xlsx`/`odt`/`odp`/`ods`) expand via `extractDocumentAttachments` (`fflate`) into extracted text plus embedded images, attached atomically.
- Office extraction rejects unsafe/oversized archives, entries, XML, image sets, and path traversal before retaining output. Dense XLSX ranges use quoted TSV; pathologically sparse rows keep coordinate/value pairs so a single `XFD` cell cannot allocate thousands of empty columns.
- Files outside the allowlist are rejected (not attached as opaque binaries).
- VS Code `file://` path attachments and server mentions stay path references and skip Office zip extraction.
- Composer compares prepared MIME modalities with the selected model’s `modalities.input` and shows a non-blocking warning when incompatible.
- Plugin tool `state.attachments` are preserved across materialization snapshots and rendered with `MessageFilesDisplay` (entries without `url` are omitted).
- VS Code webview CSP allows `blob:` only on `worker-src` so Office inflate workers run without permitting blob scripts.

Sending still uses the owning session’s `serverId + directory`; preparation only produces `data:` / `text/plain` parts in the UI.

### Deleted-worktree draft recovery

Regular new-chat drafts may inherit a persisted current directory that was a worktree and has since been deleted. `session-ui-store.ts` probes that implicit target through the selected project's owning server and falls back to the selected/active project root only when the server explicitly reports `missing`.

- Probe results are `available`, `missing`, or `unknown`; offline, permission, malformed, and unavailable remote responses are never treated as deletion.
- Explicit targets (`preserveDirectoryOverride`), temp drafts, pending worktree requests, and bootstrap-pending directories are never rewritten.
- Runtime switches and concurrent user target changes abort the recovery. A concurrent rewrite of the same implicit draft to the same fallback is accepted.
- The visible draft, persisted draft target, config owner, materialization path, send path, and created Session server all move together. Recovery must not update only the UI while the create call keeps the stale path.

### Context-window token authority

Assistant token breakdown fields can accumulate across internal tool-call round trips; summing input/output/reasoning/cache can therefore exceed the actual context window several times over. Context meters use `tokens.total` when it is a finite positive value because OpenCode reports the final round-trip window there. Older servers without `total` retain the breakdown-sum fallback. The same helper must feed contextStore, composer, Context tab, work status, VS Code, and Mini Chat so surfaces cannot disagree.

## Remote read admission

Remote summary and status reads share one scheduler per remote server. The scheduler admits at most three reads concurrently, leaving one slot in the server's four-request normal lane for user operations. Interactive status reads take precedence over queued background discovery, and identical status/list keys share one in-flight promise.

Remote summary scans cache successful directory reads for 30 seconds. A failed fetch is not recorded as an empty snapshot and is eligible for retry. Repeating the same 42-directory input therefore performs no second bootstrap and creates no child stores.

HTTP 408, 429, and 5xx failures use bounded exponential retry. Generated server-lane failures carry `retryAfterMs` and HTTP `Retry-After`; clients add jitter so concurrent providers do not retry in lockstep.

## Reconnect reconciliation

The browser event pipeline treats connection recovery as two separate facts:

1. `transport-ready` proves only that the local WebSocket bridge is reachable.
2. `ready` proves that the upstream OpenCode event stream is attached. `disconnected` revokes this state without requiring the local socket to close.

After every upstream `ready`, each initialized directory reconciles authoritative live state. Cold summary-only directories are not materialized during reconnect. A replay gap forces the same reconciliation path for resident directories; replay alone is not allowed to claim convergence when the requested cursor is no longer buffered.

When a managed restart or authoritative reconnect settles a Session whose trailing assistant message never completed, `interrupted-turn.ts` marks that message with `MessageAbortedError` and finalizes only pending/running tool parts. Pending forms/permissions block this recovery. A later authoritative completed snapshot replaces the local aborted copy, so reconnect cannot preserve a false interruption after OpenCode actually accepted and finished the turn.

Reconnect recovery deliberately uses two session sets:

- **Authority sessions** are every session represented by the directory store's session, status, message, form, or permission state. Statuses and pending forms/permissions are reconciled for this complete set.
- **Materialization sessions** are the smaller subset needing expensive session/message/todo hydration: active status, incomplete or unrenderable messages, relevant parents, and the viewed session.

Failed authoritative fetches must remain distinguishable from successful empty results. A partial reconciliation is retried while the upstream provider stays connected; it must not clear known pending requests or status merely because one fetch failed.

## Message history pagination and payload budgets

`message-history-loader.ts` owns the shared `session.messages` page contract for interactive loading and reconnect materialization. Callers must pass the session's authoritative SDK client and directory; the loader never falls back to a global current directory.

- Web/desktop cold history starts with 30 raw messages and follows cursors until it has 30 real user turns or reaches the beginning of the session. VS Code targets 6 real user turns to keep bridge and webview transfers smaller. Subsequent interactive older-page loads stop at the next real user-turn boundary, so one click/near-top trigger prepends one coherent turn rather than an arbitrary raw-message slice.
- Session and message-history requests use module-shared keyed single-flight coordination. Every `useSync()` consumer and React Strict Mode remount joins the same directory/session request instead of downloading and materializing the same history in parallel.
- A direct `?session=<id>` route restores persisted session-to-project ownership before calling `session.get`, so a remote session is queried through its owning server instead of the default local server. Persisted last-session state is only used when it agrees with that project ownership. Existing sessions never borrow the currently open workspace as a directory fallback: chat hydration waits for an authoritative session directory and reruns when it arrives. This prevents a cold URL restore from sending history or file requests to an unrelated project and then remaining on the skeleton until HMR or another state change.
- Initial chat hydration fetches the parent session's direct children alongside message history. Historical Agent Task parts can therefore resolve child sessions that have fallen outside the global session-list window; task inputs remain the primary identity source when they contain `task_id`/`taskId`.
- After committing the initial page, web/desktop keeps only the active session's next cursor page in a single-slot background prefetch. Loading within one viewport of the top (minimum 640px) consumes that prepared page, prepends it synchronously, preserves the viewport anchor in a layout effect, and then prepares the following page.
- Near-top detection uses both `IntersectionObserver` and a scroll-position fallback. The shared attempted-version and pending-request guards prevent the two signals from loading the same cursor twice.
- Tail and forced refreshes may update materialized messages but cannot weaken an already-authoritative `complete: true` history snapshot with the cursor from their deliberately smaller response window.
- Sending after a revert removes the abandoned branch from the directory store and confirms its entries out of the optimistic shadow only after the replacement send is accepted. A failed send restores the branch and keeps its shadows eligible for reconciliation.
- If the user keeps scrolling while a prepend is pending, the saved anchor is refreshed to the current viewport instead of being discarded. Session changes and failed loads still cancel it.
- Virtual row measurement may keep a genuinely bottom-pinned viewport at the bottom, but it does not rewrite `scrollTop` while the user is reading older content. Prepend and fold transitions use their explicit anchors instead.
- Prompt Navigator completeness is independent from the rendered chat page. On desktop web/Electron, its full cursor scan starts only after the active chat snapshot is renderable, retains only real user records, and does not commit scanned assistant/tool history into the chat store. Sidebar neighbor prefetch follows the same foreground-first gate. Each completed navigator page is published immediately and cached by server/session, so long scans grow the navigator progressively and preserve partial results if a later page fails. Its 30-tick window is presentation virtualization, not a history limit. Selecting a prompt whose body is not loaded waits for any in-flight history request, then follows older cursors through that message and performs one prepend commit so the existing layout-effect anchor restoration remains authoritative.
- A batch remains bounded by `message-page-boundary.ts`. When a runtime reports decoded response bytes, it may follow at most 32 additional cursor pages and 5,000 raw message records, stopping at an 8 MB decoded-payload budget. If decoded bytes are unavailable, it falls back to four additional pages and 600 records.
- Reconnect/materialization callers omit the interactive target and preserve the one-real-user-boundary behavior.
- Message arrays are chronological by `message.time.created`; message ID is only an equal-time tie-breaker and identity key. Fixed-width OpenCode IDs can roll from `msg_fff...` to `msg_000...`, so event insertion, pagination, materialization, optimistic state, prompt history, side-channel merge, completion selection, and revert/redo must not infer time from lexical ID order.
- Part arrays preserve authoritative response/event arrival order. Part IDs are identity keys only and can roll over independently.
- SDK errors throw `MessageHistoryLoadError`; a failed fetch is never represented as an empty successful page.
- `syncSession` / `forceRefreshSession` bump a per-key generation (`serverId + directory + sessionID`) via `sync-session-generation.ts`. `loadMessages` accepts `isStale` and skips store writes when a newer sync for the same key has started. Fetch failure still clears loading without wiping existing messages.

The web/local and remote proxies copy a verified identity-encoded upstream `content-length` into `x-openchamber-decoded-content-length` before normal proxy header filtering and optional browser compression. The VS Code bridge measures the decoded body directly and supplies the same header. The loader never treats a compressed standard `content-length` as a decoded-memory budget.

Message and part payload sanitization happens before records are retained in sync stores. The web and VS Code `session.messages` projections remove historical summary-diff snapshot bodies (`before`, `after`, `from`, and `to`) before transport, cap diff lists, and cap oversized patch text; those fields are not used by chat rendering and previously made a single older page exceed 30 MB. Individual tool input/output/metadata fields have a one-million-character retained-data budget. Truncated tool parts carry the `__openchamberTruncated` metadata marker with the affected field names and limit.

This client-side budget does not protect OpenCode's own JSON serialization or the initial HTTP parse. OpenCode must enforce a server-side response byte budget and summary/detail API to eliminate upstream memory spikes; OpenChamber must not hide that limitation by treating a rejected or truncated response as an empty page.

## Session action rules

Session actions live in `session-actions.ts` and are the canonical place for SDK-calling session mutations that affect global session lists.

Rules:

1. If an action mutates session list membership or visible session metadata, update `useGlobalSessionsStore` there.
2. If an action targets a session by ID, resolve the **session's own directory**. Do not assume the current directory is correct.
3. `session-ui-store.ts` should delegate to `session-actions.ts` for these mutations instead of duplicating SDK calls.

Examples of global-store updates performed in `session-actions.ts`:

- `createSession()` -> `upsertSession(session)`
- `updateSessionTitle()` -> `upsertSession(result.data)`
- `shareSession()` / `unshareSession()` -> `upsertSession(result.data)`
- `archiveSession()` -> `archiveSessions([id], archivedAt)`
- `deleteSession()` -> `removeSessions([id])`
- `moveSessionToDirectory()` -> control-plane `experimental.controlPlane.moveSession`, reconcile child stores for that session's `serverId`, then `registerSessionDirectory` + `upsertSession`

## The golden rule

When creating a draft in `handleDirectoryEvent`, **only clone the state fields the event will mutate**. Never spread all fields eagerly.

```typescript
// WRONG — clones everything, breaks referential equality for all subscribers
const draft = {
  ...current,
  session: [...current.session],
  message: { ...current.message },
  part: { ...current.part },
  permission: { ...current.permission },
  // ...
}

// RIGHT — only clone what this event type touches
const draft = { ...current }
switch (event.type) {
  case "message.part.delta":
    draft.part = { ...current.part }
    break
}
```

## Why this matters

Zustand skips re-renders when a selector returns the same reference (`Object.is`). If you spread `session: [...current.session]` but the event only modifies `part`, the `session` array gets a new reference. Every component using `useSessions()` re-renders for nothing.

During streaming, `message.part.delta` fires ~60 times/sec. Eagerly cloning all fields caused every subscriber in the entire app to re-render 60/sec — a 10x overhead. Targeted cloning reduced MessageList renders from ~1972 to ~296 per session.

## Event → field mapping

Keep this in sync with `handleDirectoryEvent` in `sync-context.tsx`:

| Event type | Fields to clone |
|---|---|
| `session.created/updated/deleted` | `session`, `permission`, `todo`, `part` |
| `session.diff` | `session_diff` |
| `session.status` | `session_status` |
| `todo.updated` | `todo` |
| `message.updated` | `message` |
| `message.removed` | `message`, `part` |
| `message.part.updated/removed/delta` | `part` |
| `vcs.branch.updated` | (none — mutates `draft.vcs` directly) |
| `permission.asked/replied` | `permission` |
| `question.asked/replied/rejected` (v1 wire; store field `form`) | `form` |
| `form.created`/`form.settled` (v2, server-translated; store field `nativeForm`) | `nativeForm` |
| `lsp.updated` | `lsp` |

## Adding a new event type

1. Add the case to the event reducer (`event-reducer.ts`)
2. Add a corresponding case to the switch in `handleDirectoryEvent` (`sync-context.tsx`) that clones **only** the fields your reducer writes to
3. If your event fires frequently (more than a few times per second), verify that unrelated components don't re-render — check with the stream perf counters

## Selector hygiene

Select leaf values, not containers:

```typescript
// WRONG — returns entire Map/object, new reference on any mutation
useDirectorySync((s) => s.permission)

// RIGHT — returns the value for one key, stable unless that key changes
useDirectorySync((s) => s.permission[sessionID] ?? EMPTY)
```

Same applies to `useStreamingStore` — select `.get(key)` not the Map itself.

## Store splitting pattern

### Why split

A single Zustand store with N properties means every subscriber's selector re-evaluates on every state change — even if the change is unrelated to what that subscriber reads. During streaming, `sessionMemoryState` updates ~60/sec. Before the split, all 68+ `useSessionUIStore` subscribers re-evaluated on each update. After splitting into focused stores, only `useViewportStore` subscribers (2-3 components) re-evaluate.

The optimization multiplies with targeted event cloning: fewer new references per event × fewer subscribers per store = dramatically less work per SSE frame.

### The stores

| Store | Owns | When it changes |
|-------|------|-----------------|
| `session-ui-store.ts` | Session selection, draft lifecycle, abort, worktree, SDK actions | Session switch, draft open/close |
| `voice-store.ts` | Voice connection/activity state | Voice toggle |
| `input-store.ts` | Pending input text, synthetic parts, attached files | User typing, file attach, revert/fork |
| `selection-store.ts` | Per-session model/agent/variant choices | Model/agent picker |
| `viewport-store.ts` | Scroll anchors, session memory state, sync status | Streaming, scroll, session switch |

### Rules for new UI state

1. **Never add to `session-ui-store`** unless it's session selection, draft lifecycle, or abort state
2. **Group by change frequency** — state that changes during streaming (viewport, memory) must not live with state that changes on user action (selections, input)
3. **Group by subscriber set** — if only 2 components read a value, it should be in a store that only those 2 components subscribe to
4. **Prefer a new store over growing an existing one** if the new state has different subscribers or change frequency
5. **Cross-store reads use `.getState()`** — actions in one store that need to read another store call `useOtherStore.getState()` (imperative, no subscription)

### Anti-patterns

```typescript
// WRONG — stuffing unrelated state into one store
const useEverythingStore = create(() => ({
  voiceMode: "idle",
  scrollAnchor: 0,
  selectedModel: null,
  pendingInput: "",
  // 20 more fields...
}))

// RIGHT — separate stores by concern + change frequency
const useVoiceStore = create(() => ({ voiceMode: "idle" }))
const useViewportStore = create(() => ({ scrollAnchor: 0 }))
const useSelectionStore = create(() => ({ selectedModel: null }))
const useInputStore = create(() => ({ pendingInput: "" }))
```

## Background Network Scheduling

Startup discovery and polling use `runBackgroundNetworkTask` from `lib/background-network.ts`. The shared gate admits at most three background requests at once, leaving browser connection capacity for foreground Session message loads.

The gate covers global Session catalog pages, project/worktree Git discovery, root-branch probes, command discovery, and skill discovery. Selected Session bootstrap and message pagination are interactive paths and must not enter this gate. The Electron loopback runtime also removes Chromium's per-host connection cap only for `127.0.0.1` and `localhost`; remote instances retain browser defaults.
