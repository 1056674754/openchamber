import { describe, expect, test } from 'bun:test';
import { LEGACY_FORM_CUSTOM_TEXTAREA_MIN_HEIGHT, getLegacyFormCustomTextareaHeight } from '../legacyFormTextareaSizing';

describe('getLegacyFormCustomTextareaHeight', () => {
  test('exports the initial textarea height', () => {
    expect(LEGACY_FORM_CUSTOM_TEXTAREA_MIN_HEIGHT).toBe(40);
  });

  test('returns null when the textarea is already at the target height', () => {
    expect(getLegacyFormCustomTextareaHeight({ scrollHeight: 60, currentHeight: 60 })).toBeNull();
  });

  test('clamps textarea height between two and ten lines', () => {
    expect(getLegacyFormCustomTextareaHeight({ scrollHeight: 10, currentHeight: 0 })).toBe(40);
    expect(getLegacyFormCustomTextareaHeight({ scrollHeight: 120, currentHeight: 0 })).toBe(120);
    expect(getLegacyFormCustomTextareaHeight({ scrollHeight: 260, currentHeight: 0 })).toBe(200);
  });
});
