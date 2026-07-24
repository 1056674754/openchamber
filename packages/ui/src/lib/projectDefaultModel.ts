/**
 * Per-project default model contract: `"providerID/modelID"`.
 * Slash-containing model IDs are supported (first `/` separates provider).
 */
export const normalizeProjectDefaultModel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const separatorIndex = trimmed.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return undefined;
  }
  return trimmed;
};

export const parseProjectDefaultModel = (
  value: unknown,
): { providerId: string; modelId: string } | null => {
  const normalized = normalizeProjectDefaultModel(value);
  if (!normalized) {
    return null;
  }
  const separatorIndex = normalized.indexOf('/');
  return {
    providerId: normalized.slice(0, separatorIndex),
    modelId: normalized.slice(separatorIndex + 1),
  };
};

export const formatProjectDefaultModel = (
  providerId: string | null | undefined,
  modelId: string | null | undefined,
): string | undefined => {
  const provider = typeof providerId === 'string' ? providerId.trim() : '';
  const model = typeof modelId === 'string' ? modelId.trim() : '';
  if (!provider || !model) {
    return undefined;
  }
  return normalizeProjectDefaultModel(`${provider}/${model}`);
};
