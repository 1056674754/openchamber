/** Selections shorter than this stay verbatim when saving to Notes. */
export const NOTES_SUMMARIZE_MIN_CHARS = 280;

export const shouldSummarizeSelectionForNotes = (text: string): boolean =>
  text.trim().length >= NOTES_SUMMARIZE_MIN_CHARS;
