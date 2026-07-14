type JsonFileViewMode = 'tree' | 'text';

type JsonFileViewState =
  | { readonly kind: 'tree' }
  | { readonly kind: 'source' }
  | { readonly kind: 'invalid-source'; readonly error: string };

const resolveJsonFileViewState = (
  requestedMode: JsonFileViewMode,
  source: string,
): JsonFileViewState => {
  try {
    JSON.parse(source);
  } catch (error) {
    return {
      kind: 'invalid-source',
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }

  return requestedMode === 'tree' ? { kind: 'tree' } : { kind: 'source' };
};

export { resolveJsonFileViewState };
export type { JsonFileViewMode, JsonFileViewState };
