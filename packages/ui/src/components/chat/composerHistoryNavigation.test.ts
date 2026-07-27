import { describe, expect, test } from 'bun:test';
import {
  canNavigateComposerHistoryDown,
  canNavigateComposerHistoryUp,
  resolveComposerHistoryArrowDown,
  resolveComposerHistoryArrowUp,
} from './composerHistoryNavigation';

describe('composerHistoryNavigation gates', () => {
  test('ArrowUp blocked when autocomplete is open', () => {
    expect(canNavigateComposerHistoryUp({
      autocompleteOpen: true,
      messageLength: 0,
      selectionStart: 0,
      selectionEnd: 0,
    })).toBe(false);
  });

  test('ArrowUp blocked when selection is not collapsed', () => {
    expect(canNavigateComposerHistoryUp({
      autocompleteOpen: false,
      messageLength: 10,
      selectionStart: 0,
      selectionEnd: 3,
    })).toBe(false);
  });

  test('ArrowUp allowed at start or when empty', () => {
    expect(canNavigateComposerHistoryUp({
      autocompleteOpen: false,
      messageLength: 0,
      selectionStart: 0,
      selectionEnd: 0,
    })).toBe(true);
    expect(canNavigateComposerHistoryUp({
      autocompleteOpen: false,
      messageLength: 12,
      selectionStart: 0,
      selectionEnd: 0,
    })).toBe(true);
    expect(canNavigateComposerHistoryUp({
      autocompleteOpen: false,
      messageLength: 12,
      selectionStart: 4,
      selectionEnd: 4,
    })).toBe(false);
  });

  test('ArrowDown only at end or when empty', () => {
    expect(canNavigateComposerHistoryDown({
      autocompleteOpen: false,
      messageLength: 5,
      selectionStart: 5,
      selectionEnd: 5,
    })).toBe(true);
    expect(canNavigateComposerHistoryDown({
      autocompleteOpen: false,
      messageLength: 5,
      selectionStart: 2,
      selectionEnd: 2,
    })).toBe(false);
    expect(canNavigateComposerHistoryDown({
      autocompleteOpen: true,
      messageLength: 5,
      selectionStart: 5,
      selectionEnd: 5,
    })).toBe(false);
  });
});

describe('composerHistoryNavigation steps', () => {
  test('ArrowUp enters then walks older until noop', () => {
    expect(resolveComposerHistoryArrowUp({ historyIndex: -1, historyLength: 3 })).toEqual({
      type: 'enter',
      index: 0,
      saveDraft: true,
    });
    expect(resolveComposerHistoryArrowUp({ historyIndex: 0, historyLength: 3 })).toEqual({
      type: 'older',
      index: 1,
    });
    expect(resolveComposerHistoryArrowUp({ historyIndex: 2, historyLength: 3 })).toEqual({
      type: 'noop',
    });
    expect(resolveComposerHistoryArrowUp({ historyIndex: -1, historyLength: 0 })).toEqual({
      type: 'noop',
    });
  });

  test('ArrowDown walks newer then exits to draft', () => {
    expect(resolveComposerHistoryArrowDown({ historyIndex: 2 })).toEqual({
      type: 'newer',
      index: 1,
    });
    expect(resolveComposerHistoryArrowDown({ historyIndex: 0 })).toEqual({
      type: 'exit',
      restoreDraft: true,
    });
    expect(resolveComposerHistoryArrowDown({ historyIndex: -1 })).toEqual({
      type: 'noop',
    });
  });
});
