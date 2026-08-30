import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { AgentMemoryLoadResult } from '@/lib/agentMemoryApi';

const project = { id: 'mutable', path: '/workspace/app' };
const key = 'path_L3dvcmtzcGFjZS9hcHA';
let loadResult: AgentMemoryLoadResult = { enabled: false };
let loadError: Error | null = null;

mock.module('@/lib/agentMemoryApi', () => ({
  fetchAgentMemory: mock(async () => {
    if (loadError) throw loadError;
    return loadResult;
  }),
  updateAgentMemory: mock(async () => ({
    entry: { id: 'mem-1', title: 'Updated', body: 'Body', type: 'fact', createdAt: 1, updatedAt: 2 },
    entries: [{ id: 'mem-1', title: 'Updated', body: 'Body', type: 'fact', createdAt: 1, updatedAt: 2 }],
  })),
  deleteAgentMemory: mock(async () => []),
}));

const { useAgentMemoryStore } = await import('./useAgentMemoryStore');

beforeEach(() => {
  loadResult = { enabled: false };
  loadError = null;
  useAgentMemoryStore.setState({ entries: {} });
});

describe('agent memory store', () => {
  test('disabled and enabled-empty remain different states', async () => {
    await useAgentMemoryStore.getState().load(project);
    expect(useAgentMemoryStore.getState().entries[key]?.available).toBe(false);
    expect(useAgentMemoryStore.getState().entries[key]?.loaded).toBe(true);

    loadResult = { enabled: true, global: [], project: [], globalFailed: false, projectFailed: false };
    await useAgentMemoryStore.getState().load(project, { force: true });
    expect(useAgentMemoryStore.getState().entries[key]?.available).toBe(true);
    expect(useAgentMemoryStore.getState().entries[key]?.loaded).toBe(true);
  });

  test('a failed refresh preserves the last known good entries', async () => {
    loadResult = {
      enabled: true,
      global: [{ id: 'mem-1', title: 'Known', body: 'Keep me', type: 'fact', createdAt: 1, updatedAt: 1 }],
      project: [],
      globalFailed: false,
      projectFailed: false,
    };
    await useAgentMemoryStore.getState().load(project);
    loadError = new Error('offline');

    await useAgentMemoryStore.getState().load(project, { force: true });

    expect(useAgentMemoryStore.getState().entries[key]?.global).toHaveLength(1);
    expect(useAgentMemoryStore.getState().entries[key]?.error).toBe('offline');
  });

  test('update and delete replace only the named scope', async () => {
    loadResult = {
      enabled: true,
      global: [{ id: 'global-1', title: 'Global', body: 'Body', type: 'fact', createdAt: 1, updatedAt: 1 }],
      project: [{ id: 'project-1', title: 'Project', body: 'Body', type: 'fact', createdAt: 1, updatedAt: 1 }],
      globalFailed: false,
      projectFailed: false,
    };
    await useAgentMemoryStore.getState().load(project);

    await useAgentMemoryStore.getState().update(project, 'project', 'project-1', { title: 'Updated' });
    expect(useAgentMemoryStore.getState().entries[key]?.project[0]?.title).toBe('Updated');
    expect(useAgentMemoryStore.getState().entries[key]?.global[0]?.id).toBe('global-1');

    await useAgentMemoryStore.getState().remove(project, 'global', 'global-1');
    expect(useAgentMemoryStore.getState().entries[key]?.global).toEqual([]);
    expect(useAgentMemoryStore.getState().entries[key]?.project[0]?.title).toBe('Updated');
  });
});
