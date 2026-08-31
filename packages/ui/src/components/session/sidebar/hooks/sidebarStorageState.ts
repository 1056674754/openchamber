export type SidebarStorageReader = {
  readonly getItem: (key: string) => string | null;
};

export type SidebarStorageKeys = {
  readonly sessionExpanded: string;
  readonly projectCollapse: string;
  readonly groupOrder: string;
  readonly projectActiveSession: string;
  readonly groupCollapse: string;
  readonly tempSessionsCollapse: string;
};

export type SidebarStorageState = {
  readonly expandedParents: Set<string> | null;
  readonly collapsedProjects: Set<string> | null;
  readonly groupOrderByProject: Map<string, string[]> | null;
  readonly activeSessionByProject: Map<string, string> | null;
  readonly collapsedGroups: Set<string> | null;
  readonly tempSessionsCollapsed: boolean | null;
};

const parseStoredJson = (storage: SidebarStorageReader, key: string): unknown | null => {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const readStringSet = (storage: SidebarStorageReader, key: string): Set<string> | null => {
  const parsed = parseStoredJson(storage, key);
  if (!Array.isArray(parsed)) return null;
  return new Set(parsed.filter((item): item is string => typeof item === 'string'));
};

const readStringArrayMap = (
  storage: SidebarStorageReader,
  key: string,
): Map<string, string[]> | null => {
  const parsed = parseStoredJson(storage, key);
  if (!isRecord(parsed)) return null;
  const result = new Map<string, string[]>();
  for (const [entryKey, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) continue;
    result.set(entryKey, value.filter((item): item is string => typeof item === 'string'));
  }
  return result;
};

const readStringMap = (
  storage: SidebarStorageReader,
  key: string,
): Map<string, string> | null => {
  const parsed = parseStoredJson(storage, key);
  if (!isRecord(parsed)) return null;
  const result = new Map<string, string>();
  for (const [entryKey, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.length > 0) {
      result.set(entryKey, value);
    }
  }
  return result;
};

export const readSidebarStorageState = (
  storage: SidebarStorageReader,
  keys: SidebarStorageKeys,
): SidebarStorageState => {
  const tempSessionsCollapse = storage.getItem(keys.tempSessionsCollapse);
  return {
    expandedParents: readStringSet(storage, keys.sessionExpanded),
    collapsedProjects: readStringSet(storage, keys.projectCollapse),
    groupOrderByProject: readStringArrayMap(storage, keys.groupOrder),
    activeSessionByProject: readStringMap(storage, keys.projectActiveSession),
    collapsedGroups: readStringSet(storage, keys.groupCollapse),
    tempSessionsCollapsed: tempSessionsCollapse === 'true'
      ? true
      : tempSessionsCollapse === 'false'
        ? false
        : null,
  };
};
