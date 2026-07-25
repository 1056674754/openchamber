import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionGoalRuntime } from './runtime.js';

const SESSION_ID = 'ses_parent';
const CHILD_ID = 'ses_child';
const DIRECTORY = '/workspace';

const goal = {
  id: 'goal_1',
  objective: 'Finish the task',
  status: 'active',
  turnsUsed: 1,
  createdAt: 1,
  updatedAt: 1,
};

const session = {
  id: SESSION_ID,
  directory: DIRECTORY,
  metadata: { openchamber: { goal } },
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const requestPath = (input) => new URL(typeof input === 'string' ? input : input.url).pathname;

const originalFetch = globalThis.fetch;

const startIdleTick = async (fetchImpl) => {
  const getSmallModelService = vi.fn();
  globalThis.fetch = fetchImpl;
  const runtime = createSessionGoalRuntime({
    buildOpenCodeUrl: (pathname) => `http://opencode.test${pathname}`,
    getOpenCodeAuthHeaders: () => ({}),
    getSmallModelService,
    idleQuietMs: 10,
  });
  runtime.processPayload({
    type: 'session.status',
    properties: { sessionID: SESSION_ID, status: { type: 'idle' }, directory: DIRECTORY },
  });
  await vi.advanceTimersByTimeAsync(10);
  return { runtime, getSmallModelService };
};

describe('session goal live activity gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('waits for the next parent idle when the parent resumed during the quiet window', async () => {
    const paths = [];
    const { runtime, getSmallModelService } = await startIdleTick(vi.fn(async (input) => {
      const pathname = requestPath(input);
      paths.push(pathname);
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse(session);
      if (pathname === '/session/status') return jsonResponse({ [SESSION_ID]: { type: 'busy' } });
      throw new Error(`Unexpected request: ${pathname}`);
    }));

    expect(paths).toEqual([`/session/${SESSION_ID}`, '/session/status']);
    expect(getSmallModelService).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(paths).toHaveLength(2);
    runtime.stop();
  });

  it('waits for the parent result cycle while a direct child is working', async () => {
    const paths = [];
    const { runtime, getSmallModelService } = await startIdleTick(vi.fn(async (input) => {
      const pathname = requestPath(input);
      paths.push(pathname);
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse(session);
      if (pathname === '/session/status') return jsonResponse({ [CHILD_ID]: { type: 'busy' } });
      if (pathname === `/session/${SESSION_ID}/children`) return jsonResponse([{ id: CHILD_ID, parentID: SESSION_ID }]);
      throw new Error(`Unexpected request: ${pathname}`);
    }));

    expect(paths).toEqual([
      `/session/${SESSION_ID}`,
      '/session/status',
      `/session/${SESSION_ID}/children`,
    ]);
    expect(getSmallModelService).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(paths).toHaveLength(3);
    runtime.stop();
  });

  it('retries the quiet window when live status cannot be read', async () => {
    const paths = [];
    const { runtime, getSmallModelService } = await startIdleTick(vi.fn(async (input) => {
      const pathname = requestPath(input);
      paths.push(pathname);
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse(session);
      if (pathname === '/session/status') return jsonResponse({ error: 'unavailable' }, 503);
      throw new Error(`Unexpected request: ${pathname}`);
    }));

    expect(paths).toEqual([`/session/${SESSION_ID}`, '/session/status']);
    expect(getSmallModelService).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10);
    expect(paths).toEqual([
      `/session/${SESSION_ID}`,
      '/session/status',
      `/session/${SESSION_ID}`,
      '/session/status',
    ]);
    runtime.stop();
  });

  it('audits normally when the idle parent has no working children', async () => {
    const requests = [];
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const pathname = requestPath(input);
      requests.push({ pathname, method: init.method ?? 'GET', body: init.body });
      if (pathname === `/session/${SESSION_ID}` && init.method === 'PATCH') return jsonResponse(session);
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse(session);
      if (pathname === '/session/status') return jsonResponse({});
      if (pathname === `/session/${SESSION_ID}/children`) return jsonResponse([]);
      if (pathname === `/session/${SESSION_ID}/message`) {
        return jsonResponse([{
          info: {
            id: 'msg_assistant',
            sessionID: SESSION_ID,
            role: 'assistant',
            providerID: 'provider',
            modelID: 'model',
            time: { completed: 2 },
            tokens: { input: 1, output: 1, cache: { read: 0 } },
          },
          parts: [{ type: 'text', text: 'The task is verified complete.' }],
        }]);
      }
      throw new Error(`Unexpected request: ${pathname}`);
    });
    const service = {
      generateSmallModelText: vi.fn(async () => ({
        text: '{"verdict":"complete","note":"Task verified complete"}',
        providerID: 'provider',
        modelID: 'model',
      })),
    };
    globalThis.fetch = fetchImpl;
    const runtime = createSessionGoalRuntime({
      buildOpenCodeUrl: (pathname) => `http://opencode.test${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      getSmallModelService: async () => service,
      idleQuietMs: 10,
    });

    runtime.processPayload({
      type: 'session.status',
      properties: { sessionID: SESSION_ID, status: { type: 'idle' }, directory: DIRECTORY },
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(service.generateSmallModelText).toHaveBeenCalledOnce();
    const patch = requests.find((request) => request.pathname === `/session/${SESSION_ID}` && request.method === 'PATCH');
    expect(patch).toBeDefined();
    const writtenGoal = JSON.parse(patch.body).metadata.openchamber.goal;
    expect(writtenGoal).toMatchObject({
      status: 'complete',
      evaluationProviderID: 'provider',
      evaluationModelID: 'model',
    });
    runtime.stop();
  });

  it('ignores remote-instance events (local-first hard boundary)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('OpenCode must not be called for remote goal events');
    });
    globalThis.fetch = fetchImpl;
    const getSmallModelService = vi.fn();
    const runtime = createSessionGoalRuntime({
      buildOpenCodeUrl: (pathname) => `http://opencode.test${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      getSmallModelService,
      idleQuietMs: 10,
    });

    runtime.processPayload({
      type: 'session.status',
      properties: { sessionID: SESSION_ID, status: { type: 'idle' }, directory: DIRECTORY },
    }, DIRECTORY, 'remote-a');
    await vi.advanceTimersByTimeAsync(50);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getSmallModelService).not.toHaveBeenCalled();
    runtime.stop();
  });
});
