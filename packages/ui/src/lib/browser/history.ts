import { normalizeBrowserUrl } from './url';

export type BrowserHistoryEntry = {
  readonly url: string;
  readonly title: string;
  readonly lastVisitedAt: number;
};

export const MAX_HISTORY_ENTRIES = 50;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 200;

export const historyUrl = (value: string): string => {
  const normalized = normalizeBrowserUrl(String(value ?? '').trim());
  if (!normalized || normalized.length > MAX_URL_LENGTH) return '';
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
};

export const recordVisit = (
  entries: readonly BrowserHistoryEntry[],
  visit: { url: string; title?: string; at: number },
): BrowserHistoryEntry[] => {
  const url = historyUrl(visit.url);
  if (!url) return entries as BrowserHistoryEntry[];
  const previous = entries.find((entry) => entry.url === url);
  const title = String(visit.title ?? '').trim().slice(0, MAX_TITLE_LENGTH) || previous?.title || '';
  return [
    { url, title, lastVisitedAt: visit.at },
    ...entries.filter((entry) => entry.url !== url),
  ].slice(0, MAX_HISTORY_ENTRIES);
};

export const forgetVisit = (
  entries: readonly BrowserHistoryEntry[],
  url: string,
): BrowserHistoryEntry[] => {
  const target = historyUrl(url);
  return entries.filter((entry) => entry.url !== target);
};

export const suggestFromHistory = (
  entries: readonly BrowserHistoryEntry[],
  query: string,
  limit = 6,
): BrowserHistoryEntry[] => {
  const needle = String(query ?? '').trim().toLowerCase().replace(/^https?:\/\//, '');
  const ordered = [...entries].sort((left, right) => right.lastVisitedAt - left.lastVisitedAt);
  if (!needle) return ordered.slice(0, limit);
  return ordered.filter((entry) => (
    `${entry.url.replace(/^https?:\/\//, '')} ${entry.title}`.toLowerCase().includes(needle)
  )).slice(0, limit);
};
