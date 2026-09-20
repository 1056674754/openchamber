import { z } from 'zod';
import type { ProjectEntry, RuntimeAPIs } from '@/lib/api/types';
import type { MobileKeyboardMode } from '@/lib/mobileKeyboardMode';
import type { DraftStarterRef } from '@/lib/draftStarters';
import type { FollowUpBehavior } from '@/lib/followUpBehavior';

export type AssistantNotificationPayload = {
  title?: string;
  body?: string;
};

export type UpdateInfo = {
  available: boolean;
  version?: string;
  currentVersion: string;
  body?: string;
  date?: string;
  nextSuggestedCheckInSec?: number;
  // Web-specific fields
  packageManager?: string;
  updateCommand?: string;
  /** Direct download URL (Android Capacitor APK when available). */
  downloadUrl?: string;
  releaseUrl?: string;
};

export type UpdateProgress = {
  downloaded: number;
  total?: number;
};

export type SkillCatalogConfig = {
  id: string;
  label: string;
  source: string;
  subpath?: string;
  gitIdentityId?: string;
};

export type ManagedRemoteTunnelPreset = {
  id: string;
  name: string;
  hostname: string;
};

export type DesktopWindowControlsPosition = 'left' | 'right';
export type DesktopWindowControlsSide = 'left' | 'right';
export type DesktopWindowControlAction = 'close' | 'minimize' | 'maximize';
export type DesktopWindowControlsStyle = 'classic' | 'traffic-lights';

export type LocalStorePatch = {
  set?: Record<string, string>;
  remove?: string[];
};

