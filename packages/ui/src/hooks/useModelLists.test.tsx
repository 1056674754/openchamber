import { describe, expect, mock, test } from 'bun:test';

type MockConfigState = {
  readonly providers: [];
};

const mockConfigState: MockConfigState = { providers: [] };

mock.module('@/stores/useConfigStore', () => ({
  useConfigStore: <T,>(selector: (state: MockConfigState) => T): T => selector(mockConfigState),
}));

const { buildModelLists } = await import('./useModelLists');

describe('useModelLists', () => {
  test('exposes hidden models and removes them from shared picker sections', () => {
    const hiddenModels = [{ providerID: 'anthropic', modelID: 'claude-opus' }];
    const result = buildModelLists({
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: [
            { id: 'claude-opus', name: 'Claude Opus' },
            { id: 'claude-sonnet', name: 'Claude Sonnet' },
          ],
        },
      ],
      favoriteModels: hiddenModels,
      recentModels: [
        { providerID: 'anthropic', modelID: 'claude-opus' },
        { providerID: 'anthropic', modelID: 'claude-sonnet' },
      ],
      hiddenModels,
    });

    expect(result.hiddenModels).toEqual(hiddenModels);
    expect(result.favoriteModelsList).toEqual([]);
    expect(result.recentModelsList.map((entry) => entry.modelID)).toEqual(['claude-sonnet']);
  });
});
