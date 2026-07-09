import { describe, expect, test } from 'bun:test';

import { getExternalFaviconUrl, isExternalHttpUrl, isLoopbackHttpUrl, normalizeHttpUrlCandidate } from './url';

describe('normalizeHttpUrlCandidate', () => {
  test('removes adjacent CJK explanatory text from loopback URLs', () => {
    expect(normalizeHttpUrlCandidate('http://localhost:8081（右上角切换器切了 3 页）')).toBe('http://localhost:8081');
    expect(normalizeHttpUrlCandidate('http://localhost:8081，右上角切换器切了 3 页')).toBe('http://localhost:8081');
  });

  test('removes percent-encoded explanatory text from autolinked URLs', () => {
    expect(
      normalizeHttpUrlCandidate(
        'http://localhost:8081%EF%BC%88%E5%8F%B3%E4%B8%8A%E8%A7%92%E5%88%87%E6%8D%A2%E5%99%A8%E5%88%87%E4%BA%86%203%20%E9%A1%B5%EF%BC%89',
      ),
    ).toBe('http://localhost:8081');
    expect(normalizeHttpUrlCandidate('http://localhost:8081%28mobile%20preview%29')).toBe('http://localhost:8081');
  });

  test('keeps valid URL paths and query strings intact', () => {
    expect(normalizeHttpUrlCandidate('http://localhost:8081/app/(tabs)?page=1#top')).toBe('http://localhost:8081/app/(tabs)?page=1#top');
  });
});

describe('http URL detection', () => {
  test('detects loopback URLs followed by CJK punctuation', () => {
    expect(isLoopbackHttpUrl('http://localhost:8081（右上角切换器切了 3 页）')).toBe(true);
    expect(
      isLoopbackHttpUrl(
        'http://localhost:8081%EF%BC%88%E5%8F%B3%E4%B8%8A%E8%A7%92%E5%88%87%E6%8D%A2%E5%99%A8%E5%88%87%E4%BA%86%203%20%E9%A1%B5%EF%BC%89',
      ),
    ).toBe(true);
    expect(isExternalHttpUrl('http://localhost:8081（右上角切换器切了 3 页）')).toBe(true);
    expect(getExternalFaviconUrl('http://localhost:8081（右上角切换器切了 3 页）')).toBe('https://icons.duckduckgo.com/ip3/localhost.ico');
  });
});