export type DesktopSettings = {
  themeId?: string;
  useSystemTheme?: boolean;
  themeVariant?: 'light' | 'dark';
  lightThemeId?: string;
  darkThemeId?: string;
  splashBgLight?: string;
  splashFgLight?: string;
  splashBgDark?: string;
  splashFgDark?: string;
  lastDirectory?: string;
  homeDirectory?: string;
  // Optional absolute path to `opencode` binary.
  opencodeBinary?: string;
  agentControlToolEnabled?: boolean;
  agentMemoryToolEnabled?: boolean;
  /** Server-computed: this build has Jev routing (`OPENCHAMBER_ROUTING_ENABLE`). */
  routingFeatureAvailable?: boolean;
  optimizeSystemPrompt?: boolean;
  desktopLanAccessEnabled?: boolean;
  desktopMacMenuBarEnabled?: boolean;
  desktopMinimizeToTrayEnabled?: boolean;
  desktopKeepAwakeEnabled?: boolean;
  desktopKeepManagedOpenCodeAliveOnQuit?: boolean;
  /** Fork-only: the desktop shell refuses remote (non-local) connections. */
  desktopRemoteOnly?: boolean;
  projects?: ProjectEntry[];
  activeProjectId?: string;
  approvedDirectories?: string[];
  securityScopedBookmarks?: string[];
  /** Per-session permission auto-accept map (fork: the server still round-trips it). */
  permissionAutoAccept?: {
    sessions: Record<string, boolean>;
    revision: number;
  };
  /** Fork-only: remote instances configured on this host (server-sanitized shape). */
  remoteInstances?: Array<{
    id: string;
    label: string;
    url: string;
    auth: { type: 'none' | 'password' | 'bearer'; value?: string };
    requestHeaders?: Record<string, string>;
    connectionTimeoutSec: number;
    enabled: boolean;
  }>;
   pinnedDirectories?: string[];
  /** Global session pins — shared via host settings (desktop ↔ mobile). */
  pinnedSessions?: string[];
  /** Per-project session pins keyed by project path/id. */
  pinnedSessionsByProject?: Record<string, string[]>;
  /** Display order for global pinned sessions. */
  pinnedSessionOrder?: string[];
  /** Display order for per-project pinned sessions. */
  pinnedSessionOrderByProject?: Record<string, string[]>;
   showReasoningTraces?: boolean;
   draftStarters?: DraftStarterRef[];
   draftStartersScheduleTaskAdded?: boolean;
   draftStartersVisible?: boolean;
   collapsibleThinkingBlocks?: boolean;
  showDeletionDialog?: boolean;
  nativeNotificationsEnabled?: boolean;
  notificationMode?: 'always' | 'hidden-only';
  notifyOnSubtasks?: boolean;
  dockBadgeEnabled?: boolean;

  // Event toggles (which events trigger notifications)
  notifyOnCompletion?: boolean;
  notifyOnError?: boolean;
  notifyOnQuestion?: boolean;

  // Session assist (recap + suggested next message generated server-side)
  sessionRecapEnabled?: boolean;
  sessionSuggestionEnabled?: boolean;

  // Per-event notification templates
  notificationTemplates?: {
    completion: { title: string; message: string };
    error: { title: string; message: string };
    question: { title: string; message: string };
    subtask: { title: string; message: string };
  };

  // Summarization settings
  summarizeLastMessage?: boolean;
  summaryThreshold?: number;
  summaryLength?: number;
  maxLastMessageLength?: number;

  usageAutoRefresh?: boolean;
  usageRefreshIntervalMs?: number;
  usageDisplayMode?: 'usage' | 'remaining';
  usageShowPredValues?: boolean;
  usageDropdownProviders?: string[];
  usageSelectedModels?: Record<string, string[]>;  // Map of providerId -> selected model names
  usageCollapsedFamilies?: Record<string, string[]>;  // Map of providerId -> collapsed family IDs (UsagePage)
  usageExpandedFamilies?: Record<string, string[]>;  // Map of providerId -> EXPANDED family IDs (header dropdown - inverted)
  usageModelGroups?: Record<string, {
    customGroups?: Array<{id: string; label: string; models: string[]; order: number}>;
    modelAssignments?: Record<string, string>;  // modelName -> groupId
    renamedGroups?: Record<string, string>;  // groupId -> custom label
  }>;  // Per-provider custom model groups configuration
  autoDeleteEnabled?: boolean;
  autoSaveEnabled?: boolean;
  autoDeleteAfterDays?: number;
  sessionRetentionAction?: 'archive' | 'delete';
  sessionRetentionOnlyArchived?: boolean;
  tunnelProvider?: string;
  tunnelMode?: 'quick' | 'managed-remote' | 'managed-local';
  tunnelBootstrapTtlMs?: number | null;
  tunnelSessionTtlMs?: number;
  managedLocalTunnelConfigPath?: string | null;
  managedRemoteTunnelHostname?: string;
  managedRemoteTunnelToken?: string | null;
  hasManagedRemoteTunnelToken?: boolean;
  managedRemoteTunnelPresets?: ManagedRemoteTunnelPreset[];
  managedRemoteTunnelSelectedPresetId?: string;
  managedRemoteTunnelPresetTokens?: Record<string, string>;
  defaultModel?: string; // format: "provider/model"
  defaultVariant?: string;
  defaultAgent?: string;
  /** When false, `smallModelOverride` outranks OpenCode `small_model` / family scan. */
  smallModelUseDefault?: boolean;
  /** Explicit utility model as `provider/model`. Empty string clears. */
  smallModelOverride?: string;
  /** Explicit walkthrough model as `provider/model`. Empty string clears. */
  walkthroughModelOverride?: string;
  /** Session Goals control loop (local OpenCode only in v1). */
  sessionGoalEnabled?: boolean;
  sessionGoalDefaultBudgetEnabled?: boolean;
  sessionGoalDefaultBudget?: number;
  defaultGitIdentityId?: string; // ''/undefined = unset, 'global' or profile id
  openInAppId?: string;
  autoCreateWorktree?: boolean;
  followUpBehavior?: FollowUpBehavior | 'immediate';
  queueModeEnabled?: boolean;
  gitmojiEnabled?: boolean;
  defaultFileViewerPreview?: boolean;
  zenModel?: string;
  gitProviderId?: string;
  gitModelId?: string;
  pwaAppName?: string;
  pwaOrientation?: 'system' | 'portrait' | 'landscape';
  mobileKeyboardMode?: MobileKeyboardMode;
  desktopWindowControlsPosition?: DesktopWindowControlsPosition;
  desktopWindowControlsStyle?: DesktopWindowControlsStyle;
  inputSpellcheckEnabled?: boolean;
  showToolFileIcons?: boolean;
  showExpandedBashTools?: boolean;
  showExpandedEditTools?: boolean;
  timeFormatPreference?: 'auto' | '12h' | '24h';
  weekStartPreference?: 'auto' | 'sunday' | 'monday';
  chatRenderMode?: 'sorted' | 'live';
  messageStreamTransport?: 'auto' | 'ws' | 'sse';
  activityRenderMode?: 'collapsed' | 'summary';
  sessionSortMode?: 'updated-desc' | 'created-desc';
  sessionGroupMinVisible?: number;
  sessionGroupRecentHours?: number;
  userMessageRenderingMode?: 'markdown' | 'plain';
  collapsibleUserMessages?: boolean;
  stickyUserHeader?: boolean;
  promptNavigatorEnabled?: boolean;
  wideChatLayoutEnabled?: boolean;
  codeBlockLineWrap?: boolean;
  showSplitAssistantMessageActions?: boolean;
  allowPromptingSubagentSessions?: boolean;
  fontSize?: number;
  terminalFontSize?: number;
  editorFontSize?: number;
  uiFont?: string;
  monoFont?: string;
  padding?: number;
  cornerRadius?: number;
  inputBarOffset?: number;

  favoriteModels?: Array<{ providerID: string; modelID: string }>;
  hiddenModels?: Array<{ providerID: string; modelID: string }>;
  collapsedModelProviders?: string[];
  modelPickerLayoutByServerId?: Record<string, {
    providerOrder: string[];
    collapsedProviders: string[];
  }>;
  recentModels?: Array<{ providerID: string; modelID: string }>;
  recentAgents?: string[];
  recentEfforts?: Record<string, string[]>;
  diffLayoutPreference?: 'dynamic' | 'inline' | 'side-by-side';
  diffViewMode?: 'single' | 'stacked';
  gitChangesViewMode?: 'flat' | 'tree';
  directoryShowHidden?: boolean;
  filesViewShowGitignored?: boolean;

  // Message limit — controls fetch, trim, and Load More chunk size (default: 200)
  messageLimit?: number;

  // User-added skills catalogs (persisted to ~/.config/openchamber/settings.json)
  skillCatalogs?: SkillCatalogConfig[];
  // Opt-in to send anonymous usage reports for update checks (default: true)
  reportUsage?: boolean;

  // Global behavior prompt — synced to ~/.config/opencode/AGENTS.md
  globalBehaviorPrompt?: string;
  responseStyleEnabled?: boolean;
  responseStylePreset?: 'concise' | 'detailed' | 'mentor' | 'pushback' | 'noFiller' | 'matchEnergy' | 'warmPeer' | 'custom';
  responseStyleCustomInstructions?: string;
  multiRunEnabled?: boolean;
  sttProvider?: 'browser' | 'server' | 'wasm';
  sttServerUrl?: string;
  sttModel?: string;
  wasmSttModel?: string;
  sttLanguage?: string;
  sttSilenceThresholdDb?: number;
  sttSilenceHoldMs?: number;
  sttTranscribeOnStop?: boolean;

  /**
   * UI safeStorage bag (display mode, locale, sidebar state, etc.).
   * Lives in the host file because Desktop's loopback port changes
   * per launch, which would scope `localStorage` to a different origin.
   */
  localStore?: Record<string, string>;
  localStorePatch?: LocalStorePatch;
};

