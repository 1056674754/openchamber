import { describe, expect, test } from 'bun:test';

import { normalizePath } from './pathNormalization';

describe('normalizePath', () => {
  test('canonicalizes Windows separators and drive-letter casing', () => {
    expect(normalizePath('c:\\Users\\me\\project\\')).toBe('C:/Users/me/project');
    expect(normalizePath('C:/Users/me/project')).toBe('C:/Users/me/project');
  });

  test('does not case-fold POSIX paths or colon-containing names', () => {
    expect(normalizePath('/Users/Song/Project/')).toBe('/Users/Song/Project');
    expect(normalizePath('abc:def')).toBe('abc:def');
  });

  test('handles empty and root paths', () => {
    expect(normalizePath('   ')).toBeNull();
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('///')).toBeNull();
  });
});
