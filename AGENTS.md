# OpenChamber - AI Agent Reference (verified)

## Core purpose

OpenChamber provides UI runtimes (web/desktop/VS Code) for interacting with an OpenCode server (local auto-start or remote URL). UI uses HTTP + SSE via `@opencode-ai/sdk`.

## Workspace scope

This checkout (`openchamber-merge-v1.11.0`) is the command center. From here, two related bodies of work are managed:

1. **OpenCode fork** at `../opencode` (branch `sscity`) — the customized OpenCode server that OpenChamber embeds. The two repos are tightly coupled: the fork's own `AGENTS.md` cross-references [`docs/EMBEDDED_OPENCODE_PACKAGING.md`](docs/EMBEDDED_OPENCODE_PACKAGING.md). Editing the fork — merging upstream releases, branding, and custom fixes — is expected work from here.
2. **OMO (OhMyOpenCode) plugins** — agent skills and plugins maintained from this workspace.

## Runtime architecture (IMPORTANT)

- `Desktop` (Electron) boots the web server in the same Node process as the Electron main, then loads the web UI from `http://127.0.0.1:<port>`. No sidecar subprocess.
- All backend logic lives in `packages/web/server/*` (and `packages/vscode/*` for the VS Code runtime). The native shell is not a feature backend.
- The shell is used only for stable native integrations: menu, dialog (open folder), notifications, updater, deep-links, quit confirmation.

### Desktop shell: Electron

- All desktop work goes into `packages/electron/`.
- Desktop-side changes (IPC handlers, native integrations, window/quit/notification behavior) land in `packages/electron/main.mjs` + `packages/electron/preload.mjs`.
- Electron imports the server via `@openchamber/web/server/index.js` (workspace dep) and calls `startWebUiServer({...})`. The returned handle has `getPort()` / `stop()`.

## Tech stack (source of truth: `package.json`, resolved: `bun.lock`)

- Runtime/tooling: Bun (`package.json` `packageManager`), Node >=20 (`package.json` `engines`)
- UI: React, TypeScript, Vite, Tailwind v4
- State: Zustand (`packages/ui/src/stores/`)
- UI primitives: Base UI (`@base-ui/react`, primary source for dropdown/select/dialog/menu/tooltip/etc. — wrappers live in `packages/ui/src/components/ui/`), Radix UI (`package.json` deps, legacy usages being migrated), HeroUI (`package.json` deps), Remixicon (`package.json` deps)
- Server: Express (`packages/web/server/index.js`)
- Desktop (forward): Electron 41 (`packages/electron/`)
- Desktop shell (Electron): `packages/electron`
- VS Code: extension + webview (`packages/vscode/`)

## Monorepo layout

Workspaces are `packages/*` (see `package.json`).

- Shared UI: `packages/ui`
- Web app + server + CLI: `packages/web`
- Desktop shell (Electron — forward): `packages/electron`
- VS Code extension: `packages/vscode`

## Documentation map

Before changing any mapped module, read its module documentation first.

### Migration backlog (dual source of truth)

Upstream migration work uses two complementary sources. Do not treat either as optional.

