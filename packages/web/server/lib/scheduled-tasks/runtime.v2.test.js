import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * v2-track scheduled-task dispatch (OC2 prompt-sender adaptation). Mirrors the
 * issue-2710 harness: the run loop is driven against a mocked SDK client, and
 * the global fetch records the flat v2 dispatch posts.
 */

const sdk = vi.hoisted(() => ({
  createOpencodeClient: () => ({
    session: {
      create: async () => ({ data: { id: 'sess-v2-1' } }),
    },
    command: { list: async () => ({ data: [] }) },
  }),
}));

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: sdk.createOpencodeClient,
}));

// The goal objective file write is real fs IO, which cannot land inside a
// fake-timer advance window; failing it fast exercises the documented inline
// fallback and keeps the goal-stamp test deterministic.
vi.mock('../session-goal/objectives.js', () => ({
  writeObjective: async () => {
    throw new Error('no objective fs in this suite');
  },
  readObjective: async () => null,
  GOAL_OBJECTIVE_CHAR_LIMIT: 5_000,
}));

import { createScheduledTasksRuntime } from './runtime.js';

const UTC = (y, mo, d, h, mi, s = 0) => Date.UTC(y, mo, d, h, mi, s);
const HOUR = 3_600_000;

const makeTask = (execution = {}) => ({
  id: 'task-v2',
  name: 'V2 Runner',
  enabled: true,
  schedule: { timezone: 'UTC', kind: 'daily', times: ['15:00'] },
  execution: { prompt: 'Summarize open issues', providerID: 'openai', modelID: 'gpt-4o', ...execution },
  state: { createdAt: UTC(2026, 0, 1, 0, 0, 0), updatedAt: UTC(2026, 0, 1, 0, 0, 0) },
});

// On-disk project config stand-in (same shape the issue-2710 harness uses).
const createProjectConfigStandIn = (initialTask) => {
  let currentTask = structuredClone(initialTask);
  const applyPatch = (patch) => {
    currentTask = { ...currentTask, state: { ...(currentTask.state ?? {}), ...patch, updatedAt: Date.now() } };
    return currentTask;
  };
  return {
    listScheduledTasks: async () => [structuredClone(currentTask)],
    reconcileLoopTasks: async () => [structuredClone(currentTask)],
    updateScheduledTaskState: async (_pid, _tid, patch) => ({ task: structuredClone(applyPatch(patch)), updated: true }),
    updateScheduledTaskStateIf: async (_pid, _tid, predicate, patch) => {
      if (!predicate(currentTask)) return { task: structuredClone(currentTask), updated: false };
      return { task: structuredClone(applyPatch(patch)), updated: true };
    },
    upsertScheduledTask: async (_pid, input) => {
      currentTask = structuredClone(input);
      return { task: structuredClone(currentTask) };
    },
  };
};

describe('scheduled-tasks runtime (v2 protocol mode)', () => {
  let posts;

  beforeEach(() => {
    vi.useFakeTimers();
    posts = [];
    globalThis.fetch = vi.fn(async (input, init = {}) => {
      posts.push({ url: String(input), method: init.method ?? 'GET', body: JSON.parse(String(init.body)) });
      return { ok: true, text: async () => '' };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.OPENCHAMBER_PROTOCOL_MODE;
  });

  const startRuntime = async (task) => {
    const projectConfigRuntime = createProjectConfigStandIn(task);
    const runtime = createScheduledTasksRuntime({
      projectConfigRuntime,
      listProjects: async () => [{ id: 'p1', path: '/repo' }],
      buildOpenCodeUrl: () => 'http://127.0.0.1:9999/',
      getOpenCodeAuthHeaders: () => ({}),
      waitForOpenCodeReady: async () => {},
      emitTaskRunEvent: vi.fn(),
      setSessionAutoAccept: async () => {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    await runtime.start();
    return runtime;
  };

  it('dispatches a run through the flat v2 endpoints with the selection switches first', async () => {
    process.env.OPENCHAMBER_PROTOCOL_MODE = 'v2';
    vi.setSystemTime(UTC(2026, 0, 1, 14, 0, 0));
    const runtime = await startRuntime(makeTask({ agent: 'build', variant: 'high' }));
    await vi.advanceTimersByTimeAsync(HOUR + 3_000);
    runtime.stop();

    expect(posts.map((post) => `${post.method} ${post.url}`)).toEqual([
      'POST http://127.0.0.1:9999/api/session/sess-v2-1/model',
      'POST http://127.0.0.1:9999/api/session/sess-v2-1/agent',
      'POST http://127.0.0.1:9999/api/session/sess-v2-1/prompt',
    ]);
    expect(posts[0].body).toEqual({ model: { providerID: 'openai', id: 'gpt-4o', variant: 'high' } });
    expect(posts[1].body).toEqual({ agent: 'build' });
    expect(posts[2].body).toEqual({ text: 'Summarize open issues' });
    const firstPost = globalThis.fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(firstPost[1].headers['x-opencode-directory']).toBe('/repo');
  });

  it('keeps goal-stamped runs on the v2 session route before the prompt', async () => {
    process.env.OPENCHAMBER_PROTOCOL_MODE = 'v2';
    vi.setSystemTime(UTC(2026, 0, 1, 14, 0, 0));
    const runtime = await startRuntime(makeTask({ goalEnabled: true }));
    await vi.advanceTimersByTimeAsync(HOUR + 3_000);
    runtime.stop();

    expect(posts.map((post) => `${post.method} ${post.url}`)).toEqual([
      'PATCH http://127.0.0.1:9999/api/session/sess-v2-1',
      'POST http://127.0.0.1:9999/api/session/sess-v2-1/model',
      'POST http://127.0.0.1:9999/api/session/sess-v2-1/synthetic',
      'POST http://127.0.0.1:9999/api/session/sess-v2-1/prompt',
    ]);
    const goalPatch = posts[0];
    expect(goalPatch.body.metadata.openchamber.goal.status).toBe('active');
    expect(goalPatch.body.metadata.openchamber.goal.objective).toBe('Summarize open issues');
    const patchCall = globalThis.fetch.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patchCall[1].headers['x-opencode-directory']).toBe('/repo');
    expect(posts[2].body.text).toContain('Goal mode is active for this session');
    expect(posts[3].body).toEqual({ text: 'Summarize open issues' });
  });
});
