import { describe, expect, test } from 'bun:test';

import { getDefaultModels } from './model-families';

describe('quota model defaults', () => {
  test('selects every model-scoped Claude limit by default', () => {
    expect(getDefaultModels('claude', ['Fable', 'Opus', 'Custom Model'])).toEqual([
      'Fable',
      'Opus',
      'Custom Model',
    ]);
  });
});
