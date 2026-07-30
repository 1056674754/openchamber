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

- `bridge-system-runtime.ts`
  - System/editor/provider/quota/update-check message handlers.
  - Includes session activity snapshot bridge handler used by webview parity routes (`/api/session-activity`).
  - Includes Zen utility model parity handler (`/api/zen/models`) retained as an empty-list compatibility stub.
  - Exposes managed OpenCode upgrade status and mutation handlers with explicit external/unavailable capability reporting.

- `opencode-upgrade-runtime.ts`
  - Owns managed-versus-external capability decisions, latest-version checks, serialized upgrades, custom-build-aware version comparison, and restart-after-upgrade behavior.

- `bridge-permission-auto-accept-runtime.ts`
  - Owns the persisted VS Code permission auto-accept policy and its GET/SET bridge contract.
  - Broadcasts authoritative snapshots to every active OpenChamber webview after a successful write.

## Extension guideline

When adding new bridge route families:

1. Prefer creating or extending a domain runtime module under `packages/vscode/src/bridge-*-runtime.ts`.
2. Keep `bridge.ts` focused on delegation order and minimal fallthrough behavior.
3. Inject dependencies into runtimes instead of reaching into unrelated modules directly.
