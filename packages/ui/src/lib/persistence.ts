import type { DesktopSettings } from '@/lib/desktop';
import { createProjectIdFromPath } from '@/lib/projectId';
import { useUIStore } from '@/stores/useUIStore';
import { isMonoFontOption, isUiFontOption } from '@/lib/fontOptions';
import { useMessageQueueStore } from '@/stores/messageQueueStore';
import { setDirectoryShowHidden } from '@/lib/directoryShowHidden';
import { setFilesViewShowGitignored } from '@/lib/filesViewShowGitignored';
import { loadAppearancePreferences, applyAppearancePreferences } from '@/lib/appearancePersistence';
import { sanitizeStarterRefs } from '@/lib/draftStarters';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { normalizeMobileKeyboardMode, setStoredMobileKeyboardMode } from '@/lib/mobileKeyboardMode';
import { resolvePersistedFollowUpBehavior } from '@/lib/followUpBehavior';
import {
  areModelPickerLayoutMapsEqual,
  migrateModelPickerLayoutState,
  sanitizeModelPickerLayoutByServerId,
} from '@/lib/modelPickerLayout';
import {
  SESSION_PINNED_BY_PROJECT_STORAGE_KEY,
  SESSION_PINNED_ORDER_BY_PROJECT_STORAGE_KEY,
  SESSION_PINNED_ORDER_STORAGE_KEY,
  SESSION_PINNED_STORAGE_KEY,
  resetHostSessionPinsApplied,
  sanitizePinnedSessionIds,
  sanitizePinnedSessionsByKey,
  stripSessionPinSettingsIfHostPending,
} from '@/lib/sessionPinSettings';
import {
  getRuntimeKey,
  subscribeRuntimeEndpointChanged,
  subscribeRuntimeEndpointWillChange,
} from '@/lib/runtime-switch';
import { hydrateLocalStore } from '@/stores/utils/safeStorage';

const persistToLocalStorage = (settings: DesktopSettings) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (settings.themeId) {
    localStorage.setItem('selectedThemeId', settings.themeId);
  }
  if (settings.themeVariant) {
    localStorage.setItem('selectedThemeVariant', settings.themeVariant);
  }
  if (settings.lightThemeId) {
    localStorage.setItem('lightThemeId', settings.lightThemeId);
  }
  if (settings.darkThemeId) {
    localStorage.setItem('darkThemeId', settings.darkThemeId);
  }
  if (typeof settings.useSystemTheme === 'boolean') {
    localStorage.setItem('useSystemTheme', String(settings.useSystemTheme));
  }
  if (settings.lastDirectory) {
    localStorage.setItem('lastDirectory', settings.lastDirectory);
  }
  if (settings.homeDirectory) {
    localStorage.setItem('homeDirectory', settings.homeDirectory);
    // Electron's preload exposes __OPENCHAMBER_HOME__ as a read-only
    // contextBridge property; assignment throws TypeError there. In VSCode
    // webview and plain web runtime the property is writable. Swallow the
    // error in Electron — preload already seeded the value correctly.
    try {
      window.__OPENCHAMBER_HOME__ = settings.homeDirectory;
    } catch {
      /* read-only contextBridge property — leave preload-seeded value */
    }
  }
  if (Array.isArray(settings.projects) && settings.projects.length > 0) {
    localStorage.setItem('projects', JSON.stringify(settings.projects));
  } else {
    localStorage.removeItem('projects');
  }
  if (settings.activeProjectId) {
    localStorage.setItem('activeProjectId', settings.activeProjectId);
  } else {
    localStorage.removeItem('activeProjectId');
  }
  if (Array.isArray(settings.pinnedDirectories) && settings.pinnedDirectories.length > 0) {
    localStorage.setItem('pinnedDirectories', JSON.stringify(settings.pinnedDirectories));
  } else {
    localStorage.removeItem('pinnedDirectories');
  }
  // Only touch session-pin keys when the host actually persisted them.
  // Omitting the field must not wipe local pins before one-time migration.
  if (Array.isArray(settings.pinnedSessions)) {
    localStorage.setItem(SESSION_PINNED_STORAGE_KEY, JSON.stringify(settings.pinnedSessions));
  }
  if (settings.pinnedSessionsByProject && typeof settings.pinnedSessionsByProject === 'object') {
    localStorage.setItem(
      SESSION_PINNED_BY_PROJECT_STORAGE_KEY,
      JSON.stringify(settings.pinnedSessionsByProject),
    );
  }
  if (Array.isArray(settings.pinnedSessionOrder)) {
    localStorage.setItem(SESSION_PINNED_ORDER_STORAGE_KEY, JSON.stringify(settings.pinnedSessionOrder));
  }
  if (settings.pinnedSessionOrderByProject && typeof settings.pinnedSessionOrderByProject === 'object') {
    localStorage.setItem(
      SESSION_PINNED_ORDER_BY_PROJECT_STORAGE_KEY,
      JSON.stringify(settings.pinnedSessionOrderByProject),
    );
  }

  if (Array.isArray(settings.projects) && settings.projects.length > 0) {
    const collapsed = settings.projects
      .filter((project) => (project as unknown as { sidebarCollapsed?: boolean }).sidebarCollapsed === true)
      .map((project) => project.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (collapsed.length > 0) {
      localStorage.setItem('oc.sessions.projectCollapse', JSON.stringify(collapsed));
    } else {
      localStorage.removeItem('oc.sessions.projectCollapse');
    }
  }
  if (typeof settings.gitmojiEnabled === 'boolean') {
    localStorage.setItem('gitmojiEnabled', String(settings.gitmojiEnabled));
  } else {
    localStorage.removeItem('gitmojiEnabled');
  }
  if (typeof settings.directoryShowHidden === 'boolean') {
    localStorage.setItem('directoryTreeShowHidden', settings.directoryShowHidden ? 'true' : 'false');
  }
  if (typeof settings.filesViewShowGitignored === 'boolean') {
    localStorage.setItem('filesViewShowGitignored', settings.filesViewShowGitignored ? 'true' : 'false');
  }
  if (typeof settings.openInAppId === 'string' && settings.openInAppId.length > 0) {
    localStorage.setItem('openInAppId', settings.openInAppId);
  }
  if (typeof settings.pwaAppName === 'string') {
    const normalized = settings.pwaAppName.trim().replace(/\s+/g, ' ').slice(0, 64);
    if (normalized.length > 0) {
      localStorage.setItem('openchamber.pwaName', normalized);
    } else {
      localStorage.removeItem('openchamber.pwaName');
    }
  }
  if (typeof settings.mobileKeyboardMode === 'string') {
    setStoredMobileKeyboardMode(settings.mobileKeyboardMode);
  }
  if (
    settings.sttProvider === 'browser'
    || settings.sttProvider === 'server'
    || settings.sttProvider === 'wasm'
  ) {
    localStorage.setItem('sttProvider', settings.sttProvider);
  }
  if (typeof settings.sttServerUrl === 'string') {
    localStorage.setItem('sttServerUrl', settings.sttServerUrl);
  }
  if (typeof settings.sttModel === 'string') {
    localStorage.setItem('sttModel', settings.sttModel);
  }
  if (typeof settings.wasmSttModel === 'string') {
    localStorage.setItem('wasmSttModel', settings.wasmSttModel);
  }
  if (typeof settings.sttLanguage === 'string') {
    localStorage.setItem('sttLanguage', settings.sttLanguage);
  }
  if (typeof settings.sttSilenceThresholdDb === 'number' && Number.isFinite(settings.sttSilenceThresholdDb)) {
    localStorage.setItem('sttSilenceThresholdDb', String(settings.sttSilenceThresholdDb));
  }
  if (typeof settings.sttSilenceHoldMs === 'number' && Number.isFinite(settings.sttSilenceHoldMs)) {
    localStorage.setItem('sttSilenceHoldMs', String(settings.sttSilenceHoldMs));
  }
  if (typeof settings.sttTranscribeOnStop === 'boolean') {
    localStorage.setItem('sttTranscribeOnStop', String(settings.sttTranscribeOnStop));
  }
};

const dispatchSettingsSynced = (settings: DesktopSettings): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent<DesktopSettings>('openchamber:settings-synced', { detail: settings }));
};

type PersistApi = {
  hasHydrated?: () => boolean;
  onFinishHydration?: (callback: () => void) => (() => void) | undefined;
};

const sanitizeSkillCatalogs = (value: unknown): DesktopSettings['skillCatalogs'] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result: NonNullable<DesktopSettings['skillCatalogs']> = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;

    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const source = typeof candidate.source === 'string' ? candidate.source.trim() : '';
    const subpath = typeof candidate.subpath === 'string' ? candidate.subpath.trim() : '';
    const gitIdentityId = typeof candidate.gitIdentityId === 'string' ? candidate.gitIdentityId.trim() : '';

    if (!id || !label || !source) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    result.push({
      id,
      label,
      source,
      ...(subpath ? { subpath } : {}),
      ...(gitIdentityId ? { gitIdentityId } : {}),
    });
  }

  return result;
};

const areModelRefsEqual = (
  left: Array<{ providerID: string; modelID: string }>,
  right: Array<{ providerID: string; modelID: string }>,
): boolean => (
  left.length === right.length
  && left.every((item, index) => item.providerID === right[index]?.providerID && item.modelID === right[index]?.modelID)
);

const areStringArraysEqual = (left: string[], right: string[]): boolean => (
  left.length === right.length && left.every((value, index) => value === right[index])
);

const sanitizeStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return Array.from(new Set(
    value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0),
  ));
};

const sanitizeRecentEfforts = (value: unknown): Record<string, string[]> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string[]> = {};
  for (const [key, variants] of Object.entries(value)) {
    if (!key || !Array.isArray(variants)) continue;
    const sanitized = sanitizeStringArray(variants);
    if (sanitized && sanitized.length > 0) {
      result[key] = sanitized.slice(0, 5);
    }
  }
  return result;
};

const areRecentEffortsEqual = (left: Record<string, string[]>, right: Record<string, string[]>): boolean => {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Array.isArray(right[key]) && areStringArraysEqual(left[key], right[key]));
};

const HEX_COLOR_PATTERN = /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/;

const normalizeIconBackground = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
};

