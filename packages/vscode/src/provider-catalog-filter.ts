/**
 * The /provider endpoint merges the full models.dev catalog into the user's
 * providers. Live shape (verified against the managed server):
 *
 *   { all: Array<{ id, name, source, env, options, models }>,   // ~218 entries / ~6MB
 *     default: Record<providerId, string>,                      // ~8KB
 *     connected: Array<providerId> }                            // providers actually usable
 *
 * Older/other deployments also serve a flat { providerId: { models } } map.
 * Shipping the full catalog into the VS Code webview parks a 7.5k-model
 * structure in the UI stores — every model-picker pass then walks thousands
 * of entries on the main thread, which is the gray-screen freeze class.
 * Keep providers that are configured (opencode config layers), connected
 * (per the server's own list), or referenced by synced settings
 * (favorites / hidden / default model).
 */

export type ProviderCatalogFilterReason = 'kept' | 'passthrough';

export type ProviderCatalogFilterResult = {
  bodyText: string;
  reason: ProviderCatalogFilterReason;
  keptProviders: number;
  totalProviders: number;
};

export const providerPrefixOf = (reference: unknown): string | null => {
  if (typeof reference !== 'string' || reference.length === 0) return null;
  const slash = reference.indexOf('/');
  return slash > 0 ? reference.slice(0, slash) : null;
};

export const collectReferencedProviderIds = (values: unknown, into: Set<string>): void => {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    const prefix = providerPrefixOf(value);
    if (prefix) into.add(prefix);
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function projectProviderCatalogResponse(bodyText: string, keepProviderIds: Set<string>): ProviderCatalogFilterResult {
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { bodyText, reason: 'passthrough', keptProviders: 0, totalProviders: 0 };
  }
  if (!isPlainObject(payload)) {
    return { bodyText, reason: 'passthrough', keptProviders: 0, totalProviders: 0 };
  }

  // Live shape: { all: [...], default: {...}, connected: [...] }
  if (Array.isArray(payload.all)) {
    // The server's own "connected" list is authoritative for what the UI can
    // use, so it always extends the keep-set. Entries are bare provider ids
    // (no "provider/model" slash), unlike settings references.
    const effectiveKeep = new Set(keepProviderIds);
    if (Array.isArray(payload.connected)) {
      for (const id of payload.connected) {
        if (typeof id === 'string' && id.length > 0) {
          effectiveKeep.add(id);
        }
      }
    }

    const kept = payload.all.filter((entry): boolean => {
      if (!isPlainObject(entry)) return false;
      const id = entry.id;
      return typeof id === 'string' && effectiveKeep.has(id);
    });
    if (kept.length === 0) {
      // Nothing recognizable — never blank the picker.
      return { bodyText, reason: 'passthrough', keptProviders: 0, totalProviders: payload.all.length };
    }
    const filtered = {
      ...payload,
      all: kept,
    };
    return {
      bodyText: JSON.stringify(filtered),
      reason: 'kept',
      keptProviders: kept.length,
      totalProviders: payload.all.length,
    };
  }

  // Legacy flat map shape: { providerId: { models: {...} } }
  const filtered: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(payload)) {
    if (keepProviderIds.has(id)) {
      filtered[id] = value;
    }
  }
  if (Object.keys(filtered).length === 0) {
    return { bodyText, reason: 'passthrough', keptProviders: 0, totalProviders: Object.keys(payload).length };
  }
  return {
    bodyText: JSON.stringify(filtered),
    reason: 'kept',
    keptProviders: Object.keys(filtered).length,
    totalProviders: Object.keys(payload).length,
  };
}
