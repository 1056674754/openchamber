import { beforeEach, describe, expect, test } from 'bun:test';
import {
  sanitizePinnedSessionIds,
  sanitizePinnedSessionsByKey,
  pinnedSessionsByProjectToMap,
  mapPinnedSessionsByProject,
  arePinnedByProjectMapsEqual,
  haveHostSessionPinsApplied,
  markHostSessionPinsApplied,
  resetHostSessionPinsApplied,
  settingsHaveSessionPinFields,
  stripSessionPinSettingsIfHostPending,
} from './sessionPinSettings';

describe('sessionPinSettings', () => {
  beforeEach(() => {
    resetHostSessionPinsApplied();
  });

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

  test('host pin applied gate strips pin PUTs until marked', () => {
    expect(haveHostSessionPinsApplied()).toBe(false);
    const pending = stripSessionPinSettingsIfHostPending({
      themeId: 'x',
      pinnedSessions: ['a'],
      pinnedSessionOrder: ['a'],
      pinnedSessionsByProject: { '/p': ['a'] },
      pinnedSessionOrderByProject: { '/p': ['a'] },
    });
    expect(pending).toEqual({ themeId: 'x' });

    markHostSessionPinsApplied();
    expect(haveHostSessionPinsApplied()).toBe(true);
    const allowed = stripSessionPinSettingsIfHostPending({
      pinnedSessions: [],
    });
    expect(allowed).toEqual({ pinnedSessions: [] });
  });

  test('settingsHaveSessionPinFields detects presence including empty arrays', () => {
    expect(settingsHaveSessionPinFields({})).toBe(false);
    expect(settingsHaveSessionPinFields({ pinnedSessions: [] })).toBe(true);
    expect(settingsHaveSessionPinFields({ pinnedSessionsByProject: {} })).toBe(true);
  });

  test('resetHostSessionPinsApplied clears the gate', () => {
    markHostSessionPinsApplied();
    resetHostSessionPinsApplied();
    expect(haveHostSessionPinsApplied()).toBe(false);
  });
});
