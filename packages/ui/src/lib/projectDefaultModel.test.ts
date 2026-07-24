import { describe, expect, test } from 'bun:test';
import {
  formatProjectDefaultModel,
  normalizeProjectDefaultModel,
  parseProjectDefaultModel,
} from './projectDefaultModel';

describe('projectDefaultModel', () => {
  test('normalizes provider/model strings', () => {
    expect(normalizeProjectDefaultModel('  anthropic/claude-opus-4  ')).toBe('anthropic/claude-opus-4');
    expect(normalizeProjectDefaultModel('opencode/big-pickle')).toBe('opencode/big-pickle');
  });

  test('supports slash-containing model IDs', () => {
    expect(normalizeProjectDefaultModel('provider/org/model')).toBe('provider/org/model');
    expect(parseProjectDefaultModel('provider/org/model')).toEqual({
      providerId: 'provider',
      modelId: 'org/model',
    });
  });

  test('rejects invalid values', () => {
    expect(normalizeProjectDefaultModel('')).toBe(undefined);
    expect(normalizeProjectDefaultModel('no-slash')).toBe(undefined);
    expect(normalizeProjectDefaultModel('/missing-provider')).toBe(undefined);
    expect(normalizeProjectDefaultModel('missing-model/')).toBe(undefined);
    expect(normalizeProjectDefaultModel(null)).toBe(undefined);
  });

  test('formats and clears via empty provider/model', () => {
    expect(formatProjectDefaultModel('anthropic', 'claude')).toBe('anthropic/claude');
    expect(formatProjectDefaultModel('', 'claude')).toBe(undefined);
    expect(formatProjectDefaultModel('anthropic', '')).toBe(undefined);
  });
});
