import { afterEach, describe, expect, mock, test } from 'bun:test';

const calls: Array<{ input: string; init?: RequestInit }> = [];
let responseFactory: () => Response = () => new Response('{}');

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: input.toString(), init });
    return responseFactory();
  }),
}));

const {
  deleteAgentMemory,
  fetchAgentMemory,
  updateAgentMemory,
} = await import('./agentMemoryApi');

const localProject = { id: 'mutable', path: '/workspace/app' };
const remoteProject = { ...localProject, serverId: 'memory-dev3' };

afterEach(() => {
  calls.length = 0;
  responseFactory = () => new Response('{}');
});

describe('agent memory API authority', () => {
  test('routes an authoritative read through the project instance and stable path-derived id', async () => {
    responseFactory = () => Response.json({
      global: [],
      project: [{ id: 'mem-1', title: 'Run tests', body: 'Use Bun.', type: 'fact', createdAt: 1, updatedAt: 1 }],
      globalFailed: false,
      projectFailed: false,
    });

    const result = await fetchAgentMemory(remoteProject);

    expect(result.enabled).toBe(true);
    expect(result.enabled ? result.project[0]?.id : null).toBe('mem-1');
    expect(calls[0]?.input).toContain('/api/remote/memory-dev3/agent-memory/all?projectId=');
    expect(calls[0]?.input).not.toContain('mutable');
  });

  test('distinguishes disabled from an enabled empty store', async () => {
    responseFactory = () => Response.json({ error: 'Agent memory is disabled', disabled: true }, { status: 404 });
    expect(await fetchAgentMemory(localProject)).toEqual({ enabled: false });

    responseFactory = () => Response.json({ global: [], project: [], globalFailed: false, projectFailed: false });
    const enabled = await fetchAgentMemory(localProject);
    expect(enabled.enabled).toBe(true);
    expect(enabled.enabled ? enabled.global : null).toEqual([]);
    expect(enabled.enabled ? enabled.project : null).toEqual([]);
  });

  test('patch and delete carry the explicit scope and project id', async () => {
    responseFactory = () => Response.json({
      entry: { id: 'mem/1', title: 'Updated', body: 'Body', type: 'reference', createdAt: 1, updatedAt: 2 },
      entries: [],
      deleted: true,
    });

    await updateAgentMemory(localProject, 'project', 'mem/1', { title: 'Updated' });
    await deleteAgentMemory(localProject, 'global', 'mem/1');

    expect(calls[0]?.input).toContain('/api/agent-memory/mem%2F1?scope=project&projectId=');
    expect(calls[0]?.init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ title: 'Updated' });
    expect(calls[1]?.input).toContain('/api/agent-memory/mem%2F1?scope=global');
    expect(calls[1]?.input).not.toContain('projectId=');
    expect(calls[1]?.init?.method).toBe('DELETE');
  });
});
