/**
 * The settings registry: one table that names every OpenChamber setting, who
 * owns it (`scope`), how a value is parsed at the boundary, and where the UI
 * keeps its live copy.
 *
 * Everything else about settings derives from this table: the boundary parser,
 * the store apply step, the store-subscribing auto-save key list, and — through
 * the generated JSON snapshot (`settings-registry.json`, see
 * `registry-snapshot.ts`) — the server's and the VS Code bridge's key lists. A
 * key that is not here does not persist.
 *
 * Fork transition note (upstream 82a0ee757): upstream derives `DesktopSettings`
 * from this table. This fork still carries settings for features that have not
 * been ported yet and fork-local settings that upstream does not have, so the
 * canonical type remains the hand-written `DesktopSettings` in `@/lib/desktop`
 * and the table is checked against it: every key of that type must have an
 * entry and every parser must produce exactly the key's type. Keys for
 * not-yet-ported upstream features join the table with their feature ports.
 *
 * Scopes (upstream `.opencode/plans/settings-scopes.md`):
 * - `instance`: a fact about the machine the server runs on. Never synced.
 * - `profile`: the person's preference. Synced to every client of the
 *   instance; a few are stored per surface kind (`perSurface`).
 * - `device`: state of this install/surface. Keys the fork still round-trips
 *   through the server today (window controls, mobile keyboard mode, input bar
 *   offset) stay writable until the client migration stops sending them; keys
 *   that only ever lived in a local store are marked `local` and never cross
 *   the wire.
 */
import type { DesktopSettings, DesktopWindowControlsPosition, DesktopWindowControlsStyle } from '@/lib/desktop';
import { DIRECTORY_SHOW_HIDDEN_STORAGE_KEY, setDirectoryShowHidden } from '@/lib/directoryShowHidden';
import type { DraftStarterRef } from '@/lib/draftStarters';
import { sanitizeStarterRefs } from '@/lib/draftStarters';
import { FILES_VIEW_SHOW_GITIGNORED_STORAGE_KEY, setFilesViewShowGitignored } from '@/lib/filesViewShowGitignored';
import { isMonoFontOption, isUiFontOption } from '@/lib/fontOptions';
import { normalizeMobileKeyboardMode } from '@/lib/mobileKeyboardMode';
import { getSafeStorage } from '@/stores/utils/safeStorage';
import { useMessageQueueStore } from '@/stores/messageQueueStore';
import { useUIStore } from '@/stores/useUIStore';
import { z } from 'zod';
import {
  fromSchema,
  mapParser,
  parseBoolean,
  parseDesktopWindowControlsPosition,
  parseFiniteNumber,
  parseFollowUpBehavior,
  parseGuarded,
  parseIntegerAtLeast,
  parseIntegerInRange,
  parseManagedRemoteTunnelPresetTokens,
  parseManagedRemoteTunnelPresets,
  parseModelRefs,
  parseNonEmptyString,
  parseNotificationTemplates,
  parseNullableFiniteNumber,
  parseNullableTrimmedPath,
  parseNullableTrimmedString,
  parseOneOf,
  parsePositiveInteger,
  parseProjects,
  parsePwaAppName,
  parseRecentEfforts,
  parseSkillCatalogs,
  parseStringList,
  parseStringRecordOfStringLists,
  parseStringSet,
  parseTextUpTo,
  parseTrimmedString,
  parseTrimmedStringUpTo,
  parseUsageModelGroups,
  type ManagedRemoteTunnelPreset,
  type ModelRef,
  type SettingsParser,
  type SettingsRawDocument,
  type SkillCatalogConfig,
} from './parsers';

export type SettingsScope = 'instance' | 'profile' | 'device';
export type SettingsSurface = 'web' | 'desktop' | 'vscode' | 'mobile';

/**
 * The siblings a field's `write` may consult in the same parsed snapshot. Named
 * explicitly (not `DesktopSettings`) so the registry's type does not refer to
 * itself through the bindings; extend it when another field needs a sibling.
 */
export type SettingsSiblingView = {
  readonly draftStartersScheduleTaskAdded?: boolean;
};

/**
 * How the UI keeps a live copy of a field, when it keeps one at all. Method
 * syntax on purpose: it keeps `SettingsFieldSpec<T>` assignable to
 * `SettingsFieldSpec<unknown>`, which is what the generic loops below iterate.
 */
export type SettingsUiBinding<T> = {
  read(): T | undefined;
  write(value: T, snapshot: SettingsSiblingView): void;
  /** Send changes of the backing store to the server (store-subscribing auto-save). */
  autoSave: boolean;
};

export type SettingsFieldSpec<T> = {
  scope: SettingsScope;
  parse(value: unknown, raw: SettingsRawDocument): T | undefined;
  ui?: SettingsUiBinding<T>;
  /** Profile fields the owner chose to store per surface kind (change on a phone stays on phones). */
  perSurface?: true;
  /** Surfaces that have this field; absent means all. */
  surfaces?: readonly SettingsSurface[];
  /** Workspace pointers: adopted only on a bootstrap-grade sync (see `SettingsSyncedDetail`). */
  adopt?: 'bootstrap-only';
  /** Computed by the writer from other fields; never edited directly. */
  derived?: true;
  /** Accepted on write, never returned by a read. */
  secret?: true;
  /** Emitted by the server for this build/process; never accepted on a write, never persisted. */
  computed?: true;
  /** Lives only in the local store; never crosses the wire (fork: typed settings keys the server rejects). */
  local?: true;
};

const field = <T>(spec: SettingsFieldSpec<T>): SettingsFieldSpec<T> => spec;

type UIStoreState = ReturnType<typeof useUIStore.getState>;

/** A field whose live copy is one `useUIStore` key, written through its setter. */
const uiStore = <K extends keyof UIStoreState>(
  key: K,
  write: (value: UIStoreState[K], snapshot: SettingsSiblingView) => void,
  options: { autoSave?: boolean } = {},
): SettingsUiBinding<UIStoreState[K]> => ({
  read: () => useUIStore.getState()[key],
  write,
  autoSave: options.autoSave ?? true,
});

