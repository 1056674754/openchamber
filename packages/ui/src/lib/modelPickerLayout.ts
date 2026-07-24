import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';

export type ModelPickerLayout = {
  providerOrder: string[];
  collapsedProviders: string[];
};

export type ModelPickerLayoutByServerId = Record<string, ModelPickerLayout>;

export const EMPTY_MODEL_PICKER_LAYOUT: ModelPickerLayout = {
  providerOrder: [],
  collapsedProviders: [],
};

export const MODEL_PICKER_SECTION_FAVORITES = 'favorites';
export const MODEL_PICKER_SECTION_RECENT = 'recent';

const MAX_SERVERS = 64;
const MAX_PROVIDER_ORDER = 256;
const MAX_COLLAPSED = 256;

export const modelPickerProviderSectionKey = (providerID: string): string => `provider:${providerID}`;

export const normalizeModelPickerServerId = (serverId: string | null | undefined): string => {
  const trimmed = typeof serverId === 'string' ? serverId.trim() : '';
  return trimmed || DEFAULT_SERVER_ID;
};

const normalizeStringList = (value: unknown, limit: number): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
};

/** Convert legacy bare provider IDs into section keys used by the picker accordion. */
export const migrateLegacyCollapsedProviders = (value: unknown): string[] => {
  const raw = normalizeStringList(value, MAX_COLLAPSED);
  return raw.map((entry) => {
    if (
      entry === MODEL_PICKER_SECTION_FAVORITES
      || entry === MODEL_PICKER_SECTION_RECENT
      || entry.startsWith('provider:')
    ) {
      return entry;
    }
    return modelPickerProviderSectionKey(entry);
  });
};

export const sanitizeModelPickerLayout = (value: unknown): ModelPickerLayout => {
  if (!value || typeof value !== 'object') {
    return { ...EMPTY_MODEL_PICKER_LAYOUT };
  }
  const record = value as Record<string, unknown>;
  return {
    providerOrder: normalizeStringList(record.providerOrder, MAX_PROVIDER_ORDER),
    collapsedProviders: migrateLegacyCollapsedProviders(record.collapsedProviders),
  };
};

export const sanitizeModelPickerLayoutByServerId = (value: unknown): ModelPickerLayoutByServerId => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: ModelPickerLayoutByServerId = {};
  for (const [rawKey, rawLayout] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(result).length >= MAX_SERVERS) break;
    const serverId = normalizeModelPickerServerId(rawKey);
    if (result[serverId]) continue;
    const layout = sanitizeModelPickerLayout(rawLayout);
    if (layout.providerOrder.length === 0 && layout.collapsedProviders.length === 0) {
      continue;
    }
    result[serverId] = layout;
  }
  return result;
};

export const migrateModelPickerLayoutState = (input: {
  modelPickerLayoutByServerId?: unknown;
  collapsedModelProviders?: unknown;
}): ModelPickerLayoutByServerId => {
  const layoutByServerId = sanitizeModelPickerLayoutByServerId(input.modelPickerLayoutByServerId);
  const legacyCollapsed = migrateLegacyCollapsedProviders(input.collapsedModelProviders);
  if (legacyCollapsed.length === 0) {
    return layoutByServerId;
  }

  const defaultLayout = layoutByServerId[DEFAULT_SERVER_ID] ?? { ...EMPTY_MODEL_PICKER_LAYOUT };
  if (defaultLayout.collapsedProviders.length > 0) {
    return layoutByServerId;
  }

  return {
    ...layoutByServerId,
    [DEFAULT_SERVER_ID]: {
      providerOrder: defaultLayout.providerOrder.slice(),
      collapsedProviders: legacyCollapsed,
    },
  };
};

export const getModelPickerLayout = (
  layoutByServerId: ModelPickerLayoutByServerId | undefined,
  serverId: string | null | undefined,
): ModelPickerLayout => {
  const key = normalizeModelPickerServerId(serverId);
  const layout = layoutByServerId?.[key];
  if (!layout) return { ...EMPTY_MODEL_PICKER_LAYOUT };
  return {
    providerOrder: layout.providerOrder.slice(),
    collapsedProviders: layout.collapsedProviders.slice(),
  };
};

export const sortProvidersByOrder = <T extends { id: string }>(
  providers: readonly T[],
  providerOrder: readonly string[],
): T[] => {
  if (providerOrder.length === 0 || providers.length <= 1) {
    return providers.slice();
  }

  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const ordered: T[] = [];
  const seen = new Set<string>();

  for (const providerID of providerOrder) {
    const provider = byId.get(providerID);
    if (!provider || seen.has(providerID)) continue;
    ordered.push(provider);
    seen.add(providerID);
  }

  for (const provider of providers) {
    if (seen.has(provider.id)) continue;
    ordered.push(provider);
  }

  return ordered;
};

export const toggleCollapsedSectionKey = (
  collapsedProviders: readonly string[],
  sectionKey: string,
): string[] => {
  const normalized = typeof sectionKey === 'string' ? sectionKey.trim() : '';
  if (!normalized) return collapsedProviders.slice();
  if (collapsedProviders.includes(normalized)) {
    return collapsedProviders.filter((entry) => entry !== normalized);
  }
  return [...collapsedProviders, normalized];
};

export const setCollapsedSectionKeys = (
  collapsedProviders: readonly string[],
  sectionKeys: readonly string[],
  collapsed: boolean,
): string[] => {
  const normalizedKeys = Array.from(new Set(
    sectionKeys
      .filter((key): key is string => typeof key === 'string')
      .map((key) => key.trim())
      .filter(Boolean),
  ));
  if (normalizedKeys.length === 0) return collapsedProviders.slice();

  const scoped = new Set(normalizedKeys);
  const untouched = collapsedProviders.filter((key) => !scoped.has(key));
  return collapsed
    ? [...untouched, ...normalizedKeys].slice(0, MAX_COLLAPSED)
    : untouched;
};

export const areModelPickerLayoutsEqual = (
  left: ModelPickerLayout,
  right: ModelPickerLayout,
): boolean => (
  left.providerOrder.length === right.providerOrder.length
  && left.collapsedProviders.length === right.collapsedProviders.length
  && left.providerOrder.every((value, index) => value === right.providerOrder[index])
  && left.collapsedProviders.every((value, index) => value === right.collapsedProviders[index])
);

export const areModelPickerLayoutMapsEqual = (
  left: ModelPickerLayoutByServerId | undefined,
  right: ModelPickerLayoutByServerId | undefined,
): boolean => {
  const leftKeys = Object.keys(left ?? {});
  const rightKeys = Object.keys(right ?? {});
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const leftLayout = left?.[key];
    const rightLayout = right?.[key];
    if (!leftLayout || !rightLayout) return false;
    return areModelPickerLayoutsEqual(leftLayout, rightLayout);
  });
};
