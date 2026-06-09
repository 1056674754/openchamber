import { describe, expect, test } from 'bun:test';
import { getResolvedReference, isLikelyFilePath, parseFileReference } from '../markdownFileReferences';

describe('markdown file reference heuristics', () => {
  test('does not treat IP endpoints as file references', () => {
    expect(isLikelyFilePath('43.154.84.58')).toBe(false);
    expect(isLikelyFilePath('43.154.84.58:9993')).toBe(false);
    expect(isLikelyFilePath('81.68.238.43:9993')).toBe(false);
    expect(getResolvedReference('43.154.84.58:9993', '/repo')).toBe(null);
  });

  test('does not treat bare domain-shaped tokens as file references', () => {
    expect(isLikelyFilePath('example.com')).toBe(false);
    expect(isLikelyFilePath('search.s-s.city')).toBe(false);
    expect(isLikelyFilePath('xxx.yyy')).toBe(false);
  });

  test('keeps common bare filenames and line references clickable', () => {
    expect(isLikelyFilePath('package.json')).toBe(true);
    expect(isLikelyFilePath('docker-compose.yml')).toBe(true);
    expect(isLikelyFilePath('MarkdownRendererImpl.tsx:872')).toBe(true);
    expect(parseFileReference('MarkdownRendererImpl.tsx:872')).toEqual({
      path: 'MarkdownRendererImpl.tsx',
      line: 872,
      column: undefined,
    });
  });

  test('keeps explicit paths with custom extensions discoverable', () => {
    expect(isLikelyFilePath('src/example.custom')).toBe(true);
    expect(isLikelyFilePath('./example.custom')).toBe(true);
    expect(isLikelyFilePath('../example.custom')).toBe(true);
  });
});