type ElectronRuntimeGlobal = {
  runtime?: string;
  trayEnabled?: boolean;
};

const getElectronRuntime = (): ElectronRuntimeGlobal | null => {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __OPENCHAMBER_ELECTRON__?: ElectronRuntimeGlobal }).__OPENCHAMBER_ELECTRON__ ?? null;
};

const getDesktopBridge = (): OpenChamberDesktopBridge | null => {
  if (typeof window === 'undefined') return null;
  return window.__OPENCHAMBER_DESKTOP__ ?? null;
};

export const isElectronShell = (): boolean => getElectronRuntime()?.runtime === 'electron';

export const getElectronPlatform = (): string | null => {
  if (typeof window === 'undefined') return null;
  return typeof window.__OPENCHAMBER_PLATFORM__ === 'string'
    ? window.__OPENCHAMBER_PLATFORM__
    : null;
};

export const DEFAULT_DESKTOP_WINDOW_CONTROLS_POSITION: DesktopWindowControlsPosition = 'right';

export const usesFramelessElectronChrome = (): boolean => {
  if (!isElectronShell()) return false;
  const platform = getElectronPlatform();
  return platform === 'win32' || platform === 'linux';
};

export const supportsDesktopWindowControlsStyle = (): boolean => (
  isElectronShell() && getElectronPlatform() === 'linux'
);

export const normalizeDesktopWindowControlsStyle = (
  value: unknown,
): DesktopWindowControlsStyle | undefined => {
  if (value === 'classic' || value === 'traffic-lights') {
    return value;
  }
  return undefined;
};

export const normalizeDesktopWindowControlsPosition = (
  value: unknown,
): DesktopWindowControlsPosition | undefined => {
  if (value === 'left' || value === 'right') {
    return value;
  }
  if (value === 'auto') {
    return DEFAULT_DESKTOP_WINDOW_CONTROLS_POSITION;
  }
  return undefined;
};

export const resolveDesktopWindowControlsSide = (
  preference: DesktopWindowControlsPosition | undefined,
): DesktopWindowControlsSide => {
  return preference === 'left' ? 'left' : DEFAULT_DESKTOP_WINDOW_CONTROLS_POSITION;
};

export const getDesktopWindowControlsOrder = (
  side: DesktopWindowControlsSide,
): readonly DesktopWindowControlAction[] => {
  return side === 'left'
    ? ['close', 'minimize', 'maximize']
    : ['minimize', 'maximize', 'close'];
};

