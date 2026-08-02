import stripJsonComments from 'strip-json-comments';

type JsonFileViewMode = 'tree' | 'text';

type JsonFileViewState =
  | { readonly kind: 'tree' }
  | { readonly kind: 'source' }
  | { readonly kind: 'invalid-source'; readonly error: string };

/**
 * Parse JSON/JSONC/JSON5 source into a JS value.
 *
 * strip-json-comments is a state-machine parser (not regex): it removes
 * `//` line comments, `/* block *\/` comments, and trailing commas while
 * preserving string literals.  Calling it on strict JSON is a no-op, so we
 * apply it unconditionally — no try/catch heuristic, no file-extension check.
 */
const parseJsonLenient = (source: string): unknown =>
  JSON.parse(stripJsonComments(source, { trailingCommas: true }));

const resolveJsonFileViewState = (
  requestedMode: JsonFileViewMode,
  source: string,
): JsonFileViewState => {
  try {
    parseJsonLenient(source);
  } catch (error) {
    return {
      kind: 'invalid-source',
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }

  return requestedMode === 'tree' ? { kind: 'tree' } : { kind: 'source' };
};

export { parseJsonLenient, resolveJsonFileViewState };
export type { JsonFileViewMode, JsonFileViewState };
