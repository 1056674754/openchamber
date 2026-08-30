import { describe, expect, test } from 'bun:test';

import { shouldPreserveManualModelOverride } from './userModelChoice';

describe('shouldPreserveManualModelOverride', () => {
  const savedSessionModel = { providerId: 'openai', modelId: 'gpt-5' };

  test('protects a manually selected session model from a default-only update', () => {
    expect(shouldPreserveManualModelOverride({
      selectionSource: 'manual',
      savedSessionModel,
      candidate: null,
    })).toBe(true);
  });

  test('does not protect automatic or missing session selections', () => {
    expect(shouldPreserveManualModelOverride({
      selectionSource: 'auto',
      savedSessionModel,
      candidate: null,
    })).toBe(false);
    expect(shouldPreserveManualModelOverride({
      selectionSource: 'manual',
      savedSessionModel: null,
      candidate: null,
    })).toBe(false);
  });

  test('only preserves against a restored candidate when the models differ', () => {
    expect(shouldPreserveManualModelOverride({
      selectionSource: 'manual',
      savedSessionModel,
      candidate: { providerID: 'openai', modelID: 'gpt-5' },
    })).toBe(false);
    expect(shouldPreserveManualModelOverride({
      selectionSource: 'manual',
      savedSessionModel,
      candidate: { providerID: 'anthropic', modelID: 'claude' },
    })).toBe(true);
  });
});
