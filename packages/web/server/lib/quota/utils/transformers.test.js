import { describe, expect, it } from 'vitest';

import { toTimestamp } from './transformers.js';

describe('toTimestamp', () => {
  it('parses a millisecond epoch encoded as a string', () => {
    // Given an API timestamp encoded as a numeric string
    const timestamp = '1785377115000';

    // When the timestamp is normalized
    const result = toTimestamp(timestamp);

    // Then the millisecond epoch is preserved
    expect(result).toBe(1_785_377_115_000);
  });
});
