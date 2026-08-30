import { describe, expect, test } from 'bun:test';

import {
  MAX_HISTORY_ENTRIES,
  forgetVisit,
  recordVisit,
  suggestFromHistory,
  type BrowserHistoryEntry,
} from './history';

describe('Browser history', () => {
  test('records newest first and revisits without duplicates', () => {
    const first = recordVisit([], { url: 'localhost:5173', title: 'App', at: 1 });
    const second = recordVisit(first, { url: 'http://localhost:5173/', at: 2 });
    expect(second).toEqual([{ url: 'http://localhost:5173/', title: 'App', lastVisitedAt: 2 }]);
  });

  test('matches URL fragments and titles', () => {
    const entries = [
      { url: 'https://example.com/admin', title: 'Control room', lastVisitedAt: 2 },
      { url: 'http://localhost:5173/', title: 'Portal', lastVisitedAt: 1 },
    ];
    expect(suggestFromHistory(entries, '5173').map((entry) => entry.title)).toEqual(['Portal']);
    expect(suggestFromHistory(entries, 'control').map((entry) => entry.url)).toEqual(['https://example.com/admin']);
  });

  test('forgets one URL and caps retained history', () => {
    let entries: BrowserHistoryEntry[] = [];
    for (let index = 0; index < MAX_HISTORY_ENTRIES + 5; index += 1) {
      entries = recordVisit(entries, { url: `https://example.com/${index}`, at: index });
    }
    expect(entries.length).toBe(MAX_HISTORY_ENTRIES);
    expect(forgetVisit(entries, entries[0]?.url ?? '').length).toBe(MAX_HISTORY_ENTRIES - 1);
  });
});
