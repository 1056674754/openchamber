import { describe, expect, test } from 'bun:test';
import { NOTES_SUMMARIZE_MIN_CHARS, shouldSummarizeSelectionForNotes } from './smallModelGate';

describe('shouldSummarizeSelectionForNotes', () => {
  test('skips short selections', () => {
    expect(shouldSummarizeSelectionForNotes('short')).toBe(false);
    expect(shouldSummarizeSelectionForNotes('x'.repeat(NOTES_SUMMARIZE_MIN_CHARS - 1))).toBe(false);
  });

  test('accepts long selections', () => {
    expect(shouldSummarizeSelectionForNotes('x'.repeat(NOTES_SUMMARIZE_MIN_CHARS))).toBe(true);
  });
});