export const hasDesktopInvoke = (): boolean => {
  return typeof getDesktopBridge()?.core?.invoke === 'function';
};

export const canUseElectronDesktopIPC = (): boolean => isElectronShell() && hasDesktopInvoke();

export const createDesktopThemeFileAPI = (): RuntimeAPIs['themeFiles'] => {
  // Preload exposes this capability only to trusted local UI pages. Unlike the
  // active API endpoint, that page identity stays local during remote connections.
  const pick = getDesktopBridge()?.themeFiles?.pick;
  if (typeof pick !== 'function') return undefined;
  return {
    async pick() {
      const bridgePick = getDesktopBridge()?.themeFiles?.pick;
      if (typeof bridgePick !== 'function') return { status: 'unsupported' };
      const file = z.object({ name: z.string(), size: z.number().nonnegative(), text: z.string() }).nullable().parse(await bridgePick());
      return { status: 'picked' as const, file };
    },
  };
};

export const invokeDesktop = async <T = unknown>(command: string, args?: Record<string, unknown>): Promise<T | null> => {
  const invoke = getDesktopBridge()?.core?.invoke;
  if (typeof invoke !== 'function') return null;
  return invoke(command, args ?? {}) as Promise<T>;
};

export const listenDesktopEvent = async (
  event: string,
  handler: (evt: { payload?: unknown }) => void,
): Promise<(() => void) | null> => {
  const listen = getDesktopBridge()?.event?.listen;
  if (typeof listen !== 'function') return null;
  return listen(event, handler);
};

export const canUseDesktopNativeApi = (): boolean => hasDesktopInvoke() && isDesktopLocalOriginActive();

const openDesktopDialog = async (options: Record<string, unknown>): Promise<unknown> => {
  const open = getDesktopBridge()?.dialog?.open;
  if (typeof open !== 'function') {
    return null;
  }
  return open(options);
};

type LaunchAtLoginStatus = {
  supported: boolean;
  enabled: boolean;
};

type KeepAwakeStatus = {
  supported: boolean;
  enabled: boolean;
  active: boolean;
};

export const getDesktopLaunchAtLogin = async (): Promise<LaunchAtLoginStatus | null> => {
  if (!canUseElectronDesktopIPC() || !isDesktopLocalOriginActive()) {
    return null;
  }

  try {
    const result = await invokeDesktop<LaunchAtLoginStatus>('desktop_get_launch_at_login');
    if (!result || typeof result.supported !== 'boolean' || typeof result.enabled !== 'boolean') {
      return null;
    }
    return result;
  } catch (error) {
    console.warn('Failed to get launch at login status', error);
    return null;
  }
};

export const setDesktopLaunchAtLogin = async (enabled: boolean): Promise<LaunchAtLoginStatus | null> => {
  if (!canUseElectronDesktopIPC() || !isDesktopLocalOriginActive()) {
    return null;
  }

  try {
    const result = await invokeDesktop<LaunchAtLoginStatus>('desktop_set_launch_at_login', { enabled });
    if (!result || typeof result.supported !== 'boolean' || typeof result.enabled !== 'boolean') {
      return null;
    }
    return result;
  } catch (error) {
    console.warn('Failed to set launch at login status', error);
    return null;
  }
};

type MinimizeToTrayStatus = {
  supported: boolean;
  enabled: boolean;
};

export const getDesktopMinimizeToTray = async (): Promise<MinimizeToTrayStatus | null> => {
  if (!canUseElectronDesktopIPC() || !isDesktopLocalOriginActive()) {
    return null;
  }

  try {
    const result = await invokeDesktop<MinimizeToTrayStatus>('desktop_get_minimize_to_tray');
    if (!result || typeof result.supported !== 'boolean' || typeof result.enabled !== 'boolean') {
      return null;
    }
    return result;
  } catch (error) {
    console.warn('Failed to get minimize to tray status', error);
    return null;
  }
};

export const setDesktopMinimizeToTray = async (enabled: boolean): Promise<MinimizeToTrayStatus | null> => {
  if (!canUseElectronDesktopIPC() || !isDesktopLocalOriginActive()) {
    return null;
  }

  try {
    const result = await invokeDesktop<MinimizeToTrayStatus>('desktop_set_minimize_to_tray', { enabled });
    if (!result || typeof result.supported !== 'boolean' || typeof result.enabled !== 'boolean') {
      return null;
    }
    return result;
  } catch (error) {
    console.warn('Failed to set minimize to tray status', error);
    return null;
  }
};