const setUi = <K extends keyof UIStoreState>(key: K) => (value: UIStoreState[K]): void => {
  // SAFETY: a single-key patch built from the key it is typed by.
  useUIStore.setState({ [key]: value } as Pick<UIStoreState, K>);
};

// The config store is reached through the global it registers on `window`
// (`useConfigStore` imports the shared write path, so a direct import here
// would be a load-order cycle). Absent outside the browser.
const configStore = () => globalThis.window?.__zustand_config_store__ ?? null;

type ConfigStoreState = NonNullable<ReturnType<NonNullable<ReturnType<typeof configStore>>['getState']>>;

const configField = <K extends keyof ConfigStoreState>(
  key: K,
): SettingsUiBinding<ConfigStoreState[K]> => ({
  read: () => configStore()?.getState()[key],
  write: (value) => {
    // SAFETY: a single-key patch built from the key it is typed by.
    configStore()?.setState({ [key]: value } as Pick<ConfigStoreState, K>);
  },
  // The config store's own setters write these through `updateDesktopSettings`.
  autoSave: false,
});

const parseUiFont: SettingsParser<string> = parseGuarded(isUiFontOption);
const parseMonoFont: SettingsParser<string> = parseGuarded(isMonoFontOption);
// The fork's stored value for one of the safeStorage-backed display toggles.
const readStoredBooleanFlag = (storageKey: string): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    const stored = getSafeStorage().getItem(storageKey);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
};
const parseMobileKeyboardModeValue = mapParser(parseTrimmedString, (value) => normalizeMobileKeyboardMode(value, undefined));
const parseDraftStarters: SettingsParser<DraftStarterRef[]> = mapParser(fromSchema(z.array(z.unknown())), sanitizeStarterRefs);
/** Fork keeps the legacy STT provider names (upstream normalized them to 'local' | 'openai-compatible'). */
const parseForkSttProvider: SettingsParser<'browser' | 'server' | 'wasm'> = parseOneOf(['browser', 'server', 'wasm']);

/** Fork-only: per-server model picker layout, bounded like the server sanitizer. */
const MODEL_PICKER_LAYOUT_MAX_SERVERS = 64;
const MODEL_PICKER_LAYOUT_MAX_LIST = 256;

const parseModelPickerLayoutByServerId: SettingsParser<NonNullable<DesktopSettings['modelPickerLayoutByServerId']>> = fromSchema(
  z.record(z.string(), z.unknown()).transform((record) => {
    const result: NonNullable<DesktopSettings['modelPickerLayoutByServerId']> = {};
    let count = 0;
    for (const [serverId, value] of Object.entries(record)) {
      if (!serverId || count >= MODEL_PICKER_LAYOUT_MAX_SERVERS) break;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const list = (input: unknown): string[] => {
        const seen = new Set<string>();
        if (Array.isArray(input)) {
          for (const entry of input) {
            if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) continue;
            seen.add(entry);
            if (seen.size >= MODEL_PICKER_LAYOUT_MAX_LIST) break;
          }
        }
        return [...seen];
      };
      result[serverId] = {
        providerOrder: list((value as Record<string, unknown>).providerOrder),
        collapsedProviders: list((value as Record<string, unknown>).collapsedProviders),
      };
      count += 1;
    }
    return result;
  }).refine((record) => Object.keys(record).length > 0),
);

/**
 * Removing a built-in starter must stay a durable choice, so the list is only
 * patched with the built-in when the marker says it was never offered. The
 * marker travels with the user's edit (useDraftStarters).
 */
const withOfferedBuiltInStarters = (starters: DraftStarterRef[], snapshot: SettingsSiblingView): DraftStarterRef[] => {
  let next = starters;
  const insertAfter = (name: string, after: string) => {
    if (next.some((starter) => starter.type === 'command' && starter.name === name)) return next;
    const anchor = next.findIndex((starter) => starter.type === 'command' && starter.name === after);
    const insertAt = anchor >= 0 ? anchor + 1 : next.length;
    next = [...next.slice(0, insertAt), { type: 'command', name }, ...next.slice(insertAt)];
    return next;
  };
  if (snapshot.draftStartersScheduleTaskAdded !== true) return insertAfter('schedule-task', 'craft-goal');
  return next;
};

/**
 * Every key of the fork's `DesktopSettings` must appear exactly once. The
 * mapped annotation is the completeness guard: a settings key added to
 * `@/lib/desktop` without a registry entry fails the type-check here, and a
 * parser whose output does not match the key's type does too.
 */