const sanitizeProjects = (value: unknown): DesktopSettings['projects'] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result: NonNullable<DesktopSettings['projects']> = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;

    const rawPath = typeof candidate.path === 'string' ? candidate.path.trim() : '';
    if (!rawPath) continue;

    const normalizedPath = rawPath === '/' ? rawPath : rawPath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalizedPath) continue;

    const id = createProjectIdFromPath(normalizedPath);
    if (!id) continue;

    if (seenIds.has(id) || seenPaths.has(normalizedPath)) continue;
    seenIds.add(id);
    seenPaths.add(normalizedPath);

    const project: NonNullable<DesktopSettings['projects']>[number] = {
      id,
      path: normalizedPath,
    };

    if (typeof candidate.label === 'string' && candidate.label.trim().length > 0) {
      project.label = candidate.label.trim();
    }
    if (typeof candidate.icon === 'string' && candidate.icon.trim().length > 0) {
      project.icon = candidate.icon.trim();
    }
    if (candidate.iconImage === null) {
      (project as unknown as Record<string, unknown>).iconImage = null;
    } else if (candidate.iconImage && typeof candidate.iconImage === 'object') {
      const iconImage = candidate.iconImage as Record<string, unknown>;
      const mime = typeof iconImage.mime === 'string' ? iconImage.mime.trim() : '';
      const updatedAt = typeof iconImage.updatedAt === 'number' && Number.isFinite(iconImage.updatedAt)
        ? Math.max(0, Math.round(iconImage.updatedAt))
        : 0;
      const source = iconImage.source === 'custom' || iconImage.source === 'auto'
        ? iconImage.source
        : null;
      if (mime && updatedAt > 0 && source) {
        (project as unknown as Record<string, unknown>).iconImage = { mime, updatedAt, source };
      }
    }
    if (typeof candidate.color === 'string' && candidate.color.trim().length > 0) {
      project.color = candidate.color.trim();
    }
    if (candidate.iconBackground === null) {
      (project as unknown as Record<string, unknown>).iconBackground = null;
    } else {
      const iconBackground = normalizeIconBackground(candidate.iconBackground);
      if (iconBackground) {
        (project as unknown as Record<string, unknown>).iconBackground = iconBackground;
      }
    }
    if (typeof candidate.addedAt === 'number' && Number.isFinite(candidate.addedAt) && candidate.addedAt >= 0) {
      project.addedAt = candidate.addedAt;
    }
    if (
      typeof candidate.lastOpenedAt === 'number' &&
      Number.isFinite(candidate.lastOpenedAt) &&
      candidate.lastOpenedAt >= 0
    ) {
      project.lastOpenedAt = candidate.lastOpenedAt;
    }
    if (typeof candidate.sidebarCollapsed === 'boolean') {
      (project as unknown as Record<string, unknown>).sidebarCollapsed = candidate.sidebarCollapsed;
    }
    if (candidate.pinned === true) {
      (project as unknown as Record<string, unknown>).pinned = true;
    }
    if (typeof candidate.serverId === 'string' && candidate.serverId.trim().length > 0) {
      (project as unknown as Record<string, unknown>).serverId = candidate.serverId.trim();
    }
    if (typeof candidate.defaultModel === 'string') {
      const trimmed = candidate.defaultModel.trim();
      if (trimmed.includes('/') && trimmed.indexOf('/') > 0 && trimmed.indexOf('/') < trimmed.length - 1) {
        (project as unknown as Record<string, unknown>).defaultModel = trimmed;
      }
    }
    result.push(project);
  }

  return result.length > 0 ? result : undefined;
};

const sanitizeManagedRemoteTunnelPresets = (value: unknown): DesktopSettings['managedRemoteTunnelPresets'] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result: NonNullable<DesktopSettings['managedRemoteTunnelPresets']> = [];
  const seenIds = new Set<string>();
  const seenHostnames = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;

    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const hostname = typeof candidate.hostname === 'string' ? candidate.hostname.trim().toLowerCase() : '';

    if (!id || !name || !hostname) continue;
    if (seenIds.has(id) || seenHostnames.has(hostname)) continue;
    seenIds.add(id);
    seenHostnames.add(hostname);

    result.push({ id, name, hostname });
  }

  return result;
};