export const getDesktopKeepAwake = async (): Promise<KeepAwakeStatus | null> => {
  if (!canUseElectronDesktopIPC() || !isDesktopLocalOriginActive()) {
    return null;
  }

  try {
    const result = await invokeDesktop<KeepAwakeStatus>('desktop_get_keep_awake');
    if (!result || typeof result.supported !== 'boolean' || typeof result.enabled !== 'boolean' || typeof result.active !== 'boolean') {
      return null;
    }
    return result;
  } catch (error) {
    console.warn('Failed to get keep awake status', error);
    return null;
  }
};

export const setDesktopKeepAwake = async (enabled: boolean): Promise<KeepAwakeStatus | null> => {
  if (!canUseElectronDesktopIPC() || !isDesktopLocalOriginActive()) {
    return null;
  }

  try {
    const result = await invokeDesktop<KeepAwakeStatus>('desktop_set_keep_awake', { enabled });
    if (!result || typeof result.supported !== 'boolean' || typeof result.enabled !== 'boolean' || typeof result.active !== 'boolean') {
      return null;
    }
    return result;
  } catch (error) {
    console.warn('Failed to set keep awake status', error);
    return null;
  }
};

export type DesktopRemotePasswordLoginResult = {
  ok: boolean;
  status: number;
};

export const loginDesktopRemotePassword = async (
  password: string,
  trustDevice: boolean,
): Promise<DesktopRemotePasswordLoginResult | null> => {
  if (!canUseElectronDesktopIPC() || isDesktopLocalOriginActive() || typeof window === 'undefined') {
    return null;
  }

  try {
    const result = await invokeDesktop<DesktopRemotePasswordLoginResult>('desktop_remote_password_login', {
      url: window.location.href,
      password,
      trustDevice,
    });
    if (!result || typeof result.ok !== 'boolean' || typeof result.status !== 'number') {
      return null;
    }
    return result;
  } catch (error) {
    console.warn('Failed to log in to remote desktop host', error);
    return null;
  }
};

const normalizeOrigin = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    try {
      return new URL(trimmed.endsWith('/') ? trimmed : `${trimmed}/`).origin;
    } catch {
      return null;
    }
  }
};

const parseUrl = (raw: string): URL | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    try {
      return new URL(trimmed.endsWith('/') ? trimmed : `${trimmed}/`);
    } catch {
      return null;
    }
  }
};

const normalizeHost = (rawHost: string): string => rawHost.replace(/^\[|\]$/g, '').toLowerCase();

const isLoopbackHost = (host: string): boolean => {
  const normalized = normalizeHost(host);
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

export const isDesktopLocalOriginActive = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (!isDesktopShell()) return false;

  const local = typeof window.__OPENCHAMBER_LOCAL_ORIGIN__ === 'string' ? window.__OPENCHAMBER_LOCAL_ORIGIN__ : '';
  const localUrl = parseUrl(local);
  const currentUrl = parseUrl(window.location.origin);

  if (localUrl && currentUrl) {
    if (localUrl.origin === currentUrl.origin) {
      return true;
    }

    const localPort = localUrl.port || (localUrl.protocol === 'https:' ? '443' : '80');
    const currentPort = currentUrl.port || (currentUrl.protocol === 'https:' ? '443' : '80');

    return (
      localUrl.protocol === currentUrl.protocol &&
      localPort === currentPort &&
      isLoopbackHost(localUrl.hostname) &&
      isLoopbackHost(currentUrl.hostname)
    );
  }

  const localOrigin = normalizeOrigin(local);
  const currentOrigin = normalizeOrigin(window.location.origin) || window.location.origin;
  if (localOrigin && currentOrigin && localOrigin === currentOrigin) {
    return true;
  }

  return Boolean(currentUrl && isLoopbackHost(currentUrl.hostname));
};

export const isDesktopShell = (): boolean => {
  if (typeof window === 'undefined') return false;
  return isElectronShell();
};

export const canRequestNativeDirectoryAccess = (): boolean => canUseDesktopNativeApi();
/**
 * On-disk path of a File dropped from the OS onto the desktop app.
 * Null outside the desktop local origin (browser drops carry no usable path).
 * (upstream 5181bcd33)
 */
const droppedFilePathSchema = z.string().min(1);

export const pathForDroppedFile = (file: File): string | null => {
  if (!canRequestNativeDirectoryAccess()) return null;
  try {
    const parsed = droppedFilePathSchema.safeParse(getDesktopBridge()?.pathForFile?.(file));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    console.warn('Failed to resolve dropped file path', error);
    return null;
  }
};


export const startDesktopWindowDrag = async (): Promise<boolean> => {
  if (!isDesktopShell() || !hasDesktopInvoke()) {
    return false;
  }
  try {
    await invokeDesktop('desktop_start_window_drag');
    return true;
  } catch {
    return false;
  }
};