export const SETTINGS_REGISTRY: { readonly [K in keyof DesktopSettings]-?: SettingsFieldSpec<Exclude<DesktopSettings[K], undefined>> } = {
  // ── Theme (profile; the fork's ThemeSystemContext owns the live copy) ──
  themeId: field({ scope: 'profile', parse: parseNonEmptyString }),
  useSystemTheme: field({ scope: 'profile', parse: parseBoolean }),
  themeVariant: field({ scope: 'profile', derived: true, parse: parseOneOf(['light', 'dark']) }),
  lightThemeId: field({ scope: 'profile', parse: parseNonEmptyString }),
  darkThemeId: field({ scope: 'profile', parse: parseNonEmptyString }),
  // Fork: the Electron shell still reads the flat splash colours; upstream
  // replaced them by the desktop-shell-owned `desktopSplashColors`. The fork's
  // theme context writes them through the settings document, so they stay
  // client-persistable (instance facts about this install's splash screen).
  splashBgLight: field({ scope: 'instance', surfaces: ['desktop'], parse: parseTrimmedString }),
  splashFgLight: field({ scope: 'instance', surfaces: ['desktop'], parse: parseTrimmedString }),
  splashBgDark: field({ scope: 'instance', surfaces: ['desktop'], parse: parseTrimmedString }),
  splashFgDark: field({ scope: 'instance', surfaces: ['desktop'], parse: parseTrimmedString }),

  // ── Workspace pointers and instance facts ──
  lastDirectory: field({ scope: 'instance', adopt: 'bootstrap-only', parse: parseNonEmptyString }),
  homeDirectory: field({ scope: 'instance', parse: parseNonEmptyString }),
  opencodeBinary: field({ scope: 'instance', parse: parseTrimmedString }),
  agentControlToolEnabled: field({ scope: 'instance', parse: parseBoolean, ui: uiStore('agentControlToolEnabled', (v) => useUIStore.getState().setAgentControlToolEnabled(v)) }),
  // `builtin` or an installed extension id; the server falls back to `builtin` when that extension cannot serve.
  browserProvider: field({ scope: 'instance', parse: parseNonEmptyString, ui: uiStore('browserProvider', (v) => useUIStore.getState().setBrowserProvider(v)) }),
  agentNotifyToolEnabled: field({ scope: 'instance', parse: parseBoolean, ui: uiStore('agentNotifyToolEnabled', (v) => useUIStore.getState().setAgentNotifyToolEnabled(v)) }),
  agentMemoryToolEnabled: field({ scope: 'instance', parse: parseBoolean, ui: uiStore('agentMemoryToolEnabled', (v) => useUIStore.getState().setAgentMemoryToolEnabled(v)) }),
  // The isolated-spaces switch. The server reads it once at start; a change takes effect at the
  // next start. No live copy in the UI yet: the settings screen for it is a later stage.
  isolatedSpacesEnabled: field({ scope: 'instance', parse: parseBoolean }),
  // Emitted by the server for this build (OPENCHAMBER_ROUTING_ENABLE); never
  // accepted on a write, never persisted.
  routingFeatureAvailable: field({
    scope: 'instance',
    computed: true,
    parse: parseBoolean,
    ui: uiStore('routingFeatureAvailable', (v) => useUIStore.getState().setRoutingFeatureAvailable(v), { autoSave: false }),
  }),
  optimizeSystemPrompt: field({ scope: 'profile', parse: parseBoolean }),
  desktopLanAccessEnabled: field({ scope: 'instance', surfaces: ['desktop'], parse: parseBoolean }),
  desktopMacMenuBarEnabled: field({ scope: 'instance', surfaces: ['desktop'], parse: parseBoolean }),
  desktopMinimizeToTrayEnabled: field({ scope: 'instance', surfaces: ['desktop'], parse: parseBoolean }),
  desktopKeepAwakeEnabled: field({ scope: 'instance', surfaces: ['desktop'], parse: parseBoolean }),
  // Fork-only: keeps the managed OpenCode process alive after the shell quits.
  desktopKeepManagedOpenCodeAliveOnQuit: field({ scope: 'instance', surfaces: ['desktop'], parse: parseBoolean }),
  // Fork-only: the Electron main refuses remote (non-local) connections when
  // this is set; upstream does not have the key.
  desktopRemoteOnly: field({ scope: 'instance', surfaces: ['desktop'], parse: parseBoolean }),
  projects: field({ scope: 'instance', parse: parseProjects }),
  activeProjectId: field({ scope: 'instance', adopt: 'bootstrap-only', parse: parseNonEmptyString }),
  approvedDirectories: field({ scope: 'instance', parse: parseStringList }),
  securityScopedBookmarks: field({ scope: 'instance', surfaces: ['desktop'], parse: parseStringList }),
  // Per-session permission modes; booleans are policies from before the modes,
  // which the server converts on its first read (upstream segb 1bc709ed0).
  permissionAutoAccept: field({
    scope: 'instance',
    parse: fromSchema(z.object({
      sessions: z.record(z.string().min(1), z.union([z.boolean(), z.enum(['ask', 'safety', 'auto'])])).catch({}),
      revision: z.number().int().nonnegative().catch(0),
    })),
  }),
  // The mode the server writes onto each new top-level session. VS Code has no
  // OpenChamber server to write it.
  permissionDefaultMode: field({
    scope: 'instance',
    surfaces: ['web', 'desktop', 'mobile'],
    parse: fromSchema(z.enum(['ask', 'safety', 'auto'])),
    ui: uiStore('permissionDefaultMode', (v) => useUIStore.getState().setPermissionDefaultMode(v)),
  }),
  // Fork-only: remote instances configured on this host (the server sanitizes
  // the entries; the parser mirrors its shape).
  remoteInstances: field({
    scope: 'instance',
    parse: fromSchema(
      z.array(z.unknown()).transform((entries) => {
        const result: NonNullable<DesktopSettings['remoteInstances']> = [];
        const seen = new Set<string>();
        for (const entry of entries) {
          if (result.length >= 64) break;
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
          const raw = entry as Record<string, unknown>;
          const id = typeof raw.id === 'string' ? raw.id.trim() : '';
          const url = typeof raw.url === 'string' ? raw.url.trim().replace(/\/+$/, '') : '';
          if (!id || id.length > 128 || !url) continue;
          if (seen.has(id)) continue;
          try { new URL(url); } catch { continue; }
          const authType = (raw as { auth?: { type?: unknown } }).auth?.type;
          seen.add(id);
          result.push({
            id,
            label: typeof raw.label === 'string' ? raw.label.trim().slice(0, 256) || id : id,
            url,
            auth: {
              type: authType === 'password' || authType === 'bearer' ? authType : 'none',
              ...(typeof (raw as { auth?: { value?: unknown } }).auth?.value === 'string'
                ? { value: (raw as { auth: { value: string } }).auth.value }
                : {}),
            },
            connectionTimeoutSec: typeof raw.connectionTimeoutSec === 'number' && Number.isFinite(raw.connectionTimeoutSec)
              ? Math.max(5, Math.min(300, Math.round(raw.connectionTimeoutSec)))
              : 30,
            enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
          });
        }
        return result;
      }).refine((entries) => entries.length > 0),
    ),
  }),
  pinnedDirectories: field({ scope: 'instance', parse: parseStringSet }),
  // Fork-only: session pins shared desktop ↔ mobile through the host settings.
  pinnedSessions: field({ scope: 'profile', parse: parseStringList }),
  pinnedSessionsByProject: field({ scope: 'profile', parse: parseStringRecordOfStringLists }),
  pinnedSessionOrder: field({ scope: 'profile', parse: parseStringList }),
  pinnedSessionOrderByProject: field({ scope: 'profile', parse: parseStringRecordOfStringLists }),

  // ── Chat and rendering (profile) ──
  showReasoningTraces: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('showReasoningTraces', (v) => useUIStore.getState().setShowReasoningTraces(v)) }),
  collapsibleThinkingBlocks: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('collapsibleThinkingBlocks', (v) => useUIStore.getState().setCollapsibleThinkingBlocks(v)) }),
  chatRenderMode: field({ scope: 'profile', parse: parseOneOf(['sorted', 'live']), ui: uiStore('chatRenderMode', (v) => useUIStore.getState().setChatRenderMode(v)) }),
  activityRenderMode: field({ scope: 'profile', parse: parseOneOf(['collapsed', 'summary']), ui: uiStore('activityRenderMode', (v) => useUIStore.getState().setActivityRenderMode(v)) }),
  // Fork-only sidebar grouping knobs: the fork server never persisted them,
  // so they stay store-local until the upstream sidebar grouping feature lands.
  sessionSortMode: field({ scope: 'device', local: true, parse: parseOneOf(['updated-desc', 'created-desc']), ui: uiStore('sessionSortMode', (v) => useUIStore.getState().setSessionSortMode(v), { autoSave: false }) }),
  sessionGroupMinVisible: field({ scope: 'device', local: true, parse: parseIntegerAtLeast(1), ui: uiStore('sessionGroupMinVisible', (v) => useUIStore.getState().setSessionGroupMinVisible(v), { autoSave: false }) }),
  sessionGroupRecentHours: field({ scope: 'device', local: true, parse: parseIntegerAtLeast(1), ui: uiStore('sessionGroupRecentHours', (v) => useUIStore.getState().setSessionGroupRecentHours(v), { autoSave: false }) }),
  userMessageRenderingMode: field({ scope: 'profile', parse: parseOneOf(['markdown', 'plain']), ui: uiStore('userMessageRenderingMode', (v) => useUIStore.getState().setUserMessageRenderingMode(v)) }),
  collapsibleUserMessages: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('collapsibleUserMessages', (v) => useUIStore.getState().setCollapsibleUserMessages(v)) }),
  stickyUserHeader: field({ scope: 'profile', perSurface: true, parse: parseBoolean, ui: uiStore('stickyUserHeader', (v) => useUIStore.getState().setStickyUserHeader(v)) }),
  promptNavigatorEnabled: field({ scope: 'profile', perSurface: true, parse: parseBoolean, ui: uiStore('promptNavigatorEnabled', (v) => useUIStore.getState().setPromptNavigatorEnabled(v)) }),
  wideChatLayoutEnabled: field({ scope: 'profile', perSurface: true, parse: parseBoolean, ui: uiStore('wideChatLayoutEnabled', (v) => useUIStore.getState().setWideChatLayoutEnabled(v)) }),
  showSplitAssistantMessageActions: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('showSplitAssistantMessageActions', (v) => useUIStore.getState().setShowSplitAssistantMessageActions(v)) }),
  showToolFileIcons: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('showToolFileIcons', (v) => useUIStore.getState().setShowToolFileIcons(v)) }),
  codeBlockLineWrap: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('codeBlockLineWrap', (v) => useUIStore.getState().setCodeBlockLineWrap(v)) }),
  showExpandedBashTools: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('showExpandedBashTools', (v) => useUIStore.getState().setShowExpandedBashTools(v)) }),
  showExpandedEditTools: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('showExpandedEditTools', (v) => useUIStore.getState().setShowExpandedEditTools(v)) }),
  timeFormatPreference: field({ scope: 'profile', parse: parseOneOf(['auto', '12h', '24h']), ui: uiStore('timeFormatPreference', (v) => useUIStore.getState().setTimeFormatPreference(v)) }),
  weekStartPreference: field({ scope: 'profile', parse: parseOneOf(['auto', 'sunday', 'monday']), ui: uiStore('weekStartPreference', (v) => useUIStore.getState().setWeekStartPreference(v)) }),
  messageStreamTransport: field({ scope: 'profile', parse: parseOneOf(['auto', 'ws', 'sse']), ui: configField('settingsMessageStreamTransport') }),
  diffLayoutPreference: field({ scope: 'profile', parse: parseOneOf(['dynamic', 'inline', 'side-by-side']), ui: uiStore('diffLayoutPreference', (v) => useUIStore.getState().setDiffLayoutPreference(v)) }),
  diffViewMode: field({ scope: 'profile', parse: parseOneOf(['single', 'stacked']), ui: uiStore('diffViewMode', (v) => useUIStore.getState().setDiffViewMode(v)) }),
  gitChangesViewMode: field({ scope: 'profile', parse: parseOneOf(['flat', 'tree']), ui: uiStore('gitChangesViewMode', (v) => useUIStore.getState().setGitChangesViewMode(v)) }),
  gitmojiEnabled: field({ scope: 'profile', parse: parseBoolean }),
  defaultFileViewerPreview: field({ scope: 'profile', parse: parseBoolean }),
  directoryShowHidden: field({
    scope: 'profile',
    parse: parseBoolean,
    ui: { read: () => readStoredBooleanFlag(DIRECTORY_SHOW_HIDDEN_STORAGE_KEY), write: (v) => setDirectoryShowHidden(v, { persist: false }), autoSave: false },
  }),
  filesViewShowGitignored: field({
    scope: 'profile',
    parse: parseBoolean,
    ui: { read: () => readStoredBooleanFlag(FILES_VIEW_SHOW_GITIGNORED_STORAGE_KEY), write: (v) => setFilesViewShowGitignored(v, { persist: false }), autoSave: false },
  }),
  allowPromptingSubagentSessions: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('allowPromptingSubagentSessions', (v) => useUIStore.getState().setAllowPromptingSubagentSessions(v)) }),

  // ── Sessions ──
  showDeletionDialog: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('showDeletionDialog', (v) => useUIStore.getState().setShowDeletionDialog(v)) }),
  autoDeleteEnabled: field({ scope: 'instance', parse: parseBoolean, ui: uiStore('autoDeleteEnabled', (v) => useUIStore.getState().setAutoDeleteEnabled(v)) }),
  autoSaveEnabled: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('autoSaveEnabled', (v) => useUIStore.getState().setAutoSaveEnabled(v)) }),
  autoDeleteAfterDays: field({ scope: 'instance', parse: parseIntegerInRange(1, 365), ui: uiStore('autoDeleteAfterDays', (v) => useUIStore.getState().setAutoDeleteAfterDays(v)) }),
  // Apply scope before action so leaving archived-only mode can restore an incoming archive choice.
  sessionRetentionOnlyArchived: field({ scope: 'instance', parse: parseBoolean, ui: uiStore('sessionRetentionOnlyArchived', (v) => useUIStore.getState().setSessionRetentionOnlyArchived(v)) }),
  sessionRetentionAction: field({ scope: 'instance', parse: parseOneOf(['archive', 'delete']), ui: uiStore('sessionRetentionAction', (v) => useUIStore.getState().setSessionRetentionAction(v)) }),
  autoCreateWorktree: field({ scope: 'profile', parse: parseBoolean }),
  sessionGoalEnabled: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('sessionGoalEnabled', (v) => useUIStore.getState().setSessionGoalEnabled(v)) }),
  sessionGoalDefaultBudgetEnabled: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('sessionGoalDefaultBudgetEnabled', (v) => useUIStore.getState().setSessionGoalDefaultBudgetEnabled(v)) }),
  sessionGoalDefaultBudget: field({ scope: 'profile', parse: parsePositiveInteger, ui: uiStore('sessionGoalDefaultBudget', (v) => useUIStore.getState().setSessionGoalDefaultBudget(v)) }),
  sessionRecapEnabled: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('sessionRecapEnabled', (v) => useUIStore.getState().setSessionRecapEnabled(v)) }),
  sessionSuggestionEnabled: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('sessionSuggestionEnabled', (v) => useUIStore.getState().setSessionSuggestionEnabled(v)) }),
  defaultGitIdentityId: field({ scope: 'instance', parse: parseTrimmedString }),
  openInAppId: field({ scope: 'instance', parse: parseTrimmedString }),

  // ── Notifications ──
  nativeNotificationsEnabled: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('nativeNotificationsEnabled', (v) => useUIStore.getState().setNativeNotificationsEnabled(v)) }),
  notificationMode: field({ scope: 'profile', parse: parseOneOf(['always', 'hidden-only']), ui: uiStore('notificationMode', (v) => useUIStore.getState().setNotificationMode(v)) }),
  notifyOnSubtasks: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('notifyOnSubtasks', (v) => useUIStore.getState().setNotifyOnSubtasks(v)) }),
  notifyOnCompletion: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('notifyOnCompletion', (v) => useUIStore.getState().setNotifyOnCompletion(v)) }),
  notifyOnError: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('notifyOnError', (v) => useUIStore.getState().setNotifyOnError(v)) }),
  notifyOnQuestion: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('notifyOnQuestion', (v) => useUIStore.getState().setNotifyOnQuestion(v)) }),
  notificationTemplates: field({ scope: 'profile', parse: parseNotificationTemplates, ui: uiStore('notificationTemplates', (v) => useUIStore.getState().setNotificationTemplates(v)) }),
  reportUsage: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('reportUsage', (v) => useUIStore.getState().setReportUsage(v)) }),

  // ── Summarization ──
  summarizeLastMessage: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('summarizeLastMessage', (v) => useUIStore.getState().setSummarizeLastMessage(v)) }),
  summaryThreshold: field({ scope: 'profile', parse: parseIntegerAtLeast(0), ui: uiStore('summaryThreshold', (v) => useUIStore.getState().setSummaryThreshold(v)) }),
  summaryLength: field({ scope: 'profile', parse: parseIntegerAtLeast(10), ui: uiStore('summaryLength', (v) => useUIStore.getState().setSummaryLength(v)) }),
  maxLastMessageLength: field({ scope: 'profile', parse: parseIntegerAtLeast(10), ui: uiStore('maxLastMessageLength', (v) => useUIStore.getState().setMaxLastMessageLength(v)) }),

  // ── Usage page ──
  usageAutoRefresh: field({ scope: 'profile', parse: parseBoolean }),
  usageRefreshIntervalMs: field({ scope: 'profile', parse: parseIntegerInRange(30_000, 300_000) }),
  usageDisplayMode: field({ scope: 'profile', parse: parseOneOf(['usage', 'remaining']) }),
  usageShowPredValues: field({ scope: 'profile', parse: parseBoolean }),
  usageDropdownProviders: field({ scope: 'profile', parse: parseStringList }),
  usageSelectedModels: field({ scope: 'profile', parse: parseStringRecordOfStringLists }),
  usageCollapsedFamilies: field({ scope: 'profile', parse: parseStringRecordOfStringLists }),
  usageExpandedFamilies: field({ scope: 'profile', parse: parseStringRecordOfStringLists }),
  usageModelGroups: field({ scope: 'profile', parse: parseUsageModelGroups }),

  // ── Tunnels (instance) ──
  tunnelProvider: field({ scope: 'instance', parse: mapParser(parseTrimmedString, (value) => (value ? value.toLowerCase() : undefined)) }),
  tunnelMode: field({ scope: 'instance', parse: fromSchema(z.string().transform((value) => value.trim().toLowerCase()).pipe(z.enum(['quick', 'managed-remote', 'managed-local']))) }),
  tunnelBootstrapTtlMs: field({ scope: 'instance', parse: parseNullableFiniteNumber }),
  tunnelSessionTtlMs: field({ scope: 'instance', parse: parseFiniteNumber }),
  managedLocalTunnelConfigPath: field({ scope: 'instance', parse: parseNullableTrimmedPath }),
  managedRemoteTunnelHostname: field({ scope: 'instance', parse: parseTrimmedString }),
  managedRemoteTunnelToken: field({ scope: 'instance', secret: true, parse: parseNullableTrimmedString }),
  hasManagedRemoteTunnelToken: field({ scope: 'instance', computed: true, parse: parseBoolean }),
  managedRemoteTunnelPresets: field<ManagedRemoteTunnelPreset[]>({ scope: 'instance', parse: parseManagedRemoteTunnelPresets }),
  managedRemoteTunnelSelectedPresetId: field({ scope: 'instance', parse: parseTrimmedString }),
  // Fork: not `secret` — the fork's tunnel page still reads the tokens back
  // from the settings document; upstream moved that to the tunnel status
  // endpoint before making the key write-only.
  managedRemoteTunnelPresetTokens: field({ scope: 'instance', parse: parseManagedRemoteTunnelPresetTokens }),

  // ── Models and agents ──
  defaultModel: field({ scope: 'profile', parse: parseNonEmptyString }),
  defaultVariant: field({ scope: 'profile', parse: parseNonEmptyString }),
  defaultAgent: field({ scope: 'profile', parse: parseNonEmptyString }),
  smallModelUseDefault: field({ scope: 'profile', parse: parseBoolean }),
  smallModelOverride: field({ scope: 'profile', parse: parseNonEmptyString }),
  walkthroughModelOverride: field({ scope: 'profile', parse: parseNonEmptyString }),
  zenModel: field({ scope: 'profile', parse: parseNonEmptyString }),
  // Fork keeps gitProviderId/gitModelId alive (the commit-model picker reads
  // them); upstream dropped the pair for smallModelOverride.
  gitProviderId: field({ scope: 'profile', parse: parseTrimmedString }),
  gitModelId: field({ scope: 'profile', parse: parseTrimmedString }),
  // The model-prefs auto-save owns these with its own debounce.
  favoriteModels: field<ModelRef[]>({ scope: 'profile', parse: parseModelRefs(64), ui: uiStore('favoriteModels', setUi('favoriteModels'), { autoSave: false }) }),
  hiddenModels: field<ModelRef[]>({ scope: 'profile', parse: parseModelRefs(1024), ui: uiStore('hiddenModels', setUi('hiddenModels'), { autoSave: false }) }),
  collapsedModelProviders: field({ scope: 'profile', parse: parseStringSet, ui: uiStore('collapsedModelProviders', setUi('collapsedModelProviders'), { autoSave: false }) }),
  modelPickerLayoutByServerId: field({ scope: 'profile', parse: parseModelPickerLayoutByServerId, ui: uiStore('modelPickerLayoutByServerId', setUi('modelPickerLayoutByServerId'), { autoSave: false }) }),
  recentModels: field<ModelRef[]>({ scope: 'profile', parse: parseModelRefs(16), ui: uiStore('recentModels', setUi('recentModels'), { autoSave: false }) }),
  recentAgents: field({ scope: 'profile', parse: parseStringSet, ui: uiStore('recentAgents', setUi('recentAgents'), { autoSave: false }) }),
  recentEfforts: field({ scope: 'profile', parse: parseRecentEfforts, ui: uiStore('recentEfforts', setUi('recentEfforts'), { autoSave: false }) }),

  // ── Composer (profile) ──
  inputSpellcheckEnabled: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('inputSpellcheckEnabled', (v) => useUIStore.getState().setInputSpellcheckEnabled(v)) }),
  followUpBehavior: field({
    scope: 'profile',
    parse: parseFollowUpBehavior,
    ui: {
      read: () => useMessageQueueStore.getState().followUpBehavior,
      write: (v) => useMessageQueueStore.getState().setFollowUpBehavior(v),
      autoSave: false,
    },
  }),
  /** Legacy boolean that `followUpBehavior` absorbs at parse time. */
  queueModeEnabled: field({ scope: 'profile', parse: parseBoolean }),
  draftStarters: field<DraftStarterRef[]>({
    scope: 'profile',
    parse: parseDraftStarters,
    ui: {
      read: () => useUIStore.getState().globalDraftStarters ?? undefined,
      write: (value, snapshot) => useUIStore.getState().setGlobalDraftStarters(withOfferedBuiltInStarters(value, snapshot)),
      // useDraftStarters writes the list together with its marker.
      autoSave: false,
    },
  }),
  draftStartersScheduleTaskAdded: field({ scope: 'profile', parse: parseBoolean }),
  draftStartersVisible: field({ scope: 'profile', parse: parseBoolean, ui: uiStore('draftStartersVisible', (v) => useUIStore.getState().setDraftStartersVisible(v)) }),
  // Fork: input-history scope/limit live in `useInputHistoryStore`'s own
  // persistence; they join the registry when that store migrates onto the
  // shared settings path (upstream keys: inputHistoryScope, inputHistoryLimit).

  // ── Typography (profile; sizes per surface) ──
  fontSize: field({ scope: 'profile', perSurface: true, parse: parseFiniteNumber, ui: uiStore('fontSize', (v) => useUIStore.getState().setFontSize(v)) }),
  terminalFontSize: field({ scope: 'profile', perSurface: true, parse: parseFiniteNumber, ui: uiStore('terminalFontSize', (v) => useUIStore.getState().setTerminalFontSize(v)) }),
  editorFontSize: field({ scope: 'profile', perSurface: true, parse: parseFiniteNumber, ui: uiStore('editorFontSize', (v) => useUIStore.getState().setEditorFontSize(v)) }),
  uiFont: field({ scope: 'profile', parse: parseUiFont, ui: uiStore('uiFont', (v) => useUIStore.getState().setUiFont(v)) }),
  monoFont: field({ scope: 'profile', parse: parseMonoFont, ui: uiStore('monoFont', (v) => useUIStore.getState().setMonoFont(v)) }),
  padding: field({ scope: 'profile', perSurface: true, parse: parseFiniteNumber, ui: uiStore('padding', (v) => useUIStore.getState().setPadding(v)) }),
  cornerRadius: field({ scope: 'profile', perSurface: true, parse: parseFiniteNumber, ui: uiStore('cornerRadius', (v) => useUIStore.getState().setCornerRadius(v)) }),

  // ── Behavior (profile) ──
  globalBehaviorPrompt: field({ scope: 'profile', parse: parseTextUpTo(1024 * 1024) }),
  responseStyleEnabled: field({ scope: 'profile', parse: parseBoolean }),
  responseStylePreset: field({ scope: 'profile', parse: parseOneOf(['concise', 'detailed', 'mentor', 'pushback', 'noFiller', 'matchEnergy', 'warmPeer', 'custom']) }),
  responseStyleCustomInstructions: field({ scope: 'profile', parse: parseTextUpTo(50_000) }),

  // The server serves the PWA manifest from these, so they are facts about
  // the instance even though only the installed web app shows them.
  pwaAppName: field({ scope: 'instance', surfaces: ['web'], parse: parsePwaAppName }),
  pwaOrientation: field({ scope: 'instance', surfaces: ['web'], parse: parseOneOf(['system', 'portrait', 'landscape']) }),

  // ── Speech (profile; fork keeps the legacy provider names) ──
  sttProvider: field({ scope: 'instance', parse: parseForkSttProvider, ui: configField('sttProvider') }),
  sttServerUrl: field({ scope: 'instance', parse: parseTrimmedStringUpTo(2048), ui: configField('sttServerUrl') }),
  sttModel: field({ scope: 'instance', parse: parseTrimmedStringUpTo(256), ui: configField('sttModel') }),
  wasmSttModel: field({ scope: 'instance', parse: parseTrimmedStringUpTo(256), ui: configField('wasmSttModel') }),
  sttLanguage: field({ scope: 'profile', parse: parseTrimmedStringUpTo(64), ui: configField('sttLanguage') }),
  sttSilenceThresholdDb: field({ scope: 'profile', parse: parseFiniteNumber, ui: configField('sttSilenceThresholdDb') }),
  sttSilenceHoldMs: field({ scope: 'profile', parse: parseIntegerAtLeast(0), ui: configField('sttSilenceHoldMs') }),
  sttTranscribeOnStop: field({ scope: 'profile', parse: parseBoolean, ui: configField('sttTranscribeOnStop') }),

  // ── Instance extras ──
  skillCatalogs: field<SkillCatalogConfig[]>({ scope: 'instance', parse: parseSkillCatalogs }),
  messageLimit: field({ scope: 'profile', parse: parseIntegerAtLeast(1) }),
  // Fork-only: the desktop shell's UI safeStorage bag (display mode, locale,
  // sidebar state, …). The host file carries it because Desktop's loopback
  // port changes per launch.
  localStore: field({ scope: 'instance', parse: fromSchema(z.record(z.string(), z.string())) }),
  localStorePatch: field({
    scope: 'instance',
    parse: fromSchema(z.object({
      set: z.record(z.string(), z.string()).optional(),
      remove: z.array(z.string()).optional(),
    })),
  }),

  // ── Device fields: the fork still round-trips these through the server, so
  // they stay writable until the client migration stops sending them; the
  // scope records the upstream intent. ──
  mobileKeyboardMode: field({
    scope: 'device',
    surfaces: ['mobile'],
    parse: parseMobileKeyboardModeValue,
    ui: uiStore('mobileKeyboardMode', (v) => useUIStore.getState().setMobileKeyboardMode(v)),
  }),
  desktopWindowControlsPosition: field<DesktopWindowControlsPosition>({
    scope: 'device',
    surfaces: ['desktop'],
    parse: parseDesktopWindowControlsPosition,
    ui: uiStore('desktopWindowControlsPosition', (v) => useUIStore.getState().setDesktopWindowControlsPosition(v)),
  }),
  desktopWindowControlsStyle: field<DesktopWindowControlsStyle>({
    scope: 'device',
    surfaces: ['desktop'],
    parse: parseOneOf(['classic', 'traffic-lights']),
    ui: uiStore('desktopWindowControlsStyle', (v) => useUIStore.getState().setDesktopWindowControlsStyle(v)),
  }),
  inputBarOffset: field({ scope: 'device', surfaces: ['mobile', 'web'], parse: parseFiniteNumber, ui: uiStore('inputBarOffset', (v) => useUIStore.getState().setInputBarOffset(v)) }),

  // ── Device fields the server already rejects: the live copy is the local
  // store and no client write reaches the disk. ──
  dockBadgeEnabled: field({ scope: 'device', surfaces: ['desktop'], local: true, parse: parseBoolean, ui: uiStore('dockBadgeEnabled', (v) => useUIStore.getState().setDockBadgeEnabled(v), { autoSave: false }) }),
  multiRunEnabled: field({ scope: 'device', local: true, parse: parseBoolean, ui: uiStore('multiRunEnabled', (v) => useUIStore.getState().setMultiRunEnabled(v), { autoSave: false }) }),
};

