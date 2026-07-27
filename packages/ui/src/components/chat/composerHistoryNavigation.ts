/**
 * Pure helpers for composer ArrowUp/ArrowDown message-history navigation.
 * Matches upstream 1.16.x: no autocomplete, collapsed caret at start/end.
 */

export type ComposerHistoryNavGate = {
  autocompleteOpen: boolean;
  messageLength: number;
  selectionStart: number;
  selectionEnd: number;
};

export const isComposerSelectionCollapsed = (
  selectionStart: number,
  selectionEnd: number,
): boolean => selectionStart === selectionEnd && selectionStart >= 0;

export const canNavigateComposerHistoryUp = (args: ComposerHistoryNavGate): boolean => {
  if (args.autocompleteOpen) return false;
  if (!isComposerSelectionCollapsed(args.selectionStart, args.selectionEnd)) return false;
  if (args.messageLength === 0) return true;
  return args.selectionStart === 0;
};

export const canNavigateComposerHistoryDown = (args: ComposerHistoryNavGate): boolean => {
  if (args.autocompleteOpen) return false;
  if (!isComposerSelectionCollapsed(args.selectionStart, args.selectionEnd)) return false;
  if (args.messageLength === 0) return true;
  return args.selectionStart === args.messageLength;
};

export type ComposerHistoryStep =
  | { type: 'enter'; index: 0; saveDraft: true }
  | { type: 'older'; index: number }
  | { type: 'newer'; index: number }
  | { type: 'exit'; restoreDraft: true }
  | { type: 'noop' };

/** historyIndex: -1 = not browsing; 0 = most recent. */
export const resolveComposerHistoryArrowUp = (args: {
  historyIndex: number;
  historyLength: number;
}): ComposerHistoryStep => {
  if (args.historyLength <= 0) return { type: 'noop' };
  if (args.historyIndex === -1) {
    return { type: 'enter', index: 0, saveDraft: true };
  }
  if (args.historyIndex < args.historyLength - 1) {
    return { type: 'older', index: args.historyIndex + 1 };
  }
  return { type: 'noop' };
};

export const resolveComposerHistoryArrowDown = (args: {
  historyIndex: number;
}): ComposerHistoryStep => {
  if (args.historyIndex < 0) return { type: 'noop' };
  if (args.historyIndex === 0) {
    return { type: 'exit', restoreDraft: true };
  }
  return { type: 'newer', index: args.historyIndex - 1 };
};