export const openSshTerminalAtPath = async (
  sshDestination: string,
  sshArgs: string[],
  remotePath: string,
  appName: string,
): Promise<boolean> => {
  if (!hasDesktopInvoke()) {
    return false;
  }
  try {
    await invokeDesktop('desktop_ssh_open_terminal', {
      sshDestination,
      sshArgs,
      remotePath,
      appName,
    });
    return true;
  } catch (e) {
    console.warn('Failed to open SSH terminal', e);
    return false;
  }
};

export const isVSCodeRuntime = (): boolean => {
  if (typeof window === "undefined") return false;
  const apis = (window as { __OPENCHAMBER_RUNTIME_APIS__?: { runtime?: { isVSCode?: boolean } } }).__OPENCHAMBER_RUNTIME_APIS__;
  return apis?.runtime?.isVSCode === true;
};

export const isWebRuntime = (): boolean => {
  if (typeof window === "undefined") return false;
  const apis = (window as { __OPENCHAMBER_RUNTIME_APIS__?: { runtime?: { platform?: string } } }).__OPENCHAMBER_RUNTIME_APIS__;
  const platform = apis?.runtime?.platform;
  if (platform === 'web') {
    return true;
  }
  if (platform === 'desktop' || platform === 'vscode') {
    return false;
  }
  // Default: anything that's not VSCode behaves like web (HTTP UI).
  return !isVSCodeRuntime();
};

export const isBrowserClientRuntime = (
  platform: RuntimeAPIs['runtime']['platform'],
  desktopShell = isDesktopShell(),
): boolean => platform === 'web' && !desktopShell;

export const getDesktopHomeDirectory = async (): Promise<string | null> => {
  if (typeof window !== 'undefined') {
    const embedded = window.__OPENCHAMBER_HOME__;
    if (embedded && embedded.length > 0) {
      return embedded;
    }
  }

  return null;
};