- **Executable backlog (GitLab)**: [`https://coding.s-s.city/songsong/openchamber`](https://coding.s-s.city/songsong/openchamber) — overview issue [`#1`](https://coding.s-s.city/songsong/openchamber/-/issues/1). Priority, risk, blockers, milestones, and open/closed state live here.
- **Evidence ledger**: [`docs/MERGE_V1.12.md`](docs/MERGE_V1.12.md). Per-commit audits, architecture decisions, verification evidence, and fork-equivalence notes live here.

Rules for agents:

- Every deferred or newly discovered **upstream runtime** capability must have one GitLab work item. Do not invent backlog rows only in MERGE, and do not leave completed work closed only in GitLab without MERGE evidence.
- Close a work item only after implementation, focused tests / workspace checks where applicable, matching-surface runtime QA, and a MERGE evidence update that links the work item. Then mark the checkbox on issue `#1`.
- Preserve this fork's multi-instance `serverId + directory` authority. Migration ports must not reintroduce single-instance global current-directory assumptions.
- Completed, already-equivalent, explicitly N/A, and pure upstream-maintenance items must not be re-created as open backlog.

### web

Web runtime and server implementation for OpenChamber.

#### lib

Server-side integration modules used by API routes and runtime services.

##### quota

Quota provider registry, dispatch, and provider integrations for usage endpoints.

- Module docs: `packages/web/server/lib/quota/DOCUMENTATION.md`

##### git

Git repository operations for the web server runtime.

- Module docs: `packages/web/server/lib/git/DOCUMENTATION.md`

##### github

GitHub authentication, OAuth device flow, Octokit client factory, and repository URL parsing.

- Module docs: `packages/web/server/lib/github/DOCUMENTATION.md`

##### opencode

OpenCode server integration utilities including config management, provider authentication, and UI authentication.

- Module docs: `packages/web/server/lib/opencode/DOCUMENTATION.md`
- Incident runbook: `docs/OPENCODE_LIFECYCLE_INCIDENT_RUNBOOK.md`

##### openchamber-control

Policy-first control plane shared by the CLI and managed OpenCode Agent tool.

- Module docs: `packages/web/server/lib/openchamber-control/DOCUMENTATION.md`

##### openchamber-sessions

Managed-local Session create/send/fork orchestration and selection inheritance.

- Module docs: `packages/web/server/lib/openchamber-sessions/DOCUMENTATION.md`

##### agent-tool

Generated managed OpenCode plugin, loopback authentication, and control bridge.

- Module docs: `packages/web/server/lib/agent-tool/DOCUMENTATION.md`

Before restarting, killing, repackaging, or replacing a suspected hung/crashed
managed OpenCode, agents must follow the incident runbook and capture the
non-destructive lifecycle/process evidence first, unless the user explicitly
prioritizes immediate service restoration.

##### notifications

Notification message preparation utilities for system notifications, including text truncation and optional summarization.

- Module docs: `packages/web/server/lib/notifications/DOCUMENTATION.md`

##### markdown-image-grants

Message-bound authorization for completed-assistant Markdown image galleries.

- Module docs: `packages/web/server/lib/markdown-image-grants/DOCUMENTATION.md`

##### terminal

WebSocket protocol utilities for terminal input handling including message normalization, control frame parsing, and rate limiting.

- Module docs: `packages/web/server/lib/terminal/DOCUMENTATION.md`

##### tts

Server-side text-to-speech services and summarization helpers for `/api/tts/*` endpoints.

- Module docs: `packages/web/server/lib/tts/DOCUMENTATION.md`

##### skills-catalog

Skills catalog management including discovery, installation, and configuration of agent skill packages.

- Module docs: `packages/web/server/lib/skills-catalog/DOCUMENTATION.md`

## Build / dev commands (verified)

### Embedded OpenCode packaging (MANDATORY)

Before rebuilding/staging OpenCode for OpenChamber, running any Electron packaging or release command, changing embedded-binary/signing/notarization behavior, or distributing a macOS build, agents **MUST read `docs/EMBEDDED_OPENCODE_PACKAGING.md` completely**.

Do not substitute the official OpenCode binary for the custom merged build. Do not package, sign, notarize, upgrade, or distribute embedded OpenCode from memory or from generic Electron conventions; the runbook defines the required channel, shared-database invariant, staging source, dual-signing order, upgrade prohibition, and live verification gates.

For direct local QA or installation into `/Applications`, use the runbook's local app-only flow and do not submit a notarization job. Developer ID release signing and notarization are only for an explicitly requested distributable artifact, such as a DMG/ZIP or an internal download build.

### Stable macOS shell deployment (MANDATORY)

`/Applications/OpenChamber.app` is the immutable, notarized shell. Normal
OpenChamber UI/server/preload JavaScript changes and OpenCode TypeScript source
changes **MUST** deploy with:

```bash
bun run electron:runtime:install
```

This command may build an isolated candidate under the repository, but it must
only install and atomically switch
`~/Library/Application Support/OpenChamber/runtime/current`. Agents must verify
that `/Applications/OpenChamber.app` was not modified.

Unless the user explicitly requests a shell refresh and the packaging runbook
classifies the change as shell-level, agents **MUST NOT** run
`electron:install`, replace/copy/sync `/Applications/OpenChamber.app`, or modify
anything under its `Contents` directory. A native CodeDirectory mismatch,
changed Electron/Bun/native module, entitlement change, or shell-loader change
requires a new Developer ID signed and notarized shell; never bypass the
runtime compatibility gate or overwrite the installed shell as a shortcut.

### Linux web/PWA server (Dev1-3)

The Dev Linux boxes (Dev1-3) run the **web/PWA server binary**, not the Electron shell. Build it from this repo:

```bash
scripts/build-linux-binary-docker.sh   # needs the Docker daemon; Apple Silicon cross-builds linux/amd64 via QEMU (~2-3 min)
```

Output is a single ~137 MB self-contained binary at `artifacts/linux-docker/openchamber-linux` — Bun-compiled (`bun build --compile --target bun-linux-x64`) from `packages/web/bin/cli-standalone.mjs`, which on first run self-extracts the embedded UI into `~/.openchamber/embedded-assets/<hash>/`. The host-side UI/web build (`bun run build`) runs natively on the Mac; only the final compile step runs inside the container.

Deploy to Dev1-3 (`ssh Dev1` / `Dev2` / `Dev3` aliases in `~/.ssh/config`; Ubuntu 25.10 x86_64). The binary lives at `/opt/openchamber/openchamber` (mirrored at `/usr/local/bin/openchamber`), driven by a **system-level** unit `/etc/systemd/system/openchamber.service` with `ExecStart=/opt/openchamber/openchamber --port 2999 --host 127.0.0.1`. It binds **loopback only** (a reverse proxy fronts it — see `docs/REVERSE_PROXY.md`) and runs its **own embedded/managed OpenCode** (no `OPENCODE_SKIP_START`, no separate `opencode.service`; the process spawns `opencode serve` children itself). To update: `scp` the new binary onto both `/opt/openchamber/openchamber` and `/usr/local/bin/openchamber`, then `systemctl restart openchamber.service`. Port is 2999, not the README template's 3000.

**Gotcha:** the binary is dynamically linked against `/lib64/ld-linux-x86-64.so.2` (glibc). It runs cleanly on Debian/Ubuntu but **not on Alpine/musl** without a glibc compat layer — verify with `file` / `ldd` on a fresh box before assuming it works.

All scripts are in `package.json`.

- Validate: `bun run type-check`, `bun run lint`
- Build all: `bun run build`
- Desktop build (Electron — primary): `bun run electron:build`
- Desktop dev (Electron): `bun run electron:dev`
- VS Code build: `bun run vscode:build`
- Release smoke build: `bun run release:test` (shell script: `scripts/test-release-build.sh`)

## Runtime entry points

- Web bootstrap: `packages/web/src/main.tsx`
- Web server: `packages/web/server/index.js`
- Web CLI: `packages/web/bin/cli.js` (package bin: `packages/web/package.json`)
- Desktop (Electron — primary): `packages/electron/main.mjs` (boots the web server in-process via `startWebUiServer`, loads web UI over loopback; preload at `packages/electron/preload.mjs`)
- VS Code extension host: `packages/vscode/src/extension.ts`
- VS Code webview bootstrap: `packages/vscode/webview/main.tsx`

## OpenCode integration

- UI client wrapper: `packages/ui/src/lib/opencode/client.ts` (imports `@opencode-ai/sdk/v2`)
- SSE hookup: `packages/ui/src/hooks/useEventStream.ts`
- Web server embeds/starts OpenCode server: `packages/web/server/index.js` (`createOpencodeServer`)
- Web runtime filesystem endpoints: search `packages/web/server/index.js` for `/api/fs/`
- External server support: Set `OPENCODE_HOST` (full base URL, e.g. `http://hostname:4096`) or `OPENCODE_PORT`, plus `OPENCODE_SKIP_START=true`, to connect to existing OpenCode instance

## Key UI patterns (reference files)

- Settings shell: `packages/ui/src/components/views/SettingsView.tsx`
- Settings shared primitives: `packages/ui/src/components/sections/shared/`
- Settings sections: `packages/ui/src/components/sections/` (incl `skills/`)
- Chat UI: `packages/ui/src/components/chat/` and `packages/ui/src/components/chat/message/`
- Context surface registry: `packages/ui/src/lib/surfaces/` (module docs: `packages/ui/src/lib/surfaces/DOCUMENTATION.md`)
- Theme + typography: `packages/ui/src/lib/theme/`, `packages/ui/src/lib/typography.ts`
- Terminal UI: `packages/ui/src/components/terminal/` (uses `ghostty-web`)

## External / system integrations (active)

- Git: `packages/ui/src/lib/gitApi.ts`, `packages/web/server/index.js` (`simple-git`)
- Terminal PTY: `packages/web/server/index.js` (`bun-pty`/`node-pty`)
- Skills catalog: `packages/web/server/lib/skills-catalog/`, UI: `packages/ui/src/components/sections/skills/`

## Agent constraints

- Do not run git/GitHub commands unless explicitly asked.
- Keep baseline green (run `bun run type-check`, `bun run lint` before finalizing changes).

## Agent code of conduct

- Prefer the smallest correct change.
- Preserve working behavior before improving structure.
- Do not add cleverness where a direct implementation is enough.
- Do not infer critical state from weak signals when a stronger source exists.
- Do not encode policy only in UI; enforce it in core logic.
- Do not hide data loss, partial failure, or fallback behavior. Make it explicit in code.
- Finish work end-to-end: implementation, verification, and cleanup.

## Development rules

- Keep diffs tight; avoid drive-by refactors.
- Follow local precedent; inspect nearby code before introducing new patterns.
- Backend changes: keep web, desktop, and VS Code behavior consistent when they share contracts.
- TypeScript: avoid `any`, blind casts, and shape guessing.
- React: prefer function components + hooks; use classes only when required.
- Control flow: prefer early returns and explicit branching over nested ternaries.
- Styling: Tailwind v4, typography via `packages/ui/src/lib/typography.ts`, theme vars via `packages/ui/src/lib/theme/`.
- Shared UI patterns: reuse shared primitives before introducing feature-local markup patterns.
- Toasts: use the wrapper from `@/components/ui`; do not import `sonner` directly in feature code.
- No new deps unless asked.
- Never add secrets or log sensitive data.

## Architecture patterns

### Thin entrypoints, focused modules

- Keep orchestration entrypoints thin: `index.js`, bridge files, bootstrap files, provider roots.
- Move route, domain, and runtime logic into focused modules with clear ownership.
- Prefer dependency injection over hidden module coupling.
- Add or update module documentation when ownership changes.

### Strong source of truth

- Prefer deterministic state over heuristics.
- Use live server/session state for live activity. Do not let historical anomalies masquerade as current execution.
- If a fallback is necessary, scope it narrowly to the active entity and treat it as temporary.
- Restore derived UI state from authoritative records. Example: restore model or agent from the latest user message, not assistant-side guesses.

### Live state vs historical state

- Derive live UI behavior from live state channels, not persisted history.
- Use historical records to restore context, not to infer that work is still in progress.
- If live state is delayed, use the narrowest possible transient fallback and clear it as soon as authoritative state arrives.

### Cross-runtime parity

- If web defines a route or payload contract that shared UI depends on, keep VS Code and desktop parity where applicable.
- Shared behavior differences must be intentional and visible in code.
- Do not ship a web-only assumption into shared UI.

### Partial-failure-safe flows

- Cross-directory and multi-entity operations must tolerate partial failure.
- Prefer per-item results, rollback paths, or resumable cleanup over all-or-nothing assumptions.
- Never leave optimistic state or local caches stranded after failure.

### Distinguish fetch failure from empty success

Client API methods that feed authoritative state (bootstrap, reconnect resync, retry loops) must signal fetch failure distinctly from a successful-but-empty server response. A method that swallows errors and returns `[]` or `{}` lets the caller delete legitimate state on a transient network blip.

- If callers use the result to delete, clear, or replace sync state, either throw on failure or return `T | null` where `null` only means "fetch failed".
- Do not return the same value shape for failure and success. SDK `{ data, error }` responses must be checked explicitly when the result is authoritative.
- Retry loops must see a failure signal; a retry around a method that swallows to `[]` will run once and incorrectly treat the empty result as success.
- Verify the consumer preserves state on failure and only runs "delete missing" logic after a known-successful fetch.

### Never silent-fail user-facing operations (信达雅 priority)

A user-initiated operation that fails must surface the failure to the user, ordered by 信达雅:

- **信 (fidelity, mandatory)**: the raw error reaches the UI. No `.then` without `.catch`. No swallowed rejection that becomes "nothing happened". No state clean-up that hides the original error. The composer must never stay silent by design — a misrouted or refused prompt must be distinguishable from "nothing happened".
- **达 (fluency, secondary)**: the raw error is translated into human-readable context next to or below the raw form. The raw form stays available (copyable, expandable).
- **雅 (elegance, tertiary)**: actionable controls (retry, reset with confirmation, copy diagnostics) layered on top of 达 — never replacing it.

Concrete applications:

- `sendMessage` wrappers (ChatInput, queue auto-send, plan/todo send, PR section) must `.catch` and surface the error to a visible UI state. Throwing onward to let upstream handlers also see it is fine; swallowing is not.
- Session-status watchdogs (`useSessionStatusWatchdog`) detect stuck `busy`/`retry` states. They **record and display** the stall. They never silently reset `session_status` to `idle` — silent self-healing is the same class of bug as the original silent failure.
- Optimistic updates that fail must roll back AND show the failure. Rolling back silently makes the user think their input was never accepted.

### Reconnect-loop pacing

The SSE/WebSocket reconnect loop in `packages/ui/src/sync/event-pipeline.ts` retries indefinitely, so it must respect browser/network signals:

- Use a long backoff cap when `navigator.onLine` is false or `document.visibilityState` is hidden.
- Let `online`, visibility becoming visible, and pipeline abort interrupt the current sleep so recovery is prompt.
- Treat permanent 4xx errors (except 408 and 429) as long-cap retries; blind fast retries do not fix stale paths or auth failures.
- Use real exponential growth for consecutive failures, clamped to the visible or hidden/offline cap.

## CLI Parity and Safety Policy (MANDATORY)

### Principle: policy-first, UX-second

All safety and correctness rules MUST be enforced in core command logic, independent of output mode.

Interactive/pretty UX (`@clack/prompts`) is a presentation layer only.
It must never be the only place where validation or restriction is enforced.

### Required parity across modes

The same functional outcome and safety gates MUST hold for all execution modes:

- Interactive TTY (full Clack UX)
- Non-interactive shells (piped/stdin-less automation)
- `--quiet`
- `--json`
- Fully pre-specified flags (no prompts)

In all modes, invalid operations MUST fail with non-zero exit code and deterministic error semantics.

### Non-negotiable rule

Do not rely on prompts to enforce policy.

- Prompts MAY help users choose valid inputs.
- Core validators MUST run even when prompts are unavailable or skipped.
- `--quiet` suppresses non-essential output only; it does not weaken validation.
- `--json` changes output shape only; it does not weaken validation.

Detailed Clack UX patterns (primitives, prompt gating, and implementation checklist)
are defined in the `clack-cli-patterns` skill and should not be duplicated here.

## Clack CLI Skill (MANDATORY for terminal CLI work)

When working on terminal CLI commands, prompts, or output formatting, agents **MUST** study the Clack CLI skill first.

**Before starting terminal CLI work:**

```
skill({ name: "clack-cli-patterns" })
```

Scope: terminal CLI only (for example `packages/web/bin/*`). Do not apply this requirement to VS Code or web UI work.

## Theme System (MANDATORY for UI work)

When working on any UI components, styling, or visual changes, agents **MUST** study the theme system skill first.

**Before starting any UI work:**

```
skill({ name: "theme-system" })
```

This skill contains all color tokens, semantic logic, decision tree, and usage patterns. All UI colors must use theme tokens - never hardcoded values or Tailwind color classes.

## Performance rules (MANDATORY)

These rules exist because violating them has caused measurable regressions (render cascades, memory bloat, UI jank). They apply to all UI and sync layer work.

### Shared-store render discipline

- **Treat common stores as render fanout boundaries.** An unnecessary reference change in shared state can re-render large parts of the app.
- **Do not put high-frequency state in broadly consumed stores.** Fast-changing state should live in narrow stores with narrow subscribers.
- **Update only the fields that changed.** Preserve references for untouched state branches.
- **Prefer leaf selectors over container selectors.** Subscribe to the smallest stable value that satisfies the component.
- **Isolate hot consumers.** If a value changes often and only a few components need it, move it to a narrower store or consume it in a memoized child.
- **Do not subscribe shell/layout components to broad live collections.** If a shell only needs one field, entity, or derived flag, subscribe to that instead of the whole collection.
- **Treat provider roots as global hot paths.** A top-level provider must not subscribe to high-frequency data unless the feature is actually enabled and the subscription is essential.

### Zustand referential equality

Zustand skips re-renders when a selector returns the same reference (`Object.is`). Every new object/array reference triggers a re-render in every subscriber.

- **Never spread all state fields in an update.** Only create new references for fields that actually changed. A `message.part.delta` event should not clone `session`, `permission`, etc.
- **Select leaf values, not containers.** `useStore((s) => s.permission[sessionID])` is correct. `useStore((s) => s.permission)` subscribes to every permission change across all sessions.
- **Preserve references when merging.** If prepending older messages, keep existing message object references. Only add truly new items. Return the original array if nothing was added.
- **For derived collections, preserve item identity when presentation-relevant fields are unchanged.** Reuse previous item references for unchanged rows/items and move high-frequency live fields to narrow per-item selectors.

### Store splitting

A single store with N properties means every subscriber re-evaluates on every state change. Split stores by change frequency and subscriber set.

- **Group state by how often it changes.** Streaming state (updated 60/sec) must not live with user preferences (updated on click).
- **Group state by who reads it.** If only 2 components need a value, it belongs in a store that only those 2 subscribe to.
- **Cross-store reads use `.getState()`.** Actions in one store that need another store call `useOtherStore.getState()` — imperative, no subscription.
- **Never add unrelated state to an existing store** just because it's convenient. Create a new store.

### Event pipeline and SSE

- **Gate expensive operations on the hot path.** During streaming, `message.part.delta` and `message.part.updated` fire ~60/sec. Any `findIndex`, `filter`, or iteration added to these handlers multiplies across every event. Gate behind a cheap boolean check first (e.g., check `next[0]` before scanning the array).
- **Skip no-op updates.** If an incoming event doesn't change the state (same role, same finish, same timestamps), return `false` from the reducer to avoid creating new references.
- **Coalesce by key.** Same-entity events (e.g., repeated `session.status` for the same session) should replace earlier ones in the queue, not accumulate.
- **Preserve event ordering semantics.** Reducers and queues must not let stale deltas or out-of-order events corrupt the latest state.
- **Do not widen live-activity fallbacks.** A fallback for delayed status should inspect only the current trailing entity, not arbitrary historical records.

### Polling payload fidelity

- **Do not let lightweight polling erase rich fields.** If light mode omits fields (e.g., `diffStats`), preserve previous rich data until a heavy follow-up fetch lands.
- **Use two-phase polling.** Run cheap change detection first; only run heavy status fetches for directories that actually changed.

### Optimistic updates

- **Use the shadow Map pattern.** Insert optimistic data into the store for instant UI, AND register it in a separate tracking Map. Cleanup happens deterministically via `mergeOptimisticPage` on the next data fetch — not via heuristics in the event reducer.
- **Pass client-generated IDs to the server.** Use the same ID format as the server (hex-encoded timestamps). Pass `messageID` to `promptAsync` so the server echoes back the same ID. This prevents duplicates and enables in-place replacement.
- **Rollback on error.** Remove the optimistic entry from both the store and the shadow Map.
- **Stabilize bridge callbacks.** When wiring hook callbacks into module-level refs, use stable ref wrappers so effects do not loop on changing function identities.

### Session/input consistency

- **Capture send config at queue time.** Queue items must include provider/model/agent/variant snapshot; do not re-resolve from mutable live state at send time.
- **Keep server-selected attachments sendable.** Preserve server-backed file selections in queue/submit flows and convert them to proper `file://` URLs before sending.
- **Do not let text input state repaint unrelated chrome.** Typing should not force unrelated controls, menus, indicators, or toolbars to re-render on every keystroke.
- **Extract slow-changing chrome from hot input paths.** If controls do not depend on the current text value, move them behind memoized boundaries with stable callbacks.

### Bootstrap resilience

- **Treat startup 502/503 as transient.** Retry bootstrap/session-list flows with bounded retries/intervals, especially in VS Code where API readiness can lag bridge startup.
- **Use polling recovery when failures are swallowed.** If an async loader resolves without throwing on failure, recover with interval retries gated by loaded-state checks.

### Scroll and DOM

- **Never use `await waitForFrames()` for scroll preservation.** Frames of visible scroll jump are unacceptable. Use `useLayoutEffect` to adjust scroll synchronously after React commits DOM — before the browser paints.
- **Capture scroll state before the state change, restore in layout effect.** The pattern: save `scrollHeight`/`scrollTop` into a ref before triggering the update, consume it in `useLayoutEffect` on the rendered output.
- **Do not let viewport resizes masquerade as content growth.** Viewport-height changes must not trigger the same scroll compensation logic used for actual content growth.
- **Disable or narrow native/browser scroll anchoring when custom scroll logic exists.** Browser anchoring and app-managed pinning/follow logic will fight and produce jiggle.
- **Autosize textareas without transient collapse on growth.** Avoid `height='auto'` shrink/expand cycles on every character when the content only grew; this creates visible layout bounce.

### List ordering and view consistency

- **Do not sort structural lists directly from high-churn live fields.** If live updates are frequent, sorting directly from them causes reorder thrash and wide rerender cascades.
- **If live recency is required, freeze order during high-frequency updates and apply a one-shot reorder only at an intentional lifecycle edge.** Choose the lifecycle edge explicitly instead of letting every intermediate update reshuffle the UI.
- **Use one ordering source for all views of the same data.** Different views of the same entities must derive from the same ranked list or rank map; do not let each surface re-derive ordering independently.
- **Do not mix global snapshots and local live snapshots without an explicit reconciliation policy.** If multiple data sources feed one view, define which fields win and how they merge.

### Component isolation

- **Extract high-frequency hook consumers into separate components.** If a hook re-evaluates 60/sec (e.g., streaming status), wrap its consumer in a `React.memo` child component so the parent doesn't re-render.
- **Use custom `React.memo` comparators for message rows.** Compare render-relevant fields (role, finish, parts count, part IDs) — not object references.

### Caching and memory

- **Cap in-memory caches with both count and byte limits.** Entry count alone doesn't prevent memory bloat from large files. Use dual-constraint LRU (e.g., 40 entries OR 20MB).
- **Set store session limits to match loaded data.** If bootstrap loads N sessions, set `limit >= N`. Otherwise the next SSE event triggers trimming that silently removes sessions.
- **Invalidate caches on mutations.** File content cache must clear entries on write, delete, rename. Prefetch cache must clear on session eviction.
- **Use TTLs to prevent redundant fetches.** If a session was fetched <15s ago, skip re-fetching — SSE events keep it current.

### Directory context

- **Never cache directory strings in closures.** Directory can change at any time (worktree switch). Read it dynamically from `opencodeClient.getDirectory()` at call time.
- **Pass directory hints when the source of truth isn't available yet.** Newly created sessions aren't in the sync store until SSE delivers them. Pass the known directory as a parameter instead of relying on lookup.

## Regression-prevention checklist

- When adding fallback logic, ask: can stale persisted data keep this path active forever?
- When deriving UI state, ask: is this live state, historical state, or inferred state?
- When adding store fields, ask: who reads this, how often does it change, and should it live elsewhere?
- When touching polling or bootstrap, ask: can a lighter payload erase richer existing data?
- When handling optimistic updates, ask: where is rollback, reconciliation, and duplicate prevention?
- When changing shared routes or state contracts, ask: what breaks in web, desktop, and VS Code?
- When fixing a bug with a heuristic, prefer narrowing the heuristic over widening it.

## Validation expectations

- Run `bun run type-check` and `bun run lint` before finalizing.
- For hot-path changes, verify behavior under streaming or repeated events, not just static render.
- For sync or startup changes, verify fresh load, retry/failure, and restart behavior.
- For session changes, verify create, stream, abort, permission, archive/delete, and revisit flows when relevant.

## Known issues (remote-instances settings redesign, in progress)

The settings page is mid-redesign to support remote instances. The model picker/provider filter is now instance-scoped (local `hiddenModels`/favorites/recents no longer leak to remote), and the Providers settings page is reachable on remote instances (fetches its provider list from the remote server). Still incomplete: most other OpenCode pages (`agents`, `behavior`, `commands`, `mcp`, `plugins`, `permissions`, etc.) remain `showOn: 'default'` and need their data/mutations wired to the active instance's server.

## Recent changes

- Releases + high-level changes: `CHANGELOG.md`
- Recent commits: `git log --oneline` (latest tags: `v1.4.6`, `v1.4.5`)
