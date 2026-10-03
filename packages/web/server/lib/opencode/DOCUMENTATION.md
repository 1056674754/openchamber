# OpenCode Module Documentation

## Purpose
This module provides OpenCode server integration utilities for the web server runtime, including configuration management and provider authentication.

## Entrypoints and structure
- `packages/web/server/lib/opencode/index.js`: public entrypoint (currently baseline placeholder).
- `packages/web/server/lib/opencode/auth.js`: provider authentication file operations.
- `packages/web/server/lib/opencode/auth-state-runtime.js`: managed OpenCode server auth password/header runtime.
- `packages/web/server/lib/opencode/credential-db.js`: read-only view of the OpenCode 2.x SQLite credential table, projected into the legacy `auth.json` entry shape (v2 track only; spine OC2-S2).
- `packages/web/server/lib/opencode/managed-config-file.js`: v2-track managed config file runtime (`opencode.managed.json`) whose plugin list the running OpenCode 2 hot-reloads; lifecycle wiring is OC2-S3/S8.
- `packages/web/server/lib/opencode/managed-plugin-config.js`: v2-track `plugins` merge helper (directory-form plugin entries, folds the legacy `plugin` key).
- `packages/web/server/lib/opencode/cli-options.js`: CLI/environment option parsing for server startup arguments.
- `packages/web/server/lib/opencode/cli-entry-runtime.js`: CLI entrypoint runtime that detects direct execution, parses CLI options, and starts server bootstrap.
- `packages/web/server/lib/opencode/routes.js`: OpenCode/provider settings and auth-related route registration.
- `packages/web/server/lib/opencode/opencode-upgrade-runtime.js`: Direct OpenCode CLI upgrade fallback, including install-source detection and captured package-manager diagnostics.
- `packages/web/server/lib/opencode/lifecycle.js`: OpenCode process lifecycle runtime (startup, restart, readiness, health monitoring).
- `packages/web/server/lib/opencode/lifecycle-journal.js`: serialized, size-bounded JSONL evidence journal for managed OpenCode spawn/exit/health/restart decisions.
- `packages/web/server/lib/opencode/config-file-watcher.js`: debounced OpenCode config-file watcher that validates JSONC and waits for managed sessions to become idle before recording a deferred restart.
- `packages/web/server/lib/opencode/pending-config-restart.js`: process-local accumulator for configuration changes that require an OpenCode restart, including active-session impact snapshots and single-flight apply behavior.
- `packages/web/server/lib/opencode/config-mutation-response.js`: shared response shapes for successful configuration mutations. `buildDeferredRestartResponse` is the v1 contract (restart deferred, `pendingRestart` snapshot); `buildAppliedResponse` is the v2-track answer (spine OC2-S3) — OpenCode 2 watches config files and reloads live, so the mutation is already applied when the route answers, optionally carrying the file the mutation landed in.
- `packages/web/server/lib/opencode/interrupted-runs.js`: managed OpenCode restart recovery for stale in-flight message/tool rows in the OpenCode SQLite database.
- `packages/web/server/lib/opencode/sqlite-runtime.js`: shared synchronous SQLite driver selection for Bun, Electron/Node `node:sqlite`, and native `better-sqlite3` fallbacks.
- `packages/web/server/lib/opencode/env-runtime.js`: OpenCode CLI/binary resolution and shell environment runtime.
- `packages/web/server/lib/opencode/env-config.js`: OpenCode-related environment variable parsing and validation (host/port/hostname).
- `packages/web/server/lib/opencode/hmr-state-runtime.js`: HMR-persistent runtime state initialization, auth-state bootstrap, and HMR sync helpers.
- `packages/web/server/lib/opencode/bootstrap-runtime.js`: base app bootstrap runtime for status/auth/tts/notification/OpenChamber route wiring.
- `packages/web/server/lib/opencode/network-runtime.js`: OpenCode URL construction, health-probe readiness checks, and API prefix runtime.
- `packages/web/server/lib/opencode/compatibility.js`: OpenCode version/probe helpers for the OC2 dual-stack migration (spine S1). Parses CLI `--version` output and external `/api/info` responses, falls back to the legacy `/global/health` contract to identify 1.x peers, and judges `v1 | v2` protocol mode from the major version. Suffix-aware (`-sscity` releases parse and compare correctly). Nothing here hard-fails on an old or unknown version — unlike upstream's compatibility gate, callers record the conservative `v1` default and keep serving v1 behavior.
- `packages/web/server/lib/opencode/protocol-mode.js`: per-server-instance store of probe results (`v1 | v2`, probed version, source) keyed by serverId (`default` = managed instance). `resolveProtocolMode` applies the `OPENCHAMBER_PROTOCOL_MODE=v1|v2` override for joint debugging/rollback, then the recorded mode, then the `v1` default. Recorded modes persist across process restarts in `<dataDir>/protocol-mode.json` (written atomically on every record, reloaded at module init, failure-isolated, skipped under test runners) so the plugin overlay and proxy mapping know the managed child's protocol before the first spawn of a fresh server process. The managed default stays v1 until activation.
- `packages/web/server/lib/opencode/upstream-v2-paths.js`: v1 → v2 upstream request-path translation (spine finale). `resolveUpstreamRequestPath` prefixes v1 paths with `/api` on the v2 track (OpenCode 2 answers 500 on its v1-shaped root paths), leaves already-v2 paths and base URLs untouched, and renames the v1 names OpenCode 2 moved (`/global/event` → `/event`, `/path` → `/location`, `/session/status` → `/session/active`). `rewriteDirectoryQueryForUpstream` moves v1's `?directory=` to the v2 location query (`location[directory]`), because the v2 location middleware otherwise ignores it and silently falls back to the server's working directory.
- `packages/web/server/lib/opencode/v2-prompt-dispatch.js`: server-side v2 prompt-dispatch planning for the five prompt senders (spine finale). Senders keep building the v1 `prompt_async` body — the `resolvePromptBody` hook contract — and on a v2-mode instance map it through `planV2PromptDispatch` + `postV2PromptDispatch`: selection switches (`/api/session/:id/model` with `Model.Ref` — v2 has no prompt-level variant, it rides the model ref — and `/agent`), synthetic pre-text parked on `/api/session/:id/synthetic` with `resume: false`, then the flat `/api/session/:id/prompt` (`{text, files, agents, delivery}`; `prompt_async` queue semantics map to `delivery: 'queue'`). The executor speaks v2-named paths without the `/api` prefix so URL boundaries that already translate keep owning it; raw-fetch callers add the prefix. `isV2PromptTrack(serverId)` reads the recorded protocol mode per call.
- `packages/web/server/lib/opencode/message-records.js`: shared v2 → v1 message-record view (OC2 session-call-surface fix-up). OpenCode 2 message reads answer `{data, cursor}` pages of FLAT records (`type` instead of `role`, `model` as `Model.Ref {providerID, id, variant}`, `content[]` instead of `parts`), while every fork consumer parses the v1 `{info, parts}` row. `readMessageRecords` / `readMessageRecord` normalize either track's answer to the v1 view — v1 rows (and loose partial rows) pass through by reference, so the v1 track's parsed shapes are unchanged — and `unwrapOpenCodeEnvelope` splits the single-record `{data}` wrapper (pages keep their envelope so callers can read the cursor). The v2 mapping mirrors upstream's `toLoopMessage`: synthetic folds into the user role, a completed compaction plays the `summary: true` assistant turn with `time.completed` defaulted, v2 structured errors gain the v1 `name` from `error.type`, and marker roles (`system`/`skill`/`shell`/`idle`/`*-switched`) are dropped. Consumed by openchamber-sessions, openchamber-control, session-goal, session-assist, context-obligatory, routing, notifications, and markdown-image-grants message reads.
- `packages/web/server/lib/opencode/config-v2.js` (+`.d.ts`): pure OpenCode 2.x config conversion layer (spine OC2-S3, upstream `654705f7d`). Canonical entity shapes for agents/commands/MCP/providers/plugins; accepts the v1 spellings OpenCode 2 still decodes (section keys `agent`/`command`/`provider`, permission maps, `npm`/`api` providers, plugin tuples) and writes native v2 (`permissions` rule arrays, `mcp.servers`, `package: "aisdk:…"`). Re-exported by the VS Code host so the two runtimes cannot drift. Consumed by `shared.js`'s `lookupSectionEntry` and the entity modules' v2 write paths (`mcp.js` from S3; `agents.js`/`commands.js`/`providers.js` from S8).
- `packages/web/server/lib/opencode/agents.js`, `commands.js`, `providers.js`: agent/command/provider config data layer, dual-track (S8 leftover of S3, upstream `654705f7d`). The v1 track is byte-stable (`agent`/`command`/`provider` sections, permission maps, raw frontmatter). The v2 track (per `resolveProtocolMode`) discovers entities in every OpenCode 2 directory (`agent(s)`, `mode(s)`, project-ancestor `.opencode` walks), reads/writes canonical v2 entities through `config-v2.js`, rewrites v1-located files in place in v2 shape, deletes both JSON spellings, and adds `getAgentPermissions` (ordered global+agent rules) / `getCommandConfig`. Custom providers on v2 accept both spellings, allow `@ai-sdk/openai-compatible|openai|anthropic`, and always write the `providers` section (`package: "aisdk:…"`, `settings.baseURL`, `models.<id>.modelID`).
- `packages/web/server/lib/opencode/v1-migration-topup.js`: re-arms OpenCode's own V1→V2 session migration before the managed child spawns (spine OC2-S3, upstream `654705f7d` + `ee99e079d`). Reads the completed `migration.v1-v2` row from OpenCode's SQLite store and schedules a resume cursor for legacy sessions 1.x touched after the migration finished. Never deletes the migration row, never revisits sessions with v2 activity, and self-guards on v1-only databases (no `session_v2` tables → skipped), so a pure v1 install is untouched.
- `packages/web/server/lib/opencode/config-entity-v2.test.js`: dual-track proof suite for the v2 config layout — mode `v1` (default) keeps the exact v1 file layout and section keys; mode `v2` activates `.opencode/`-first project candidates, `opencode.json`-only user paths, `OPENCODE_CONFIG_DIR` honoring, and both-spelling entry lookup through `shared.lookupSectionEntry`.
- `packages/web/server/lib/opencode/project-directory-runtime.js`: request-scoped and settings-backed project directory resolution/validation runtime.
- `packages/web/server/lib/opencode/config-entity-routes.js`: route registration for agent/command/MCP config orchestration and reload semantics. Mutation answers are per mode (`buildAppliedResponse` on v2, deferred restart on v1). Two v2-only route shapes (S8, upstream `654705f7d`) answer 404 on the v1 track: `GET /api/config/agents/:name/permissions` and `GET /api/config/commands/:name/config`.
- `packages/web/server/lib/opencode/plugins.js`: plugin config and plugin-directory data layer. Production calls resolve the active OpenCode config normally; tests and isolated consumers use `createPluginDataLayer({ configDir, customConfigPath })` so config ownership is explicit and cannot leak through process-global environment state.
- `packages/web/server/lib/opencode/plugin-bootstrap.js` + `plugin-overlay.js`: install the first-party plugin under the `opencode-notifier` ownership basename and append it only to OpenChamber's managed config overlay. OMA recognizes that basename and disables its own OS notification hook for managed OpenCode, leaving Electron/OpenChamber as the single notification sender without changing standalone OpenCode behavior.
  - Plugin bundles, overlays, and runtime status live under `OPENCHAMBER_DATA_DIR` when set.
  - User plugin discovery and stale-entry cleanup use `OPENCODE_CONFIG_DIR` when set, so isolated runtimes do not read or mutate the default `~/.config/opencode`.
  - v2 track (spine finale): on a recorded v2 instance the overlay writes the v2 `plugins` key instead — OpenCode 2 skips file-form configured entries — carrying the bundled plugin DIRECTORY (`<overlayDir>/openchamber-plugin/`, a `bun build` of the workspace plugin with the `server.js` entrypoint OpenCode 2's Host.resolve expects, rebuilt when source is newer, stale bundle reused when the source or the build is unavailable) plus the user's directory-form and npm-form entries. File-form user plugins are reported as `degradedPlugins` through `/api/openchamber/plugin-status` instead of failing silently. `checkPluginLoaded` probes `GET /api/plugin` on this track (the v1 `/experimental/tool/ids` path does not exist under OpenCode 2); a missing v1 runtime status file is enrichment, not a failure. The v1 overlay path is byte-stable.
- `packages/web/server/lib/opencode/snippets.js`: opencode-snippets-compatible snippet file CRUD, discovery, and hashtag expansion.
- `packages/web/server/lib/opencode/cli-options.js`: CLI/environment option parsing for server startup arguments.
- `packages/web/server/lib/opencode/core-routes.js`: server status/system routes, auth/access guard routes, and settings utility route registration.
- `packages/web/server/lib/opencode/shutdown-runtime.js`: graceful shutdown orchestration runtime for watcher/session/terminal/process/server teardown.
- `packages/web/server/lib/opencode/server-startup-runtime.js`: server listen/startup tunnel flow and process/signal handler orchestration runtime.
- `packages/web/server/lib/opencode/static-routes-runtime.js`: static asset/SPA fallback route registration and manifest route wiring.
- `packages/web/server/lib/opencode/feature-routes-runtime.js`: feature route composition runtime for dynamic import-backed config/skill/provider route registration.
- `packages/web/server/lib/opencode/opencode-resolution-runtime.js`: OpenCode binary resolution snapshot runtime for settings routes and diagnostics.
- `packages/web/server/lib/opencode/tunnel-wiring-runtime.js`: tunnel service/routes composition runtime and active-port wiring for main server startup.
- `packages/web/server/lib/opencode/startup-pipeline-runtime.js`: server startup tail orchestration runtime for terminal/proxy/static/start-listen flow.
  - The OpenChamber listener and active port are established before managed
    OpenCode bootstrap so generated plugins can receive a valid loopback
    callback URL.
- `packages/web/server/lib/opencode/server-utils-runtime.js`: shared server runtime utilities for OpenCode proxy wiring, OpenCode port/readiness helpers, and snapshot fetchers.
- `packages/web/server/lib/opencode/openchamber-routes.js`: OpenChamber update, models metadata, and session unread state route registration.
- `packages/web/server/lib/permission-auto-accept/runtime.js`: persisted server-side permission auto-accept policy and pending-permission reconciliation for scheduled/background sessions.
- `packages/web/server/lib/opencode/pwa-manifest-routes.js`: PWA manifest route registration with recent-session shortcut resolution and short-lived caching.
- `packages/web/server/lib/opencode/project-icon-routes.js`: project icon upload/read/discovery route registration and icon storage orchestration.
- `packages/web/server/lib/opencode/skill-routes.js`: route registration for skill config CRUD, supporting files, and skills catalog scan/install flows.
- `packages/web/server/lib/opencode/settings-runtime.js`: Settings persistence runtime (disk IO, migrations, normalization, project validation, and persisted update serialization).
  - Standalone Web instances serialize through the shared cross-process settings lock; embedded Electron injects the same lock boundary so shell and server read-modify-write operations cannot lose each other's keys.
  - Atomic writes remove failed temp files, and startup migration removes orphaned `settings.json.tmp-*` files without touching unrelated files.
- `packages/web/server/lib/opencode/settings-helpers.js`: Settings payload sanitization/format helpers runtime for response shaping and persisted merge prep.
- `packages/web/server/lib/opencode/settings-normalization-runtime.js`: path/settings/tunnel normalization and sanitization helpers runtime used by settings/routes/config wiring.
- `packages/web/server/lib/opencode/theme-runtime.js`: custom theme JSON validation and theme directory loading runtime for settings utility routes.

  `POST /api/config/themes` saves a converted VS Code palette. The runtime validates
  literal colors and required authored roles, assigns a content-derived filename,
  and publishes through a same-directory hard link so partial files and overwrites
  are impossible. Identical retries reuse the existing file; a manually edited
  collision returns 409. Temporary files are ignored by the loader and removed
  after publication or failure. Non-missing-directory read failures propagate to
  the route instead of returning an authoritative empty library.

  The common request middleware parses theme POST bodies before these routes;
  integration tests must use that middleware rather than an unrestricted test parser.
  `DELETE /api/config/themes/:id` finds a valid regular JSON file by its metadata ID
  inside the custom themes directory. IDs are never used as filenames. Hand-added
  themes are supported; symlinks and bundled themes are outside deletion ownership.
  Duplicate matching IDs fail explicitly. Missing themes are an idempotent success;
  filesystem failures remain errors.
  `theme-catalog.js` owns POST catalog search/package routes under
  `/api/config/themes/catalog/`. It fetches only Open VSX and its Eclipse CDN over
  HTTPS, validates redirects and checksums, and verifies packaged identity.
  `theme-archive.js` reads selected JSON entries in memory with bounded decompression.
  JSON includes and token references stay inside the package. Each failed variant
  is reported separately so valid siblings remain available. No extension code runs.
- `packages/web/server/lib/opencode/proxy.js`: OpenCode API/SSE forwarding and readiness-gate route registration. Message-history responses omit unused full-file diff snapshots before crossing into the UI while preserving renderable summary fields and cursors.
  - v2 boundary translation (spine finale): on the v2 track the generic proxy keeps the `/api` prefix (OpenCode 2 answers 500 on v1-shaped root paths), maps v1-only names through the shared rename table (`/api/path` → `/api/location`), rewrites `?directory=` into the v2 location query after the worktree gate, and points both SSE forwarders at the single v2 `/api/event` stream. The v1 track strips the prefix exactly as before.
- `packages/web/server/lib/opencode/session-runtime.js`: session status/attention/activity runtime for OpenCode SSE events.
- `packages/web/server/lib/opencode/session-unread-store.js`: persisted session unread state, manual read/unread mutations, and unread-count snapshots.
- Managed startup never probes or attaches to an arbitrary server on port `4096`. External attachment requires explicit host/port/skip-start configuration; reconnecting a port persisted by this OpenChamber runtime remains a separate managed path.
- `packages/web/server/lib/opencode/watcher.js`: global SSE watcher runtime for push/session event fanout.
- `packages/web/server/lib/opencode/shared.js`: shared utilities for config, markdown, skills, and git helpers.
  - JSONC reads reject parser errors, partial trees, arrays, scalars, and content that yields no JSON value; comment-only files remain valid empty layers.
  - `readConfigLayers()` isolates an invalid user/project/custom layer and reports it through `layerErrors`, so unrelated valid layers remain readable. Mutations fail closed when their authoritative target layer is invalid.
  - `writeConfig()` validates existing content before creating a backup or replacing it, preventing a mutation from overwriting an unparseable config with a partial object.
- `packages/web/server/lib/ui-auth/ui-auth.js`: UI session authentication runtime (outside OpenCode module).
- `packages/web/server/lib/ui-auth/ui-passkeys.js`: UI passkey storage and WebAuthn registration/authentication helpers (outside OpenCode module).

## Public exports (auth.js)
- `readAuthFile()`: Reads provider credentials. v1 track (default): parses `~/.local/share/opencode/auth.json`. v2 track (`protocolMode: 'v2'`, test seam `options.protocolMode`): answers from the OpenCode 2.x SQLite database (`credential-db.js`) authoritatively and falls back to the file only when the database cannot be read.
- `writeAuthFile(auth)`: Writes auth file with automatic backup.
- `removeProviderAuth(providerId)`: Removes a provider's auth entry.
- `getProviderAuth(providerId)`: Returns auth for a specific provider or null.
- `listProviderAuths()`: Returns list of provider IDs with configured auth.
- `AUTH_FILE`: Auth file path constant.
- `OPENCODE_DATA_DIR`: OpenCode data directory path constant.

## Public exports (shared.js)
- `OPENCODE_CONFIG_DIR`, `AGENT_DIR`, `COMMAND_DIR`, `SKILL_DIR`, `CONFIG_FILE`, `CUSTOM_CONFIG_FILE`: Path constants.
- `AGENT_SCOPE`, `COMMAND_SCOPE`, `SKILL_SCOPE`: Scope constants with USER and PROJECT values.
- `ensureDirs()`: Creates required OpenCode directories.
- `parseMdFile(filePath)`, `writeMdFile(filePath, frontmatter, body)`: Markdown file operations with YAML frontmatter.
- `getConfigPaths(workingDirectory)`, `readConfigLayers(workingDirectory)`, `readConfig(workingDirectory)`: Config file operations with layer merging (user, project, custom).
- `writeConfig(config, filePath)`: Writes config with automatic backup.
- `getJsonEntrySource(layers, sectionKey, entryName)`: Resolves which config layer provides an entry.
- `getJsonWriteTarget(layers, preferredScope)`: Determines write target for config updates.
- `getAncestors(startDir, stopDir)`, `findWorktreeRoot(startDir)`: Git worktree helpers.
- `isPromptFileReference(value)`, `resolvePromptFilePath(reference)`, `writePromptFile(filePath, content)`: Prompt file reference handling.
- `walkSkillMdFiles(rootDir)`: Recursively finds all SKILL.md files.
- `addSkillFromMdFile(skillsMap, skillMdPath, scope, source)`: Parses and indexes a skill file.
- `resolveSkillSearchDirectories(workingDirectory)`: Returns skill search path order (config, project, home, custom).
- `listSkillSupportingFiles(skillDir)`, `readSkillSupportingFile(skillDir, relativePath)`, `writeSkillSupportingFile(skillDir, relativePath, content)`, `deleteSkillSupportingFile(skillDir, relativePath)`: Skill supporting file management.

## Public exports (plugins.js)
- `createPluginDataLayer({ configDir, customConfigPath })`: Returns plugin config/file CRUD functions bound to an explicit config context. Tests must use this factory instead of mutating `process.env.OPENCODE_CONFIG`, because Bun can execute test files concurrently in one process.
- `listPluginEntries()`, `getPluginEntry()`, `createPluginEntry()`, `updatePluginEntry()`, `deletePluginEntry()`: Default production plugin config CRUD using the active OpenCode config.
- `listPluginDirFiles()`, `readPluginDirFile()`, `writePluginDirFile()`, `deletePluginDirFile()`: Default production plugin-directory CRUD.
- `encodePluginId()`, `decodePluginId()`, `parsePluginRaw()`, `serializePluginEntry()`: Plugin identifier and config-value helpers.

## Public exports (routes.js)
- `registerOpenCodeRoutes(app, dependencies)`: Registers OpenCode-owned HTTP routes and internal module runtime:
  - `GET /api/config/settings`
  - `PUT /api/config/settings`
  - `GET /api/config/opencode-resolution`
  - `POST /api/opencode/upgrade` (requires an explicit supported capability, proxies OpenCode upgrade, falls back to direct install-source upgrade when `/global/upgrade` fails without diagnostics, and returns `requiresReload` without restarting managed OpenCode)
  - `GET /api/opencode/upgrade-status` (returns an explicit `upgrade` capability; bundled and external runtimes fail closed)
  - `GET /api/opencode/health`
  - `GET /api/opencode/version`
  - `POST /api/opencode/directory`
  - `GET /api/provider/:providerId/source`
  - `DELETE /api/provider/:providerId/auth`
- Owns lazy auth library loading for provider auth checks/removal.
- Keeps route behavior independent from composition root; `index.js` now supplies dependencies only.

## Public exports (session-runtime.js)
- `createSessionRuntime({ writeSseEvent, getNotificationClients, broadcastEvent? })`: creates runtime-owned state machine and APIs for session status.
- Returned API:
  - `processOpenCodeSsePayload(payload)`
  - `getSessionActivitySnapshot()`
  - `getSessionStateSnapshot()`
  - `getSessionAttentionSnapshot()`
  - `getSessionState(sessionId)`
  - `getSessionAttentionState(sessionId)`
  - `markSessionViewed(sessionId, clientId)`
  - `markSessionUnviewed(sessionId, clientId)`
  - `markUserMessageSent(sessionId)`
  - `resetAllSessionActivityToIdle()`
  - `dispose()`

## Public exports (lifecycle.js)
- `createOpenCodeLifecycleRuntime(dependencies)`: creates lifecycle runtime for managed/external OpenCode process orchestration.
- Returned API:
  - `startOpenCode()`
  - `restartOpenCode(reason?)`
  - `waitForOpenCodeReady(timeoutMs?, intervalMs?)`
  - `waitForAgentPresence(agentName, timeoutMs?, intervalMs?)`
  - `refreshOpenCodeAfterConfigChange(reason, options?)`
  - `bootstrapOpenCodeAtStartup()`
  - `startHealthMonitoring(healthCheckIntervalMs)`
  - `waitForPortRelease(port, timeoutMs, hostname?)`
  - `killProcessOnPort(port)`

Configuration refreshes are single-flight across manual and automatic callers, so overlapping requests join the same restart/readiness operation.
The composition root rebuilds the OpenChamber plugin overlay before entering that lifecycle operation, keeping user plugin changes in sync with the managed overlay.
At desktop startup, a healthy persisted managed port is reused. If that port is still listening but fails health checks, lifecycle termination targets the listener's detached process group and waits for the port to be released before launching a replacement; it will not stack another managed server on top of an unreleased stale instance.
Managed process wrappers retain the child `pid`, `exitCode`, and `signalCode`, and keep an exit listener after readiness. This lets health checks distinguish a live child from an exited child instead of inferring process state from port health alone.
Dual-track readiness (spine OC2-S3): the v1 probe (`/global/health`, `healthy: true`) is unchanged and answers first; when it fails, one `/api/info` attempt per tick covers OpenCode 2.x (a 200 is the readiness answer) and records the protocol mode from the payload `version`. A recorded v2 instance probes `/api/info` directly. The stdout listener accepts the 2.x `server listening on <url>` line without the `opencode` prefix; the spawned child env carries both `OPENCODE_PASSWORD` and `OPENCODE_SERVER_PASSWORD` (2.x reads the former first; 1.x ignores it). Before each managed spawn the v1 session migration top-up runs (self-guarding, never fatal).
They also retain a bounded, credential-redacted stderr tail. Health failures are classified (`timeout`, `connection`, `invalid_response`, or `error`), and the last process/health/restart snapshots are exposed through `/health` for incident correlation without storing prompts or authorization values.
Transport-triggered health checks can run more frequently than the periodic monitor. Failed probes are therefore counted at most once per configured health interval, while a confirmed missing managed listener can still restart immediately. Busy-session grace and lifecycle evidence remain authoritative.
Startup timeout (`startupTimeoutMs` dep, env `OPENCHAMBER_OPENCODE_STARTUP_TIMEOUT_MS`, default 30 s) kills the spawned child if it never becomes ready, preventing orphan accumulation across retry attempts. A failed attempt also cleans up any stale listener on its allocated port before the retry begins. When `restartOpenCode` cannot release the old port after SIGKILL escalation, it records a `port_release_timeout` lifecycle event instead of silently proceeding.

## Public exports (lifecycle-journal.js)
- `createOpenCodeLifecycleJournal(options)`: creates a failure-isolated JSONL lifecycle journal.
- The production journal is written to `${OPENCHAMBER_DATA_DIR}/logs/opencode-lifecycle.jsonl`, defaults to `~/.config/openchamber/logs/opencode-lifecycle.jsonl`, and rotates one prior generation at 2 MB.
- Events include managed process spawn/readiness/exit/error, requested stop reason, health failures/recovery, busy-session deferral, and restart start/completion/failure.
- After a successful managed restart, every locally tracked busy/retry Session is authoritatively settled to idle and receives a synthetic `MessageAbortedError`; one UI notification identifies the interrupted chat set.
- Health failure entries include the managed PID, current port, listening PIDs, consecutive failure count, and active-session count. They do not include prompts, message content, credentials, request headers, or the spawned environment.
- Journal write failures warn once and never interrupt OpenCode startup, health checks, shutdown, or restart.

## Public exports (config-file-watcher.js)
- `createOpenCodeConfigFileWatcherRuntime(dependencies)`: watches user and active-project `opencode.json`, `opencode.jsonc`, and legacy `config.json` files for a managed OpenCode server.
- Invalid JSONC is ignored without disturbing the running server.
- Valid changes are debounced and held until the authoritative `/session/status` response and OpenChamber's live activity state both report no busy/retrying sessions, then recorded in the pending-restart accumulator.
- External or skip-start OpenCode instances are never restarted by the watcher.

## Public exports (pending-config-restart.js)
- `createPendingConfigRestartRuntime(dependencies)`: creates the deferred restart accumulator.
- `markPendingConfigRestart(reason, details?)`: records a change and broadcasts `openchamber:pending-config-restart` with the current count, reasons, change metadata, affected busy/retrying sessions, and apply state.
- `getPendingConfigRestart()`: returns the current accumulator snapshot.
- `applyPendingConfigRestart()`: applies the current batch through the managed lifecycle's configuration refresh. Concurrent apply requests join one promise, and changes recorded while that promise is running remain pending afterward.
- Successful configuration mutation routes return `requiresRestart: true`, `restartDeferred: true`, and the current `pendingRestart` snapshot. `PUT /api/config/settings` remains restart-free.
- `GET /api/opencode/restart/pending` returns the current snapshot. `POST /api/opencode/restart/apply` applies the current batch and reports any remaining pending changes.

## Public exports (interrupted-runs.js)
- `finalizeInterruptedOpenCodeRuns(options?)`: scans the OpenCode SQLite database for active tool parts left behind by an interrupted managed OpenCode process and marks the owning assistant message as aborted.

## Public exports (env-runtime.js)
- `createOpenCodeEnvRuntime(dependencies)`: creates runtime that owns OpenCode CLI environment and binary discovery state.
- Returned API:
  - `applyLoginShellEnvSnapshot()`
  - `getLoginShellEnvSnapshot()`
  - `ensureOpencodeCliEnv()`
  - `applyOpencodeBinaryFromSettings()`
  - `resolveOpencodeCliPath()`
  - `resolveManagedOpenCodeLaunchSpec(opencodePath)`: resolves the effective managed OpenCode launch target, unwrapping Windows package-manager shims to a direct native binary or explicit runtime+script when possible.
  - `resolveGitBinaryForSpawn()`
  - `resolveWslExecutablePath()`
  - `buildWslExecArgs(execArgs, distroOverride?)`
  - `isExecutable(filePath)`
  - `searchPathFor(binaryName)`
  - `clearResolvedOpenCodeBinary()`

## Public exports (env-config.js)
- `resolveOpenCodeEnvConfig(options?)`: resolves and validates OpenCode host/port/hostname environment configuration.
- Returned object fields:
  - `configuredOpenCodePort`
  - `configuredOpenCodeHost`
  - `effectivePort`
  - `configuredOpenCodeHostname`

## Public exports (hmr-state-runtime.js)
- `createHmrStateRuntime(dependencies)`: creates runtime for HMR state container initialization and runtime<->HMR state synchronization.
- `ensureUserProvidedOpenCodePassword` reads the user-provided password with OpenCode's own precedence: on the v2 track `OPENCODE_PASSWORD` first, then the legacy `OPENCODE_SERVER_PASSWORD` (upstream `8dd842a3b`); the v1 default track reads the legacy variable only, because OpenCode 1.x never reads `OPENCODE_PASSWORD`.
- Returned API:
  - `getOrCreateHmrState()`
  - `ensureUserProvidedOpenCodePassword(hmrState)`
  - `getUserProvidedOpenCodePassword(hmrState)`
  - `resolveOpenCodeAuthFromState({ hmrState, userProvidedOpenCodePassword })`
  - `syncStateFromRuntime(hmrState, runtime)`
  - `restoreRuntimeFromState({ hmrState, userProvidedOpenCodePassword })`

## Public exports (bootstrap-runtime.js)
- `createBootstrapRuntime(dependencies)`: creates runtime for base app route bootstrap and UI auth controller initialization.
- Returned API:
  - `setupBaseRoutes(app, options)`

## Public exports (network-runtime.js)
- `createOpenCodeNetworkRuntime(dependencies)`: creates runtime for OpenCode network and URL concerns.
- `waitForReady` is dual-track (spine OC2-S3): the v1 `/global/health` probe is unchanged and records the mode from its payload version; when it fails, one `/api/info` attempt per tick covers OpenCode 2.x (200 = ready) and records the v2 mode from its version.
- Returned API:
  - `waitForReady(url, timeoutMs?)`
  - `normalizeApiPrefix(prefix)`
  - `setDetectedOpenCodeApiPrefix()`
  - `buildOpenCodeUrl(path, prefixOverride?)`
  - `ensureOpenCodeApiPrefix()`
  - `scheduleOpenCodeApiDetection()`

## Public exports (settings-runtime.js)
- `createSettingsRuntime(dependencies)`: creates settings lifecycle runtime for read/migrate/persist concerns.
- Returned API:
  - `readSettingsFromDisk({ surface? })`
  - `readSettingsFromDiskMigrated({ surface? })`
  - `writeSettingsToDisk(settings, { surface?, changedKeys? })`
  - `persistSettings(changes, { surface? })`

## Two settings files (settings-files.js)
- `settings.json` holds instance facts and any legacy or unknown keys; `preferences.json` beside it holds every key the generated registry snapshot (`settings-registry.json`) marks `profile`, as `{ version: 1, fields: { key: { value, updatedAt, surfaces? } } }`. Keys the snapshot marks `perSurface` are stored per surface kind: `GET`/`PUT /api/config/settings` read the client's kind from the `surface` query parameter (`settingsSurfaceOf`), `persistSettings(changes, { surface })` writes a changed per-surface key under `surfaces[surface]` and never touches its base, and `readSettingsFromDisk({ surface })` resolves that kind's value first, the base otherwise. Callers without a surface (migrations, the seed, server-side feature writers) read and write the base. `readSettingsFromDisk()` returns the merged document and seeds `preferences.json` once from an existing `settings.json` (which it leaves intact). An existing `preferences.json` that fails to parse is a failure, not an empty profile: it is never seeded or overwritten, the merged read serves the instance part, and `persistSettings` drops profile keys with a warning until the file is fixed or removed. `writeSettingsToDisk(document)` splits by scope and writes `settings.json` as the instance part plus a copy of the profile's base values (`legacySettingsDocumentOf`): a build from before the split reads only that file, so a rollback keeps the user's preferences, while current builds ignore the copy because `preferences.json` wins in the merge. Fork: device keys this fork still round-trips (window controls, mobile keyboard mode, input bar offset) stay in `settings.json`; only `local` device keys are refused, by the registry gate in `settings-helpers.js`.
- Modules that read one profile key off the disk on a hot path use `readMergedSettingsSync`.

## Public exports (settings-files.js)
- `parsePreferencesDocument(raw)`, `serializePreferencesDocument(fields)`, `flattenPreferences(fields)`, `buildPreferencesFields(previousFields, document, now)`, `instancePartOf(document)`, `seedPreferencesFrom(document, now)`, `readMergedSettingsSync({ fs, path, settingsFilePath })`, `isProfileSettingsKey(key)`, `isDeviceSettingsKey(key)`, `normalizeSettingsSurface(value)`, `settingsSurfaceOf(req)`, `preferencesFilePathFor(settingsFilePath, path)`.
- The VS Code extension host writes the same two files with the same shape (`packages/vscode/src/settings-files.ts`); format changes go to both.

## Public exports (settings-helpers.js)
- `createSettingsHelpers(dependencies)`: creates settings helper runtime for settings request/response shaping.
- Returned API:
  - `normalizePwaAppName(value, fallback?)`
  - `sanitizeSettingsUpdate(payload)`
  - `mergePersistedSettings(current, changes)`
  - `formatSettingsResponse(settings)`

## Public exports (settings-normalization-runtime.js)
- `createSettingsNormalizationRuntime(dependencies)`: creates normalization/sanitization runtime for shared settings and tunnel helper logic.
- Returned API:
  - `normalizeDirectoryPath(value)`
  - `normalizePathForPersistence(value)`
  - `normalizeSettingsPaths(input)`
  - `normalizeTunnelBootstrapTtlMs(value)`
  - `normalizeTunnelSessionTtlMs(value)`
  - `normalizeManagedRemoteTunnelHostname(value)`
  - `normalizeManagedRemoteTunnelPresets(value)`
  - `normalizeManagedRemoteTunnelPresetTokens(value)`
  - `isUnsafeSkillRelativePath(value)`
  - `sanitizeTypographySizesPartial(input)`
  - `normalizeStringArray(input)`
  - `sanitizeModelRefs(input, limit)`
  - `sanitizeSkillCatalogs(input)`
  - `sanitizeProjects(input)`

## Public exports (theme-runtime.js)
- `createThemeRuntime(dependencies)`: creates custom theme runtime for on-disk theme discovery and JSON normalization/validation.
- Returned API:
  - `normalizeThemeJson(raw)`
  - `readCustomThemesFromDisk()`

## Public exports (project-directory-runtime.js)
- `createProjectDirectoryRuntime(dependencies)`: creates runtime for request/project directory candidate normalization and validation. `dependencies.refuseDirectory(candidate)` answers the reason a resolved directory may not be used on this host, or null; `validateDirectoryPath` asks it before it looks at the disk, so a refused directory is never touched and never falls back to another one. The isolated-spaces host refuses `/spaces/...` through it while its switch is on.
- Returned API:
  - `resolveDirectoryCandidate(value)`
  - `validateDirectoryPath(candidate)`
  - `resolveRequiredExplicitProjectDirectory(req)`
  - `resolveProjectDirectory(req)`
  - `resolveOptionalProjectDirectory(req)`

## Public exports (config-entity-routes.js)
- `registerConfigEntityRoutes(app, dependencies)`: registers configuration entity routes:
  - Agents: `/api/config/agents/:name` and `/api/config/agents/:name/config`
  - Commands: `/api/config/commands/:name`
  - MCP servers: `/api/config/mcp` and `/api/config/mcp/:name`
  - Snippets: `/api/config/snippets`, `/api/config/snippets/:name`, and `/api/config/snippets/expand`

## Public exports (auth-state-runtime.js)
- `createOpenCodeAuthStateRuntime(dependencies)`: creates runtime for managed OpenCode auth password state and request headers.
- Returned API:
  - `getOpenCodeAuthHeaders()`
  - `isOpenCodeConnectionSecure()`
  - `ensureLocalOpenCodeServerPassword(options?)`

## Public exports (core-routes.js)
- `registerServerStatusRoutes(app, dependencies)`: registers status/system endpoints:
  - `GET /health`
  - `POST /api/system/shutdown`
  - `GET /api/system/info`
 - `registerAuthAndAccessRoutes(app, dependencies)`: registers browser auth/session exchange and API access middleware:
   - `GET /auth/session`
   - `POST /auth/session`
   - `GET /auth/passkey/status`
   - `POST /auth/passkey/authenticate/options`
   - `POST /auth/passkey/authenticate/verify`
   - `POST /auth/passkey/register/options`
   - `POST /auth/passkey/register/verify`
   - `GET /api/passkeys`
   - `DELETE /api/passkeys/:id`
   - `POST /api/auth/reset`
   - `GET /connect`
   - `app.use('/api', ...)` auth/tunnel guard
- `registerSettingsUtilityRoutes(app, dependencies)`: registers small settings utility endpoints:
  - `GET /api/config/themes`
  - `POST /api/config/reload`
- `registerCommonRequestMiddleware(app, dependencies)`: registers shared request middleware stack:
  - conditional JSON body parser behavior for `/api/*` vs non-API requests
  - URL-encoded parser setup
  - request logging middleware
  - `dependencies.skipBodyParsing(req)` names a request both parsers leave alone, so its body reaches its route untouched; the isolated-spaces dispatcher uses it for `/api/spaces/<id>/...`, which it streams into a space

## Public exports (cli-options.js)
- `parseServeCliOptions(options)`: parses serve CLI flags and environment-derived defaults:
  - Port/host/ui-password
  - Tunnel provider/mode/config/token/hostname
  - Legacy `--tunnel` shorthand normalization

## Public exports (cli-entry-runtime.js)
- `runCliEntryIfMain(dependencies)`: detects direct CLI execution and runs server startup with parsed CLI options.

## Public exports (server-utils-runtime.js)
- `createServerUtilsRuntime(dependencies)`: creates server utility runtime for OpenCode orchestration helpers.
- Returned API:
  - `setOpenCodePort(port)`
  - `waitForOpenCodePort(timeoutMs?)`
  - `buildAugmentedPath()`
  - `parseSseDataPayload(block)`
  - `fetchAgentsSnapshot()`
  - `fetchProvidersSnapshot()`
  - `fetchModelsSnapshot()`
  - `setupProxy(app)`

## Public exports (shutdown-runtime.js)
- `createGracefulShutdownRuntime(dependencies)`: creates graceful shutdown runtime for managed OpenCode and web server teardown sequencing.
- Returned API:
  - `gracefulShutdown(options?)`

## Public exports (server-startup-runtime.js)
- `createServerStartupRuntime(dependencies)`: creates runtime for server bind/startup tunnel and process handler wiring.
- Returned API:
  - `resolveBindHost(host)`
  - `startListeningAndMaybeTunnel(options)`
  - `attachProcessHandlers(options)`

## Public exports (static-routes-runtime.js)
- `createStaticRoutesRuntime(dependencies)`: creates runtime for static dist resolution and static route registration.
- Returned API:
  - `registerStaticRoutes(app)`

## Public exports (feature-routes-runtime.js)
- `createFeatureRoutesRuntime(dependencies)`: creates runtime for main feature route registration orchestration.
- Returned API:
  - `registerRoutes(app, routeDependencies)`

## Public exports (opencode-resolution-runtime.js)
- `createOpenCodeResolutionRuntime(dependencies)`: creates runtime for OpenCode binary/source snapshot resolution.
- Returned API:
  - `getOpenCodeResolutionSnapshot(settings)`: returns configured/resolved OpenCode binary details plus effective managed-launch fields (`launchBinary`, `launchArgs`, `launchWrapperType`) when applicable.

## Public exports (tunnel-wiring-runtime.js)
- `createTunnelWiringRuntime(dependencies)`: creates runtime for tunnel service construction and tunnel route registration.
- Returned API:
  - `initialize(app, initialPort)`

## Public exports (startup-pipeline-runtime.js)
- `createStartupPipelineRuntime(dependencies)`: creates runtime for terminal wiring, proxy/bootstrap scheduling, static route registration, and server startup/listen flow.
- Returned API:
  - `run(options)`

## Public exports (openchamber-routes.js)
- `registerOpenChamberRoutes(app, dependencies)`: registers OpenChamber endpoints:
  - `GET /api/openchamber/update-check`
  - `POST /api/openchamber/update-install`
  - `GET /api/openchamber/models-metadata`
  - `GET /api/zen/models`

## Public exports (pwa-manifest-routes.js)
- `registerPwaManifestRoute(app, dependencies)`: registers PWA manifest endpoint with dynamic app-name resolution and recent-session shortcuts:
  - `GET /manifest.webmanifest`

## Public exports (project-icon-routes.js)
- `registerProjectIconRoutes(app, dependencies)`: registers project icon routes and owns icon storage/discovery flow:
  - `GET /api/projects/:projectId/icon`
  - `PUT /api/projects/:projectId/icon`
  - `DELETE /api/projects/:projectId/icon`
  - `POST /api/projects/:projectId/icon/discover`

## Public exports (skill-routes.js)
- `registerSkillRoutes(app, dependencies)`: registers skills-related routes:
  - Skills config CRUD and metadata under `/api/config/skills*`
  - Skill rename via `PATCH /api/config/skills/:name` with `{ renameTo }` (directory rename preserves `SKILL.md` body and supporting files; restricted to managed skill roots under `.opencode/skills|skill`, `.claude/skills`, and `.agents/skills`)
  - Skills catalog listing/source pagination, scan, and install routes
  - Supporting skill file read/write/delete routes
- `GET /api/config/skills` merges OpenCode's skill report with filesystem discovery scoped to the request directory. Each merged skill may include `opencodeSynced`: `true` when OpenCode reported it, `false` when it exists only on disk after a successful OpenCode fetch, and absent when the OpenCode fetch failed so synchronization state is unknown. Each skill also carries an authoritative `renamable` boolean derived from the same managed-root policy used by rename.
- Directory resolution prefers an explicit request directory, then soft-falls back to the active project / `lastDirectory` (via `resolveProjectDirectory`) so repository-local `.agents/skills` and `.opencode/skills` remain discoverable when the client omits `directory`.

## Public exports (proxy.js)
- `registerOpenCodeProxy(app, dependencies)`: registers OpenCode proxy routes and middleware.
- Owns:
  - SSE forwarders: `GET /api/global/event`, `GET /api/event`
  - Upstream-only SSE stall detection; proxy-generated downstream heartbeats do not mask a silent OpenCode stream, which is closed so clients can reconnect
  - Session message forwarder: `POST /api/session/:sessionId/message`
  - Generic `/api/*` forwarding with hop-by-hop header filtering
  - One lazily selected keep-alive agent per HTTP/HTTPS scheme, shared by generic API and interactive OAuth proxies; a cold loopback fallback can later switch to an external HTTPS pool safely
  - Decoded payload accounting via `x-openchamber-decoded-content-length`; the proxy only derives it from an identity-encoded upstream `content-length`, before browser-facing compression
  - Windows `/session` merge fallback path behavior
- OpenCode readiness gate for proxied `/api` requests
- Worktree checkout gate before directory-scoped upstream reads and writes

Git bootstrap must reach `git-ready` before OpenCode can cache a new worktree's
project identity or config. Setup scripts may still be running; the optional UI
setup wait remains separate. Failed or timed-out checkout returns 503 without
forwarding. This server gate covers web, Electron, hosted mobile, and Capacitor
connections; the VS Code extension owns its separate Git and proxy implementation.

## Public exports (watcher.js)
- `createOpenCodeWatcherRuntime(dependencies)`: creates global event watcher runtime backed by the shared upstream SSE reader.
- Returned API:
  - `start()`
  - `stop()`
- Behavior:
  - Waits for OpenCode readiness before attaching the watcher.
  - In production wiring, subscribes to the shared global message-stream hub instead of opening its own `/global/event` connection.
  - Can still create its own `/global/event` reader when no shared hub is provided, which keeps module tests and isolated reuse simple.
  - Reuses event-stream parsing, `Last-Event-ID`, stall timeout, and reconnect behavior.
  - Forwards unwrapped global event payloads into notification/session side effects.

## Storage and configuration
- Provider auth: `~/.local/share/opencode/auth.json`.
- User config: `~/.config/opencode/opencode.json`.
- Project config: `<workingDirectory>/.opencode/opencode.json` or `opencode.json`.
- Custom config: `OPENCODE_CONFIG` env var path.
- Rate limit config: `OPENCHAMBER_RATE_LIMIT_MAX_ATTEMPTS`, `OPENCHAMBER_RATE_LIMIT_NO_IP_MAX_ATTEMPTS` env vars.
- Managed OpenCode runtime state: `<openchamberDataDir>/last-opencode-port`, `<openchamberDataDir>/managed-opencode-ports.json`, and `<openchamberDataDir>/managed-opencode-auth.json`.

## Notes for contributors
- Packaged Electron builds set `OPENCHAMBER_BUNDLED_OPENCODE_BINARY` before importing the server. A valid bundled executable is authoritative over persisted `settings.opencodeBinary`, keeping the managed child inside the signed app bundle with a stable macOS code identity.
- Set `OPENCHAMBER_USE_EXTERNAL_OPENCODE=true` only as an explicit desktop troubleshooting escape hatch. Development builds without a bundled executable keep the existing settings, environment, PATH, and fallback resolution order.
- `/api/opencode/upgrade` refuses in-place upgrades for bundled and external runtimes; embedded `-sscity` code must be rebuilt through the packaging runbook.
- This module serves as foundation for OpenCode-related server utilities.
- Route ownership moved to module-level `routes.js`; `index.js` wires dependencies only.
- All file writes include automatic backup before modification.
- Config merging follows priority: custom > project > user.
- UI auth uses scrypt for password hashing with constant-time comparison.
- Tunnel auth treats `host.docker.internal` as local-only when the socket remote IP is private/loopback.
