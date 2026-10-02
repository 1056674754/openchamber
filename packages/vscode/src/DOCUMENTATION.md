# VS Code Backend Modules

This document describes backend runtime modules used by the VS Code extension bridge (`packages/vscode/src/bridge.ts`).

## Purpose

Keep `bridge.ts` as a thin orchestration layer that delegates message handling to cohesive domain runtimes while preserving API behavior.

## Runtime modules

- `bridge.ts`
  - Entry orchestration layer for bridge messages.
  - Delegates to specialized runtimes in order and handles only unmatched fallthrough cases.

- `bridge-git-runtime.ts`
  - Standard Git message handlers.

- `bridge-git-special-runtime.ts`
  - Specialized Git flows (`pr-description`, `conflict-details`) and generation helpers.
  - Generation model choice lives in `bridge-git-generation-model.ts`: request model first, then the user's small-model override (`smallModelUseDefault === false` plus `smallModelOverride` as `provider/model`) when the catalog has it, then the zen fallback. Fork: the saved `gitProviderId`/`gitModelId` picker pair keeps precedence over the small-model override (upstream dropped the pair entirely).

- `bridge-git-process-runtime.ts`
  - Git process execution and environment setup (`execGit`), including SSH agent socket resolution.

- `git-lock-recovery-runtime.ts`
  - Conservative worktree bootstrap recovery for stale `index.lock` files.
  - Retries transient conflicts, removes only metadata-identical locks, and preserves locks that change during the observation window.

- `bridge-fs-runtime.ts`
  - Bridge handlers for filesystem-related message routes.
  - Uses shared FS helpers via injected dependencies.

- `bridge-fs-helpers-runtime.ts`
  - Filesystem/path/search helper functions:
    - path normalization and resolution
    - directory listing
    - file search
    - file read path safety checks
    - dropped-file parsing and attachment reading
    - models metadata fetch helper

- `bridge-localfs-proxy-runtime.ts`
  - Local `/api/fs/read` and `/api/fs/raw` proxy helpers and shared proxy utility helpers.
  - Serves plugin-published `/api/artifacts/:artifactId/content` responses from the local immutable Artifact store.

- `bridge-proxy-runtime.ts`
  - Proxy route handlers (`api:proxy`, `api:session:message`) with injected helper dependencies.
  - SSE routes use `sseProxy.ts`; its upstream-only stall watchdog closes an open but silent OpenCode stream so the webview can reconnect.

- `bridge-config-runtime.ts`
  - Config and skills message handlers (`api:config/*`).
  - Includes OpenCode resolution diagnostics parity handler used by shared UI (`/api/config/opencode-resolution`).

- `bridge-project-setup-runtime.ts`
  - Extension-host side of `GET/PUT /api/projects/:projectId/config` (the webview handles the route locally and bridges `api:project-setup:get` / `api:project-setup:update` / `api:project-setup:update-shared`). Reads and writes the client-owned keys of `~/.config/openchamber/projects/<projectId>.json` (worktree setup commands, project actions, draft starters) with the rules in `project-setup.ts`, a mirror of the server's `packages/web/server/lib/projects/project-setup.js`; keep the two in sync. Writes to one file are chained; server-owned and unknown keys survive. The read also merges the team's optional `<workspace>/.openchamber/project.json` (checkout path decoded from the `path_<base64url>` id) by the same rules as the server, so the webview sees one view with `shared` / `personal` blocks.

