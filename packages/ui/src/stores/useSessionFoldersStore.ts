import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { getSafeStorage } from './utils/safeStorage';
import { isVSCodeRuntime } from '@/lib/desktop';

// --- Types ---

export interface SessionFolder {
  id: string;
  name: string;
  sessionIds: string[];
  createdAt: number;
  /** If set, this folder is a sub-folder of the parent folder with this id */
  parentId?: string | null;
}

export type SessionFoldersMap = Record<string, SessionFolder[]>;

interface SessionFoldersState {
  foldersMap: SessionFoldersMap;
  collapsedFolderIds: Set<string>;
  /** Archived scope keys that have already been default-collapsed (one-time init) */
  archivedAutoCollapsedScopes: Set<string>;
}

interface SessionFoldersActions {
  getFoldersForScope: (scopeKey: string) => SessionFolder[];
  createFolder: (scopeKey: string, name: string, parentId?: string | null) => SessionFolder;
  renameFolder: (scopeKey: string, folderId: string, name: string) => void;
  deleteFolder: (scopeKey: string, folderId: string) => void;
  addSessionToFolder: (scopeKey: string, folderId: string, sessionId: string) => void;
  addSessionsToFolder: (scopeKey: string, folderId: string, sessionIds: string[]) => void;
  removeSessionFromFolder: (scopeKey: string, sessionId: string) => void;
  removeSessionsFromFolders: (scopeKey: string, sessionIds: string[]) => void;
  toggleFolderCollapse: (folderId: string) => void;
  defaultCollapseArchivedFolders: (scopeKey: string, folderIds: string[]) => void;
  cleanupSessions: (scopeKey: string, existingSessionIds: Set<string>) => void;
  getSessionFolderId: (scopeKey: string, sessionId: string) => string | null;
}

type SessionFoldersStore = SessionFoldersState & SessionFoldersActions;

// --- Storage ---

const FOLDERS_STORAGE_KEY = 'oc.sessions.folders';
const COLLAPSED_STORAGE_KEY = 'oc.sessions.folderCollapse';
const ARCHIVED_AUTO_COLLAPSED_STORAGE_KEY = 'oc.sessions.archivedAutoCollapsedScopes';
const SESSION_FOLDERS_API_PATH = '/api/session-folders';
const DISK_WRITE_DEBOUNCE_MS = 250;
const ARCHIVED_SCOPE_PREFIX = '__archived__:';

const safeStorage = getSafeStorage();
let diskWriteTimer: ReturnType<typeof setTimeout> | null = null;
let diskHydrated = false;
let diskHydrationInFlight = false;
let persistFoldersTimer: ReturnType<typeof setTimeout> | undefined;
let persistCollapsedTimer: ReturnType<typeof setTimeout> | undefined;
let persistArchivedAutoCollapsedTimer: ReturnType<typeof setTimeout> | undefined;
let pendingFoldersMap: SessionFoldersMap | null = null;
let pendingCollapsedIds: Set<string> | null = null;
let pendingArchivedAutoCollapsedScopes: Set<string> | null = null;

const isVSCodeWebview = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  if (isVSCodeRuntime()) {
    return true;
  }

  return (window as { __VSCODE_CONFIG__?: unknown }).__VSCODE_CONFIG__ !== undefined;
};

const schedulePersistToDisk = (foldersMap: SessionFoldersMap, collapsedFolderIds: Set<string>, archivedAutoCollapsedScopes: Set<string>): void => {
  if (typeof window === 'undefined') {
    return;
  }

  if (isVSCodeWebview()) {
    return;
  }

  if (diskWriteTimer) {
    clearTimeout(diskWriteTimer);
  }

  const foldersSnapshot = JSON.parse(JSON.stringify(foldersMap)) as SessionFoldersMap;
  const collapsedSnapshot = Array.from(collapsedFolderIds);
  const archivedAutoCollapsedSnapshot = Array.from(archivedAutoCollapsedScopes);

  diskWriteTimer = setTimeout(() => {
    diskWriteTimer = null;
    const payload = {
      version: 1,
      foldersMap: foldersSnapshot,
      collapsedFolderIds: collapsedSnapshot,
      archivedAutoCollapsedScopes: archivedAutoCollapsedSnapshot,
      updatedAt: Date.now(),
    };
    void fetch(SESSION_FOLDERS_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => { /* best-effort */ });
  }, DISK_WRITE_DEBOUNCE_MS);
};

