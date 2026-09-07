/**
 * The /provider endpoint merges the full models.dev catalog (200+ providers,
 * ~7.5k models, ~5MB JSON) into the user's configured providers. Shipping
 * that into the VS Code webview over postMessage parks a giant model catalog
 * in the UI stores — every model-picker pass then walks thousands of entries
 * on the main thread, which is the gray-screen freeze class. Drop catalog
 * providers that are not configured (user/project/custom layers) and not
 * referenced by synced settings (favorites/hidden/default model).
 */
export function projectProviderCatalogResponse(bodyText: string, keepProviderIds: Set<string>): string {
  try {
    const payload: unknown = JSON.parse(bodyText);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return bodyText;
    }
    const filtered: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(payload as Record<string, unknown>)) {
      if (keepProviderIds.has(id)) {
        filtered[id] = value;
      }
    }
    if (Object.keys(filtered).length === 0) {
      // Unexpected shape or nothing configured — never blank the picker.
      return bodyText;
    }
    return JSON.stringify(filtered);
  } catch {
    return bodyText;
  }
}

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
