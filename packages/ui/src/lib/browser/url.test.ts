import { describe, expect, test } from 'bun:test';

import { BLANK_URL, browserUrlLabel, isLoopbackUrl, normalizeBrowserUrl } from './url';

describe('Browser URL handling', () => {
  test('defaults public hosts to HTTPS and loopback development servers to HTTP', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com/');
    expect(normalizeBrowserUrl('localhost:5173')).toBe('http://localhost:5173/');
    expect(normalizeBrowserUrl('127.0.0.1:3000/app')).toBe('http://127.0.0.1:3000/app');
  });

  test('rejects unsafe and invalid schemes', () => {
    expect(normalizeBrowserUrl('file:///etc/passwd')).toBe(BLANK_URL);
    expect(normalizeBrowserUrl('javascript://alert(1)')).toBe(BLANK_URL);
    expect(normalizeBrowserUrl('http://')).toBe(BLANK_URL);
  });

  test('uses host and port as the compact label', () => {
    expect(browserUrlLabel('http://localhost:5173/path')).toBe('localhost:5173');
  });

  test('recognizes only parsed loopback hosts', () => {
    expect(isLoopbackUrl('https://localhost:5173/')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:3000/')).toBe(true);
    expect(isLoopbackUrl('https://localhost.example.com/')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});
