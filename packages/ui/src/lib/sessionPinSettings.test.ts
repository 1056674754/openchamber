import { describe, expect, test } from 'bun:test';
import {
  sanitizePinnedSessionIds,
  sanitizePinnedSessionsByKey,
  pinnedSessionsByProjectToMap,
  mapPinnedSessionsByProject,
  arePinnedByProjectMapsEqual,
} from './sessionPinSettings';

describe('sessionPinSettings', () => {
  test('sanitizePinnedSessionIds dedupes and drops empties', () => {
    expect(sanitizePinnedSessionIds(['a', 'a', '', 'b', 1 as unknown as string])).toEqual(['a', 'b']);
    expect(sanitizePinnedSessionIds(null)).toEqual(undefined);
  });

  test('sanitizePinnedSessionsByKey keeps non-empty project maps', () => {
    expect(
      sanitizePinnedSessionsByKey({
        '/proj': ['s1', 's1'],
        '/empty': [],
        '': ['x'],
      }),
    ).toEqual({ '/proj': ['s1'] });
  });

  test('map round-trip preserves sets', () => {
    const original = new Map<string, Set<string>>([['/p', new Set(['a', 'b'])]]);
    const record = mapPinnedSessionsByProject(original);
    const back = pinnedSessionsByProjectToMap(record);
    expect(arePinnedByProjectMapsEqual(original, back)).toBe(true);
  });
});