export const requestDirectoryAccess = async (
  directoryPath: string
): Promise<{ success: boolean; path?: string; projectId?: string; error?: string }> => {
  // Desktop shell on local instance: use native folder picker.
  if (canUseDesktopNativeApi()) {
    try {
      const selected = await openDesktopDialog({
        directory: true,
        multiple: false,
        title: 'Select Working Directory',
        ...(directoryPath ? { defaultPath: directoryPath } : {}),
      });
      if (!selected || typeof selected !== 'string') {
        return { success: false, error: 'Directory selection cancelled' };
      }
      return { success: true, path: selected };
    } catch (error) {
      console.warn('Failed to request directory access', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return { success: false, error: 'Native directory picker not available' };
};

export const requestFileAccess = async (
  options?: { filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }
): Promise<{ success: boolean; path?: string; error?: string }> => {
  if (canUseDesktopNativeApi()) {
    try {
      const selected = await openDesktopDialog({
        directory: false,
        multiple: false,
        title: 'Select File',
        ...(options?.filters ? { filters: options.filters } : {}),
        ...(options?.defaultPath ? { defaultPath: options.defaultPath } : {}),
      });
      if (!selected || typeof selected !== 'string') {
        return { success: false, error: 'File selection cancelled' };
      }
      return { success: true, path: selected };
    } catch (error) {
      console.warn('Failed to request file access', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return { success: false, error: 'Native file picker not available' };
};

export const startAccessingDirectory = async (
  directoryPath: string
): Promise<{ success: boolean; error?: string }> => {
  void directoryPath;
  return { success: true };
};

export const stopAccessingDirectory = async (
  directoryPath: string
): Promise<{ success: boolean; error?: string }> => {
  void directoryPath;
  return { success: true };
};

export const sendAssistantCompletionNotification = async (
  payload?: AssistantNotificationPayload
): Promise<boolean> => {
  if (hasDesktopInvoke()) {
    try {
      await invokeDesktop('desktop_notify', {
        payload: {
          title: payload?.title,
          body: payload?.body,
          tag: 'openchamber-agent-complete',
        },
      });
      return true;
    } catch (error) {
      console.warn('Failed to send assistant completion notification', error);
      return false;
    }
  }

  return false;
};

export const checkForDesktopUpdates = async (): Promise<UpdateInfo | null> => {
  if (!canUseDesktopNativeApi()) {
    return null;
  }

  try {
    const info = await invokeDesktop('desktop_check_for_updates');
    return info as UpdateInfo;
  } catch (error) {
    console.warn('Failed to check for updates', error);
    return null;
  }
};

export const downloadDesktopUpdate = async (
  onProgress?: (progress: UpdateProgress) => void
): Promise<boolean> => {
  if (!canUseDesktopNativeApi()) {
    return false;
  }

  let unlisten: null | (() => void | Promise<void>) = null;
  let downloaded = 0;
  let total: number | undefined;

  try {
    if (typeof onProgress === 'function') {
      unlisten = await listenDesktopEvent('openchamber:update-progress', (evt) => {
        const payload = evt?.payload;
        if (!payload || typeof payload !== 'object') return;
        const data = payload as { event?: unknown; data?: unknown };
        const eventName = typeof data.event === 'string' ? data.event : null;
        const eventData = data.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : null;

        if (eventName === 'Started') {
          downloaded = 0;
          total = typeof eventData?.contentLength === 'number' ? (eventData.contentLength as number) : undefined;
          onProgress({ downloaded, total });
          return;
        }

        if (eventName === 'Progress') {
          const d = eventData?.downloaded;
          const t = eventData?.total;
          if (typeof d === 'number') downloaded = d;
          if (typeof t === 'number') total = t;
          onProgress({ downloaded, total });
          return;
        }

        if (eventName === 'Finished') {
          onProgress({ downloaded, total });
        }
      });
    }

    await invokeDesktop('desktop_download_and_install_update');
    return true;
  } catch (error) {
    console.warn('Failed to download update', error);
    return false;
  } finally {
    if (unlisten) {
      try {
        const result = unlisten();
        if (result instanceof Promise) {
          await result;
        }
      } catch {
        // ignored
      }
    }
  }
};

export const restartToApplyUpdate = async (): Promise<boolean> => {
  if (!canUseDesktopNativeApi()) {
    return false;
  }

  return restartDesktopApp();
};

export const restartDesktopApp = async (): Promise<boolean> => {
  if (!hasDesktopInvoke()) {
    return false;
  }

  try {
    await invokeDesktop('desktop_restart');
    return true;
  } catch (error) {
    console.warn('Failed to restart desktop app', error);
    return false;
  }
};

export const getDesktopLanAddress = async (): Promise<string | null> => {
  if (!canUseDesktopNativeApi()) {
    return null;
  }

  try {
    const result = await invokeDesktop('desktop_get_lan_address');
    return typeof result === 'string' && result.trim().length > 0 ? result.trim() : null;
  } catch (error) {
    console.warn('Failed to get desktop LAN address', error);
    return null;
  }
};

export const openDesktopPath = async (path: string, app?: string | null): Promise<boolean> => {
  if (!canUseDesktopNativeApi()) {
    return false;
  }

  const trimmed = path?.trim();
  if (!trimmed) {
    return false;
  }

  try {
    await invokeDesktop('desktop_open_path', {
      path: trimmed,
      app: typeof app === 'string' && app.trim().length > 0 ? app.trim() : undefined,
    });
    return true;
  } catch (error) {
    console.warn('Failed to open path', error);
    return false;
  }
};

export const revealDesktopPath = async (path: string): Promise<boolean> => {
  if (!canUseDesktopNativeApi()) {
    return false;
  }

  const trimmed = path?.trim();
  if (!trimmed) {
    return false;
  }

  try {
    await invokeDesktop('desktop_reveal_path', {
      path: trimmed,
    });
    return true;
  } catch {
    return openDesktopPath(trimmed);
  }
};

export const saveDesktopMarkdownFile = async (
  defaultFileName: string,
  content: string,
): Promise<string | null> => {
  if (!canUseDesktopNativeApi()) {
    return null;
  }

  const trimmedFileName = defaultFileName?.trim();
  if (!trimmedFileName) {
    return null;
  }

  try {
    const result = await invokeDesktop('desktop_save_markdown_file', {
      defaultFileName: trimmedFileName,
      content,
    });
    return typeof result === 'string' && result.trim().length > 0 ? result : null;
  } catch (error) {
    console.warn('Failed to save markdown file', error);
    return null;
  }
};

export const openDesktopProjectInApp = async (
  projectPath: string,
  appId: string,
  appName: string,
): Promise<boolean> => {
  if (!canUseDesktopNativeApi()) {
    return false;
  }

  const trimmedProjectPath = projectPath?.trim();
  const trimmedAppId = appId?.trim();
  const trimmedAppName = appName?.trim();

  if (!trimmedProjectPath || !trimmedAppId || !trimmedAppName) {
    return false;
  }

  try {
    await invokeDesktop('desktop_open_in_app', {
      projectPath: trimmedProjectPath,
      appId: trimmedAppId,
      appName: trimmedAppName,
    });
    return true;
  } catch (error) {
    console.warn('Failed to open project in app', error);
    return false;
  }
};

export const openDesktopFileInApp = async (
  filePath: string,
  appId: string,
  appName: string,
): Promise<boolean> => {
  if (!canUseDesktopNativeApi()) {
    return false;
  }

  const trimmedFilePath = filePath?.trim();
  const trimmedAppId = appId?.trim();
  const trimmedAppName = appName?.trim();

  if (!trimmedFilePath || !trimmedAppId || !trimmedAppName) {
    return false;
  }

  try {
    await invokeDesktop('desktop_open_file_in_app', {
      filePath: trimmedFilePath,
      appId: trimmedAppId,
      appName: trimmedAppName,
    });
    return true;
  } catch (error) {
    console.warn('Failed to open file in app', error);
    return false;
  }
};

export const filterInstalledDesktopApps = async (apps: string[]): Promise<string[]> => {
  if (!canUseDesktopNativeApi()) {
    return [];
  }

  const candidate = Array.isArray(apps) ? apps.filter((value) => typeof value === 'string') : [];
  if (candidate.length === 0) {
    return [];
  }

  try {
    const result = await invokeDesktop('desktop_filter_installed_apps', {
      apps: candidate,
    });
    return Array.isArray(result) ? result.filter((value) => typeof value === 'string') : [];
  } catch (error) {
    console.warn('Failed to check installed apps', error);
    return [];
  }
};

export const fetchDesktopAppIcons = async (apps: string[]): Promise<Record<string, string>> => {
  if (!canUseDesktopNativeApi()) {
    return {};
  }

  const candidate = Array.isArray(apps) ? apps.filter((value) => typeof value === 'string') : [];
  if (candidate.length === 0) {
    return {};
  }

  try {
    const result = await invokeDesktop('desktop_fetch_app_icons', {
      apps: candidate,
    });
    if (!Array.isArray(result)) {
      return {};
    }
    const map: Record<string, string> = {};
    for (const entry of result) {
      if (!entry || typeof entry !== 'object') continue;
      const candidateEntry = entry as { app?: unknown; data_url?: unknown };
      if (typeof candidateEntry.app !== 'string' || typeof candidateEntry.data_url !== 'string') continue;
      map[candidateEntry.app] = candidateEntry.data_url;
    }
    return map;
  } catch (error) {
    console.warn('Failed to fetch installed app icons', error);
    return {};
  }
};

export type InstalledDesktopAppInfo = {
  name: string;
  iconDataUrl?: string | null;
};

export type FetchDesktopInstalledAppsResult = {
  apps: InstalledDesktopAppInfo[];
  success: boolean;
  hasCache: boolean;
  isCacheStale: boolean;
};

export const fetchDesktopInstalledApps = async (
  apps: string[],
  force?: boolean
): Promise<FetchDesktopInstalledAppsResult> => {
  if (!canUseDesktopNativeApi()) {
    return { apps: [], success: false, hasCache: false, isCacheStale: false };
  }

  const candidate = Array.isArray(apps) ? apps.filter((value) => typeof value === 'string') : [];
  if (candidate.length === 0) {
    return { apps: [], success: true, hasCache: false, isCacheStale: false };
  }

  try {
    const result = await invokeDesktop('desktop_get_installed_apps', {
      apps: candidate,
      force: force === true ? true : undefined,
    });
    if (!result || typeof result !== 'object') {
      return { apps: [], success: false, hasCache: false, isCacheStale: false };
    }
    const payload = result as { apps?: unknown; hasCache?: unknown; isCacheStale?: unknown };
    if (!Array.isArray(payload.apps)) {
      return { apps: [], success: false, hasCache: false, isCacheStale: false };
    }
    const installedApps = payload.apps
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => {
        const record = entry as { name?: unknown; iconDataUrl?: unknown };
        return {
          name: typeof record.name === 'string' ? record.name : '',
          iconDataUrl: typeof record.iconDataUrl === 'string' ? record.iconDataUrl : null,
        };
      })
      .filter((entry) => entry.name.length > 0);
    return {
      apps: installedApps,
      success: true,
      hasCache: payload.hasCache === true,
      isCacheStale: payload.isCacheStale === true,
    };
  } catch (error) {
    console.warn('Failed to fetch installed apps', error);
    return { apps: [], success: false, hasCache: false, isCacheStale: false };
  }
};

export const clearDesktopCache = async (): Promise<boolean> => {
  if (!canUseDesktopNativeApi()) {
    return false;
  }

  try {
    await invokeDesktop('desktop_clear_cache');
    return true;
  } catch (error) {
    console.warn('Failed to clear cache', error);
    return false;
  }
};

export const focusDesktopWindow = async (): Promise<boolean> => {
  if (!isDesktopShell()) return false;
  try {
    return Boolean(await invokeDesktop('desktop_focus_window'));
  } catch {
    return false;
  }
};
