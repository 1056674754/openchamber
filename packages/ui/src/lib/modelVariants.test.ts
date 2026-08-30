import { describe, expect, test } from 'bun:test';

import { modelVariantNames } from './modelVariants';

describe('modelVariantNames', () => {
  test('returns variant keys and tolerates models without variants', () => {
    expect(modelVariantNames({ variants: { low: {}, high: {} } } as never)).toEqual(['low', 'high']);
    expect(modelVariantNames({} as never)).toEqual([]);
    expect(modelVariantNames(undefined)).toEqual([]);
  });
});
