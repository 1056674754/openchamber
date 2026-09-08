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

- `bridge-settings-runtime.ts`
  - Settings read/write and OpenCode skills discovery via API for bridge consumers.
  - Shared settings updates use the same cross-process lock as Electron/Web and clean failed atomic-write temp files.

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
  - Provides the request/response timeout bridge used to collect the same read-only DOM diagnostics from the sidebar, session editor panels, and Agent Manager panel.

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