export type SettingsKey = keyof DesktopSettings;

/** Keys whose value belongs to this install and therefore never goes to the server. */
export const isDeviceSettingsKey = (key: SettingsKey): boolean => SETTINGS_REGISTRY[key].scope === 'device';

type SettingsValue = DesktopSettings[SettingsKey];

/** The erased view the generic loops iterate; assignable because the bindings use method syntax. */
const specOf = (key: SettingsKey): SettingsFieldSpec<SettingsValue> => SETTINGS_REGISTRY[key];

export const SETTINGS_KEYS: SettingsKey[] = Object.keys(SETTINGS_REGISTRY) as SettingsKey[];

/** Keys the client may send to the server: not computed, not this install's local-only state. */
export const isWritableSettingsKey = (key: SettingsKey): boolean =>
  !SETTINGS_REGISTRY[key].computed && !(SETTINGS_REGISTRY[key].scope === 'device' && SETTINGS_REGISTRY[key].local);

/**
 * Parse an untrusted document (server response, bridge payload) into the
 * trusted shape. Keys not in the registry are dropped; a value a parser rejects
 * is dropped as if absent — never replaced by a default.
 */
const rawDocumentSchema = z.record(z.string(), z.unknown());

export const parseSettingsDocument = (payload: unknown): DesktopSettings | null => {
  const document = rawDocumentSchema.safeParse(payload);
  if (!document.success) {
    return null;
  }
  const raw = document.data;
  const result: DesktopSettings = {};
  for (const key of SETTINGS_KEYS) {
    const spec = specOf(key);
    const parsed = spec.parse(raw[key], raw);
    if (parsed !== undefined) {
      Object.assign(result, { [key]: parsed });
    }
  }
  return result;
};

