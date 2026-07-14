import { describe, expect, test } from 'bun:test';

import { resolveJsonFileViewState } from './jsonFileViewState';

describe('resolveJsonFileViewState', () => {
  test('keeps invalid JSON editable when tree view was requested', () => {
    // Given: invalid JSON and the tree-view preference.
    const source = '{\n  "valid": true,\n  broken\n}';

    // When: the file display state is resolved.
    const state = resolveJsonFileViewState('tree', source);

    // Then: the source editor is selected and the parse error is preserved.
    expect(state.kind).toBe('invalid-source');
    if (state.kind === 'invalid-source') {
      expect(state.error).toContain('JSON');
    }
  });

  test('keeps valid JSON in tree view when tree view was requested', () => {
    // Given: valid JSON and the tree-view preference.
    const source = '{"valid":true}';

    // When: the file display state is resolved.
    const state = resolveJsonFileViewState('tree', source);

    // Then: the tree view remains active.
    expect(state).toEqual({ kind: 'tree' });
  });

  test('preserves the parse error when text view was requested', () => {
    // Given: invalid JSON and an explicit text-view preference.
    const source = '{ broken';

    // When: the file display state is resolved.
    const state = resolveJsonFileViewState('text', source);

    // Then: the explicit source view remains editable with its parse error.
    expect(state.kind).toBe('invalid-source');
  });
});
