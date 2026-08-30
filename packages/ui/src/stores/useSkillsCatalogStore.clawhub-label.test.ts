import { beforeEach, describe, expect, mock, test } from 'bun:test';

let runtimeFetchImpl: (input: string | URL | Request) => Promise<Response> = async () => new Response('{}', { status: 500 });
let runtimeIdentity = '/api/local';

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: { getDirectory: () => undefined },
}));

mock.module('@/stores/useProjectsStore', () => ({
  useProjectsStore: { getState: () => ({ getActiveProject: () => null }) },
}));

mock.module('@/lib/runtime-fetch', () => ({
  buildRuntimeFetchUrl: () => runtimeIdentity,
  runtimeFetch: (input: string | URL | Request) => runtimeFetchImpl(input),
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
    runtimeFetchImpl = async () => new Response('{}', { status: 500 });
    runtimeIdentity = '/api/local';
    useSkillsCatalogStore.setState({
      itemsBySource: {},
      loadedSourceIds: {},
      isLoadingSource: false,
      lastCatalogError: null,
    });
  });

  test('uses the public ClawHub name for fallback sources', () => {
    const source = useSkillsCatalogStore.getState().sources.find((item) => item.id === 'clawdhub');
    expect(source?.label).toBe('ClawHub');
  });

  test('keeps ClawHub alongside every curated GitHub collection', () => {
    expect(useSkillsCatalogStore.getState().sources.map((source) => source.id)).toEqual([
      'anthropic', 'openai', 'cursor', 'mattpocock', 'clawdhub',
    ]);
  });

  test('deduplicates source loads through the active runtime transport', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    runtimeFetchImpl = async (input) => {
      calls.push(String(input));
      await gate;
      return Response.json({ ok: true, items: [] });
    };

    const first = useSkillsCatalogStore.getState().loadSource('anthropic');
    const second = useSkillsCatalogStore.getState().loadSource('anthropic');
    release();
    await Promise.all([first, second]);

    expect(calls).toEqual(['/api/config/skills/catalog/source?sourceId=anthropic']);
  });

  test('does not share source loads between runtime instances', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    runtimeFetchImpl = async () => {
      calls += 1;
      await gate;
      return Response.json({ ok: true, items: [] });
    };
    const local = useSkillsCatalogStore.getState().loadSource('anthropic');
    runtimeIdentity = '/api/remote/dev3';
    const remote = useSkillsCatalogStore.getState().loadSource('anthropic');
    release();
    await Promise.all([local, remote]);
    expect(calls).toBe(2);
  });
});
