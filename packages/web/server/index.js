import 'reflect-metadata';
import express from 'express';
import compression from 'compression';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';
import { createUiAuth } from './lib/ui-auth/ui-auth.js';
import { createTunnelAuth } from './lib/opencode/tunnel-auth.js';
import { createManagedTunnelConfigRuntime } from './lib/tunnels/managed-config.js';
import { createTunnelProviderRegistry } from './lib/tunnels/registry.js';
import { createCloudflareTunnelProvider } from './lib/tunnels/providers/cloudflare.js';
import { createNgrokTunnelProvider } from './lib/tunnels/providers/ngrok.js';
import { createRequestSecurityRuntime } from './lib/security/request-security.js';
import {
  TUNNEL_MODE_MANAGED_LOCAL,
  TUNNEL_MODE_MANAGED_REMOTE,
  TUNNEL_MODE_QUICK,
  TUNNEL_PROVIDER_CLOUDFLARE,
  TunnelServiceError,
  isSupportedTunnelMode,
  normalizeOptionalPath,
  normalizeTunnelStartRequest,
  normalizeTunnelMode,
  normalizeTunnelProvider,
} from './lib/tunnels/types.js';
import { prepareNotificationLastMessage } from './lib/notifications/index.js';
import { registerTtsRoutes } from './lib/tts/routes.js';
import { detectSayTtsCapability } from './lib/tts/capability-runtime.js';
import { createTerminalRuntime } from './lib/terminal/runtime.js';
import {
  createGlobalUiEventBroadcaster,
  createGlobalMessageStreamHub,
  createMessageStreamWsRuntime,
  DEFAULT_UPSTREAM_STALL_TIMEOUT_MS,
  UPSTREAM_STALL_TIMEOUT_CONCURRENT_MS,
} from './lib/event-stream/index.js';
import { createFsSearchRuntime as createFsSearchRuntimeFactory } from './lib/fs/search.js';
import { createOpenCodeLifecycleRuntime } from './lib/opencode/lifecycle.js';
import { createOpenCodeLifecycleJournal } from './lib/opencode/lifecycle-journal.js';
import { createOpenCodeEnvRuntime } from './lib/opencode/env-runtime.js';
import { resolveOpenCodeEnvConfig } from './lib/opencode/env-config.js';
import { createHmrStateRuntime } from './lib/opencode/hmr-state-runtime.js';
import { createOpenCodeNetworkRuntime } from './lib/opencode/network-runtime.js';
import { createOpenCodeAuthStateRuntime } from './lib/opencode/auth-state-runtime.js';
import { createProjectDirectoryRuntime } from './lib/opencode/project-directory-runtime.js';
import { createSettingsNormalizationRuntime } from './lib/opencode/settings-normalization-runtime.js';
import { createSettingsHelpers } from './lib/opencode/settings-helpers.js';
import { createThemeRuntime } from './lib/opencode/theme-runtime.js';
import { createFeatureRoutesRuntime } from './lib/opencode/feature-routes-runtime.js';
import { parseServeCliOptions } from './lib/opencode/cli-options.js';
import {
  registerAuthAndAccessRoutes,
  registerCommonRequestMiddleware,
  registerServerStatusRoutes,
} from './lib/opencode/core-routes.js';
import { registerOpenChamberRoutes } from './lib/opencode/openchamber-routes.js';
import {
  prepareOpenChamberConfig,
  cleanupOpenChamberPluginFromUserConfig,
  checkPluginLoaded,
} from './lib/opencode/plugin-bootstrap.js';
import { createServerUtilsRuntime } from './lib/opencode/server-utils-runtime.js';
import { createStaticRoutesRuntime } from './lib/opencode/static-routes-runtime.js';
import { createSettingsRuntime } from './lib/opencode/settings-runtime.js';
import { createOpenCodeResolutionRuntime } from './lib/opencode/opencode-resolution-runtime.js';
import { resolveOpenCodeUpgradeCapability } from './lib/opencode/upgrade-capability.js';
import { createBootstrapRuntime } from './lib/opencode/bootstrap-runtime.js';
import { createSessionRuntime } from './lib/opencode/session-runtime.js';
import { createSessionUnreadStore } from './lib/opencode/session-unread-store.js';
import { createSessionMarkersStore } from './lib/opencode/session-markers-store.js';
import { createOpenCodeWatcherRuntime } from './lib/opencode/watcher.js';
import { createOpenCodeConfigFileWatcherRuntime } from './lib/opencode/config-file-watcher.js';
import { createScheduledTasksRuntime } from './lib/scheduled-tasks/runtime.js';
import { createScheduledTaskService } from './lib/scheduled-tasks/service.js';
import { createOpenChamberSessionService } from './lib/openchamber-sessions/service.js';
import { createOpenChamberControlService } from './lib/openchamber-control/service.js';
import { createAgentToolRuntime } from './lib/agent-tool/runtime.js';
import { createRuntimeFallbackApprovalService } from './lib/agent-tool/runtime-fallback-approval.js';
import { createServerStartupRuntime } from './lib/opencode/server-startup-runtime.js';
import { createTunnelWiringRuntime } from './lib/opencode/tunnel-wiring-runtime.js';
import { createStartupPipelineRuntime } from './lib/opencode/startup-pipeline-runtime.js';
import { runCliEntryIfMain } from './lib/opencode/cli-entry-runtime.js';
import { registerNotificationRoutes } from './lib/notifications/routes.js';
import { createNotificationEmitterRuntime } from './lib/notifications/emitter-runtime.js';
import { createNotificationTriggerRuntime } from './lib/notifications/runtime.js';
import { createPushRuntime } from './lib/notifications/push-runtime.js';
import { createNotificationTemplateRuntime } from './lib/notifications/template-runtime.js';
import { createPermissionAutoAcceptRuntime } from './lib/permission-auto-accept/runtime.js';
import { createGracefulShutdownRuntime } from './lib/opencode/shutdown-runtime.js';
import { createSessionGoalRuntime } from './lib/session-goal/runtime.js';
import { createSessionAssistRuntime } from './lib/session-assist/runtime.js';
import { createContextObligatoryRuntime } from './lib/context-obligatory/runtime.js';
import { createProjectConfigRuntime } from './lib/projects/project-config.js';
import { createPreviewProxyRuntime } from './lib/preview/proxy-runtime.js';
import { createRemoteInstancesRuntime } from './lib/remote-instances/config.js';
import { createRemoteGlobalEventFanout } from './lib/remote-instances/global-event-fanout.js';
import { registerRemoteInstanceRoutes } from './lib/remote-instances/routes.js';
import { registerRemoteProxy } from './lib/remote-instances/proxy.js';
import { registerRemoteSseRelay } from './lib/remote-instances/sse-relay.js';
import { registerRemoteRpcWebSocket } from './lib/remote-instances/rpc-ws.js';
import { buildRemoteUpstreamHeaders } from './lib/remote-instances/request-headers.js';
import { createRemoteClientAuthRuntime } from './lib/client-auth/remote-clients.js';
import { createClientPairingRuntime } from './lib/client-auth/pairing.js';
import { registerClientAuthPairingRoutes } from './lib/client-auth/pairing-routes.js';
import { createPairingLanHelpers } from './lib/client-auth/pairing-lan.js';
import { createRelayService } from './lib/relay/service.js';
import { createRelayHostLock } from './lib/relay/host-lock.js';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import webPush from 'web-push';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 3000;
const DESKTOP_NOTIFY_PREFIX = '[OpenChamberDesktopNotify] ';
const uiNotificationClients = new Set();
const uiNotificationWsClients = new Set();
const uiOpenChamberEventClients = new Set();
const HEALTH_CHECK_INTERVAL = 15000;
const SHUTDOWN_TIMEOUT = 10000;
const MODELS_DEV_API_URL = 'https://models.dev/api.json';
const MODELS_METADATA_CACHE_TTL = 5 * 60 * 1000;
const CLIENT_RELOAD_DELAY_MS = 800;
const OPEN_CODE_READY_GRACE_MS = 12000;
const LONG_REQUEST_TIMEOUT_MS = 4 * 60 * 1000;
const TUNNEL_BOOTSTRAP_TTL_DEFAULT_MS = 30 * 60 * 1000;
const TUNNEL_BOOTSTRAP_TTL_MIN_MS = 60 * 1000;
const TUNNEL_BOOTSTRAP_TTL_MAX_MS = 24 * 60 * 60 * 1000;
const TUNNEL_SESSION_TTL_DEFAULT_MS = 8 * 60 * 60 * 1000;
const TUNNEL_SESSION_TTL_MIN_MS = 5 * 60 * 1000;
const TUNNEL_SESSION_TTL_MAX_MS = 30 * 24 * 60 * 60 * 1000;

function headerIncludesEventStream(value) {
  if (typeof value === 'string') {
    return value.toLowerCase().includes('text/event-stream');
  }

  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === 'string' && entry.toLowerCase().includes('text/event-stream'));
  }

  return false;
}

/**
 * SSE endpoint paths that must never be compressed by the compression middleware.
 *
 * The compression middleware filter runs before route handlers, so
 * `res.getHeader('Content-Type')` is still undefined at that point.
 * This means the Accept-header check alone is not sufficient for
 * non-standard clients (e.g. curl, fetch) that omit Accept.
 * Path-based exclusion acts as a deterministic fallback.
 */
const SSE_PATH_PREFIXES = [
  '/api/event',
  '/api/global/event',
  '/api/notifications/stream',
  '/api/openchamber/events',
];

function shouldSkipCompression(req, res) {
  if (headerIncludesEventStream(req.headers.accept)) {
    return true;
  }

  const pathname = req.path || req.url || '';
  if ((pathname === '/api' || pathname.startsWith('/api/')) && shouldSkipApiCompression()) {
    return true;
  }

  for (const prefix of SSE_PATH_PREFIXES) {
    if (pathname === prefix) {
      return true;
    }
  }

  if (pathname.startsWith('/api/remote/') && (pathname.endsWith('/global/event') || pathname.endsWith('/event'))) {
    return true;
  }

  return headerIncludesEventStream(res.getHeader('Content-Type'));
}