const isSameValue = (left: SettingsValue, right: SettingsValue): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return JSON.stringify(left) === JSON.stringify(right);
};

/**
 * Copy the fields a snapshot carries into their live stores. A field the
 * snapshot omits is left alone ("missing is not default"); a field whose
 * store already holds the value is not written again.
 */
export const applySettingsToStores = (snapshot: DesktopSettings): void => {
  for (const key of SETTINGS_KEYS) {
    const spec = specOf(key);
    if (!spec.ui) continue;
    const value = snapshot[key];
    if (value === undefined) continue;
    if (isSameValue(spec.ui.read(), value)) continue;
    spec.ui.write(value as SettingsValue, snapshot);
  }
};

/** Keys whose backing store the auto-save watches. */
export const AUTO_SAVE_KEYS = SETTINGS_KEYS.filter((key) => specOf(key).ui?.autoSave === true);

/** Current store values for the auto-saved keys (undefined for unset). */
export const readAutoSaveSnapshot = (): DesktopSettings => {
  const snapshot: DesktopSettings = {};
  for (const key of AUTO_SAVE_KEYS) {
    const spec = specOf(key);
    const value = spec.ui?.read();
    if (value !== undefined) Object.assign(snapshot, { [key]: value });
  }
  return snapshot;
};

/** Keys the per-runtime browser mirror carries: everything the server owns for the user, minus secrets and computed flags. */
export const MIRRORED_KEYS = SETTINGS_KEYS.filter((key) => {
  const spec = specOf(key);
  return spec.scope !== 'device' && !spec.secret && !spec.computed && !spec.local;
});