const readPersistedFolders = (): SessionFoldersMap => {
  try {
    const raw = safeStorage.getItem(FOLDERS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result: SessionFoldersMap = {};
    for (const [scopeKey, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) {
        continue;
      }
      const folders: SessionFolder[] = [];
      for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const candidate = entry as Record<string, unknown>;
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
        const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
        const createdAt = typeof candidate.createdAt === 'number' ? candidate.createdAt : 0;
        if (!id || !name) continue;
        const sessionIds = Array.isArray(candidate.sessionIds)
          ? (candidate.sessionIds as unknown[]).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          : [];
        const parentId = typeof candidate.parentId === 'string' ? candidate.parentId : null;
        folders.push({ id, name, sessionIds, createdAt, parentId });
      }
      if (folders.length > 0) {
        result[scopeKey] = folders;
      }
    }
    return result;
  } catch {
    return {};
  }
};

const readPersistedCollapsed = (): Set<string> => {
  try {
    const raw = safeStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
};

const persistFolders = (foldersMap: SessionFoldersMap): void => {
  pendingFoldersMap = foldersMap;
  clearTimeout(persistFoldersTimer);
  persistFoldersTimer = setTimeout(() => {
    try {
      safeStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(foldersMap));
      pendingFoldersMap = null;
    } catch {
      // ignored
    }
  }, 300);
};

const persistCollapsed = (collapsedFolderIds: Set<string>): void => {
  pendingCollapsedIds = collapsedFolderIds;
  clearTimeout(persistCollapsedTimer);
  persistCollapsedTimer = setTimeout(() => {
    try {
      safeStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(collapsedFolderIds)));
      pendingCollapsedIds = null;
    } catch {
      // ignored
    }
  }, 300);
};

const readPersistedArchivedAutoCollapsed = (): Set<string> => {
  try {
    const raw = safeStorage.getItem(ARCHIVED_AUTO_COLLAPSED_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
};

const persistArchivedAutoCollapsed = (scopes: Set<string>): void => {
  pendingArchivedAutoCollapsedScopes = scopes;
  clearTimeout(persistArchivedAutoCollapsedTimer);
  persistArchivedAutoCollapsedTimer = setTimeout(() => {
    try {
      safeStorage.setItem(ARCHIVED_AUTO_COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(scopes)));
      pendingArchivedAutoCollapsedScopes = null;
    } catch {
      // ignored
    }
  }, 300);
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (pendingFoldersMap !== null) {
      clearTimeout(persistFoldersTimer);
      try {
        safeStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(pendingFoldersMap));
      } catch { /* ignored */ }
      pendingFoldersMap = null;
    }
    if (pendingCollapsedIds !== null) {
      clearTimeout(persistCollapsedTimer);
      try {
        safeStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(pendingCollapsedIds)));
      } catch { /* ignored */ }
      pendingCollapsedIds = null;
    }
    if (pendingArchivedAutoCollapsedScopes !== null) {
      clearTimeout(persistArchivedAutoCollapsedTimer);
      try {
        safeStorage.setItem(ARCHIVED_AUTO_COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(pendingArchivedAutoCollapsedScopes)));
      } catch { /* ignored */ }
      pendingArchivedAutoCollapsedScopes = null;
    }
  });
}

const persistState = (foldersMap: SessionFoldersMap, collapsedFolderIds: Set<string>, archivedAutoCollapsedScopes: Set<string>): void => {
  persistFolders(foldersMap);
  persistCollapsed(collapsedFolderIds);
  persistArchivedAutoCollapsed(archivedAutoCollapsedScopes);
  schedulePersistToDisk(foldersMap, collapsedFolderIds, archivedAutoCollapsedScopes);
};

