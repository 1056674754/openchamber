import { describe, expect, test } from 'bun:test';
import { canonicalizeTimezone } from './timezones';

describe('canonicalizeTimezone', () => {
  test('uses the modern IANA identifier for a known legacy alias', () => {
    expect(canonicalizeTimezone('Europe/Kiev')).toBe('Europe/Kyiv');
  });

  test('preserves an identifier that has no migration', () => {
    expect(canonicalizeTimezone('Asia/Shanghai')).toBe('Asia/Shanghai');
  });
});