/**
 * Device state that only ever lived in `useUIStore`'s persisted slice. Listed
 * so the registry accounts for every persisted key; none of these crosses the
 * wire, so they carry no parser. `globalDraftStarters` is the store's name for
 * the `draftStarters` field and is therefore not here.
 */
export const LOCAL_DEVICE_KEYS = [
  'theme',
  'isSidebarOpen',
  'sidebarWidth',
  'isRightSidebarOpen',
  'contextPanelByDirectory',
  'contextPanelScope',
  'contextRailOrder',
  'notesPanelHeight',
  'todoPanelHeight',
  'messageQueueExpanded',
  'isSessionSwitcherOpen',
  'isSessionDropdownOpen',
  'activeMainTab',
  'sidebarSection',
  'settingsPage',
  'settingsHasOpenedOnce',
  'settingsProjectsSelectedId',
  'settingsRemoteInstancesSelectedId',
  'isSessionCreateDialogOpen',
  'autoCollapseThinking',
  'autoCollapseThinkingThreshold',
  'autoDeleteLastRunAt',
  'diffWrapLines',
  'showTerminalQuickKeysOnDesktop',
  'sessionTabsEnabled',
  'streamingAutoFollow',
  'doubleClickRenameSession',
  'persistChatDraft',
  'showOpenCodeUpdateNotifications',
  'showTurnChangedFiles',
  'toolJsonViewMode',
  'showMobileSessionStatusBar',
  'isMobileSessionStatusBarCollapsed',
  'shortcutOverrides',
  'fileEditorKeymap',
] as const;