const OPENCHAMBER_VERSION = (() => {
  const runtimeVersion = process.env.OPENCHAMBER_VERSION?.trim();
  if (runtimeVersion) return runtimeVersion;

  try {
    const packagePath = path.resolve(__dirname, '..', 'package.json');
    const raw = fs.readFileSync(packagePath, 'utf8');
    const pkg = JSON.parse(raw);
    if (pkg && typeof pkg.version === 'string' && pkg.version.trim().length > 0) {
      return pkg.version.trim();
    }
  } catch {
  }
  return 'unknown';
})();

const isEnvFlagEnabled = (value) => {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
};

const isEnvFlagDisabled = (value) => {
  if (value === false || value === 0) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '0' || normalized === 'false';
};

const resolveBoundedIntegerEnv = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const shouldSkipApiCompression = () => {
  if (isEnvFlagEnabled(process.env.OPENCHAMBER_SKIP_API_COMPRESSION)) return true;
  if (isEnvFlagEnabled(process.env.OPENCHAMBER_COMPRESS_API)) return false;
  if (isEnvFlagDisabled(process.env.OPENCHAMBER_COMPRESS_API)) return true;
  return process.env.OPENCHAMBER_RUNTIME === 'desktop';
};

const OPENCHAMBER_VERBOSE_REQUEST_LOGS = isEnvFlagEnabled(process.env.OPENCHAMBER_VERBOSE_REQUEST_LOGS);
const OPENCHAMBER_HTTP_LISTEN_BACKLOG = resolveBoundedIntegerEnv(
  process.env.OPENCHAMBER_HTTP_LISTEN_BACKLOG,
  2048,
  128,
  65535,
);
const OPENCHAMBER_HTTP_KEEP_ALIVE_TIMEOUT_MS = resolveBoundedIntegerEnv(
  process.env.OPENCHAMBER_HTTP_KEEP_ALIVE_TIMEOUT_MS,
  60_000,
  5_000,
  300_000,
);

const PLAN_MODE_EXPERIMENT_ENABLED =
  isEnvFlagEnabled(process.env.OPENCODE_EXPERIMENTAL_PLAN_MODE)
  || isEnvFlagEnabled(process.env.OPENCODE_EXPERIMENTAL);

const fsPromises = fs.promises;

const settingsNormalizationRuntime = createSettingsNormalizationRuntime({
  os,
  path,
  processLike: process,
  realpathSync: fs.realpathSync,
  tunnelBootstrapTtlDefaultMs: TUNNEL_BOOTSTRAP_TTL_DEFAULT_MS,
  tunnelBootstrapTtlMinMs: TUNNEL_BOOTSTRAP_TTL_MIN_MS,
  tunnelBootstrapTtlMaxMs: TUNNEL_BOOTSTRAP_TTL_MAX_MS,
  tunnelSessionTtlDefaultMs: TUNNEL_SESSION_TTL_DEFAULT_MS,
  tunnelSessionTtlMinMs: TUNNEL_SESSION_TTL_MIN_MS,
  tunnelSessionTtlMaxMs: TUNNEL_SESSION_TTL_MAX_MS,
});

const normalizeDirectoryPath = (...args) => settingsNormalizationRuntime.normalizeDirectoryPath(...args);
const normalizePathForPersistence = (...args) => settingsNormalizationRuntime.normalizePathForPersistence(...args);
const normalizeSettingsPaths = (...args) => settingsNormalizationRuntime.normalizeSettingsPaths(...args);
const normalizeTunnelBootstrapTtlMs = (...args) => settingsNormalizationRuntime.normalizeTunnelBootstrapTtlMs(...args);
const normalizeTunnelSessionTtlMs = (...args) => settingsNormalizationRuntime.normalizeTunnelSessionTtlMs(...args);
const normalizeManagedRemoteTunnelHostname = (...args) =>
  settingsNormalizationRuntime.normalizeManagedRemoteTunnelHostname(...args);
const normalizeManagedRemoteTunnelPresets = (...args) =>
  settingsNormalizationRuntime.normalizeManagedRemoteTunnelPresets(...args);
const normalizeManagedRemoteTunnelPresetTokens = (...args) =>
  settingsNormalizationRuntime.normalizeManagedRemoteTunnelPresetTokens(...args);
const isUnsafeSkillRelativePath = (...args) => settingsNormalizationRuntime.isUnsafeSkillRelativePath(...args);
const sanitizeTypographySizesPartial = (...args) =>
  settingsNormalizationRuntime.sanitizeTypographySizesPartial(...args);
const normalizeStringArray = (...args) => settingsNormalizationRuntime.normalizeStringArray(...args);
const sanitizeModelRefs = (...args) => settingsNormalizationRuntime.sanitizeModelRefs(...args);
const sanitizeSkillCatalogs = (...args) => settingsNormalizationRuntime.sanitizeSkillCatalogs(...args);
const sanitizeProjects = (...args) => settingsNormalizationRuntime.sanitizeProjects(...args);

const OPENCHAMBER_USER_CONFIG_ROOT = path.join(os.homedir(), '.config', 'openchamber');
const OPENCHAMBER_USER_THEMES_DIR = path.join(OPENCHAMBER_USER_CONFIG_ROOT, 'themes');
const OPENCHAMBER_PROJECTS_CONFIG_DIR = path.join(OPENCHAMBER_USER_CONFIG_ROOT, 'projects');

const MAX_THEME_JSON_BYTES = 512 * 1024;


const themeRuntime = createThemeRuntime({
  fsPromises,
  path,
  themesDir: OPENCHAMBER_USER_THEMES_DIR,
  maxThemeJsonBytes: MAX_THEME_JSON_BYTES,
  logger: console,
});

const readCustomThemesFromDisk = (...args) => themeRuntime.readCustomThemesFromDisk(...args);

let notificationTemplateRuntime = null;

const createTimeoutSignal = (...args) => notificationTemplateRuntime.createTimeoutSignal(...args);
const formatProjectLabel = (...args) => notificationTemplateRuntime.formatProjectLabel(...args);
const resolveNotificationTemplate = (...args) => notificationTemplateRuntime.resolveNotificationTemplate(...args);
const shouldApplyResolvedTemplateMessage = (...args) => notificationTemplateRuntime.shouldApplyResolvedTemplateMessage(...args);
const fetchFreeZenModels = (...args) => notificationTemplateRuntime.fetchFreeZenModels(...args);
const extractTextFromParts = (...args) => notificationTemplateRuntime.extractTextFromParts(...args);
const extractLastMessageText = (...args) => notificationTemplateRuntime.extractLastMessageText(...args);
const fetchLastAssistantMessageText = (...args) => notificationTemplateRuntime.fetchLastAssistantMessageText(...args);
const maybeCacheSessionInfoFromEvent = (...args) => notificationTemplateRuntime.maybeCacheSessionInfoFromEvent(...args);
const buildTemplateVariables = (...args) => notificationTemplateRuntime.buildTemplateVariables(...args);
const getCachedZenModels = (...args) => notificationTemplateRuntime.getCachedZenModels(...args);

const OPENCHAMBER_DATA_DIR = process.env.OPENCHAMBER_DATA_DIR
  ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
  : path.join(os.homedir(), '.config', 'openchamber');
const openCodeLifecycleJournal = createOpenCodeLifecycleJournal({
  dataDir: OPENCHAMBER_DATA_DIR,
});
const SETTINGS_FILE_PATH = path.join(OPENCHAMBER_DATA_DIR, 'settings.json');
const PUSH_SUBSCRIPTIONS_FILE_PATH = path.join(OPENCHAMBER_DATA_DIR, 'push-subscriptions.json');
const CLOUDFLARE_MANAGED_REMOTE_TUNNELS_FILE_PATH = path.join(OPENCHAMBER_DATA_DIR, 'cloudflare-managed-remote-tunnels.json');
const CLOUDFLARE_LEGACY_NAMED_TUNNELS_FILE_PATH = path.join(OPENCHAMBER_DATA_DIR, 'cloudflare-named-tunnels.json');
const CLOUDFLARE_MANAGED_REMOTE_TUNNELS_VERSION = 1;

const LAST_OPENCODE_PORT_FILE = path.join(OPENCHAMBER_DATA_DIR, 'last-opencode-port');
const MANAGED_OPENCODE_PORTS_FILE = path.join(OPENCHAMBER_DATA_DIR, 'managed-opencode-ports.json');
const MANAGED_OPENCODE_AUTH_FILE = path.join(OPENCHAMBER_DATA_DIR, 'managed-opencode-auth.json');
const REMOTE_CLIENTS_FILE_PATH = path.join(OPENCHAMBER_DATA_DIR, 'remote-clients.json');
const CLIENT_PAIRING_SESSIONS_FILE_PATH = path.join(OPENCHAMBER_DATA_DIR, 'client-pairing-sessions.json');

const normalizeManagedOpenCodePort = (value) => {
  const port = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(port) && port > 0 && port <= 65535 ? port : null;
};

const readManagedOpenCodePorts = () => {
  try {
    if (!fs.existsSync(MANAGED_OPENCODE_PORTS_FILE)) return [];
    const raw = fs.readFileSync(MANAGED_OPENCODE_PORTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(normalizeManagedOpenCodePort).filter((port) => port !== null))];
  } catch {
    return [];
  }
};

const writeManagedOpenCodePorts = (ports) => {
  try {
    fs.mkdirSync(OPENCHAMBER_DATA_DIR, { recursive: true });
    const normalized = [...new Set((ports || []).map(normalizeManagedOpenCodePort).filter((port) => port !== null))];
    fs.writeFileSync(MANAGED_OPENCODE_PORTS_FILE, JSON.stringify(normalized, null, 2), 'utf8');
  } catch {
  }
};

const rememberManagedOpenCodePort = (port) => {
  const normalizedPort = normalizeManagedOpenCodePort(port);
  if (normalizedPort === null) return;
  const ports = readManagedOpenCodePorts().filter((entry) => entry !== normalizedPort);
  ports.push(normalizedPort);
  writeManagedOpenCodePorts(ports.slice(-20));
};

const clearManagedOpenCodePorts = () => {
  writeManagedOpenCodePorts([]);
};

const persistOpenCodePort = (port) => {
  try {
    fs.writeFileSync(LAST_OPENCODE_PORT_FILE, String(port), 'utf8');
    rememberManagedOpenCodePort(port);
  } catch {
  }
};

const readPersistedOpenCodePort = () => {
  try {
    if (!fs.existsSync(LAST_OPENCODE_PORT_FILE)) return null;
    const raw = fs.readFileSync(LAST_OPENCODE_PORT_FILE, 'utf8').trim();
    return normalizeManagedOpenCodePort(raw);
  } catch {
    return null;
  }
};

