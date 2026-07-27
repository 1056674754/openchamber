/** Shared storage keys + sanitizers for host-synced session pins. */

export const SESSION_PINNED_STORAGE_KEY = 'oc.sessions.pinned';
export const SESSION_PINNED_BY_PROJECT_STORAGE_KEY = 'oc.sessions.pinnedByProject';
export const SESSION_PINNED_ORDER_STORAGE_KEY = 'oc.sessions.pinnedOrder';
export const SESSION_PINNED_ORDER_BY_PROJECT_STORAGE_KEY = 'oc.sessions.pinnedOrderByProject';

const SESSION_PIN_SETTINGS_KEYS = [
  'pinnedSessions',
  'pinnedSessionsByProject',
  'pinnedSessionOrder',
  'pinnedSessionOrderByProject',
] as const;

export type SessionPinSettingsKey = (typeof SESSION_PIN_SETTINGS_KEYS)[number];

/**
 * After connect/switch, local pin effects must not PUT until the host settings
 * handshake has been observed for this endpoint (host wins).
 */
let hostSessionPinsApplied = false;

export const haveHostSessionPinsApplied = (): boolean => hostSessionPinsApplied;

export const markHostSessionPinsApplied = (): void => {
  hostSessionPinsApplied = true;
};

export const resetHostSessionPinsApplied = (): void => {
  hostSessionPinsApplied = false;
};

export const settingsHaveSessionPinFields = (settings: {
  pinnedSessions?: unknown;
  pinnedSessionsByProject?: unknown;
  pinnedSessionOrder?: unknown;
  pinnedSessionOrderByProject?: unknown;
}): boolean => {
  return (
    Array.isArray(settings.pinnedSessions)
    || Array.isArray(settings.pinnedSessionOrder)
    || (settings.pinnedSessionsByProject != null
      && typeof settings.pinnedSessionsByProject === 'object'
      && !Array.isArray(settings.pinnedSessionsByProject))
    || (settings.pinnedSessionOrderByProject != null
      && typeof settings.pinnedSessionOrderByProject === 'object'
      && !Array.isArray(settings.pinnedSessionOrderByProject))
  );
};

/** Drop session-pin keys from a settings PUT when host pins are not applied yet. */
export const stripSessionPinSettingsIfHostPending = <T extends Record<string, unknown>>(
  changes: T,
): T => {
  if (hostSessionPinsApplied) return changes;
  let stripped: Record<string, unknown> | null = null;
  for (const key of SESSION_PIN_SETTINGS_KEYS) {
    if (!(key in changes)) continue;
    if (!stripped) stripped = { ...changes };
    delete stripped[key];
  }
  return (stripped ?? changes) as T;
};

export const sanitizePinnedSessionIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return Array.from(
    new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)),
  );
};

export const sanitizePinnedSessionsByKey = (value: unknown): Record<string, string[]> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    const sanitized = sanitizePinnedSessionIds(ids);
    if (!sanitized) continue;
    if (sanitized.length > 0) {
      result[key] = sanitized;
    }
  }
  return result;
};

export const pinnedSessionsByProjectToMap = (
  value: Record<string, string[]> | undefined,
): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>();
  if (!value) return map;
  for (const [key, ids] of Object.entries(value)) {
    map.set(key, new Set(ids));
  }
  return map;
};

export const pinnedOrderByProjectToMap = (
  value: Record<string, string[]> | undefined,
): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  if (!value) return map;
  for (const [key, order] of Object.entries(value)) {
    map.set(key, [...order]);
  }
  return map;
};

export const mapPinnedSessionsByProject = (
  map: Map<string, Set<string>>,
): Record<string, string[]> => {
  const obj: Record<string, string[]> = {};
  map.forEach((ids, key) => {
    obj[key] = Array.from(ids);
  });
  return obj;
};

export const mapPinnedOrderByProject = (
  map: Map<string, string[]>,
): Record<string, string[]> => {
  const obj: Record<string, string[]> = {};
  map.forEach((order, key) => {
    obj[key] = order;
  });
  return obj;
};

export const areStringSetsEqual = (a: Set<string>, b: Set<string>): boolean => {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
};

export const areStringArraysEqual = (a: string[], b: string[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const arePinnedByProjectMapsEqual = (
  a: Map<string, Set<string>>,
  b: Map<string, Set<string>>,
): boolean => {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, ids] of a) {
    const other = b.get(key);
    if (!other || !areStringSetsEqual(ids, other)) return false;
  }
  return true;
};

export const arePinnedOrderByProjectMapsEqual = (
  a: Map<string, string[]>,
  b: Map<string, string[]>,
): boolean => {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, order] of a) {
    const other = b.get(key);
    if (!other || !areStringArraysEqual(order, other)) return false;
  }
  return true;
};
