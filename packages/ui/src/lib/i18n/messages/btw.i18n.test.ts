import { describe, expect, test } from 'bun:test';

import { btwI18n } from './btw.i18n';

describe('/btw translations', () => {
  test('keeps every runtime locale aligned with the English contract', () => {
    const expected = Object.keys(btwI18n.en).sort();
    for (const dictionary of Object.values(btwI18n)) {
      expect(Object.keys(dictionary).sort()).toEqual(expected);
    }
  });
});