const createFolderId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `folder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const syncCollapsedAfterFolderCleanup = (
  prevFolders: SessionFolder[],
  nextFolders: SessionFolder[],
  collapsedFolderIds: Set<string>,
): Set<string> | null => {
  const nextFolderIds = new Set(nextFolders.map((folder) => folder.id));
  let nextCollapsed: Set<string> | null = null;

  for (const folder of prevFolders) {
    if (!nextFolderIds.has(folder.id) && collapsedFolderIds.has(folder.id)) {
      if (!nextCollapsed) {
        nextCollapsed = new Set(collapsedFolderIds);
      }
      nextCollapsed.delete(folder.id);
    }
  }

  return nextCollapsed;
};

const pruneEmptyArchivedFolders = (scopeKey: string, folders: SessionFolder[]): SessionFolder[] => {
  if (!scopeKey.startsWith(ARCHIVED_SCOPE_PREFIX)) {
    return folders;
  }

  return folders.filter((folder) => folder.sessionIds.length > 0);
};

// --- Store ---

export const useSessionFoldersStore = create<SessionFoldersStore>()(
  devtools(
    (set, get) => ({
      foldersMap: readPersistedFolders(),
      collapsedFolderIds: readPersistedCollapsed(),
      archivedAutoCollapsedScopes: readPersistedArchivedAutoCollapsed(),

      getFoldersForScope: (scopeKey: string): SessionFolder[] => {
        if (!scopeKey) return [];
        return get().foldersMap[scopeKey] ?? [];
      },

      createFolder: (scopeKey: string, name: string, parentId?: string | null): SessionFolder => {
        const trimmed = name.trim() || 'New folder';
        const folder: SessionFolder = {
          id: createFolderId(),
          name: trimmed,
          sessionIds: [],
          createdAt: Date.now(),
          parentId: parentId ?? null,
        };
        const current = get().foldersMap;
        const scopeFolders = current[scopeKey] ?? [];
        const nextMap: SessionFoldersMap = {
          ...current,
          [scopeKey]: [...scopeFolders, folder],
        };
        set({ foldersMap: nextMap });
        persistState(nextMap, get().collapsedFolderIds, get().archivedAutoCollapsedScopes);
        return folder;
      },

      renameFolder: (scopeKey: string, folderId: string, name: string): void => {
        const trimmed = name.trim();
        if (!trimmed || !scopeKey) return;
        const current = get().foldersMap;
        const scopeFolders = current[scopeKey];
        if (!scopeFolders) return;
        const nextFolders = scopeFolders.map((folder) =>
          folder.id === folderId ? { ...folder, name: trimmed } : folder,
        );
        const nextMap: SessionFoldersMap = { ...current, [scopeKey]: nextFolders };
        set({ foldersMap: nextMap });
        persistState(nextMap, get().collapsedFolderIds, get().archivedAutoCollapsedScopes);
      },

      deleteFolder: (scopeKey: string, folderId: string): void => {
        if (!scopeKey) return;
        const current = get().foldersMap;
        const scopeFolders = current[scopeKey];
        if (!scopeFolders) return;
        // Also delete all sub-folders of this folder
        const idsToDelete = new Set<string>([folderId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const f of scopeFolders) {
            if (f.parentId && idsToDelete.has(f.parentId) && !idsToDelete.has(f.id)) {
              idsToDelete.add(f.id);
              changed = true;
            }
          }
        }
        const nextFolders = scopeFolders.filter((folder) => !idsToDelete.has(folder.id));
        const nextMap: SessionFoldersMap = { ...current, [scopeKey]: nextFolders };
        set({ foldersMap: nextMap });
        persistState(nextMap, get().collapsedFolderIds, get().archivedAutoCollapsedScopes);

        // Clean up collapsed state for all deleted folders
        const collapsed = get().collapsedFolderIds;
        const hasStale = Array.from(idsToDelete).some((id) => collapsed.has(id));
        if (hasStale) {
          const nextCollapsed = new Set(collapsed);
          idsToDelete.forEach((id) => nextCollapsed.delete(id));
          set({ collapsedFolderIds: nextCollapsed });
          persistState(nextMap, nextCollapsed, get().archivedAutoCollapsedScopes);
        }
      },

      addSessionToFolder: (scopeKey: string, folderId: string, sessionId: string): void => {
        if (!scopeKey || !folderId || !sessionId) return;
        const current = get().foldersMap;
        const scopeFolders = current[scopeKey];
        if (!scopeFolders) return;

        // Remove session from any existing folder first, then add to target
        const nextFolders = scopeFolders.map((folder) => {
          const withoutSession = folder.sessionIds.filter((id) => id !== sessionId);
          if (folder.id === folderId) {
            return { ...folder, sessionIds: [...withoutSession, sessionId] };
          }
          if (withoutSession.length !== folder.sessionIds.length) {
            return { ...folder, sessionIds: withoutSession };
          }
          return folder;
        });

        const nextMap: SessionFoldersMap = { ...current, [scopeKey]: nextFolders };
        const nextCollapsed = syncCollapsedAfterFolderCleanup(scopeFolders, nextFolders, get().collapsedFolderIds);

        set(nextCollapsed
          ? { foldersMap: nextMap, collapsedFolderIds: nextCollapsed }
          : { foldersMap: nextMap });
        persistState(nextMap, nextCollapsed ?? get().collapsedFolderIds, get().archivedAutoCollapsedScopes);
      },

      addSessionsToFolder: (scopeKey: string, folderId: string, sessionIds: string[]): void => {
        if (!scopeKey || !folderId || sessionIds.length === 0) return;
        const current = get().foldersMap;
        const scopeFolders = current[scopeKey];
        if (!scopeFolders) return;

        const idSet = new Set(sessionIds.filter((id) => typeof id === 'string' && id.length > 0));
        if (idSet.size === 0) return;

        const nextFolders = scopeFolders.map((folder) => {
          const withoutSessions = folder.sessionIds.filter((id) => !idSet.has(id));
          if (folder.id === folderId) {
            return { ...folder, sessionIds: [...withoutSessions, ...idSet] };
          }
          if (withoutSessions.length !== folder.sessionIds.length) {
            return { ...folder, sessionIds: withoutSessions };
          }
          return folder;
        });

        const nextMap: SessionFoldersMap = { ...current, [scopeKey]: nextFolders };
        const nextCollapsed = syncCollapsedAfterFolderCleanup(scopeFolders, nextFolders, get().collapsedFolderIds);

        set(nextCollapsed
          ? { foldersMap: nextMap, collapsedFolderIds: nextCollapsed }
          : { foldersMap: nextMap });
        persistState(nextMap, nextCollapsed ?? get().collapsedFolderIds, get().archivedAutoCollapsedScopes);
      },

      removeSessionsFromFolders: (scopeKey: string, sessionIds: string[]): void => {
        if (!scopeKey || sessionIds.length === 0) return;
        const current = get().foldersMap;
        const scopeFolders = current[scopeKey];
        if (!scopeFolders) return;

        const idSet = new Set(sessionIds.filter((id) => typeof id === 'string' && id.length > 0));
        if (idSet.size === 0) return;

        let changed = false;
        const nextFolders = scopeFolders.map((folder) => {
          const filtered = folder.sessionIds.filter((id) => !idSet.has(id));
          if (filtered.length !== folder.sessionIds.length) {
            changed = true;
            return { ...folder, sessionIds: filtered };
          }
          return folder;
        });

        if (!changed) return;
        const nextMap: SessionFoldersMap = { ...current, [scopeKey]: nextFolders };
        const nextCollapsed = syncCollapsedAfterFolderCleanup(scopeFolders, nextFolders, get().collapsedFolderIds);

        set(nextCollapsed
          ? { foldersMap: nextMap, collapsedFolderIds: nextCollapsed }
          : { foldersMap: nextMap });
        persistState(nextMap, nextCollapsed ?? get().collapsedFolderIds, get().archivedAutoCollapsedScopes);
      },

      removeSessionFromFolder: (scopeKey: string, sessionId: string): void => {
        if (!scopeKey || !sessionId) return;
        const current = get().foldersMap;
        const scopeFolders = current[scopeKey];
        if (!scopeFolders) return;

        let changed = false;
        const nextFolders = scopeFolders.map((folder) => {
          const filtered = folder.sessionIds.filter((id) => id !== sessionId);
          if (filtered.length !== folder.sessionIds.length) {
            changed = true;
            return { ...folder, sessionIds: filtered };
          }
          return folder;
        });

        if (!changed) return;
        const nextMap: SessionFoldersMap = { ...current, [scopeKey]: nextFolders };
        const nextCollapsed = syncCollapsedAfterFolderCleanup(scopeFolders, nextFolders, get().collapsedFolderIds);

        set(nextCollapsed
          ? { foldersMap: nextMap, collapsedFolderIds: nextCollapsed }
          : { foldersMap: nextMap });
        persistState(nextMap, nextCollapsed ?? get().collapsedFolderIds, get().archivedAutoCollapsedScopes);
      },

      toggleFolderCollapse: (folderId: string): void => {
        const collapsed = get().collapsedFolderIds;
        const next = new Set(collapsed);
        if (next.has(folderId)) {
          next.delete(folderId);
        } else {
          next.add(folderId);
        }
        set({ collapsedFolderIds: next });
        persistState(get().foldersMap, next, get().archivedAutoCollapsedScopes);
      },

      defaultCollapseArchivedFolders: (scopeKey: string, folderIds: string[]): void => {
        if (!scopeKey || folderIds.length === 0) return;
        const { collapsedFolderIds, archivedAutoCollapsedScopes } = get();
        if (archivedAutoCollapsedScopes.has(scopeKey)) return;
        const nextCollapsed = new Set(collapsedFolderIds);
        for (const id of folderIds) {
          nextCollapsed.add(id);
        }
        const nextScopes = new Set(archivedAutoCollapsedScopes);
        nextScopes.add(scopeKey);
        set({ collapsedFolderIds: nextCollapsed, archivedAutoCollapsedScopes: nextScopes });
        persistState(get().foldersMap, nextCollapsed, nextScopes);
      },

      cleanupSessions: (scopeKey: string, existingSessionIds: Set<string>): void => {
        if (!scopeKey) return;
        const current = get().foldersMap;
        const scopeFolders = current[scopeKey];
        if (!scopeFolders || scopeFolders.length === 0) return;

        let changed = false;
        const filteredFolders = scopeFolders.map((folder) => {
          const filtered = folder.sessionIds.filter((id) => existingSessionIds.has(id));
          if (filtered.length !== folder.sessionIds.length) {
            changed = true;
            return { ...folder, sessionIds: filtered };
          }
          return folder;
        });

        const nextFolders = pruneEmptyArchivedFolders(scopeKey, filteredFolders);
        if (nextFolders.length !== filteredFolders.length) {
          changed = true;
        }

        if (!changed) return;
        const nextMap: SessionFoldersMap = { ...current, [scopeKey]: nextFolders };
        const nextCollapsed = syncCollapsedAfterFolderCleanup(scopeFolders, nextFolders, get().collapsedFolderIds);

        set(nextCollapsed
          ? { foldersMap: nextMap, collapsedFolderIds: nextCollapsed }
          : { foldersMap: nextMap });
        persistState(nextMap, nextCollapsed ?? get().collapsedFolderIds, get().archivedAutoCollapsedScopes);
      },

      getSessionFolderId: (scopeKey: string, sessionId: string): string | null => {
        if (!scopeKey || !sessionId) return null;
        const scopeFolders = get().foldersMap[scopeKey];
        if (!scopeFolders) return null;
        for (const folder of scopeFolders) {
          if (folder.sessionIds.includes(sessionId)) {
            return folder.id;
          }
        }
        return null;
      },
    }),
    { name: 'session-folders-store' },
  ),
);

const hydrateSessionFoldersFromDisk = async (): Promise<void> => {
  if (diskHydrated || diskHydrationInFlight || typeof window === 'undefined') {
    return;
  }

  if (isVSCodeWebview()) {
    diskHydrated = true;
    return;
  }

  diskHydrationInFlight = true;

  try {
    const response = await fetch(SESSION_FOLDERS_API_PATH).catch(() => null);
    if (!response || !response.ok) {
      return;
    }

    const parsed = await response.json().catch(() => null) as {
      foldersMap?: SessionFoldersMap;
      collapsedFolderIds?: string[];
      archivedAutoCollapsedScopes?: string[];
    } | null;

    if (!parsed) {
      return;
    }

    const diskFolders = parsed.foldersMap && typeof parsed.foldersMap === 'object'
      ? parsed.foldersMap
      : {};
    const diskCollapsed = Array.isArray(parsed.collapsedFolderIds)
      ? new Set(parsed.collapsedFolderIds.filter((value): value is string => typeof value === 'string'))
      : new Set<string>();
    const diskArchivedAutoCollapsed = Array.isArray(parsed.archivedAutoCollapsedScopes)
      ? new Set(parsed.archivedAutoCollapsedScopes.filter((value): value is string => typeof value === 'string'))
      : new Set<string>();

    const hasDiskData = Object.keys(diskFolders).length > 0 || diskCollapsed.size > 0 || diskArchivedAutoCollapsed.size > 0;
    if (!hasDiskData) {
      return;
    }

    useSessionFoldersStore.setState({
      foldersMap: diskFolders,
      collapsedFolderIds: diskCollapsed,
      archivedAutoCollapsedScopes: diskArchivedAutoCollapsed,
    });

    persistFolders(diskFolders);
    persistCollapsed(diskCollapsed);
    persistArchivedAutoCollapsed(diskArchivedAutoCollapsed);
  } catch {
    // ignored
  } finally {
    diskHydrationInFlight = false;
    diskHydrated = true;
  }
};

const bootstrapSessionFoldersDiskHydration = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  void hydrateSessionFoldersFromDisk();
};

bootstrapSessionFoldersDiskHydration();
