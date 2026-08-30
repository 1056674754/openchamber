import { describe, expect, test } from 'bun:test';

import { chatsI18n } from './chats.i18n';

describe('managed Chats translations', () => {
  test('covers every runtime locale', () => {
    const expected = Object.keys(chatsI18n.en);
    for (const dictionary of Object.values(chatsI18n)) {
      expect(Object.keys(dictionary)).toEqual(expected);
    }
  });
});
