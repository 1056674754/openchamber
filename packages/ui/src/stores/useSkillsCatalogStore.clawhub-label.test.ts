import { beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: { getDirectory: () => undefined },
}));

mock.module('@/stores/useProjectsStore', () => ({
  useProjectsStore: { getState: () => ({ getActiveProject: () => null }) },
}));

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: async () => new Response('{}', { status: 500 }),
}));

mock.module('@/stores/useSkillsStore', () => ({
  invalidateSkillsLoadCache: () => undefined,
  refreshSkillsAfterOpenCodeRestart: async () => undefined,
  useSkillsStore: { getState: () => ({}) },
}));

mock.module('@/lib/configUpdate', () => ({
  startConfigUpdate: () => undefined,
  finishConfigUpdate: () => undefined,
  updateConfigUpdateMessage: () => undefined,
}));

const { useSkillsCatalogStore } = await import('./useSkillsCatalogStore');

describe('skills catalog ClawHub label', () => {
  beforeEach(() => {
    useSkillsCatalogStore.setState({ sources: useSkillsCatalogStore.getState().sources });
  });

  test('uses the public ClawHub name for fallback sources', () => {
    const source = useSkillsCatalogStore.getState().sources.find((item) => item.id === 'clawdhub');
    expect(source?.label).toBe('ClawHub');
  });
});