const persistManagedOpenCodeAuth = (password) => {
  if (typeof password !== 'string' || password.trim().length === 0) return;
  try {
    fs.mkdirSync(OPENCHAMBER_DATA_DIR, { recursive: true });
    fs.writeFileSync(
      MANAGED_OPENCODE_AUTH_FILE,
      JSON.stringify({ password: password.trim() }, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    );
    fs.chmodSync(MANAGED_OPENCODE_AUTH_FILE, 0o600);
  } catch {
  }
};

const restoreManagedOpenCodeAuth = () => {
  try {
    if (userProvidedOpenCodePassword) return false;
    if (!fs.existsSync(MANAGED_OPENCODE_AUTH_FILE)) return false;
    const raw = fs.readFileSync(MANAGED_OPENCODE_AUTH_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const password = typeof parsed?.password === 'string' ? parsed.password.trim() : '';
    if (!password) return false;
    openCodeAuthPassword = password;
    openCodeAuthSource = 'persisted-managed';
    process.env.OPENCODE_SERVER_PASSWORD = password;
    syncToHmrState();
    return true;
  } catch {
    return false;
  }
};

const isDesktopManagedOpenCodePreserveRuntime = () =>
  process.env.OPENCHAMBER_RUNTIME === 'desktop' || process.env.OPENCHAMBER_ELECTRON_DEV === '1';

const shouldPreserveManagedOpenCodeOnImplicitShutdown = () => {
  if (!isDesktopManagedOpenCodePreserveRuntime()) return false;
  try {
    const raw = fs.readFileSync(SETTINGS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.desktopKeepManagedOpenCodeAliveOnQuit !== false;
  } catch {
    return true;
  }
};

const managedTunnelConfigRuntime = createManagedTunnelConfigRuntime({
  fsPromises,
  path,
  normalizeManagedRemoteTunnelHostname,
  normalizeManagedRemoteTunnelPresets,
  constants: {
    CLOUDFLARE_MANAGED_REMOTE_TUNNELS_FILE_PATH,
    CLOUDFLARE_LEGACY_NAMED_TUNNELS_FILE_PATH,
    CLOUDFLARE_MANAGED_REMOTE_TUNNELS_VERSION,
  },
});

const readManagedRemoteTunnelConfigFromDisk = (...args) => managedTunnelConfigRuntime.readManagedRemoteTunnelConfigFromDisk(...args);
const syncManagedRemoteTunnelConfigWithPresets = (...args) => managedTunnelConfigRuntime.syncManagedRemoteTunnelConfigWithPresets(...args);
const upsertManagedRemoteTunnelToken = (...args) => managedTunnelConfigRuntime.upsertManagedRemoteTunnelToken(...args);
const resolveManagedRemoteTunnelToken = (...args) => managedTunnelConfigRuntime.resolveManagedRemoteTunnelToken(...args);

const settingsHelpers = createSettingsHelpers({
  normalizePathForPersistence,
  normalizeDirectoryPath,
  normalizeTunnelBootstrapTtlMs,
  normalizeTunnelSessionTtlMs,
  normalizeTunnelProvider,
  normalizeTunnelMode,
  normalizeOptionalPath,
  normalizeManagedRemoteTunnelHostname,
  normalizeManagedRemoteTunnelPresets,
  normalizeManagedRemoteTunnelPresetTokens,
  sanitizeTypographySizesPartial,
  normalizeStringArray,
  sanitizeModelRefs,
  sanitizeSkillCatalogs,
  sanitizeProjects,
});

const normalizePwaAppName = (...args) => settingsHelpers.normalizePwaAppName(...args);
const normalizePwaOrientation = (...args) => settingsHelpers.normalizePwaOrientation(...args);
const sanitizeSettingsUpdate = (...args) => settingsHelpers.sanitizeSettingsUpdate(...args);
const mergePersistedSettings = (...args) => settingsHelpers.mergePersistedSettings(...args);
const formatSettingsResponse = (...args) => settingsHelpers.formatSettingsResponse(...args);

const projectDirectoryRuntime = createProjectDirectoryRuntime({
  fsPromises,
  path,
  normalizeDirectoryPath,
  getReadSettingsFromDiskMigrated: () => readSettingsFromDiskMigrated,
  sanitizeProjects,
});

const resolveDirectoryCandidate = (...args) => projectDirectoryRuntime.resolveDirectoryCandidate(...args);
const validateDirectoryPath = (...args) => projectDirectoryRuntime.validateDirectoryPath(...args);
const resolveRequiredExplicitProjectDirectory = (...args) => projectDirectoryRuntime.resolveRequiredExplicitProjectDirectory(...args);
const resolveProjectDirectory = (...args) => projectDirectoryRuntime.resolveProjectDirectory(...args);
const resolveOptionalProjectDirectory = (...args) => projectDirectoryRuntime.resolveOptionalProjectDirectory(...args);

const settingsRuntime = createSettingsRuntime({
  fsPromises,
  path,
  crypto,
  SETTINGS_FILE_PATH,
  sanitizeProjects,
  sanitizeSettingsUpdate,
  mergePersistedSettings,
  normalizeSettingsPaths,
  normalizeStringArray,
  formatSettingsResponse,
  resolveDirectoryCandidate,
  normalizeManagedRemoteTunnelHostname,
  normalizeManagedRemoteTunnelPresets,
  normalizeManagedRemoteTunnelPresetTokens,
  syncManagedRemoteTunnelConfigWithPresets,
  upsertManagedRemoteTunnelToken,
});

const readSettingsFromDiskMigrated = (...args) => settingsRuntime.readSettingsFromDiskMigrated(...args);
const readSettingsFromDisk = (...args) => settingsRuntime.readSettingsFromDisk(...args);
const writeSettingsToDisk = (...args) => settingsRuntime.writeSettingsToDisk(...args);
const persistSettings = (...args) => settingsRuntime.persistSettings(...args);

const requestSecurityRuntime = createRequestSecurityRuntime({
  readSettingsFromDiskMigrated,
});

const getUiSessionTokenFromRequest = (...args) => requestSecurityRuntime.getUiSessionTokenFromRequest(...args);

const pushRuntime = createPushRuntime({
  fsPromises,
  path,
  webPush,
  PUSH_SUBSCRIPTIONS_FILE_PATH,
  readSettingsFromDiskMigrated,
  writeSettingsToDisk,
});

const getOrCreateVapidKeys = (...args) => pushRuntime.getOrCreateVapidKeys(...args);
const addOrUpdatePushSubscription = (...args) => pushRuntime.addOrUpdatePushSubscription(...args);
const removePushSubscription = (...args) => pushRuntime.removePushSubscription(...args);
const sendPushToAllUiSessions = (...args) => pushRuntime.sendPushToAllUiSessions(...args);
const updateUiVisibility = (...args) => pushRuntime.updateUiVisibility(...args);
const isAnyUiVisible = (...args) => pushRuntime.isAnyUiVisible(...args);
const isUiVisible = (...args) => pushRuntime.isUiVisible(...args);
const ensurePushInitialized = (...args) => pushRuntime.ensurePushInitialized(...args);
const setPushInitialized = (...args) => pushRuntime.setPushInitialized(...args);

const TERMINAL_INPUT_WS_MAX_REBINDS_PER_WINDOW = 128;
const TERMINAL_INPUT_WS_REBIND_WINDOW_MS = 60 * 1000;
const TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS = 15 * 1000;

const rejectWebSocketUpgrade = (...args) => requestSecurityRuntime.rejectWebSocketUpgrade(...args);


const isRequestOriginAllowed = (...args) => requestSecurityRuntime.isRequestOriginAllowed(...args);

const notificationEmitterRuntime = createNotificationEmitterRuntime({
  process,
  getDesktopNotifyEnabled: () => ENV_DESKTOP_NOTIFY,
  desktopNotifyPrefix: DESKTOP_NOTIFY_PREFIX,
  getUiNotificationClients: () => uiNotificationClients,
  getBroadcastGlobalUiEvent: () => broadcastGlobalUiEvent,
});

const writeSseEvent = (...args) => notificationEmitterRuntime.writeSseEvent(...args);
const emitDesktopNotification = (...args) => notificationEmitterRuntime.emitDesktopNotification(...args);
const broadcastGlobalUiEvent = createGlobalUiEventBroadcaster({
  sseClients: uiNotificationClients,
  wsClients: uiNotificationWsClients,
  writeSseEvent,
});
const broadcastUiNotification = (...args) => notificationEmitterRuntime.broadcastUiNotification(...args);

const unreadStore = createSessionUnreadStore({
  fs,
  path,
  dataDir: OPENCHAMBER_DATA_DIR,
  onChange: (change) => {
    broadcastGlobalUiEvent({
      type: 'openchamber:session-unread',
      properties: change,
    });
  },
});
unreadStore.load();

const markersStore = createSessionMarkersStore({
  fs,
  path,
  dataDir: OPENCHAMBER_DATA_DIR,
  onChange: (change) => {
    broadcastGlobalUiEvent({
      type: 'openchamber:session-markers',
      properties: change,
    });
  },
});
markersStore.load();

const sessionRuntime = createSessionRuntime({
  writeSseEvent,
  getNotificationClients: () => uiNotificationClients,
  broadcastEvent: broadcastGlobalUiEvent,
  unreadStore,
  markersStore,
});

const getActiveSessionCount = () => {
  const snapshot = sessionRuntime.getSessionActivitySnapshot();
  return Object.values(snapshot).filter((entry) => entry.type === 'busy').length;
};

const getUpstreamStallTimeoutMs = () => (
  getActiveSessionCount() > 1
    ? UPSTREAM_STALL_TIMEOUT_CONCURRENT_MS
    : DEFAULT_UPSTREAM_STALL_TIMEOUT_MS
);

const projectConfigRuntime = createProjectConfigRuntime({
  fsPromises,
  path,
  projectsDirPath: OPENCHAMBER_PROJECTS_CONFIG_DIR,
});

// HMR-persistent state via globalThis
// These values survive Vite HMR reloads to prevent zombie OpenCode processes
const hmrStateRuntime = createHmrStateRuntime({
  globalThisLike: globalThis,
  os,
  processLike: process,
  stateKey: '__openchamberHmrState',
});
const hmrState = hmrStateRuntime.getOrCreateHmrState();
hmrStateRuntime.ensureUserProvidedOpenCodePassword(hmrState);

// Non-HMR state (safe to reset on reload)
let healthCheckInterval = null;
let server = null;
let expressApp = null;
let currentRestartPromise = null;
let isRestartingOpenCode = false;
let openCodeApiPrefix = '';
let openCodeApiPrefixDetected = true;
let openCodeApiDetectionTimer = null;
let lastOpenCodeError = null;
let lastOpenCodeLaunchDiagnostics = null;
let isOpenCodeReady = false;
let openCodeNotReadySince = 0;
let isExternalOpenCode = false;
let exitOnShutdown = true;
let uiAuthController = null;
let activeTunnelController = null;
let globalWatcherStartPromise = null;
const tunnelProviderRegistry = createTunnelProviderRegistry([
  createCloudflareTunnelProvider(),
  createNgrokTunnelProvider(),
]);
tunnelProviderRegistry.seal();
const tunnelAuthController = createTunnelAuth();

const remoteClientAuthRuntime = createRemoteClientAuthRuntime({
  fsPromises,
  path,
  crypto,
  storePath: REMOTE_CLIENTS_FILE_PATH,
});
const clientPairingRuntime = createClientPairingRuntime({
  fsPromises,
  path,
  crypto,
  storePath: CLIENT_PAIRING_SESSIONS_FILE_PATH,
  remoteClientAuthRuntime,
});
/** @type {ReturnType<typeof createRelayService> | null} */
let relayServiceInstance = null;

const readSettingsFromDiskStrict = async () => {
  const settings = await readSettingsFromDiskMigrated();
  if (!settings || typeof settings !== 'object') {
    throw new Error('Settings file is unreadable or corrupt');
  }
  return settings;
};
let runtimeManagedRemoteTunnelToken = '';
let runtimeManagedRemoteTunnelHostname = '';
let terminalRuntime = null;
let messageStreamRuntime = null;
let remoteInstancesRuntimeRef = null;
let agentToolRuntime = null;
const userProvidedOpenCodePassword = hmrStateRuntime.getUserProvidedOpenCodePassword(hmrState);
const initialOpenCodeAuthState = hmrStateRuntime.resolveOpenCodeAuthFromState({
  hmrState,
  userProvidedOpenCodePassword,
});
let openCodeAuthPassword = initialOpenCodeAuthState.openCodeAuthPassword;
let openCodeAuthSource = initialOpenCodeAuthState.openCodeAuthSource;

// Sync helper - call after modifying any HMR state variable
const syncToHmrState = () => {
  hmrStateRuntime.syncStateFromRuntime(hmrState, {
    openCodeProcess,
    openCodePort,
    openCodeBaseUrl,
    isShuttingDown,
    signalsAttached,
    openCodeWorkingDirectory,
    openCodeAuthPassword,
    openCodeAuthSource,
  });
};

// Sync helper - call to restore state from HMR (e.g., on module reload)
const syncFromHmrState = () => {
  const restored = hmrStateRuntime.restoreRuntimeFromState({
    hmrState,
    userProvidedOpenCodePassword,
  });
  openCodeProcess = restored.openCodeProcess;
  openCodePort = restored.openCodePort;
  openCodeBaseUrl = restored.openCodeBaseUrl;
  isShuttingDown = restored.isShuttingDown;
  signalsAttached = restored.signalsAttached;
  openCodeWorkingDirectory = restored.openCodeWorkingDirectory;
  openCodeAuthPassword = restored.openCodeAuthPassword;
  openCodeAuthSource = restored.openCodeAuthSource;
};

// Module-level variables that shadow HMR state
// These are synced to/from hmrState to survive HMR reloads
let openCodeProcess = hmrState.openCodeProcess;
let openCodePort = hmrState.openCodePort;
let openCodeBaseUrl = hmrState.openCodeBaseUrl ?? null;
let isShuttingDown = hmrState.isShuttingDown;
let signalsAttached = hmrState.signalsAttached;
let openCodeWorkingDirectory = hmrState.openCodeWorkingDirectory;

const {
  configuredOpenCodePort: ENV_CONFIGURED_OPENCODE_PORT,
  configuredOpenCodeHost: ENV_CONFIGURED_OPENCODE_HOST,
  effectivePort: ENV_EFFECTIVE_PORT,
  configuredOpenCodeHostname: ENV_CONFIGURED_OPENCODE_HOSTNAME,
} = resolveOpenCodeEnvConfig({
  env: process.env,
  logger: console,
});

const ENV_SKIP_OPENCODE_START = process.env.OPENCODE_SKIP_START === 'true' ||
                                    process.env.OPENCHAMBER_SKIP_OPENCODE_START === 'true';
const ENV_DESKTOP_NOTIFY = (() => {
  if (process.env.OPENCHAMBER_DESKTOP_NOTIFY === 'true') {
    return true;
  }

  if (process.env.OPENCHAMBER_RUNTIME === 'desktop') {
    return true;
  }

  const argv0 = typeof process.argv?.[0] === 'string' ? process.argv[0] : '';
  const argv1 = typeof process.argv?.[1] === 'string' ? process.argv[1] : '';
  return /openchamber-server/i.test(argv0) || /openchamber-server/i.test(argv1);
})();

const openCodeAuthStateRuntime = createOpenCodeAuthStateRuntime({
  crypto,
  process,
  getAuthPassword: () => openCodeAuthPassword,
  setAuthPassword: (value) => {
    openCodeAuthPassword = value;
  },
  getAuthSource: () => openCodeAuthSource,
  setAuthSource: (value) => {
    openCodeAuthSource = value;
  },
  getUserProvidedPassword: () => userProvidedOpenCodePassword,
  syncToHmrState,
});

const getOpenCodeAuthHeaders = (...args) => openCodeAuthStateRuntime.getOpenCodeAuthHeaders(...args);
const isOpenCodeConnectionSecure = (...args) => openCodeAuthStateRuntime.isOpenCodeConnectionSecure(...args);
const ensureLocalOpenCodeServerPassword = (...args) => openCodeAuthStateRuntime.ensureLocalOpenCodeServerPassword(...args);

const openCodeNetworkState = {};
Object.defineProperties(openCodeNetworkState, {
  openCodePort: { get: () => openCodePort, set: (value) => { openCodePort = value; } },
  openCodeBaseUrl: { get: () => openCodeBaseUrl, set: (value) => { openCodeBaseUrl = value; } },
  openCodeApiPrefix: { get: () => openCodeApiPrefix, set: (value) => { openCodeApiPrefix = value; } },
  openCodeApiPrefixDetected: { get: () => openCodeApiPrefixDetected, set: (value) => { openCodeApiPrefixDetected = value; } },
  openCodeApiDetectionTimer: { get: () => openCodeApiDetectionTimer, set: (value) => { openCodeApiDetectionTimer = value; } },
});

const openCodeNetworkRuntime = createOpenCodeNetworkRuntime({
  state: openCodeNetworkState,
  getOpenCodeAuthHeaders,
});

const waitForReady = (...args) => openCodeNetworkRuntime.waitForReady(...args);
const normalizeApiPrefix = (...args) => openCodeNetworkRuntime.normalizeApiPrefix(...args);
const setDetectedOpenCodeApiPrefix = (...args) => openCodeNetworkRuntime.setDetectedOpenCodeApiPrefix(...args);
const buildOpenCodeUrl = (...args) => openCodeNetworkRuntime.buildOpenCodeUrl(...args);
const ensureOpenCodeApiPrefix = (...args) => openCodeNetworkRuntime.ensureOpenCodeApiPrefix(...args);
const scheduleOpenCodeApiDetection = (...args) => openCodeNetworkRuntime.scheduleOpenCodeApiDetection(...args);

const ENV_CONFIGURED_API_PREFIX = normalizeApiPrefix(
  process.env.OPENCODE_API_PREFIX || process.env.OPENCHAMBER_API_PREFIX || ''
);

  if (ENV_CONFIGURED_API_PREFIX && ENV_CONFIGURED_API_PREFIX !== '') {
  console.warn('Ignoring configured OpenCode API prefix; API runs at root.');
}

let cachedLoginShellEnvSnapshot;
let resolvedOpencodeBinary = null;
let resolvedOpencodeBinarySource = null;
let resolvedNodeBinary = null;
let resolvedBunBinary = null;
let resolvedGitBinary = null;
let useWslForOpencode = false;
let resolvedWslBinary = null;
let resolvedWslOpencodePath = null;
let resolvedWslDistro = null;

const openCodeEnvState = {};
Object.defineProperties(openCodeEnvState, {
  cachedLoginShellEnvSnapshot: { get: () => cachedLoginShellEnvSnapshot, set: (value) => { cachedLoginShellEnvSnapshot = value; } },
  resolvedOpencodeBinary: { get: () => resolvedOpencodeBinary, set: (value) => { resolvedOpencodeBinary = value; } },
  resolvedOpencodeBinarySource: { get: () => resolvedOpencodeBinarySource, set: (value) => { resolvedOpencodeBinarySource = value; } },
  resolvedNodeBinary: { get: () => resolvedNodeBinary, set: (value) => { resolvedNodeBinary = value; } },
  resolvedBunBinary: { get: () => resolvedBunBinary, set: (value) => { resolvedBunBinary = value; } },
  resolvedGitBinary: { get: () => resolvedGitBinary, set: (value) => { resolvedGitBinary = value; } },
  useWslForOpencode: { get: () => useWslForOpencode, set: (value) => { useWslForOpencode = value; } },
  resolvedWslBinary: { get: () => resolvedWslBinary, set: (value) => { resolvedWslBinary = value; } },
  resolvedWslOpencodePath: { get: () => resolvedWslOpencodePath, set: (value) => { resolvedWslOpencodePath = value; } },
  resolvedWslDistro: { get: () => resolvedWslDistro, set: (value) => { resolvedWslDistro = value; } },
});

const openCodeEnvRuntime = createOpenCodeEnvRuntime({
  state: openCodeEnvState,
  normalizeDirectoryPath,
  readSettingsFromDiskMigrated,
});

const applyLoginShellEnvSnapshot = (...args) => openCodeEnvRuntime.applyLoginShellEnvSnapshot(...args);
const getLoginShellEnvSnapshot = (...args) => openCodeEnvRuntime.getLoginShellEnvSnapshot(...args);
const ensureOpencodeCliEnv = (...args) => openCodeEnvRuntime.ensureOpencodeCliEnv(...args);
const applyOpencodeBinaryFromSettings = (...args) => openCodeEnvRuntime.applyOpencodeBinaryFromSettings(...args);
const resolveOpencodeCliPath = (...args) => openCodeEnvRuntime.resolveOpencodeCliPath(...args);
const isBundledOpenCodeCliPath = (...args) => openCodeEnvRuntime.isBundledOpenCodeCliPath(...args);
const isExecutable = (...args) => openCodeEnvRuntime.isExecutable(...args);
const searchPathFor = (...args) => openCodeEnvRuntime.searchPathFor(...args);
const resolveGitBinaryForSpawn = (...args) => openCodeEnvRuntime.resolveGitBinaryForSpawn(...args);
const resolveManagedOpenCodeLaunchSpec = (...args) => openCodeEnvRuntime.resolveManagedOpenCodeLaunchSpec(...args);
const clearResolvedOpenCodeBinary = (...args) => openCodeEnvRuntime.clearResolvedOpenCodeBinary(...args);
const openCodeResolutionRuntime = createOpenCodeResolutionRuntime({
  path,
  resolveOpencodeCliPath,
  applyOpencodeBinaryFromSettings,
  ensureOpencodeCliEnv,
  resolveManagedOpenCodeLaunchSpec,
  getResolvedState: () => ({
    resolvedOpencodeBinary,
    resolvedOpencodeBinarySource,
    useWslForOpencode,
    resolvedWslBinary,
    resolvedWslOpencodePath,
    resolvedWslDistro,
    resolvedNodeBinary,
    resolvedBunBinary,
  }),
  setResolvedOpencodeBinarySource: (value) => {
    resolvedOpencodeBinarySource = value;
  },
});
const getOpenCodeResolutionSnapshot = (...args) =>
  openCodeResolutionRuntime.getOpenCodeResolutionSnapshot(...args);

applyLoginShellEnvSnapshot();

notificationTemplateRuntime = createNotificationTemplateRuntime({
  readSettingsFromDisk,
  persistSettings,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  resolveGitBinaryForSpawn,
});

const notificationTriggerRuntime = createNotificationTriggerRuntime({
  readSettingsFromDisk,
  prepareNotificationLastMessage,
  buildTemplateVariables,
  extractLastMessageText,
  fetchLastAssistantMessageText,
  resolveNotificationTemplate,
  shouldApplyResolvedTemplateMessage,
  emitDesktopNotification,
  broadcastUiNotification,
  sendPushToAllUiSessions,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
});

const maybeSendPushForTrigger = (...args) => notificationTriggerRuntime.maybeSendPushForTrigger(...args);
const setAutoAcceptSession = (...args) => notificationTriggerRuntime.setAutoAcceptSession(...args);

const globalMessageStreamHub = createGlobalMessageStreamHub({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  upstreamStallTimeoutMs: getUpstreamStallTimeoutMs,
});

const sessionGoalRuntime = createSessionGoalRuntime({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  getSmallModelService: async () => import('./lib/small-model/index.js'),
  emitGoalNotification: async ({ sessionId, directory, status, goal }) => {
    // Local-only settle signal; full push fanout is deferred.
    const settings = await readSettingsFromDisk();
    if (settings.notifyOnCompletion === false) {
      return;
    }
    const title = status === 'complete'
      ? 'Goal complete'
      : (status === 'budgetLimited' ? 'Goal reached its token budget' : 'Goal blocked');
    const detail = goal?.statusReason && goal.statusReason !== 'verified by audit' && goal.statusReason !== 'reported by agent'
      ? goal.statusReason
      : (goal?.note || '');
    const objective = typeof goal?.objective === 'string' ? goal.objective.slice(0, 140) : '';
    const notificationPayload = {
      title,
      body: [objective, detail].filter(Boolean).join(' — ').slice(0, 240),
      tag: `goal-${sessionId}`,
      kind: 'goal',
      sessionId,
      directory,
    };
    const desktopNotificationDelivered = emitDesktopNotification(notificationPayload);
    broadcastUiNotification(notificationPayload, { desktopNotificationDelivered });
  },
});

const sessionAssistRuntime = createSessionAssistRuntime({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  getSmallModelService: async () => import('./lib/small-model/index.js'),
  readSettings: () => readSettingsFromDisk(),
});

const contextObligatoryRuntime = createContextObligatoryRuntime({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  resolveRemoteUpstream: (serverId) => {
    const instance = remoteInstancesRuntimeRef?.getInstanceSync?.(serverId);
    if (!instance?.url) return null;
    return {
      baseUrl: String(instance.url).replace(/\/$/, ''),
      headers: buildRemoteUpstreamHeaders(instance),
    };
  },
});

console.log('[session-goal] listening for local OpenCode session events');
globalMessageStreamHub.subscribeEvent((event) => {
  const raw = event?.payload;
  const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : raw;
  if (!payload || typeof payload !== 'object') return;
  const directory = typeof event?.directory === 'string' && event.directory && event.directory !== 'global'
    ? event.directory
    : '';
  // Local hub has no remote serverId; pass default explicitly for the hard gate.
  sessionGoalRuntime.processPayload(payload, directory, 'default');
  sessionAssistRuntime.processPayload(payload, directory, 'default');
  contextObligatoryRuntime.processPayload(payload, directory, 'default');
});

const permissionAutoAcceptRuntime = createPermissionAutoAcceptRuntime({
  globalEventHub: globalMessageStreamHub,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  readSettingsFromDiskMigrated,
  persistSettings,
  broadcastGlobalUiEvent,
});
permissionAutoAcceptRuntime.start();
notificationTriggerRuntime.setGetIsSessionAutoAccepting(
  (sessionId, directory) => permissionAutoAcceptRuntime.isSessionAutoAccepting(sessionId, directory),
);

const openCodeWatcherRuntime = createOpenCodeWatcherRuntime({
  waitForOpenCodePort: (...args) => waitForOpenCodePort(...args),
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  parseSseDataPayload: (...args) => parseSseDataPayload(...args),
  globalEventHub: globalMessageStreamHub,
  onPayload: (payload) => {
    maybeCacheSessionInfoFromEvent(payload);
    void maybeSendPushForTrigger(payload);
    sessionRuntime.processOpenCodeSsePayload(payload);
  },
  onReconnect: () => {
    sessionRuntime.resetAllSessionActivityToIdle();
  },
});

const processForwardedEventPayload = (payload, emitSyntheticEvent) => {
  if (!payload || typeof payload !== 'object' || typeof emitSyntheticEvent !== 'function') {
    return;
  }

  maybeCacheSessionInfoFromEvent(payload);

  if (payload.type !== 'session.status') {
    return;
  }

  const properties = payload.properties && typeof payload.properties === 'object' ? payload.properties : {};
  const statusInfo = properties.status && typeof properties.status === 'object' ? properties.status : {};
  const info = properties.info && typeof properties.info === 'object' ? properties.info : {};
  const sessionId = typeof properties.sessionID === 'string' ? properties.sessionID.trim() : '';
  const status = typeof statusInfo.type === 'string'
    ? statusInfo.type.trim()
    : (typeof info.type === 'string' ? info.type.trim() : '');

  if (!sessionId || !status) {
    return;
  }

  emitSyntheticEvent({
    type: 'openchamber:session-status',
    properties: {
      sessionID: sessionId,
      status,
      timestamp: Date.now(),
      metadata: {
        attempt: typeof statusInfo.attempt === 'number'
          ? statusInfo.attempt
          : (typeof info.attempt === 'number' ? info.attempt : undefined),
        message: typeof statusInfo.message === 'string'
          ? statusInfo.message
          : (typeof info.message === 'string' ? info.message : undefined),
        next: typeof statusInfo.next === 'number'
          ? statusInfo.next
          : (typeof info.next === 'number' ? info.next : undefined),
      },
      needsAttention: false,
    },
  });

  emitSyntheticEvent({
    type: 'openchamber:session-activity',
    properties: {
      sessionId,
      phase: status === 'busy' || status === 'retry' ? 'busy' : 'idle',
    },
  });
};


const serverUtilsRuntime = createServerUtilsRuntime({
  fs,
  os,
  path,
  process,
  openCodeReadyGraceMs: OPEN_CODE_READY_GRACE_MS,
  longRequestTimeoutMs: LONG_REQUEST_TIMEOUT_MS,
  getRuntime: () => ({
    openCodePort,
    openCodeBaseUrl,
    openCodeNotReadySince,
    isOpenCodeReady,
    isRestartingOpenCode,
  }),
  getOpenCodeAuthHeaders,
  buildOpenCodeUrl,
  ensureOpenCodeApiPrefix,
  getUpstreamStallTimeoutMs,
  getUiNotificationClients: () => uiNotificationClients,
  getOpenCodePort: () => openCodePort,
  setOpenCodePortState: (value) => {
    openCodePort = value;
  },
  syncToHmrState,
  markOpenCodeNotReady: () => {
    isOpenCodeReady = false;
  },
  setOpenCodeNotReadySince: (value) => {
    openCodeNotReadySince = value;
  },
  clearLastOpenCodeError: () => {
    lastOpenCodeError = null;
  },
  getLoginShellPath: () => {
    const snapshot = getLoginShellEnvSnapshot();
    if (!snapshot || typeof snapshot.PATH !== 'string' || snapshot.PATH.length === 0) {
      return null;
    }
    return snapshot.PATH;
  },
});

const setOpenCodePort = (...args) => serverUtilsRuntime.setOpenCodePort(...args);
const waitForOpenCodePort = (...args) => serverUtilsRuntime.waitForOpenCodePort(...args);
const buildAugmentedPath = (...args) => serverUtilsRuntime.buildAugmentedPath(...args);
const buildManagedOpenCodePath = (...args) => serverUtilsRuntime.buildManagedOpenCodePath(...args);
const parseSseDataPayload = (...args) => serverUtilsRuntime.parseSseDataPayload(...args);
const staticRoutesRuntime = createStaticRoutesRuntime({
  fs,
  path,
  process,
  __dirname,
  express,
  resolveProjectDirectory,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  readSettingsFromDiskMigrated,
  normalizePwaAppName,
  normalizePwaOrientation,
});
const featureRoutesRuntime = createFeatureRoutesRuntime({
  clientReloadDelayMs: CLIENT_RELOAD_DELAY_MS,
});
const bootstrapRuntime = createBootstrapRuntime({
  createUiAuth,
  registerServerStatusRoutes,
  registerCommonRequestMiddleware,
  registerAuthAndAccessRoutes,
  registerTtsRoutes,
  registerNotificationRoutes,
  registerOpenChamberRoutes,
  express,
});
const tunnelWiringRuntime = createTunnelWiringRuntime({
  crypto,
  URL,
  tunnelProviderRegistry,
  tunnelAuthController,
  readSettingsFromDiskMigrated,
  readManagedRemoteTunnelConfigFromDisk,
  normalizeTunnelProvider,
  normalizeTunnelMode,
  normalizeOptionalPath,
  normalizeManagedRemoteTunnelHostname,
  normalizeTunnelBootstrapTtlMs,
  normalizeTunnelSessionTtlMs,
  isSupportedTunnelMode,
  upsertManagedRemoteTunnelToken,
  resolveManagedRemoteTunnelToken,
  TUNNEL_MODE_QUICK,
  TUNNEL_MODE_MANAGED_LOCAL,
  TUNNEL_MODE_MANAGED_REMOTE,
  TUNNEL_PROVIDER_CLOUDFLARE,
  TunnelServiceError,
  getActiveTunnelController: () => activeTunnelController,
  setActiveTunnelController: (value) => {
    activeTunnelController = value;
  },
  getRuntimeManagedRemoteTunnelHostname: () => runtimeManagedRemoteTunnelHostname,
  setRuntimeManagedRemoteTunnelHostname: (value) => {
    runtimeManagedRemoteTunnelHostname = value;
  },
  getRuntimeManagedRemoteTunnelToken: () => runtimeManagedRemoteTunnelToken,
  setRuntimeManagedRemoteTunnelToken: (value) => {
    runtimeManagedRemoteTunnelToken = value;
  },
});
const startupPipelineRuntime = createStartupPipelineRuntime({
  createTerminalRuntime,
  createMessageStreamWsRuntime,
  createServerStartupRuntime,
});

const openCodeLifecycleState = {};
Object.defineProperties(openCodeLifecycleState, {
  openCodeProcess: { get: () => openCodeProcess, set: (value) => { openCodeProcess = value; } },
  openCodePort: { get: () => openCodePort, set: (value) => { openCodePort = value; } },
  openCodeBaseUrl: { get: () => openCodeBaseUrl, set: (value) => { openCodeBaseUrl = value; } },
  openCodeWorkingDirectory: { get: () => openCodeWorkingDirectory, set: (value) => { openCodeWorkingDirectory = value; } },
  currentRestartPromise: { get: () => currentRestartPromise, set: (value) => { currentRestartPromise = value; } },
  isRestartingOpenCode: { get: () => isRestartingOpenCode, set: (value) => { isRestartingOpenCode = value; } },
  openCodeApiPrefix: { get: () => openCodeApiPrefix, set: (value) => { openCodeApiPrefix = value; } },
  openCodeApiPrefixDetected: { get: () => openCodeApiPrefixDetected, set: (value) => { openCodeApiPrefixDetected = value; } },
  openCodeApiDetectionTimer: { get: () => openCodeApiDetectionTimer, set: (value) => { openCodeApiDetectionTimer = value; } },
  lastOpenCodeError: { get: () => lastOpenCodeError, set: (value) => { lastOpenCodeError = value; } },
  lastOpenCodeLaunchDiagnostics: { get: () => lastOpenCodeLaunchDiagnostics, set: (value) => { lastOpenCodeLaunchDiagnostics = value; } },
  isOpenCodeReady: { get: () => isOpenCodeReady, set: (value) => { isOpenCodeReady = value; } },
  openCodeNotReadySince: { get: () => openCodeNotReadySince, set: (value) => { openCodeNotReadySince = value; } },
  isExternalOpenCode: { get: () => isExternalOpenCode, set: (value) => { isExternalOpenCode = value; } },
  isShuttingDown: { get: () => isShuttingDown, set: (value) => { isShuttingDown = value; } },
  healthCheckInterval: { get: () => healthCheckInterval, set: (value) => { healthCheckInterval = value; } },
  expressApp: { get: () => expressApp, set: (value) => { expressApp = value; } },
  useWslForOpencode: { get: () => useWslForOpencode, set: (value) => { useWslForOpencode = value; } },
  resolvedWslBinary: { get: () => resolvedWslBinary, set: (value) => { resolvedWslBinary = value; } },
  resolvedWslOpencodePath: { get: () => resolvedWslOpencodePath, set: (value) => { resolvedWslOpencodePath = value; } },
  resolvedWslDistro: { get: () => resolvedWslDistro, set: (value) => { resolvedWslDistro = value; } },
});

const openCodeLifecycleRuntime = createOpenCodeLifecycleRuntime({
  state: openCodeLifecycleState,
  env: {
    ENV_CONFIGURED_OPENCODE_PORT,
    ENV_CONFIGURED_OPENCODE_HOST,
    ENV_EFFECTIVE_PORT,
    ENV_CONFIGURED_OPENCODE_HOSTNAME,
    ENV_SKIP_OPENCODE_START,
  },
  syncToHmrState,
  syncFromHmrState,
  getOpenCodeAuthHeaders,
  buildOpenCodeUrl,
  waitForReady,
  normalizeApiPrefix,
  applyOpencodeBinaryFromSettings,
  ensureOpencodeCliEnv,
  ensureLocalOpenCodeServerPassword,
  resolveManagedOpenCodeLaunchSpec,
  setOpenCodePort,
  setDetectedOpenCodeApiPrefix,
  setupProxy: (...args) => setupProxy(...args),
  ensureOpenCodeApiPrefix,
  clearResolvedOpenCodeBinary,
  buildAugmentedPath,
  buildManagedOpenCodePath,
  getManagedOpenCodeShellEnvSnapshot: getLoginShellEnvSnapshot,
  prepareManagedOpenCodeEnv: async () => {
    if (ENV_SKIP_OPENCODE_START || openCodeLifecycleState.isExternalOpenCode) return {};
    const settings = await readSettingsFromDiskMigrated();
    const managedEnv = settings?.agentControlToolEnabled === false
      ? {}
      : await (agentToolRuntime?.prepareManagedOpenCodeEnv() || {});
    return managedEnv;
  },
  getActiveSessionCount,
  persistOpenCodePort,
  readPersistedOpenCodePort,
  persistManagedOpenCodeAuth,
  restoreManagedOpenCodeAuth,
  recordLifecycleEvent: openCodeLifecycleJournal.record,
  getLifecycleLogPath: () => openCodeLifecycleJournal.path,
});

const restartOpenCode = (...args) => openCodeLifecycleRuntime.restartOpenCode(...args);
const getOpenCodeUpgradeCapability = () => {
  const activeBinary = lastOpenCodeLaunchDiagnostics?.binary || resolvedOpencodeBinary;
  return resolveOpenCodeUpgradeCapability({
    isExternal: isExternalOpenCode,
    hasManagedProcess: Boolean(openCodeProcess),
    activeBinary,
    isBundledBinary: isBundledOpenCodeCliPath,
  });
};
const waitForOpenCodeReady = (...args) => openCodeLifecycleRuntime.waitForOpenCodeReady(...args);
const waitForAgentPresence = (...args) => openCodeLifecycleRuntime.waitForAgentPresence(...args);
const verifyOpenChamberPluginLoaded = async () => {
  if (!openCodeLifecycleState.openCodePort) return null;
  const url = `http://127.0.0.1:${openCodeLifecycleState.openCodePort}`;
  const result = await checkPluginLoaded(url, getOpenCodeAuthHeaders(), {
    expectedPid: openCodeLifecycleState.openCodeProcess?.pid,
  });
  if (!result.loaded) {
    console.warn('[openchamber] plugin not loaded:', result.reason);
  } else {
    console.log('[openchamber] plugin verified:', result.tools.join(', '));
  }
  return result;
};
let openCodeConfigFileWatcherRuntime = null;
const refreshOpenCodeAfterConfigChange = async (...args) => {
  openCodeConfigFileWatcherRuntime?.acknowledgeCurrentConfig();
  try {
    const overlayPath = prepareOpenChamberConfig();
    if (overlayPath) process.env.OPENCODE_CONFIG = overlayPath;
  } catch (error) {
    console.warn('[openchamber] config overlay refresh skipped:', error?.message || error);
  }
  const result = await openCodeLifecycleRuntime.refreshOpenCodeAfterConfigChange(...args);
  await verifyOpenChamberPluginLoaded();
  return result;
};
openCodeConfigFileWatcherRuntime = createOpenCodeConfigFileWatcherRuntime({
  getWorkingDirectory: () => openCodeWorkingDirectory,
  getActiveSessionCount,
  isOpenCodeIdle: async () => {
    if (getActiveSessionCount() > 0 || !openCodePort || !isOpenCodeReady) return false;
    try {
      const url = new URL(buildOpenCodeUrl('/session/status'));
      if (openCodeWorkingDirectory) url.searchParams.set('directory', openCodeWorkingDirectory);
      const response = await fetch(url, {
        headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
      });
      if (!response.ok) return false;
      const statuses = await response.json();
      if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) return false;
      return Object.values(statuses).every((status) => status?.type !== 'busy' && status?.type !== 'retry');
    } catch {
      return false;
    }
  },
  isManagedOpenCode: () => !ENV_SKIP_OPENCODE_START && !openCodeLifecycleState.isExternalOpenCode,
  refreshOpenCodeAfterConfigChange,
});
const startHealthMonitoring = () => openCodeLifecycleRuntime.startHealthMonitoring(HEALTH_CHECK_INTERVAL);
const triggerHealthCheck = () => openCodeLifecycleRuntime.triggerHealthCheck();
const scheduledTasksRuntime = createScheduledTasksRuntime({
  projectConfigRuntime,
  listProjects: async () => {
    const settings = await readSettingsFromDiskMigrated();
    return sanitizeProjects(settings?.projects || []);
  },
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  waitForOpenCodeReady,
  setSessionAutoAccept: (sessionId, enabled, directory) =>
    permissionAutoAcceptRuntime.setSessionPolicy(sessionId, enabled, directory),
  emitTaskRunEvent: (event) => {
    const payload = {
      type: 'openchamber:scheduled-task-ran',
      properties: {
        projectId: event.projectID,
        taskId: event.taskID,
        ranAt: event.ranAt,
        status: event.status,
        ...(event.sessionID ? { sessionId: event.sessionID } : {}),
      },
    };

    broadcastGlobalUiEvent(payload);

    for (const client of uiOpenChamberEventClients) {
      try {
        writeSseEvent(client, payload);
      } catch {
        uiOpenChamberEventClients.delete(client);
      }
    }
  },
  logger: console,
});

const scheduledTaskService = createScheduledTaskService({
  readSettingsFromDiskMigrated,
  sanitizeProjects,
  projectConfigRuntime,
  scheduledTasksRuntime,
});

const openChamberSessionService = createOpenChamberSessionService({
  readSettingsFromDiskMigrated,
  sanitizeProjects,
  validateDirectoryPath,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  waitForOpenCodeReady,
  emitSessionCreatedEvent: (event) => {
    broadcastGlobalUiEvent({
      type: 'openchamber:session-created',
      properties: event,
    });
  },
});

const openChamberControlService = createOpenChamberControlService({
  readSettingsFromDiskMigrated,
  sanitizeProjects,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  waitForOpenCodeReady,
  sessionService: openChamberSessionService,
  scheduledTaskService,
});

const runtimeFallbackApprovalService = createRuntimeFallbackApprovalService({
  crypto,
  broadcastEvent: broadcastGlobalUiEvent,
  getQuotaProviders: () => import('./lib/quota/index.js'),
});

agentToolRuntime = createAgentToolRuntime({
  crypto,
  fsPromises,
  path,
  dataDir: OPENCHAMBER_DATA_DIR,
  getActivePort: () => Number(server?.address()?.port) || null,
  executeAction: (...args) => openChamberControlService.execute(...args),
  runtimeFallbackApprovalService,
});

const ensureGlobalWatcherStarted = async () => {
  if (globalWatcherStartPromise) {
    return globalWatcherStartPromise;
  }

  globalWatcherStartPromise = openCodeWatcherRuntime.start().catch((error) => {
    globalWatcherStartPromise = null;
    throw error;
  });

  return globalWatcherStartPromise;
};
const bootstrapOpenCodeAtStartup = async (...args) => {
  try {
    cleanupOpenChamberPluginFromUserConfig();
    const overlayPath = prepareOpenChamberConfig();
    process.env.OPENCODE_CONFIG = overlayPath;
  } catch (error) {
    console.warn('[openchamber] config overlay skipped:', error?.message || error);
  }
  await openCodeLifecycleRuntime.bootstrapOpenCodeAtStartup(...args);
  openCodeConfigFileWatcherRuntime.start();
  scheduleOpenCodeApiDetection();
  if (openCodeLifecycleState.openCodePort && !openCodeLifecycleState.isExternalOpenCode) {
    startHealthMonitoring();
  }
  setTimeout(async () => {
    await verifyOpenChamberPluginLoaded();
  }, 5000);
  if (ENV_DESKTOP_NOTIFY) {
    void ensureGlobalWatcherStarted().catch((error) => {
      console.warn(`Global event watcher startup failed: ${error?.message || error}`);
    });
  }
};
const killProcessOnPort = (...args) => openCodeLifecycleRuntime.killProcessOnPort(...args);
const waitForPortRelease = (...args) => openCodeLifecycleRuntime.waitForPortRelease(...args);

const fetchAgentsSnapshot = (...args) => serverUtilsRuntime.fetchAgentsSnapshot(...args);
const fetchProvidersSnapshot = (...args) => serverUtilsRuntime.fetchProvidersSnapshot(...args);
const fetchModelsSnapshot = (...args) => serverUtilsRuntime.fetchModelsSnapshot(...args);
const setupProxy = (...args) => serverUtilsRuntime.setupProxy(...args);
const gracefulShutdownRuntime = createGracefulShutdownRuntime({
  process,
  shutdownTimeoutMs: SHUTDOWN_TIMEOUT,
  getExitOnShutdown: () => exitOnShutdown,
  getIsShuttingDown: () => isShuttingDown,
  setIsShuttingDown: (value) => {
    isShuttingDown = value;
  },
  syncToHmrState,
  openCodeWatcherRuntime,
  openCodeConfigFileWatcherRuntime,
  sessionRuntime,
  sessionGoalRuntime,
  sessionAssistRuntime,
  contextObligatoryRuntime,
  getHealthCheckInterval: () => healthCheckInterval,
  clearHealthCheckInterval: (value) => clearInterval(value),
  getTerminalRuntime: () => terminalRuntime,
  setTerminalRuntime: (value) => {
    terminalRuntime = value;
  },
  getMessageStreamRuntime: () => messageStreamRuntime,
  setMessageStreamRuntime: (value) => {
    messageStreamRuntime = value;
  },
  shouldSkipOpenCodeStop: (shutdownOptions = {}) => {
    if (ENV_SKIP_OPENCODE_START || isExternalOpenCode) return true;
    if (shutdownOptions.stopOpenCode === false) return true;
    if (shutdownOptions.stopOpenCode === true) return false;
    return shouldPreserveManagedOpenCodeOnImplicitShutdown();
  },
  getOpenCodePort: () => openCodePort,
  getOpenCodeProcess: () => openCodeProcess,
  setOpenCodeProcess: (value) => {
    openCodeProcess = value;
  },
  killProcessOnPort,
  waitForPortRelease,
  getManagedOpenCodePorts: readManagedOpenCodePorts,
  clearManagedOpenCodePorts,
  getServer: () => server,
  getUiAuthController: () => uiAuthController,
  setUiAuthController: (value) => {
    uiAuthController = value;
  },
  getActiveTunnelController: () => activeTunnelController,
  setActiveTunnelController: (value) => {
    activeTunnelController = value;
  },
  tunnelAuthController,
  scheduledTasksRuntime,
  getRemoteInstancesRuntime: () => remoteInstancesRuntimeRef,
});

const gracefulShutdown = (...args) => gracefulShutdownRuntime.gracefulShutdown(...args);

function isLoopbackOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function installLoopbackCors(app) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Authorization');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    next();
  });
}