const sanitizeManagedRemoteTunnelPresetTokens = (value: unknown): DesktopSettings['managedRemoteTunnelPresetTokens'] | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [key, tokenValue] of Object.entries(candidate)) {
    const id = key.trim();
    const token = typeof tokenValue === 'string' ? tokenValue.trim() : '';
    if (!id || !token) continue;
    result[id] = token;
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const sanitizeModelRefs = (value: unknown, limit: number): Array<{ providerID: string; modelID: string }> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result: Array<{ providerID: string; modelID: string }> = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const providerID = typeof candidate.providerID === 'string' ? candidate.providerID.trim() : '';
    const modelID = typeof candidate.modelID === 'string' ? candidate.modelID.trim() : '';
    if (!providerID || !modelID) continue;
    const key = `${providerID}/${modelID}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ providerID, modelID });
    if (result.length >= limit) break;
  }

  return result;
};

const getPersistApi = (): PersistApi | undefined => {
  const candidate = (useUIStore as unknown as { persist?: PersistApi }).persist;
  if (candidate && typeof candidate === 'object') {
    return candidate;
  }
  return undefined;
};

const getRuntimeSettingsAPI = () => getRegisteredRuntimeAPIs()?.settings ?? null;

const applyDesktopUiPreferences = (
  settings: DesktopSettings,
  options?: { authoritative?: boolean },
) => {
  const store = useUIStore.getState();
  const configStore = typeof window !== 'undefined'
    ? window.__zustand_config_store__?.getState?.() ?? null
    : null;
  const configStoreApi = typeof window !== 'undefined'
    ? window.__zustand_config_store__ ?? null
    : null;
  const queueStore = useMessageQueueStore.getState();

  if (typeof settings.showReasoningTraces === 'boolean' && settings.showReasoningTraces !== store.showReasoningTraces) {
    store.setShowReasoningTraces(settings.showReasoningTraces);
  }
  if (typeof settings.collapsibleThinkingBlocks === 'boolean' && settings.collapsibleThinkingBlocks !== store.collapsibleThinkingBlocks) {
    store.setCollapsibleThinkingBlocks(settings.collapsibleThinkingBlocks);
  }
  if (typeof settings.autoDeleteEnabled === 'boolean' && settings.autoDeleteEnabled !== store.autoDeleteEnabled) {
    store.setAutoDeleteEnabled(settings.autoDeleteEnabled);
  }
  if (typeof settings.autoSaveEnabled === 'boolean' && settings.autoSaveEnabled !== store.autoSaveEnabled) {
    store.setAutoSaveEnabled(settings.autoSaveEnabled);
  }
  if (typeof settings.autoDeleteAfterDays === 'number' && Number.isFinite(settings.autoDeleteAfterDays)) {
    const normalized = Math.max(1, Math.min(365, settings.autoDeleteAfterDays));
    if (normalized !== store.autoDeleteAfterDays) {
      store.setAutoDeleteAfterDays(normalized);
    }
  }
  if (settings.sessionRetentionAction === 'archive' || settings.sessionRetentionAction === 'delete') {
    if (settings.sessionRetentionAction !== store.sessionRetentionAction) {
      store.setSessionRetentionAction(settings.sessionRetentionAction);
    }
  }

  if (settings.followUpBehavior !== undefined || typeof settings.queueModeEnabled === 'boolean') {
    const behavior = resolvePersistedFollowUpBehavior(
      settings.followUpBehavior,
      settings.queueModeEnabled,
    );
    if (behavior !== queueStore.followUpBehavior) {
      queueStore.setFollowUpBehavior(behavior);
    }
  }

  if (typeof settings.showDeletionDialog === 'boolean' && settings.showDeletionDialog !== store.showDeletionDialog) {
    store.setShowDeletionDialog(settings.showDeletionDialog);
  }
  if (typeof settings.nativeNotificationsEnabled === 'boolean' && settings.nativeNotificationsEnabled !== store.nativeNotificationsEnabled) {
    store.setNativeNotificationsEnabled(settings.nativeNotificationsEnabled);
  }
  if (typeof settings.notificationMode === 'string' && (settings.notificationMode === 'always' || settings.notificationMode === 'hidden-only')) {
    if (settings.notificationMode !== store.notificationMode) {
      store.setNotificationMode(settings.notificationMode);
    }
  }
  if (typeof settings.notifyOnSubtasks === 'boolean' && settings.notifyOnSubtasks !== store.notifyOnSubtasks) {
    store.setNotifyOnSubtasks(settings.notifyOnSubtasks);
  }
  if (typeof settings.dockBadgeEnabled === 'boolean' && settings.dockBadgeEnabled !== store.dockBadgeEnabled) {
    store.setDockBadgeEnabled(settings.dockBadgeEnabled);
  }
  if (typeof settings.notifyOnCompletion === 'boolean' && settings.notifyOnCompletion !== store.notifyOnCompletion) {
    store.setNotifyOnCompletion(settings.notifyOnCompletion);
  }
  if (typeof settings.sessionRecapEnabled === 'boolean' && settings.sessionRecapEnabled !== store.sessionRecapEnabled) {
    store.setSessionRecapEnabled(settings.sessionRecapEnabled);
  }
  if (typeof settings.sessionSuggestionEnabled === 'boolean' && settings.sessionSuggestionEnabled !== store.sessionSuggestionEnabled) {
    store.setSessionSuggestionEnabled(settings.sessionSuggestionEnabled);
  }
  if (typeof settings.notifyOnError === 'boolean' && settings.notifyOnError !== store.notifyOnError) {
    store.setNotifyOnError(settings.notifyOnError);
  }
  if (typeof settings.notifyOnQuestion === 'boolean' && settings.notifyOnQuestion !== store.notifyOnQuestion) {
    store.setNotifyOnQuestion(settings.notifyOnQuestion);
  }
  if (settings.notificationTemplates && typeof settings.notificationTemplates === 'object') {
    store.setNotificationTemplates(settings.notificationTemplates);
  }
  if (typeof settings.summarizeLastMessage === 'boolean' && settings.summarizeLastMessage !== store.summarizeLastMessage) {
    store.setSummarizeLastMessage(settings.summarizeLastMessage);
  }
  if (typeof settings.summaryThreshold === 'number' && Number.isFinite(settings.summaryThreshold)) {
    store.setSummaryThreshold(settings.summaryThreshold);
  }
  if (typeof settings.summaryLength === 'number' && Number.isFinite(settings.summaryLength)) {
    store.setSummaryLength(settings.summaryLength);
  }
  if (typeof settings.maxLastMessageLength === 'number' && Number.isFinite(settings.maxLastMessageLength)) {
    store.setMaxLastMessageLength(settings.maxLastMessageLength);
  }
  if (typeof settings.inputSpellcheckEnabled === 'boolean' && settings.inputSpellcheckEnabled !== store.inputSpellcheckEnabled) {
    store.setInputSpellcheckEnabled(settings.inputSpellcheckEnabled);
  }
  if (typeof settings.showToolFileIcons === 'boolean' && settings.showToolFileIcons !== store.showToolFileIcons) {
    store.setShowToolFileIcons(settings.showToolFileIcons);
  }
  if (typeof settings.codeBlockLineWrap === 'boolean' && settings.codeBlockLineWrap !== store.codeBlockLineWrap) {
    store.setCodeBlockLineWrap(settings.codeBlockLineWrap);
  }
  if (typeof settings.showExpandedBashTools === 'boolean' && settings.showExpandedBashTools !== store.showExpandedBashTools) {
    store.setShowExpandedBashTools(settings.showExpandedBashTools);
  }
  if (typeof settings.showExpandedEditTools === 'boolean' && settings.showExpandedEditTools !== store.showExpandedEditTools) {
    store.setShowExpandedEditTools(settings.showExpandedEditTools);
  }
  if (
    typeof settings.agentControlToolEnabled === 'boolean'
    && settings.agentControlToolEnabled !== store.agentControlToolEnabled
  ) {
    store.setAgentControlToolEnabled(settings.agentControlToolEnabled);
  }
  if (
    typeof settings.agentMemoryToolEnabled === 'boolean'
    && settings.agentMemoryToolEnabled !== store.agentMemoryToolEnabled
  ) {
    store.setAgentMemoryToolEnabled(settings.agentMemoryToolEnabled);
  }
  if (typeof settings.timeFormatPreference === 'string'
    && (settings.timeFormatPreference === 'auto' || settings.timeFormatPreference === '12h' || settings.timeFormatPreference === '24h')) {
    if (settings.timeFormatPreference !== store.timeFormatPreference) {
      store.setTimeFormatPreference(settings.timeFormatPreference);
    }
  }
  if (typeof settings.weekStartPreference === 'string'
    && (settings.weekStartPreference === 'auto' || settings.weekStartPreference === 'sunday' || settings.weekStartPreference === 'monday')) {
    if (settings.weekStartPreference !== store.weekStartPreference) {
      store.setWeekStartPreference(settings.weekStartPreference);
    }
  }
  if (typeof settings.chatRenderMode === 'string'
    && (settings.chatRenderMode === 'sorted' || settings.chatRenderMode === 'live')) {
    if (settings.chatRenderMode !== store.chatRenderMode) {
      store.setChatRenderMode(settings.chatRenderMode);
    }
  }
  if (typeof settings.activityRenderMode === 'string'
    && (settings.activityRenderMode === 'collapsed' || settings.activityRenderMode === 'summary')) {
    if (settings.activityRenderMode !== store.activityRenderMode) {
      store.setActivityRenderMode(settings.activityRenderMode);
    }
  }
  if (typeof settings.sessionSortMode === 'string'
    && (settings.sessionSortMode === 'updated-desc' || settings.sessionSortMode === 'created-desc')) {
    if (settings.sessionSortMode !== store.sessionSortMode) {
      store.setSessionSortMode(settings.sessionSortMode);
    }
  }
  if (typeof settings.sessionGroupMinVisible === 'number'
    && Number.isFinite(settings.sessionGroupMinVisible)
    && settings.sessionGroupMinVisible >= 1) {
    if (settings.sessionGroupMinVisible !== store.sessionGroupMinVisible) {
      store.setSessionGroupMinVisible(settings.sessionGroupMinVisible);
    }
  }
  if (typeof settings.sessionGroupRecentHours === 'number'
    && Number.isFinite(settings.sessionGroupRecentHours)
    && settings.sessionGroupRecentHours >= 1) {
    if (settings.sessionGroupRecentHours !== store.sessionGroupRecentHours) {
      store.setSessionGroupRecentHours(settings.sessionGroupRecentHours);
    }
  }
  if (typeof settings.userMessageRenderingMode === 'string'
    && (settings.userMessageRenderingMode === 'markdown' || settings.userMessageRenderingMode === 'plain')) {
    if (settings.userMessageRenderingMode !== store.userMessageRenderingMode) {
      store.setUserMessageRenderingMode(settings.userMessageRenderingMode);
    }
  }
  if (typeof settings.collapsibleUserMessages === 'boolean' && settings.collapsibleUserMessages !== store.collapsibleUserMessages) {
    store.setCollapsibleUserMessages(settings.collapsibleUserMessages);
  }
  if (typeof settings.messageStreamTransport === 'string'
    && (settings.messageStreamTransport === 'auto' || settings.messageStreamTransport === 'ws' || settings.messageStreamTransport === 'sse')) {
    if (configStore && settings.messageStreamTransport !== configStore.settingsMessageStreamTransport) {
      configStore.setSettingsMessageStreamTransport(settings.messageStreamTransport);
    }
  }
  if (typeof settings.stickyUserHeader === 'boolean' && settings.stickyUserHeader !== store.stickyUserHeader) {
    store.setStickyUserHeader(settings.stickyUserHeader);
  }
  if (typeof settings.promptNavigatorEnabled === 'boolean' && settings.promptNavigatorEnabled !== store.promptNavigatorEnabled) {
    store.setPromptNavigatorEnabled(settings.promptNavigatorEnabled);
  }
  if (
    (settings.desktopWindowControlsPosition === 'left' || settings.desktopWindowControlsPosition === 'right')
    && settings.desktopWindowControlsPosition !== store.desktopWindowControlsPosition
  ) {
    store.setDesktopWindowControlsPosition(settings.desktopWindowControlsPosition);
  }
  if (
    (settings.desktopWindowControlsStyle === 'classic' || settings.desktopWindowControlsStyle === 'traffic-lights')
    && settings.desktopWindowControlsStyle !== store.desktopWindowControlsStyle
  ) {
    store.setDesktopWindowControlsStyle(settings.desktopWindowControlsStyle);
  }
  if (typeof settings.wideChatLayoutEnabled === 'boolean' && settings.wideChatLayoutEnabled !== store.wideChatLayoutEnabled) {
    store.setWideChatLayoutEnabled(settings.wideChatLayoutEnabled);
  }
  if (
    typeof settings.showSplitAssistantMessageActions === 'boolean'
    && settings.showSplitAssistantMessageActions !== store.showSplitAssistantMessageActions
  ) {
    store.setShowSplitAssistantMessageActions(settings.showSplitAssistantMessageActions);
  }
  if (
    typeof settings.allowPromptingSubagentSessions === 'boolean'
    && settings.allowPromptingSubagentSessions !== store.allowPromptingSubagentSessions
  ) {
    store.setAllowPromptingSubagentSessions(settings.allowPromptingSubagentSessions);
  }
  if (typeof settings.reportUsage === 'boolean' && settings.reportUsage !== store.reportUsage) {
    store.setReportUsage(settings.reportUsage);
  }
  if (typeof settings.multiRunEnabled === 'boolean' && settings.multiRunEnabled !== store.multiRunEnabled) {
    store.setMultiRunEnabled(settings.multiRunEnabled);
  }
  if (typeof settings.sessionGoalEnabled === 'boolean' && settings.sessionGoalEnabled !== store.sessionGoalEnabled) {
    store.setSessionGoalEnabled(settings.sessionGoalEnabled);
  }
  if (
    typeof settings.sessionGoalDefaultBudgetEnabled === 'boolean'
    && settings.sessionGoalDefaultBudgetEnabled !== store.sessionGoalDefaultBudgetEnabled
  ) {
    store.setSessionGoalDefaultBudgetEnabled(settings.sessionGoalDefaultBudgetEnabled);
  }
  if (
    typeof settings.sessionGoalDefaultBudget === 'number'
    && Number.isFinite(settings.sessionGoalDefaultBudget)
    && settings.sessionGoalDefaultBudget !== store.sessionGoalDefaultBudget
  ) {
    store.setSessionGoalDefaultBudget(settings.sessionGoalDefaultBudget);
  }
  if (typeof settings.fontSize === 'number' && Number.isFinite(settings.fontSize) && settings.fontSize !== store.fontSize) {
    store.setFontSize(settings.fontSize);
  }
  if (Array.isArray(settings.draftStarters)) {
    let nextStarters = sanitizeStarterRefs(settings.draftStarters);
    if (
      settings.draftStartersScheduleTaskAdded !== true
      && !nextStarters.some((starter) => starter.type === 'command' && starter.name === 'schedule-task')
    ) {
      const goalIndex = nextStarters.findIndex(
        (starter) => starter.type === 'command' && starter.name === 'craft-goal',
      );
      const insertAt = goalIndex >= 0 ? goalIndex + 1 : nextStarters.length;
      nextStarters = [
        ...nextStarters.slice(0, insertAt),
        { type: 'command', name: 'schedule-task' },
        ...nextStarters.slice(insertAt),
      ];
    }
    if (JSON.stringify(store.globalDraftStarters) !== JSON.stringify(nextStarters)) {
      store.setGlobalDraftStarters(nextStarters);
    }
    if (settings.draftStartersScheduleTaskAdded !== true) {
      void updateDesktopSettings({
        draftStarters: nextStarters,
        draftStartersScheduleTaskAdded: true,
      });
    }
  }
  const nextDraftStartersVisible = typeof settings.draftStartersVisible === 'boolean'
    ? settings.draftStartersVisible
    : options?.authoritative
      ? true
      : store.draftStartersVisible;
  if (nextDraftStartersVisible !== store.draftStartersVisible) {
    store.setDraftStartersVisible(nextDraftStartersVisible);
  }
  if (typeof settings.terminalFontSize === 'number' && Number.isFinite(settings.terminalFontSize) && settings.terminalFontSize !== store.terminalFontSize) {
    store.setTerminalFontSize(settings.terminalFontSize);
  }
  if (typeof settings.editorFontSize === 'number' && Number.isFinite(settings.editorFontSize) && settings.editorFontSize !== store.editorFontSize) {
    store.setEditorFontSize(settings.editorFontSize);
  }
  if (isUiFontOption(settings.uiFont) && settings.uiFont !== store.uiFont) {
    store.setUiFont(settings.uiFont);
  }
  if (isMonoFontOption(settings.monoFont) && settings.monoFont !== store.monoFont) {
    store.setMonoFont(settings.monoFont);
  }
  if (typeof settings.padding === 'number' && Number.isFinite(settings.padding) && settings.padding !== store.padding) {
    store.setPadding(settings.padding);
  }
  if (typeof settings.cornerRadius === 'number' && Number.isFinite(settings.cornerRadius) && settings.cornerRadius !== store.cornerRadius) {
    store.setCornerRadius(settings.cornerRadius);
  }
  if (typeof settings.inputBarOffset === 'number' && Number.isFinite(settings.inputBarOffset) && settings.inputBarOffset !== store.inputBarOffset) {
    store.setInputBarOffset(settings.inputBarOffset);
  }
  if (typeof settings.mobileKeyboardMode === 'string') {
    const mode = normalizeMobileKeyboardMode(settings.mobileKeyboardMode, store.mobileKeyboardMode);
    if (mode !== store.mobileKeyboardMode) {
      store.setMobileKeyboardMode(mode);
    }
  }
  if (configStoreApi && configStore) {
    const nextConfigState: Partial<typeof configStore> = {};
    if (
      (
        settings.sttProvider === 'browser'
        || settings.sttProvider === 'server'
        || settings.sttProvider === 'wasm'
      )
      && settings.sttProvider !== configStore.sttProvider
    ) {
      nextConfigState.sttProvider = settings.sttProvider;
    }
    if (typeof settings.sttServerUrl === 'string' && settings.sttServerUrl !== configStore.sttServerUrl) {
      nextConfigState.sttServerUrl = settings.sttServerUrl;
    }
    if (typeof settings.sttModel === 'string' && settings.sttModel !== configStore.sttModel) {
      nextConfigState.sttModel = settings.sttModel;
    }
    if (typeof settings.wasmSttModel === 'string' && settings.wasmSttModel !== configStore.wasmSttModel) {
      nextConfigState.wasmSttModel = settings.wasmSttModel;
    }
    if (typeof settings.sttLanguage === 'string' && settings.sttLanguage !== configStore.sttLanguage) {
      nextConfigState.sttLanguage = settings.sttLanguage;
    }
    if (typeof settings.sttSilenceThresholdDb === 'number' && Number.isFinite(settings.sttSilenceThresholdDb) && settings.sttSilenceThresholdDb !== configStore.sttSilenceThresholdDb) {
      nextConfigState.sttSilenceThresholdDb = settings.sttSilenceThresholdDb;
    }
    if (typeof settings.sttSilenceHoldMs === 'number' && Number.isFinite(settings.sttSilenceHoldMs) && settings.sttSilenceHoldMs !== configStore.sttSilenceHoldMs) {
      nextConfigState.sttSilenceHoldMs = settings.sttSilenceHoldMs;
    }
    if (typeof settings.sttTranscribeOnStop === 'boolean' && settings.sttTranscribeOnStop !== configStore.sttTranscribeOnStop) {
      nextConfigState.sttTranscribeOnStop = settings.sttTranscribeOnStop;
    }
    if (Object.keys(nextConfigState).length > 0) {
      configStoreApi.setState(nextConfigState);
    }
  }

  if (Array.isArray(settings.favoriteModels)) {
    const current = store.favoriteModels;
    const next = settings.favoriteModels;
    if (!areModelRefsEqual(current, next)) {
      useUIStore.setState({ favoriteModels: next });
    }
  }

  if (Array.isArray(settings.hiddenModels) && !areModelRefsEqual(store.hiddenModels, settings.hiddenModels)) {
    useUIStore.setState({ hiddenModels: settings.hiddenModels });
  }

  {
    const nextLayoutByServerId = migrateModelPickerLayoutState({
      modelPickerLayoutByServerId: settings.modelPickerLayoutByServerId,
      collapsedModelProviders: settings.collapsedModelProviders,
    });
    if (!areModelPickerLayoutMapsEqual(store.modelPickerLayoutByServerId, nextLayoutByServerId)) {
      useUIStore.setState({
        modelPickerLayoutByServerId: nextLayoutByServerId,
        collapsedModelProviders: [],
      });
    } else if (store.collapsedModelProviders.length > 0) {
      useUIStore.setState({ collapsedModelProviders: [] });
    }
  }

  if (Array.isArray(settings.recentModels)) {
    const current = store.recentModels;
    const next = settings.recentModels;
    if (!areModelRefsEqual(current, next)) {
      useUIStore.setState({ recentModels: next });
    }
  }
  if (Array.isArray(settings.recentAgents) && !areStringArraysEqual(store.recentAgents, settings.recentAgents)) {
    useUIStore.setState({ recentAgents: settings.recentAgents });
  }
  if (settings.recentEfforts && typeof settings.recentEfforts === 'object'
    && !areRecentEffortsEqual(store.recentEfforts, settings.recentEfforts)) {
    useUIStore.setState({ recentEfforts: settings.recentEfforts });
  }
  if (typeof settings.diffLayoutPreference === 'string'
    && (settings.diffLayoutPreference === 'dynamic' || settings.diffLayoutPreference === 'inline' || settings.diffLayoutPreference === 'side-by-side')) {
    if (settings.diffLayoutPreference !== store.diffLayoutPreference) {
      store.setDiffLayoutPreference(settings.diffLayoutPreference);
    }
  }
  if (typeof settings.diffViewMode === 'string'
    && (settings.diffViewMode === 'single' || settings.diffViewMode === 'stacked')) {
    if (settings.diffViewMode !== store.diffViewMode) {
      store.setDiffViewMode(settings.diffViewMode);
    }
  }
  if (typeof settings.gitChangesViewMode === 'string'
    && (settings.gitChangesViewMode === 'flat' || settings.gitChangesViewMode === 'tree')) {
    if (settings.gitChangesViewMode !== store.gitChangesViewMode) {
      store.setGitChangesViewMode(settings.gitChangesViewMode);
    }
  }
  if (typeof settings.directoryShowHidden === 'boolean') {
    setDirectoryShowHidden(settings.directoryShowHidden, { persist: false });
  }
  if (typeof settings.filesViewShowGitignored === 'boolean') {
    setFilesViewShowGitignored(settings.filesViewShowGitignored, { persist: false });
  }
};

export const sanitizeWebSettings = (payload: unknown): DesktopSettings | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const result: DesktopSettings = {};

  if (typeof candidate.themeId === 'string' && candidate.themeId.length > 0) {
    result.themeId = candidate.themeId;
  }
  if (candidate.useSystemTheme === true || candidate.useSystemTheme === false) {
    result.useSystemTheme = candidate.useSystemTheme;
  }
  if (typeof candidate.themeVariant === 'string' && (candidate.themeVariant === 'light' || candidate.themeVariant === 'dark')) {
    result.themeVariant = candidate.themeVariant;
  }
  if (typeof candidate.lightThemeId === 'string' && candidate.lightThemeId.length > 0) {
    result.lightThemeId = candidate.lightThemeId;
  }
  if (typeof candidate.darkThemeId === 'string' && candidate.darkThemeId.length > 0) {
    result.darkThemeId = candidate.darkThemeId;
  }
  if (typeof candidate.lastDirectory === 'string' && candidate.lastDirectory.length > 0) {
    result.lastDirectory = candidate.lastDirectory;
  }
  if (typeof candidate.homeDirectory === 'string' && candidate.homeDirectory.length > 0) {
    result.homeDirectory = candidate.homeDirectory;
  }

  if (typeof candidate.opencodeBinary === 'string') {
    const trimmed = candidate.opencodeBinary.trim();
    result.opencodeBinary = trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof candidate.agentControlToolEnabled === 'boolean') {
    result.agentControlToolEnabled = candidate.agentControlToolEnabled;
  }
  if (typeof candidate.agentMemoryToolEnabled === 'boolean') {
    result.agentMemoryToolEnabled = candidate.agentMemoryToolEnabled;
  }
  if (typeof candidate.desktopLanAccessEnabled === 'boolean') {
    result.desktopLanAccessEnabled = candidate.desktopLanAccessEnabled;
  }
  if (typeof candidate.desktopMacMenuBarEnabled === 'boolean') {
    result.desktopMacMenuBarEnabled = candidate.desktopMacMenuBarEnabled;
  }
  if (typeof candidate.desktopMinimizeToTrayEnabled === 'boolean') {
    result.desktopMinimizeToTrayEnabled = candidate.desktopMinimizeToTrayEnabled;
  }

  const projects = sanitizeProjects(candidate.projects);
  if (projects) {
    result.projects = projects;
  }
  if (typeof candidate.activeProjectId === 'string' && candidate.activeProjectId.length > 0) {
    result.activeProjectId = candidate.activeProjectId;
  }

  if (Array.isArray(candidate.approvedDirectories)) {
    result.approvedDirectories = candidate.approvedDirectories.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0
    );
  }
  if (Array.isArray(candidate.securityScopedBookmarks)) {
    result.securityScopedBookmarks = candidate.securityScopedBookmarks.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0
    );
  }
  if (Array.isArray(candidate.pinnedDirectories)) {
    result.pinnedDirectories = Array.from(
      new Set(
        candidate.pinnedDirectories.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      )
    );
  }
  const pinnedSessions = sanitizePinnedSessionIds(candidate.pinnedSessions);
  if (pinnedSessions) {
    result.pinnedSessions = pinnedSessions;
  }
  const pinnedSessionsByProject = sanitizePinnedSessionsByKey(candidate.pinnedSessionsByProject);
  if (pinnedSessionsByProject) {
    result.pinnedSessionsByProject = pinnedSessionsByProject;
  }
  const pinnedSessionOrder = sanitizePinnedSessionIds(candidate.pinnedSessionOrder);
  if (pinnedSessionOrder) {
    result.pinnedSessionOrder = pinnedSessionOrder;
  }
  const pinnedSessionOrderByProject = sanitizePinnedSessionsByKey(candidate.pinnedSessionOrderByProject);
  if (pinnedSessionOrderByProject) {
    result.pinnedSessionOrderByProject = pinnedSessionOrderByProject;
  }
  if (typeof candidate.showReasoningTraces === 'boolean') {
    result.showReasoningTraces = candidate.showReasoningTraces;
  }
  if (Array.isArray(candidate.draftStarters)) {
    result.draftStarters = sanitizeStarterRefs(candidate.draftStarters);
  }
  if (typeof candidate.draftStartersScheduleTaskAdded === 'boolean') {
    result.draftStartersScheduleTaskAdded = candidate.draftStartersScheduleTaskAdded;
  }
  if (typeof candidate.draftStartersVisible === 'boolean') {
    result.draftStartersVisible = candidate.draftStartersVisible;
  }
  if (typeof candidate.collapsibleThinkingBlocks === 'boolean') {
    result.collapsibleThinkingBlocks = candidate.collapsibleThinkingBlocks;
  }
  if (typeof candidate.autoDeleteEnabled === 'boolean') {
    result.autoDeleteEnabled = candidate.autoDeleteEnabled;
  }
  if (typeof candidate.autoSaveEnabled === 'boolean') {
    result.autoSaveEnabled = candidate.autoSaveEnabled;
  }
  if (typeof candidate.autoDeleteAfterDays === 'number' && Number.isFinite(candidate.autoDeleteAfterDays)) {
    result.autoDeleteAfterDays = candidate.autoDeleteAfterDays;
  }
  if (candidate.sessionRetentionAction === 'archive' || candidate.sessionRetentionAction === 'delete') {
    result.sessionRetentionAction = candidate.sessionRetentionAction;
  }
  if (typeof candidate.tunnelProvider === 'string') {
    const provider = candidate.tunnelProvider.trim().toLowerCase();
    if (provider.length > 0) {
      result.tunnelProvider = provider;
    }
  }
  if (typeof candidate.tunnelMode === 'string') {
    const mode = candidate.tunnelMode.trim().toLowerCase();
    if (mode === 'quick' || mode === 'managed-remote' || mode === 'managed-local') {
      result.tunnelMode = mode;
    }
  }
  if (candidate.tunnelBootstrapTtlMs === null) {
    result.tunnelBootstrapTtlMs = null;
  } else if (typeof candidate.tunnelBootstrapTtlMs === 'number' && Number.isFinite(candidate.tunnelBootstrapTtlMs)) {
    result.tunnelBootstrapTtlMs = candidate.tunnelBootstrapTtlMs;
  }
  if (typeof candidate.tunnelSessionTtlMs === 'number' && Number.isFinite(candidate.tunnelSessionTtlMs)) {
    result.tunnelSessionTtlMs = candidate.tunnelSessionTtlMs;
  }
  if (candidate.managedLocalTunnelConfigPath === null) {
    result.managedLocalTunnelConfigPath = null;
  } else if (typeof candidate.managedLocalTunnelConfigPath === 'string') {
    const trimmed = candidate.managedLocalTunnelConfigPath.trim();
    result.managedLocalTunnelConfigPath = trimmed.length > 0 ? trimmed : null;
  }
  if (typeof candidate.managedRemoteTunnelHostname === 'string') {
    result.managedRemoteTunnelHostname = candidate.managedRemoteTunnelHostname.trim();
  }
  if (candidate.managedRemoteTunnelToken === null) {
    result.managedRemoteTunnelToken = null;
  } else if (typeof candidate.managedRemoteTunnelToken === 'string') {
    result.managedRemoteTunnelToken = candidate.managedRemoteTunnelToken.trim();
  }
  const managedRemoteTunnelPresets = sanitizeManagedRemoteTunnelPresets(candidate.managedRemoteTunnelPresets);
  if (managedRemoteTunnelPresets) {
    result.managedRemoteTunnelPresets = managedRemoteTunnelPresets;
  }
  if (typeof candidate.managedRemoteTunnelSelectedPresetId === 'string') {
    const trimmed = candidate.managedRemoteTunnelSelectedPresetId.trim();
    result.managedRemoteTunnelSelectedPresetId = trimmed.length > 0 ? trimmed : undefined;
  }
  const managedRemoteTunnelPresetTokens = sanitizeManagedRemoteTunnelPresetTokens(candidate.managedRemoteTunnelPresetTokens);
  if (managedRemoteTunnelPresetTokens) {
    result.managedRemoteTunnelPresetTokens = managedRemoteTunnelPresetTokens;
  }
  if (typeof candidate.defaultModel === 'string' && candidate.defaultModel.length > 0) {
    result.defaultModel = candidate.defaultModel;
  }
  if (typeof candidate.defaultVariant === 'string' && candidate.defaultVariant.length > 0) {
    result.defaultVariant = candidate.defaultVariant;
  }
  if (typeof candidate.defaultAgent === 'string' && candidate.defaultAgent.length > 0) {
    result.defaultAgent = candidate.defaultAgent;
  }
  if (typeof candidate.autoCreateWorktree === 'boolean') {
    result.autoCreateWorktree = candidate.autoCreateWorktree;
  }
  if (typeof candidate.gitmojiEnabled === 'boolean') {
    result.gitmojiEnabled = candidate.gitmojiEnabled;
  }
  if (candidate.followUpBehavior === 'steer' || candidate.followUpBehavior === 'queue' || candidate.followUpBehavior === 'immediate') {
    result.followUpBehavior = candidate.followUpBehavior;
  }
  if (typeof candidate.queueModeEnabled === 'boolean') {
    result.queueModeEnabled = candidate.queueModeEnabled;
  }
  if (typeof candidate.showDeletionDialog === 'boolean') {
    result.showDeletionDialog = candidate.showDeletionDialog;
  }
  if (typeof candidate.nativeNotificationsEnabled === 'boolean') {
    result.nativeNotificationsEnabled = candidate.nativeNotificationsEnabled;
  }
  if (typeof candidate.notificationMode === 'string' && (candidate.notificationMode === 'always' || candidate.notificationMode === 'hidden-only')) {
    result.notificationMode = candidate.notificationMode;
  }
  if (typeof candidate.notifyOnSubtasks === 'boolean') {
    result.notifyOnSubtasks = candidate.notifyOnSubtasks;
  }
  if (typeof candidate.dockBadgeEnabled === 'boolean') {
    result.dockBadgeEnabled = candidate.dockBadgeEnabled;
  }
  if (typeof candidate.notifyOnCompletion === 'boolean') {
    result.notifyOnCompletion = candidate.notifyOnCompletion;
  }
  if (typeof candidate.sessionRecapEnabled === 'boolean') {
    result.sessionRecapEnabled = candidate.sessionRecapEnabled;
  }
  if (typeof candidate.sessionSuggestionEnabled === 'boolean') {
    result.sessionSuggestionEnabled = candidate.sessionSuggestionEnabled;
  }
  if (typeof candidate.notifyOnError === 'boolean') {
    result.notifyOnError = candidate.notifyOnError;
  }
  if (typeof candidate.notifyOnQuestion === 'boolean') {
    result.notifyOnQuestion = candidate.notifyOnQuestion;
  }
  if (candidate.notificationTemplates && typeof candidate.notificationTemplates === 'object') {
    const templates = candidate.notificationTemplates as Record<string, unknown>;
    const validateTemplate = (key: string): { title: string; message: string } | undefined => {
      const value = templates[key];
      if (!value || typeof value !== 'object') return undefined;
      const obj = value as Record<string, unknown>;
      const title = typeof obj.title === 'string' ? obj.title : '';
      const message = typeof obj.message === 'string' ? obj.message : '';
      return { title, message };
    };
    const completion = validateTemplate('completion');
    const error = validateTemplate('error');
    const question = validateTemplate('question');
    const subtask = validateTemplate('subtask');
    if (completion || error || question || subtask) {
      result.notificationTemplates = {
        completion: completion ?? { title: 'Task Complete', message: 'Your task has finished.' },
        error: error ?? { title: 'Error Occurred', message: 'An error occurred while processing your task.' },
        question: question ?? { title: 'Input Needed', message: 'Please provide input to continue.' },
        subtask: subtask ?? { title: 'Subtask Complete', message: 'A subtask has finished.' },
      };
    }
  }
  if (typeof candidate.summarizeLastMessage === 'boolean') {
    result.summarizeLastMessage = candidate.summarizeLastMessage;
  }
  if (typeof candidate.summaryThreshold === 'number' && Number.isFinite(candidate.summaryThreshold)) {
    result.summaryThreshold = Math.max(0, Math.round(candidate.summaryThreshold));
  }
  if (typeof candidate.summaryLength === 'number' && Number.isFinite(candidate.summaryLength)) {
    result.summaryLength = Math.max(10, Math.round(candidate.summaryLength));
  }
  if (typeof candidate.maxLastMessageLength === 'number' && Number.isFinite(candidate.maxLastMessageLength)) {
    result.maxLastMessageLength = Math.max(10, Math.round(candidate.maxLastMessageLength));
  }
  if (typeof candidate.usageAutoRefresh === 'boolean') {
    result.usageAutoRefresh = candidate.usageAutoRefresh;
  }
  if (typeof candidate.usageRefreshIntervalMs === 'number' && Number.isFinite(candidate.usageRefreshIntervalMs)) {
    result.usageRefreshIntervalMs = candidate.usageRefreshIntervalMs;
  }
  if (candidate.usageDisplayMode === 'usage' || candidate.usageDisplayMode === 'remaining') {
    result.usageDisplayMode = candidate.usageDisplayMode;
  }
  if (typeof candidate.usageShowPredValues === 'boolean') {
    result.usageShowPredValues = candidate.usageShowPredValues;
  }
  if (Array.isArray(candidate.usageDropdownProviders)) {
    result.usageDropdownProviders = candidate.usageDropdownProviders.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0
    );
  }

  // Parse usageSelectedModels (Record<string, string[]>)
  if (candidate.usageSelectedModels && typeof candidate.usageSelectedModels === 'object') {
    const selectedModels: Record<string, string[]> = {};
    for (const [providerId, models] of Object.entries(candidate.usageSelectedModels)) {
      if (Array.isArray(models)) {
        selectedModels[providerId] = models.filter((m): m is string => typeof m === 'string');
      }
    }
    if (Object.keys(selectedModels).length > 0) {
      result.usageSelectedModels = selectedModels;
    }
  }

  // Parse usageCollapsedFamilies (Record<string, string[]>)
  if (candidate.usageCollapsedFamilies && typeof candidate.usageCollapsedFamilies === 'object') {
    const collapsedFamilies: Record<string, string[]> = {};
    for (const [providerId, families] of Object.entries(candidate.usageCollapsedFamilies)) {
      if (Array.isArray(families)) {
        collapsedFamilies[providerId] = families.filter((f): f is string => typeof f === 'string');
      }
    }
    if (Object.keys(collapsedFamilies).length > 0) {
      result.usageCollapsedFamilies = collapsedFamilies;
    }
  }

  // Parse usageExpandedFamilies (Record<string, string[]>) - inverted collapsed logic for header dropdown
  if (candidate.usageExpandedFamilies && typeof candidate.usageExpandedFamilies === 'object') {
    const expandedFamilies: Record<string, string[]> = {};
    for (const [providerId, families] of Object.entries(candidate.usageExpandedFamilies)) {
      if (Array.isArray(families)) {
        expandedFamilies[providerId] = families.filter((f): f is string => typeof f === 'string');
      }
    }
    if (Object.keys(expandedFamilies).length > 0) {
      result.usageExpandedFamilies = expandedFamilies;
    }
  }

  // Parse usageModelGroups - custom model groups configuration per provider
  if (candidate.usageModelGroups && typeof candidate.usageModelGroups === 'object') {
    const modelGroups: Record<string, {
      customGroups?: Array<{id: string; label: string; models: string[]; order: number}>;
      modelAssignments?: Record<string, string>;
      renamedGroups?: Record<string, string>;
    }> = {};
    for (const [providerId, config] of Object.entries(candidate.usageModelGroups)) {
      if (config && typeof config === 'object') {
        const typedConfig = config as Record<string, unknown>;
        const providerConfig: {
          customGroups?: Array<{id: string; label: string; models: string[]; order: number}>;
          modelAssignments?: Record<string, string>;
          renamedGroups?: Record<string, string>;
        } = {};

        // Parse customGroups
        if (Array.isArray(typedConfig.customGroups)) {
          providerConfig.customGroups = typedConfig.customGroups
            .filter((g): g is Record<string, unknown> => g && typeof g === 'object')
            .map((g) => ({
              id: String(g.id ?? ''),
              label: String(g.label ?? ''),
              models: Array.isArray(g.models)
                ? g.models.filter((m): m is string => typeof m === 'string')
                : [],
              order: typeof g.order === 'number' ? g.order : 0,
            }));
        }

        // Parse modelAssignments
        if (typedConfig.modelAssignments && typeof typedConfig.modelAssignments === 'object') {
          providerConfig.modelAssignments = Object.fromEntries(
            Object.entries(typedConfig.modelAssignments as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'string')
              .map(([k, v]) => [k, String(v)])
          );
        }

        // Parse renamedGroups
        if (typedConfig.renamedGroups && typeof typedConfig.renamedGroups === 'object') {
          providerConfig.renamedGroups = Object.fromEntries(
            Object.entries(typedConfig.renamedGroups as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'string')
              .map(([k, v]) => [k, String(v)])
          );
        }

        if (Object.keys(providerConfig).length > 0) {
          modelGroups[providerId] = providerConfig;
        }
      }
    }
    if (Object.keys(modelGroups).length > 0) {
      result.usageModelGroups = modelGroups;
    }
  }

  if (typeof candidate.inputSpellcheckEnabled === 'boolean') {
    result.inputSpellcheckEnabled = candidate.inputSpellcheckEnabled;
  }
  if (typeof candidate.showToolFileIcons === 'boolean') {
    result.showToolFileIcons = candidate.showToolFileIcons;
  }
  if (typeof candidate.codeBlockLineWrap === 'boolean') {
    result.codeBlockLineWrap = candidate.codeBlockLineWrap;
  }
  if (typeof candidate.showExpandedBashTools === 'boolean') {
    result.showExpandedBashTools = candidate.showExpandedBashTools;
  }
  if (typeof candidate.showExpandedEditTools === 'boolean') {
    result.showExpandedEditTools = candidate.showExpandedEditTools;
  }
  if (typeof candidate.timeFormatPreference === 'string'
    && (candidate.timeFormatPreference === 'auto' || candidate.timeFormatPreference === '12h' || candidate.timeFormatPreference === '24h')) {
    result.timeFormatPreference = candidate.timeFormatPreference;
  }
  if (typeof candidate.weekStartPreference === 'string'
    && (candidate.weekStartPreference === 'auto' || candidate.weekStartPreference === 'sunday' || candidate.weekStartPreference === 'monday')) {
    result.weekStartPreference = candidate.weekStartPreference;
  }
  if (typeof candidate.chatRenderMode === 'string'
    && (candidate.chatRenderMode === 'sorted' || candidate.chatRenderMode === 'live')) {
    result.chatRenderMode = candidate.chatRenderMode;
  }
  if (typeof candidate.messageStreamTransport === 'string'
    && (candidate.messageStreamTransport === 'auto' || candidate.messageStreamTransport === 'ws' || candidate.messageStreamTransport === 'sse')) {
    result.messageStreamTransport = candidate.messageStreamTransport;
  }
  if (typeof candidate.activityRenderMode === 'string'
    && (candidate.activityRenderMode === 'collapsed' || candidate.activityRenderMode === 'summary')) {
    result.activityRenderMode = candidate.activityRenderMode;
  }
  if (typeof candidate.sessionSortMode === 'string'
    && (candidate.sessionSortMode === 'updated-desc' || candidate.sessionSortMode === 'created-desc')) {
    result.sessionSortMode = candidate.sessionSortMode;
  }
  if (typeof candidate.sessionGroupMinVisible === 'number'
    && Number.isFinite(candidate.sessionGroupMinVisible)
    && candidate.sessionGroupMinVisible >= 1) {
    result.sessionGroupMinVisible = candidate.sessionGroupMinVisible;
  }
  if (typeof candidate.sessionGroupRecentHours === 'number'
    && Number.isFinite(candidate.sessionGroupRecentHours)
    && candidate.sessionGroupRecentHours >= 1) {
    result.sessionGroupRecentHours = candidate.sessionGroupRecentHours;
  }
  if (typeof candidate.userMessageRenderingMode === 'string'
    && (candidate.userMessageRenderingMode === 'markdown' || candidate.userMessageRenderingMode === 'plain')) {
    result.userMessageRenderingMode = candidate.userMessageRenderingMode;
  }
  if (typeof candidate.collapsibleUserMessages === 'boolean') {
    result.collapsibleUserMessages = candidate.collapsibleUserMessages;
  }
  if (typeof candidate.stickyUserHeader === 'boolean') {
    result.stickyUserHeader = candidate.stickyUserHeader;
  }
  if (typeof candidate.promptNavigatorEnabled === 'boolean') {
    result.promptNavigatorEnabled = candidate.promptNavigatorEnabled;
  }
  if (
    candidate.desktopWindowControlsPosition === 'left'
    || candidate.desktopWindowControlsPosition === 'right'
  ) {
    result.desktopWindowControlsPosition = candidate.desktopWindowControlsPosition;
  }
  if (
    candidate.desktopWindowControlsStyle === 'classic'
    || candidate.desktopWindowControlsStyle === 'traffic-lights'
  ) {
    result.desktopWindowControlsStyle = candidate.desktopWindowControlsStyle;
  }
  if (typeof candidate.wideChatLayoutEnabled === 'boolean') {
    result.wideChatLayoutEnabled = candidate.wideChatLayoutEnabled;
  }
  if (typeof candidate.showSplitAssistantMessageActions === 'boolean') {
    result.showSplitAssistantMessageActions = candidate.showSplitAssistantMessageActions;
  }
  if (typeof candidate.allowPromptingSubagentSessions === 'boolean') {
    result.allowPromptingSubagentSessions = candidate.allowPromptingSubagentSessions;
  }
  if (typeof candidate.fontSize === 'number' && Number.isFinite(candidate.fontSize)) {
    result.fontSize = candidate.fontSize;
  }
  if (typeof candidate.terminalFontSize === 'number' && Number.isFinite(candidate.terminalFontSize)) {
    result.terminalFontSize = candidate.terminalFontSize;
  }
  if (typeof candidate.editorFontSize === 'number' && Number.isFinite(candidate.editorFontSize)) {
    result.editorFontSize = candidate.editorFontSize;
  }
  if (typeof candidate.smallModelUseDefault === 'boolean') {
    result.smallModelUseDefault = candidate.smallModelUseDefault;
  }
  if (typeof candidate.smallModelOverride === 'string') {
    const trimmed = candidate.smallModelOverride.trim();
    if (!trimmed) {
      result.smallModelOverride = '';
    } else if (trimmed.includes('/')) {
      result.smallModelOverride = trimmed;
    }
  }
  if (typeof candidate.sessionGoalEnabled === 'boolean') {
    result.sessionGoalEnabled = candidate.sessionGoalEnabled;
  }
  if (typeof candidate.sessionGoalDefaultBudgetEnabled === 'boolean') {
    result.sessionGoalDefaultBudgetEnabled = candidate.sessionGoalDefaultBudgetEnabled;
  }
  if (typeof candidate.sessionGoalDefaultBudget === 'number' && Number.isFinite(candidate.sessionGoalDefaultBudget)) {
    result.sessionGoalDefaultBudget = candidate.sessionGoalDefaultBudget;
  }
  if (isUiFontOption(candidate.uiFont)) {
    result.uiFont = candidate.uiFont;
  }
  if (isMonoFontOption(candidate.monoFont)) {
    result.monoFont = candidate.monoFont;
  }
  if (typeof candidate.padding === 'number' && Number.isFinite(candidate.padding)) {
    result.padding = candidate.padding;
  }
  if (typeof candidate.cornerRadius === 'number' && Number.isFinite(candidate.cornerRadius)) {
    result.cornerRadius = candidate.cornerRadius;
  }
  if (typeof candidate.inputBarOffset === 'number' && Number.isFinite(candidate.inputBarOffset)) {
    result.inputBarOffset = candidate.inputBarOffset;
  }
  if (typeof candidate.mobileKeyboardMode === 'string') {
    const mode = normalizeMobileKeyboardMode(candidate.mobileKeyboardMode, undefined);
    if (mode) {
      result.mobileKeyboardMode = mode;
    }
  }

  const favoriteModels = sanitizeModelRefs(candidate.favoriteModels, 64);
  if (favoriteModels) {
    result.favoriteModels = favoriteModels;
  }

  const hiddenModels = sanitizeModelRefs(candidate.hiddenModels, 1024);
  if (hiddenModels) {
    result.hiddenModels = hiddenModels;
  }

  const collapsedModelProviders = sanitizeStringArray(candidate.collapsedModelProviders);
  if (collapsedModelProviders) {
    result.collapsedModelProviders = collapsedModelProviders;
  }

  const modelPickerLayoutByServerId = sanitizeModelPickerLayoutByServerId(candidate.modelPickerLayoutByServerId);
  if (Object.keys(modelPickerLayoutByServerId).length > 0) {
    result.modelPickerLayoutByServerId = modelPickerLayoutByServerId;
  }

  const recentModels = sanitizeModelRefs(candidate.recentModels, 16);
  if (recentModels) {
    result.recentModels = recentModels;
  }
  const recentAgents = sanitizeStringArray(candidate.recentAgents);
  if (recentAgents) {
    result.recentAgents = recentAgents;
  }
  const recentEfforts = sanitizeRecentEfforts(candidate.recentEfforts);
  if (recentEfforts) {
    result.recentEfforts = recentEfforts;
  }
  if (
    typeof candidate.diffLayoutPreference === 'string'
    && (candidate.diffLayoutPreference === 'dynamic'
      || candidate.diffLayoutPreference === 'inline'
      || candidate.diffLayoutPreference === 'side-by-side')
  ) {
    result.diffLayoutPreference = candidate.diffLayoutPreference;
  }
  if (
    typeof candidate.diffViewMode === 'string'
    && (candidate.diffViewMode === 'single' || candidate.diffViewMode === 'stacked')
  ) {
    result.diffViewMode = candidate.diffViewMode;
  }
  if (
    typeof candidate.gitChangesViewMode === 'string'
    && (candidate.gitChangesViewMode === 'flat' || candidate.gitChangesViewMode === 'tree')
  ) {
    result.gitChangesViewMode = candidate.gitChangesViewMode;
  }
  if (typeof candidate.directoryShowHidden === 'boolean') {
    result.directoryShowHidden = candidate.directoryShowHidden;
  }
  if (typeof candidate.filesViewShowGitignored === 'boolean') {
    result.filesViewShowGitignored = candidate.filesViewShowGitignored;
  }
  if (typeof candidate.openInAppId === 'string' && candidate.openInAppId.length > 0) {
    result.openInAppId = candidate.openInAppId;
  }
  if (typeof candidate.pwaAppName === 'string') {
    const normalized = candidate.pwaAppName.trim().replace(/\s+/g, ' ').slice(0, 64);
    result.pwaAppName = normalized.length > 0 ? normalized : '';
  }

  const skillCatalogs = sanitizeSkillCatalogs(candidate.skillCatalogs);
  if (skillCatalogs) {
    result.skillCatalogs = skillCatalogs;
  }

  if (typeof candidate.reportUsage === 'boolean') {
    result.reportUsage = candidate.reportUsage;
  }

  if (typeof candidate.multiRunEnabled === 'boolean') {
    result.multiRunEnabled = candidate.multiRunEnabled;
  }

  if (typeof candidate.globalBehaviorPrompt === 'string') {
    result.globalBehaviorPrompt = candidate.globalBehaviorPrompt;
  }
  if (typeof candidate.responseStyleEnabled === 'boolean') {
    result.responseStyleEnabled = candidate.responseStyleEnabled;
  }
  if (
    typeof candidate.responseStylePreset === 'string'
    && (candidate.responseStylePreset === 'concise'
      || candidate.responseStylePreset === 'detailed'
      || candidate.responseStylePreset === 'mentor'
      || candidate.responseStylePreset === 'pushback'
      || candidate.responseStylePreset === 'noFiller'
      || candidate.responseStylePreset === 'matchEnergy'
      || candidate.responseStylePreset === 'warmPeer'
      || candidate.responseStylePreset === 'custom')
  ) {
    result.responseStylePreset = candidate.responseStylePreset;
  }
  if (typeof candidate.responseStyleCustomInstructions === 'string') {
    result.responseStyleCustomInstructions = candidate.responseStyleCustomInstructions;
  }
  if (
    candidate.sttProvider === 'browser'
    || candidate.sttProvider === 'server'
    || candidate.sttProvider === 'wasm'
  ) {
    result.sttProvider = candidate.sttProvider;
  }
  if (typeof candidate.sttServerUrl === 'string') {
    result.sttServerUrl = candidate.sttServerUrl.trim();
  }
  if (typeof candidate.sttModel === 'string') {
    result.sttModel = candidate.sttModel.trim();
  }
  if (typeof candidate.wasmSttModel === 'string') {
    result.wasmSttModel = candidate.wasmSttModel.trim();
  }
  if (typeof candidate.sttLanguage === 'string') {
    result.sttLanguage = candidate.sttLanguage.trim();
  }
  if (typeof candidate.sttSilenceThresholdDb === 'number' && Number.isFinite(candidate.sttSilenceThresholdDb)) {
    result.sttSilenceThresholdDb = candidate.sttSilenceThresholdDb;
  }
  if (typeof candidate.sttSilenceHoldMs === 'number' && Number.isFinite(candidate.sttSilenceHoldMs)) {
    result.sttSilenceHoldMs = candidate.sttSilenceHoldMs;
  }
  if (typeof candidate.sttTranscribeOnStop === 'boolean') {
    result.sttTranscribeOnStop = candidate.sttTranscribeOnStop;
  }

  if (candidate.localStore && typeof candidate.localStore === 'object' && !Array.isArray(candidate.localStore)) {
    const localStore: Record<string, string> = {};
    for (const [key, value] of Object.entries(candidate.localStore as Record<string, unknown>)) {
      if (typeof key === 'string' && key.length > 0 && key.length <= 256 && typeof value === 'string' && value.length <= 256 * 1024) {
        localStore[key] = value;
      }
    }
    result.localStore = localStore;
  }

  return result;
};

// Short-lived cache + in-flight dedup for settings fetches to avoid repeated GET calls during startup
let _settingsCache: { value: DesktopSettings | null; at: number } | null = null;
let _settingsInflight: Promise<DesktopSettings | null> | null = null;
const SETTINGS_CACHE_TTL = 2_000; // 2 seconds — covers the startup burst

const performSettingsFetch = async (): Promise<DesktopSettings | null> => {
  const runtimeSettings = getRuntimeSettingsAPI();
  if (runtimeSettings) {
    try {
      const result = await runtimeSettings.load();
      return sanitizeWebSettings(result.settings);
    } catch (error) {
      console.warn('Failed to load shared settings from runtime settings API:', error);
    }
  }

  try {
    const response = await fetch('/api/config/settings', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json().catch(() => null);
    return sanitizeWebSettings(data);
  } catch (error) {
    console.warn('Failed to load shared settings from server:', error);
    return null;
  }
};

const fetchWebSettings = async (): Promise<DesktopSettings | null> => {
  // Return cached if fresh
  if (_settingsCache && Date.now() - _settingsCache.at < SETTINGS_CACHE_TTL) {
    return _settingsCache.value;
  }

  // Dedup concurrent calls
  if (_settingsInflight) return _settingsInflight;

  _settingsInflight = (async (): Promise<DesktopSettings | null> => {
    const settings = await performSettingsFetch();
    _settingsCache = { value: settings, at: Date.now() };
    return settings;
  })().finally(() => { _settingsInflight = null; });

  return _settingsInflight;
};

/**
 * The shared read path (upstream 82a0ee757): one cached, deduped read of the
 * settings document, whatever the runtime. New consumers load settings through
 * this instead of fetching `/api/config/settings` by hand.
 */
export const loadDesktopSettings = fetchWebSettings;

/**
 * Real GET bypassing cache + in-flight dedup. Deliberately does not touch
 * `_settingsInflight` so it cannot cancel a concurrent background read.
 */
const fetchWebSettingsFresh = async (): Promise<DesktopSettings | null> => {
  const settings = await performSettingsFetch();
  _settingsCache = { value: settings, at: Date.now() };
  return settings;
};

/** Invalidate cached settings (call after a successful PUT) */
export const invalidateSettingsCache = (): void => {
  _settingsCache = null;
};

// Wait for Zustand persist hydration before applying server settings.
// Otherwise `set()`-calls race with hydration: we set X, then hydration
// reads localStorage and overwrites back to the persisted value.
const waitForSettingsHydration = (): Promise<void> => {
  const persistApi = getPersistApi();
  if (!persistApi?.hasHydrated || persistApi.hasHydrated()) {
    return Promise.resolve();
  }
  if (!persistApi.onFinishHydration) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const unsubscribe = persistApi.onFinishHydration!(() => {
      unsubscribe?.();
      finish();
    });
    // Guard: hydration may have flipped to true between the hasHydrated
    // check and the onFinishHydration subscription — resolve immediately.
    if (persistApi.hasHydrated?.()) finish();
  });
};

// Each step is wrapped in try/catch so a failure in one side-effect (e.g.
// a TypeError from writing to a contextBridge-protected global) doesn't
// prevent server settings from reaching the Zustand store.
// Echo guard: values learned from a remote settings apply must never be
// re-saved as local edits. Without this, apply → store subscriber →
// updateDesktopSettings → host broadcast → apply … forms a giant-payload
// ping-pong that pegs the main thread (the VS Code gray-screen freeze).
let _remoteApplyDepth = 0;

const applySettingsAndDispatch = async (settings: DesktopSettings): Promise<void> => {
  _remoteApplyDepth += 1;
  try {
    await _applySettingsAndDispatchInner(settings);
  } finally {
    _remoteApplyDepth -= 1;
  }
};

const _applySettingsAndDispatchInner = async (settings: DesktopSettings): Promise<void> => {
  try {
    persistToLocalStorage(settings);
  } catch (error) {
    console.warn('persistToLocalStorage failed:', error);
  }
  try {
    hydrateLocalStore(settings.localStore ?? {});
  } catch (error) {
    console.warn('hydrateLocalStore failed:', error);
  }
  await waitForSettingsHydration();
  try {
    applyDesktopUiPreferences(settings, { authoritative: true });
  } catch (error) {
    console.warn('applyDesktopUiPreferences failed:', error);
  }

  dispatchSettingsSynced(settings);
};

export const syncDesktopSettings = async (): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const webSettings = await fetchWebSettings();
    if (webSettings) {
      await applySettingsAndDispatch(webSettings);
    } else {
      // No settings document arrived: let listeners (project registry) mark
      // the server snapshot as failed so extensions show a load error.
      window.dispatchEvent(new Event('openchamber:settings-sync-failed'));
    }
  } catch (error) {
    window.dispatchEvent(new Event('openchamber:settings-sync-failed'));
    console.warn('Failed to synchronise settings:', error);
  }
};

// Mobile/desktop host switches must not reuse a previous endpoint's GET cache.
// When a new host is bound, re-pull settings so pin/project prefs follow host.
if (typeof window !== 'undefined') {
  subscribeRuntimeEndpointWillChange(() => {
    resetHostSessionPinsApplied();
  });
  subscribeRuntimeEndpointChanged((detail) => {
    invalidateSettingsCache();
    if (typeof detail.apiBaseUrl === 'string' && detail.apiBaseUrl.trim().length > 0) {
      void syncDesktopSettings();
    }
  });
}

// Coalesce rapid updateDesktopSettings calls into a single PUT
let _pendingSettingsChanges: Partial<DesktopSettings> | null = null;
let _settingsFlushTimer: ReturnType<typeof setTimeout> | null = null;
// Serialized flush chain. Each enqueued flush awaits the previous one, so
// concurrent kicks never overwrite the tracked promise (which would lose a
// still-running PUT). Resolves to whether the flush succeeded.
let _settingsFlushChain: Promise<boolean> | null = null;
// Bumped on every locally-initiated PUT. A forced host refresh captures this
// before its GET and discards the response if a mutation lands during the GET,
// since that response is stale relative to local intent (the PUT has not
// reached disk yet and replaceFromRemote would otherwise clobber the new pin).
let _localSettingsMutationGeneration = 0;
const SETTINGS_DEBOUNCE_MS = 200;

export type SettingsSaveFailureKind = 'lock-timeout' | 'network' | 'http' | 'unknown';
export type SettingsSaveFailure = {
  kind: SettingsSaveFailureKind;
  message: string;
  status?: number;
  waitedMs?: number;
  ownerPid?: number;
};

let _failedSettingsChanges: Partial<DesktopSettings> | null = null;
let _failedSettingsError: SettingsSaveFailure | null = null;

const classifySettingsError = (error: unknown, httpStatus?: number): SettingsSaveFailure => {
  if (httpStatus !== undefined) {
    return { kind: 'http', message: `HTTP ${httpStatus}`, status: httpStatus };
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'SETTINGS_LOCK_TIMEOUT') {
      const e = error as { message?: string; waitedMs?: number; ownerPid?: number };
      return {
        kind: 'lock-timeout',
        message: e.message ?? 'settings lock timeout',
        waitedMs: e.waitedMs,
        ownerPid: e.ownerPid,
      };
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  const isNetwork = message.toLowerCase().includes('fetch')
    || message.toLowerCase().includes('network')
    || message.toLowerCase().includes('failed to fetch');
  return { kind: isNetwork ? 'network' : 'unknown', message };
};

const recordFailedSettings = (changes: Partial<DesktopSettings>, failure: SettingsSaveFailure): void => {
  _failedSettingsChanges = { ...(_failedSettingsChanges ?? {}), ...changes };
  _failedSettingsError = failure;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<SettingsSaveFailure>('openchamber:settings-save-failed', { detail: failure }));
  }
};

const clearFailedSettings = (): void => {
  if (_failedSettingsChanges || _failedSettingsError) {
    _failedSettingsChanges = null;
    _failedSettingsError = null;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('openchamber:settings-save-recovered'));
    }
  }
};

export const getFailedSettingsInfo = (): SettingsSaveFailure | null => _failedSettingsError;

export const retryFailedSettingsUpdate = async (): Promise<boolean> => {
  if (!_failedSettingsChanges) return true;
  const changes = _failedSettingsChanges;
  _failedSettingsChanges = null;
  _failedSettingsError = null;
  await updateDesktopSettings(changes);
  return _failedSettingsError === null;
};

// When the last local settings PUT completed. The webview's synced handler
// uses this to ignore echo broadcasts shortly after its own save — the PUT
// response already carried the freshest state, and re-syncing it is what
// fed the apply → save → broadcast → sync ping-pong.
let _lastLocalSettingsSaveCompletedAt = 0;
export const getLastLocalSettingsSaveCompletedAt = (): number => _lastLocalSettingsSaveCompletedAt;

const _flushSettingsUpdate = async (): Promise<boolean> => {
  const changes = _pendingSettingsChanges;
  _pendingSettingsChanges = null;
  _settingsFlushTimer = null;
  if (!changes || Object.keys(changes).length === 0) return true;

  const runtimeSettings = getRuntimeSettingsAPI();
  if (runtimeSettings) {
    try {
      const updated = await runtimeSettings.save(changes);
      if (updated) {
        persistToLocalStorage(updated);
        applyDesktopUiPreferences(updated);
        dispatchSettingsSynced(updated);
        // Invalidate GET cache so the next read sees the fresh data
        _settingsCache = null;
      }
      clearFailedSettings();
      _lastLocalSettingsSaveCompletedAt = Date.now();
      return true;
    } catch (error) {
      console.warn('Failed to update settings via runtime settings API:', error);
      recordFailedSettings(changes, classifySettingsError(error));
      return false;
    }
  }

  try {
    const response = await fetch('/api/config/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(changes),
    });

    if (!response.ok) {
      console.warn('Failed to update shared settings via API:', response.status, response.statusText);
      recordFailedSettings(changes, classifySettingsError(null, response.status));
      return false;
    }

    const updated = (await response.json().catch(() => null)) as DesktopSettings | null;
    if (updated) {
      persistToLocalStorage(updated);
      applyDesktopUiPreferences(updated);
      dispatchSettingsSynced(updated);
      // Invalidate GET cache so next read sees the fresh data
      _settingsCache = null;
    }
    clearFailedSettings();
    _lastLocalSettingsSaveCompletedAt = Date.now();
    return true;
  } catch (error) {
    console.warn('Failed to update shared settings via API:', error);
    recordFailedSettings(changes, classifySettingsError(error));
    return false;
  }
};

const _enqueueSettingsFlush = (): void => {
  const previous = _settingsFlushChain;
  const current = (async (): Promise<boolean> => {
    if (previous) await previous;
    return _flushSettingsUpdate();
  })();
  _settingsFlushChain = current;
  current.finally(() => {
    if (_settingsFlushChain === current) _settingsFlushChain = null;
  });
};

/**
 * Flush debounced/pending settings PUTs and await completion. Resolves false
 * if any flush failed — callers must not then read host settings, since the
 * host still holds the pre-mutation value and applying it would revert the
 * local write whose PUT just failed.
 */
export const flushPendingSettingsUpdates = async (): Promise<boolean> => {
  if (_settingsFlushTimer) {
    clearTimeout(_settingsFlushTimer);
    _settingsFlushTimer = null;
    _enqueueSettingsFlush();
  }
  let safety = 0;
  while (_settingsFlushChain && safety < 50) {
    const ok = await _settingsFlushChain;
    safety += 1;
    if (!ok) return false;
    if (_settingsFlushTimer) {
      clearTimeout(_settingsFlushTimer);
      _settingsFlushTimer = null;
      _enqueueSettingsFlush();
    }
  }
  return true;
};

export const updateDesktopSettings = async (changes: Partial<DesktopSettings>): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }

  if (_remoteApplyDepth > 0) {
    // Remote-apply echo: these values came from the host response we are
    // applying right now; re-saving them would loop the sync forever.
    return;
  }

  const safeChanges = stripSessionPinSettingsIfHostPending(changes as Record<string, unknown>) as Partial<DesktopSettings>;
  if (Object.keys(safeChanges).length === 0) {
    return;
  }

  _localSettingsMutationGeneration += 1;
  _pendingSettingsChanges = { ...(_pendingSettingsChanges ?? {}), ...safeChanges };

  if (_settingsFlushTimer) {
    clearTimeout(_settingsFlushTimer);
  }
  _settingsFlushTimer = setTimeout(() => _enqueueSettingsFlush(), SETTINGS_DEBOUNCE_MS);
};

/**
 * Force a fresh host settings pull for the sidebar "refresh" action, so a pin
 * made on another client becomes visible without a restart. Flushes pending
 * local PUTs first, then GETs; aborts on a failed PUT (host would revert the
 * local write) and discards the response if the endpoint switched or a local
 * mutation began during the GET (stale relative to local intent).
 */
export const refreshDesktopSettingsFromHost = async (): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }

  const startKey = getRuntimeKey();

  const flushOk = await flushPendingSettingsUpdates();
  // A pending PUT failed — the host still holds the pre-mutation value, so a
  // GET now would revert the local write. Abort without refreshing.
  if (!flushOk) return;
  if (getRuntimeKey() !== startKey) return;

  const getGeneration = _localSettingsMutationGeneration;
  const settings = await fetchWebSettingsFresh();

  // fetchWebSettingsFresh wrote the (possibly stale) response into the shared
  // cache. If we discard it, invalidate so the next ordinary sync re-reads.
  // Module singletons are not endpoint-keyed: an old-host response must not
  // apply under a new host.
  if (getRuntimeKey() !== startKey) {
    invalidateSettingsCache();
    return;
  }
  // A local mutation began during the GET; its PUT has not reached disk, so
  // this response is stale and must not clobber the newer local intent.
  if (_localSettingsMutationGeneration !== getGeneration) {
    invalidateSettingsCache();
    return;
  }

  if (settings) {
    await applySettingsAndDispatch(settings);
  }
};

export const initializeAppearancePreferences = async (): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }

  const persistApi = getPersistApi();

  try {
    const appearance = await loadAppearancePreferences();
    if (!appearance) {
      return;
    }

    const applyAppearance = () => applyAppearancePreferences(appearance);

    if (persistApi?.hasHydrated?.()) {
      applyAppearance();
      return;
    }

    applyAppearance();
    if (persistApi?.onFinishHydration) {
      const unsubscribe = persistApi.onFinishHydration(() => {
        unsubscribe?.();
        applyAppearance();
      });
    }
  } catch (error) {
    console.warn('Failed to load appearance preferences:', error);
  }
};

type SettingsSaveState = 'idle' | 'saving' | 'error';

let _settingsSaveState: SettingsSaveState = 'idle';
let _settingsSaveStateResetTimer: ReturnType<typeof setTimeout> | null = null;
const _settingsSaveStateListeners = new Set<() => void>();

export const getSettingsSaveState = (): SettingsSaveState => _settingsSaveState;

export const subscribeToSettingsSaveState = (listener: () => void): (() => void) => {
  _settingsSaveStateListeners.add(listener);
  return () => {
    _settingsSaveStateListeners.delete(listener);
  };
};

const dispatchSettingsSaveState = (state: 'saving' | 'saved' | 'error'): void => {
  if (_settingsSaveStateResetTimer) {
    clearTimeout(_settingsSaveStateResetTimer);
    _settingsSaveStateResetTimer = null;
  }

  // Quiet indicator: success is the normal case and renders nothing ('saved' → idle);
  // only in-flight saves and failures surface in the UI.
  const nextState: SettingsSaveState = state === 'saved' ? 'idle' : state;
  if (nextState !== _settingsSaveState) {
    _settingsSaveState = nextState;
    _settingsSaveStateListeners.forEach((listener) => listener());
  }

  if (nextState === 'error') {
    _settingsSaveStateResetTimer = setTimeout(() => dispatchSettingsSaveState('saved'), 6000);
  }

  // [fork-port] keep the fork's app-wide save-failure toast channel.
  if (state === 'error') {
    window.dispatchEvent(new CustomEvent<SettingsSaveFailure>('openchamber:settings-save-failed', {
      detail: { kind: 'unknown', message: 'Settings save failed' },
    }));
  }
};

// A runtime switch abandons whatever save indicator was in flight (upstream
// parity). Installed lazily: at module import time `window` may not exist yet
// (bun test installs happy-dom in beforeEach).
let _saveStateRuntimeHookInstalled = false;
const ensureSettingsSaveStateRuntimeHook = (): void => {
  if (_saveStateRuntimeHookInstalled || typeof window === 'undefined') return;
  _saveStateRuntimeHookInstalled = true;
  subscribeRuntimeEndpointChanged((detail) => {
    if (detail.runtimeKey !== detail.previousRuntimeKey) {
      dispatchSettingsSaveState('saved');
    }
  });
};

/** Quiet save-state signal for settings widgets that manage their own saves
 *  (e.g. Linear preferences): 'saved' is the normal case and reports nothing;
 *  only in-flight saves and failures surface in the UI. */
export const reportSettingsSaveState = (state: 'saving' | 'saved' | 'error'): void => {
  ensureSettingsSaveStateRuntimeHook();
  dispatchSettingsSaveState(state);
};