- `bridge-settings-runtime.ts`
  - Settings read/write and OpenCode skills discovery via API for bridge consumers.
  - Shared settings updates use the same cross-process lock as Electron/Web and clean failed atomic-write temp files.
  - Writes are gated by the generated registry snapshot (`settings-registry.json`, via `settings-registry-gate.ts`): keys the registry does not list, or marks `computed`, `local`, or `owner: desktop-shell`, never reach the shared settings files. Regenerate the snapshot with `bun run settings-registry:generate` when the UI registry changes.
  - Shared settings live in two files under `~/.config/openchamber/`, split by `settings-files.ts` (a pure mirror of the server's `settings-files.js`): `settings.json` holds instance facts and legacy keys, `preferences.json` (`{ version: 1, fields: { key: { value, updatedAt } } }`) holds every registry `profile` key. `updatedAt` is stamped only when a value actually changes. Reads return the merged view (preferences win). A missing `preferences.json` is seeded once from the profile keys still in `settings.json`; every write keeps a copy of the profile's base values in `settings.json` too, so a build from before the split still finds the user's preferences; it is ignored by current builds.
  - An existing but unparseable `preferences.json` is a failure, not an empty profile: it is never seeded over or rewritten, one warning is logged per process, reads return `settings.json` only, and writes drop the profile part until a later read succeeds.
  - Write failures throw, so `persistSettings` rejects and the webview sees the save fail instead of a silent success.
  - The extension host is always the `vscode` surface kind: per-surface profile keys it changes land under `surfaces.vscode` in `preferences.json` and reads resolve `vscode` first, base otherwise.

- `bridge-system-runtime.ts`
  - System/editor/provider/quota/update-check message handlers.
  - Includes session activity snapshot bridge handler used by webview parity routes (`/api/session-activity`).
  - Includes Zen utility model parity handler (`/api/zen/models`) retained as an empty-list compatibility stub.
  - Exposes managed OpenCode upgrade status and mutation handlers with explicit external/unavailable capability reporting.

- `opencode-upgrade-runtime.ts`
  - Owns managed-versus-external capability decisions, latest-version checks, serialized upgrades, custom-build-aware version comparison, and restart-after-upgrade behavior.

- `managed-process-lifecycle.ts`
  - Keeps managed OpenCode stdout/stderr pipes drained after startup so child logging cannot block on pipe backpressure.
  - Distinguishes owner-requested shutdown from unexpected exit for connection-state cleanup and automatic recovery.

- `ChatViewProvider.ts`
  - Arms its health probe only after the webview announces `webview:bridgeReady` (fired by the webview bridge when its listeners are live), so a still-loading document is never mistaken for a dead one; a 45s boot watchdog (15s after a recovery) covers bundles that never announce.
  - Recovers a wedged webview by disposing the WebviewView — reassigning `webview.html` does not recreate a frozen renderer, while dispose + re-resolve is the programmatic equivalent of the user reopening the panel. A rapid-recovery cap (3 failures each within a minute) abandons loudly instead of churning forever.
  - Logs every probe failure (reason, delivered flag, boot age, recovery count), snapshots DOM/root/covering-element diagnostics automatically before recovering, and re-delivers cached state plus theme over the bridgeReady round trip so nothing races document load.
  - Supplies the same read-only DOM diagnostics to `Show OpenCode Status` so a healthy backend can be distinguished from a stale overlay or renderer presentation issue.

- `webviewCachedStateRetry.ts`
  - Re-sends cached state at staggered delays (500ms–20s) on resolve and on the `connected` transition; VS Code drops postMessage made before the webview bridge is ready, and a lost `connectionStatus` leaves the loading overlay (the gray screen) up permanently.

- `chatParticipant.ts` + `chat-participant-protocol.ts`
  - Registers the `@openchamber` native chat participant (#200): prompts (and integrated-browser element attachments that surface as chat references) route into the sidebar's active OpenChamber session, or a new one when none is active.
  - Talks to the managed OpenCode server directly (POST `/api/session`, POST `/session/{id}/prompt_async?directory=`) and streams the reply from the directory event stream (SSE `GET /event?directory=`) — the only stream that carries assistant message parts and `session.idle`; `/api/event` carries a subset.
  - `chat-participant-protocol.ts` holds the pure parts (SSE frame parser, reference formatting, assistant-only text accumulator with role gating) so they stay unit-testable without the vscode API.

- `webview-diagnostics-client.ts`
  - Provides the request/response timeout bridge used to collect the same read-only DOM diagnostics from the sidebar and session editor panels.

- `opencodeConfig.ts`
  - Reads layered OpenCode JSON/JSONC for VS Code-owned agent, command, MCP, provider, and skill operations.
  - Rejects partial/invalid parser results before mutation, isolates unrelated broken layers for read surfaces, and validates existing content before backup/write so configuration is never silently truncated.

- `bridge-permission-auto-accept-runtime.ts`
  - Owns the persisted VS Code permission auto-accept policy and its GET/SET bridge contract.
  - Broadcasts authoritative snapshots to every active OpenChamber webview after a successful write.

## Extension guideline

When adding new bridge route families:

1. Prefer creating or extending a domain runtime module under `packages/vscode/src/bridge-*-runtime.ts`.
2. Keep `bridge.ts` focused on delegation order and minimal fallthrough behavior.
3. Inject dependencies into runtimes instead of reaching into unrelated modules directly.