async function main(options = {}) {
  const port = Number.isFinite(options.port) && options.port >= 0 ? Math.trunc(options.port) : DEFAULT_PORT;
  const host = typeof options.host === 'string' && options.host.length > 0 ? options.host : undefined;
  const tryCfTunnel = options.tryCfTunnel === true;
  const shouldUseCanonicalTunnelConfig = typeof options.tunnelMode === 'string'
    || typeof options.tunnelProvider === 'string'
    || options.tunnelConfigPath === null
    || typeof options.tunnelConfigPath === 'string'
    || typeof options.tunnelToken === 'string'
    || typeof options.tunnelHostname === 'string';
  const startupTunnelRequest = shouldUseCanonicalTunnelConfig
    ? normalizeTunnelStartRequest({
        provider: normalizeTunnelProvider(options.tunnelProvider),
        mode: options.tunnelMode,
        configPath: normalizeOptionalPath(options.tunnelConfigPath),
        token: typeof options.tunnelToken === 'string' ? options.tunnelToken.trim() : '',
        hostname: normalizeManagedRemoteTunnelHostname(options.tunnelHostname),
      })
    : (tryCfTunnel
      ? {
          provider: TUNNEL_PROVIDER_CLOUDFLARE,
          mode: TUNNEL_MODE_QUICK,
          configPath: undefined,
          token: '',
          hostname: undefined,
        }
      : null);
  const attachSignals = options.attachSignals !== false;
  const onTunnelReady = typeof options.onTunnelReady === 'function' ? options.onTunnelReady : null;
  if (typeof options.exitOnShutdown === 'boolean') {
    exitOnShutdown = options.exitOnShutdown;
  }
  if (typeof options.onDesktopNotification === 'function') {
    notificationEmitterRuntime.setOnDesktopNotification(options.onDesktopNotification);
  }
  if (typeof options.getIsWindowFocused === 'function') {
    notificationTriggerRuntime.setGetIsWindowFocused(options.getIsWindowFocused);
  }

  console.log(`Starting OpenChamber on port ${port === 0 ? 'auto' : port}`);

  const sayTTSCapability = await detectSayTtsCapability(process);

  const app = express();
  const serverStartedAt = new Date().toISOString();
  app.set('trust proxy', true);
  app.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });
  installLoopbackCors(app);
  app.use(compression({
    filter: (req, res) => {
      if (shouldSkipCompression(req, res)) return false;
      return compression.filter(req, res);
    },
    threshold: 1024,
  }));
  expressApp = app;
  server = http.createServer(app);
  server.keepAliveTimeout = OPENCHAMBER_HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = Math.max(server.headersTimeout || 0, OPENCHAMBER_HTTP_KEEP_ALIVE_TIMEOUT_MS + 5_000);

  const uiPassword = typeof options.uiPassword === 'string' ? options.uiPassword : null;
  const bootstrapResult = bootstrapRuntime.setupBaseRoutes(app, {
    process,
    openchamberVersion: OPENCHAMBER_VERSION,
    runtimeName: process.env.OPENCHAMBER_RUNTIME || 'web',
    serverStartedAt,
    gracefulShutdown,
    getHealthSnapshot: () => {
      const launchSpec = resolvedOpencodeBinary && !useWslForOpencode
        ? resolveManagedOpenCodeLaunchSpec(resolvedOpencodeBinary)
        : null;
      return {
        openCodePort,
        openCodeRunning: Boolean(openCodePort && isOpenCodeReady && !isRestartingOpenCode),
        openCodeSecureConnection: isOpenCodeConnectionSecure(),
        openCodeAuthSource: openCodeAuthSource || null,
        openCodeApiPrefix: '',
        openCodeApiPrefixDetected: true,
        isOpenCodeReady,
        lastOpenCodeError,
        lastOpenCodeLaunchDiagnostics,
        opencodeBinaryResolved: resolvedOpencodeBinary || null,
        opencodeBinarySource: resolvedOpencodeBinarySource || null,
        opencodeLaunchBinary: launchSpec?.binary || null,
        opencodeLaunchArgs: launchSpec?.args || [],
        opencodeLaunchWrapperType: launchSpec?.wrapperType || null,
        opencodeViaWsl: useWslForOpencode,
        opencodeWslBinary: resolvedWslBinary || null,
        opencodeWslPath: resolvedWslOpencodePath || null,
        opencodeWslDistro: resolvedWslDistro || null,
        nodeBinaryResolved: resolvedNodeBinary || null,
        bunBinaryResolved: resolvedBunBinary || null,
        desktopNotifyEnabled: ENV_DESKTOP_NOTIFY,
        planModeExperimentalEnabled: PLAN_MODE_EXPERIMENT_ENABLED,
      };
    },
    verboseRequestLogs: OPENCHAMBER_VERBOSE_REQUEST_LOGS,
    uiPassword,
    tunnelAuthController,
    clientAuthController: remoteClientAuthRuntime,
    getServerId: () => (relayServiceInstance ? relayServiceInstance.getServerId() : Promise.resolve(null)),
    readSettingsFromDiskMigrated,
    normalizeTunnelSessionTtlMs,
    sayTTSCapability,
    ensurePushInitialized,
    ensureGlobalWatcherStarted,
    getOrCreateVapidKeys,
    getUiSessionTokenFromRequest,
    writeSettingsToDisk,
    addOrUpdatePushSubscription,
    removePushSubscription,
    updateUiVisibility,
    isUiVisible,
    getUiNotificationClients: () => uiNotificationClients,
    writeSseEvent,
    sessionRuntime,
    setPushInitialized,
    fs,
    os,
    path,
    server,
    __dirname,
    openchamberDataDir: OPENCHAMBER_DATA_DIR,
    modelsDevApiUrl: MODELS_DEV_API_URL,
    modelsMetadataCacheTtl: MODELS_METADATA_CACHE_TTL,
    fetchFreeZenModels,
    getCachedZenModels,
    setAutoAcceptSession,
    unreadStore,
    markersStore,
  });
  uiAuthController = bootstrapResult.uiAuthController;

  const tunnelRuntimeContext = tunnelWiringRuntime.initialize(app, port);
  const { tunnelService, startTunnelWithNormalizedRequest } = tunnelRuntimeContext;

  const bindHost = typeof host === 'string' && host.length > 0 ? host : '127.0.0.1';
  const { resolvePairingTransports, resolveDirectLanUrls } = createPairingLanHelpers({
    os,
    getActivePort: () => tunnelRuntimeContext.getActivePort(),
    bindHost,
    fallbackPort: port,
  });

  const relayService = createRelayService({
    crypto,
    readSettingsFromDiskMigrated,
    writeSettingsToDisk,
    readSettingsStrict: readSettingsFromDiskStrict,
    getLocalPort: () => tunnelRuntimeContext.getActivePort(),
    hostLock: createRelayHostLock({
      lockFilePath: path.join(OPENCHAMBER_DATA_DIR, 'relay-host.lock'),
      fs,
      process,
    }),
    hasRelayDemand: async () => {
      const [pendingRelay, deviceRelay] = await Promise.all([
        clientPairingRuntime.hasActiveRelaySession().catch(() => false),
        remoteClientAuthRuntime.hasActiveRelayClients().catch(() => false),
      ]);
      return pendingRelay || deviceRelay;
    },
  });
  relayServiceInstance = relayService;
  relayService.registerRoutes(app);

  registerClientAuthPairingRoutes(app, {
    uiAuthController,
    remoteClientAuthRuntime,
    clientPairingRuntime,
    getRelayPairingCandidate: (options) => {
      if (!relayServiceInstance) return null;
      return options?.ensureEnabled
        ? relayServiceInstance.ensureEnabledForPairing()
        : relayServiceInstance.getPairingCandidate();
    },
    reconcileRelay: () => (relayServiceInstance ? relayServiceInstance.reconcile() : Promise.resolve()),
    getPairingTransports: resolvePairingTransports,
    getDirectCandidateUrls: resolveDirectLanUrls,
    getServerId: () => (relayServiceInstance ? relayServiceInstance.getServerId() : Promise.resolve(null)),
    getServerLabel: () => {
      try {
        const name = os.hostname();
        return typeof name === 'string' && name.trim().length > 0 ? name.trim() : 'OpenChamber';
      } catch {
        return 'OpenChamber';
      }
    },
  });

  await featureRoutesRuntime.registerRoutes(app, {
    crypto,
    fs,
    os,
    path,
    fsPromises,
    spawn,
    resolveGitBinaryForSpawn,
    createFsSearchRuntime: createFsSearchRuntimeFactory,
    openchamberDataDir: OPENCHAMBER_DATA_DIR,
    openchamberUserConfigRoot: OPENCHAMBER_USER_CONFIG_ROOT,
    normalizeDirectoryPath,
    resolveRequiredExplicitProjectDirectory,
    resolveProjectDirectory,
    resolveOptionalProjectDirectory,
    validateDirectoryPath,
    readCustomThemesFromDisk,
    refreshOpenCodeAfterConfigChange,
    getOpenCodeResolutionSnapshot,
    getOpenCodeUpgradeCapability,
    formatSettingsResponse,
    readSettingsFromDisk,
    readSettingsFromDiskMigrated,
    persistSettings,
    sanitizeProjects,
    sanitizeSkillCatalogs,
    isUnsafeSkillRelativePath,
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
    getOpenCodePort: () => openCodePort,
    fetchProvidersSnapshot,
    buildAugmentedPath,
    projectConfigRuntime,
    scheduledTasksRuntime,
    getOpenChamberEventClients: () => uiOpenChamberEventClients,
    writeSseEvent,
    permissionAutoAcceptRuntime,
    openChamberControlService,
    agentToolRuntime,
  });

  const previewProxyRuntime = createPreviewProxyRuntime({
    crypto,
    URL,
    createProxyMiddleware,
    responseInterceptor,
  });
  previewProxyRuntime.attach(app, {
    server,
    express,
    uiAuthController,
    isRequestOriginAllowed,
    rejectWebSocketUpgrade,
  });

  const remoteInstancesRuntime = createRemoteInstancesRuntime({
    readSettingsFromDisk,
    writeSettingsToDisk,
    readSettingsFromDiskMigrated,
    persistSettings,
  });
  remoteInstancesRuntimeRef = remoteInstancesRuntime;
  registerRemoteInstanceRoutes(app, remoteInstancesRuntime);
  registerRemoteSseRelay(app, remoteInstancesRuntime);
  registerRemoteRpcWebSocket({
    server,
    remoteInstancesRuntime,
    uiAuthController,
    isRequestOriginAllowed,
    rejectWebSocketUpgrade,
  });
  registerRemoteProxy(app, remoteInstancesRuntime, {
    server,
    uiAuthController,
    isRequestOriginAllowed,
    rejectWebSocketUpgrade,
  });
  remoteInstancesRuntime.startHealthMonitoring();
  contextObligatoryRuntime.bindRemoteFanout(createRemoteGlobalEventFanout({
    remoteInstancesRuntime,
    fetchImpl: fetch,
    upstreamStallTimeoutMs: getUpstreamStallTimeoutMs,
  }));

  const startupPipelineResult = await startupPipelineRuntime.run({
    app,
    server,
    express,
    fs,
    path,
    uiAuthController,
    buildAugmentedPath,
    searchPathFor,
    isExecutable,
    isRequestOriginAllowed,
    rejectWebSocketUpgrade,
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
    globalEventHub: globalMessageStreamHub,
    processForwardedEventPayload,
    messageStreamWsClients: uiNotificationWsClients,
    upstreamStallTimeoutMs: getUpstreamStallTimeoutMs,
    terminalHeartbeatIntervalMs: TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS,
    terminalRebindWindowMs: TERMINAL_INPUT_WS_REBIND_WINDOW_MS,
    terminalMaxRebindsPerWindow: TERMINAL_INPUT_WS_MAX_REBINDS_PER_WINDOW,
    setupProxy,
    scheduleOpenCodeApiDetection,
    bootstrapOpenCodeAtStartup,
    triggerHealthCheck,
    staticRoutesRuntime,
    process,
    crypto,
    normalizeTunnelBootstrapTtlMs,
    readSettingsFromDiskMigrated,
    tunnelAuthController,
    startTunnelWithNormalizedRequest,
    gracefulShutdown,
    getSignalsAttached: () => signalsAttached,
    setSignalsAttached: (value) => {
      signalsAttached = value;
    },
    syncToHmrState,
    TUNNEL_MODE_QUICK,
    TUNNEL_MODE_MANAGED_LOCAL,
    TUNNEL_MODE_MANAGED_REMOTE,
    host,
    port,
    startupTunnelRequest,
    onTunnelReady,
    tunnelRuntimeContext,
    attachSignals,
    remoteInstancesRuntime,
    listenBacklog: OPENCHAMBER_HTTP_LISTEN_BACKLOG,
  });
  terminalRuntime = startupPipelineResult.terminalRuntime;
  messageStreamRuntime = startupPipelineResult.messageStreamRuntime;

  try {
    await relayService.reconcile();
  } catch (error) {
    console.warn('[Relay] Failed to reconcile on startup:', error?.message || error);
  }

  try {
    await scheduledTasksRuntime.start();
  } catch (error) {
    console.warn('[ScheduledTasks] Failed to start runtime:', error?.message || error);
  }

  return {
    expressApp: app,
    httpServer: server,
    getPort: () => tunnelRuntimeContext.getActivePort(),
    getOpenCodePort: () => openCodePort,
    getTunnelUrl: () => tunnelService.getPublicUrl(),
    getQuitRiskStatus: () => ({
      tunnel: {
        active: Boolean(tunnelService.getPublicUrl()),
      },
      scheduledTasks: scheduledTasksRuntime.getStatus(),
    }),
    isReady: () => isOpenCodeReady,
    restartOpenCode: () => restartOpenCode(),
    stop: (shutdownOptions = {}) =>
      gracefulShutdown({
        exitProcess: shutdownOptions.exitProcess ?? false,
        stopOpenCode: shutdownOptions.stopOpenCode,
      }),
    remoteInstances: remoteInstancesRuntime,
  };
}

runCliEntryIfMain({
  process,
  currentFilename: __filename,
  parseServeCliOptions,
  defaultPort: DEFAULT_PORT,
  cloudflareProvider: TUNNEL_PROVIDER_CLOUDFLARE,
  managedLocalMode: TUNNEL_MODE_MANAGED_LOCAL,
  setExitOnShutdown: (value) => {
    exitOnShutdown = value;
  },
  startServer: main,
});

export {
  gracefulShutdown,
  setupProxy,
  restartOpenCode,
  main as startWebUiServer,
  parseServeCliOptions as parseArgs,
};
