import { describe, expect, test } from 'bun:test';

import { LOCALES, LOCALE_LABEL_KEYS, normalizeLocale } from './runtime';

describe('i18n runtime locales', () => {
  test('normalizes Turkish locale variants', () => {
    expect(normalizeLocale('tr')).toBe('tr');
    expect(normalizeLocale('tr-TR')).toBe('tr');
  });

  test('labels every selectable locale', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_LABEL_KEYS[locale]).toBeTruthy();
    }
  });
});