/**
 * Instance facts the Electron main process writes straight into
 * `settings.json`. The server keeps them when merging and never accepts them
 * from a client. The fork's flat `splash*` colours are client-written and are
 * regular registry keys above, not here.
 */
export const DESKTOP_SHELL_KEYS = [
  'desktopHosts',
  'desktopInstallId',
  'desktopLocalPort',
  'desktopSshInstances',
  'desktopWindowState',
] as const;

/** Shape of one field in the generated JSON snapshot the server and the VS Code bridge consume. */
export type SettingsRegistrySnapshotField = {
  scope: SettingsScope;
  perSurface?: true;
  surfaces?: readonly SettingsSurface[];
  adopt?: 'bootstrap-only';
  derived?: true;
  secret?: true;
  computed?: true;
  /** Lives only in the local store; never crosses the wire. */
  local?: true;
  /** Written by the desktop shell straight into the file; never by a client. */
  owner?: 'desktop-shell';
};

export type SettingsRegistrySnapshot = {
  version: 1;
  fields: Record<string, SettingsRegistrySnapshotField>;
};

export const buildSettingsRegistrySnapshot = (): SettingsRegistrySnapshot => {
  const fields: Record<string, SettingsRegistrySnapshotField> = {};
  for (const key of SETTINGS_KEYS) {
    const spec = specOf(key);
    const entry: SettingsRegistrySnapshotField = { scope: spec.scope };
    if (spec.perSurface) entry.perSurface = true;
    if (spec.surfaces) entry.surfaces = spec.surfaces;
    if (spec.adopt) entry.adopt = spec.adopt;
    if (spec.derived) entry.derived = true;
    if (spec.secret) entry.secret = true;
    if (spec.computed) entry.computed = true;
    if (spec.local) entry.local = true;
    fields[key] = entry;
  }
  for (const key of LOCAL_DEVICE_KEYS) {
    fields[key] = { scope: 'device', local: true };
  }
  for (const key of DESKTOP_SHELL_KEYS) {
    fields[key] = { scope: 'instance', owner: 'desktop-shell', surfaces: ['desktop'] };
  }
  return { version: 1, fields };
};
