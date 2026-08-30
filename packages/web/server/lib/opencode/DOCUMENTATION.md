# OpenCode Module Documentation

## Purpose
This module provides OpenCode server integration utilities for the web server runtime, including configuration management and provider authentication.

## Entrypoints and structure
- `packages/web/server/lib/opencode/index.js`: public entrypoint (currently baseline placeholder).
- `packages/web/server/lib/opencode/auth.js`: provider authentication file operations.
- `packages/web/server/lib/opencode/auth-state-runtime.js`: managed OpenCode server auth password/header runtime.
- `packages/web/server/lib/opencode/cli-options.js`: CLI/environment option parsing for server startup arguments.
- `packages/web/server/lib/opencode/cli-entry-runtime.js`: CLI entrypoint runtime that detects direct execution, parses CLI options, and starts server bootstrap.
- `packages/web/server/lib/opencode/routes.js`: OpenCode/provider settings and auth-related route registration.
- `packages/web/server/lib/opencode/opencode-upgrade-runtime.js`: Direct OpenCode CLI upgrade fallback, including install-source detection and captured package-manager diagnostics.
- `packages/web/server/lib/opencode/lifecycle.js`: OpenCode process lifecycle runtime (startup, restart, readiness, health monitoring).
- `packages/web/server/lib/opencode/lifecycle-journal.js`: serialized, size-bounded JSONL evidence journal for managed OpenCode spawn/exit/health/restart decisions.
- `packages/web/server/lib/opencode/config-file-watcher.js`: debounced OpenCode config-file watcher that validates JSONC and waits for managed sessions to become idle before recording a deferred restart.
- `packages/web/server/lib/opencode/pending-config-restart.js`: process-local accumulator for configuration changes that require an OpenCode restart, including active-session impact snapshots and single-flight apply behavior.
- `packages/web/server/lib/opencode/config-mutation-response.js`: shared deferred-restart response shape for successful configuration mutations.
- `packages/web/server/lib/opencode/interrupted-runs.js`: managed OpenCode restart recovery for stale in-flight message/tool rows in the OpenCode SQLite database.
- `packages/web/server/lib/opencode/sqlite-runtime.js`: shared synchronous SQLite driver selection for Bun, Electron/Node `node:sqlite`, and native `better-sqlite3` fallbacks.
- `packages/web/server/lib/opencode/env-runtime.js`: OpenCode CLI/binary resolution and shell environment runtime.
- `packages/web/server/lib/opencode/env-config.js`: OpenCode-related environment variable parsing and validation (host/port/hostname).
- `packages/web/server/lib/opencode/hmr-state-runtime.js`: HMR-persistent runtime state initialization, auth-state bootstrap, and HMR sync helpers.
- `packages/web/server/lib/opencode/bootstrap-runtime.js`: base app bootstrap runtime for status/auth/tts/notification/OpenChamber route wiring.
- `packages/web/server/lib/opencode/network-runtime.js`: OpenCode URL construction, health-probe readiness checks, and API prefix runtime.
- `packages/web/server/lib/opencode/project-directory-runtime.js`: request-scoped and settings-backed project directory resolution/validation runtime.
- `packages/web/server/lib/opencode/config-entity-routes.js`: route registration for agent/command/MCP config orchestration and reload semantics.
- `packages/web/server/lib/opencode/plugins.js`: plugin config and plugin-directory data layer. Production calls resolve the active OpenCode config normally; tests and isolated consumers use `createPluginDataLayer({ configDir, customConfigPath })` so config ownership is explicit and cannot leak through process-global environment state.
- `packages/web/server/lib/opencode/plugin-bootstrap.js` + `plugin-overlay.js`: install the first-party plugin under the `opencode-notifier` ownership basename and append it only to OpenChamber's managed config overlay. OMA recognizes that basename and disables its own OS notification hook for managed OpenCode, leaving Electron/OpenChamber as the single notification sender without changing standalone OpenCode behavior.
  - Plugin bundles, overlays, and runtime status live under `OPENCHAMBER_DATA_DIR` when set.
  - User plugin discovery and stale-entry cleanup use `OPENCODE_CONFIG_DIR` when set, so isolated runtimes do not read or mutate the default `~/.config/opencode`.
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
- `packages/web/server/lib/opencode/proxy.js`: OpenCode API/SSE forwarding and readiness-gate route registration. Message-history responses omit unused full-file diff snapshots before crossing into the UI while preserving renderable summary fields and cursors.
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
- `readAuthFile()`: Reads and parses `~/.local/share/opencode/auth.json`.
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
  - `readSettingsFromDisk()`
  - `readSettingsFromDiskMigrated()`
  - `writeSettingsToDisk(settings)`
  - `persistSettings(changes)`

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
- `createProjectDirectoryRuntime(dependencies)`: creates runtime for request/project directory candidate normalization and validation.
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
