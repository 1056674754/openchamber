import { describe, expect, it, vi } from 'vitest';
import { createPermissionAutoAcceptRuntime } from './runtime.js';

const createRuntime = ({ stored, fetchImpl, retryDelaysMs = [0], evaluatePermission, onPermissionReplied, resolveLegacyEnabledMode } = {}) => {
  let settings = stored ?? { permissionAutoAccept: { sessions: {} } };
  let eventHandler;
  let statusHandler;
  const runtime = createPermissionAutoAcceptRuntime({
    globalEventHub: {
      subscribeEvent(handler) {
        eventHandler = handler;
        return () => {};
      },
      subscribeStatus(handler) {
        statusHandler = handler;
        return () => {};
      },
    },
    buildOpenCodeUrl: (requestPath) => `http://opencode.test${requestPath}`,
    getOpenCodeAuthHeaders: () => ({}),
    readSettingsFromDiskMigrated: async () => settings,
    persistSettings: async (changes) => {
      settings = { ...settings, ...changes };
    },
    fetchImpl: fetchImpl ?? vi.fn(async () => new Response('[]')),
    retryDelaysMs,
    evaluatePermission,
    onPermissionReplied,
    resolveLegacyEnabledMode,
  });
  runtime.start();
  return {
    runtime,
    getSettings: () => settings,
    emit: (payload, directory = '/project') => eventHandler({ payload, directory }),
    connect: () => statusHandler({ type: 'connect' }),
  };
};

const flush = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
};

describe('permission auto-accept runtime', () => {
  it('persists explicit session policies across runtime restarts', async () => {
    const first = createRuntime();

    await first.runtime.setSessionPolicy('root', true);

    const second = createRuntime({ stored: first.getSettings() });
    await expect(second.runtime.load()).resolves.toEqual({
      sessions: { root: true },
      modes: { root: 'auto' },
      revision: 1,
    });
  });

  it('increments the authoritative policy revision', async () => {
    const { runtime, getSettings } = createRuntime();

    await expect(runtime.setSessionPolicy('root', true)).resolves.toMatchObject({ revision: 1 });
    await expect(runtime.setSessionPolicy('child', false)).resolves.toMatchObject({ revision: 2 });

    expect(getSettings().permissionAutoAccept.revision).toBe(2);
  });

  it('accepts a mode where older callers send a boolean', async () => {
    const { runtime, getSettings } = createRuntime();

    await runtime.setSessionPolicy('watched', 'safety');
    await runtime.setSessionPolicy('free', 'auto');
    await runtime.setSessionPolicy('quiet', 'ask');
    // The on/off shape scheduled tasks still send: false is `ask` on write.
    await runtime.setSessionPolicy('legacy', false);

    expect(getSettings().permissionAutoAccept.sessions).toEqual({
      watched: 'safety',
      free: 'auto',
      quiet: 'ask',
      legacy: 'ask',
    });
    await expect(runtime.isSessionAutoAccepting('watched')).resolves.toBe(true);
    await expect(runtime.isSessionAutoAccepting('quiet')).resolves.toBe(false);
    await expect(runtime.isSessionAutoAccepting('legacy')).resolves.toBe(false);
  });

  it('uses nearest explicit ancestor policy for subagents', async () => {
    const { runtime, emit } = createRuntime({
      stored: { permissionAutoAccept: { sessions: { root: true, child: false } } },
    });
    emit({ type: 'session.created', properties: { info: { id: 'child', parentID: 'root' } } });
    emit({ type: 'session.created', properties: { info: { id: 'grandchild', parentID: 'child' } } });

    await expect(runtime.isSessionAutoAccepting('grandchild', '/project')).resolves.toBe(false);
    await runtime.setSessionPolicy('child', true);

    await expect(runtime.isSessionAutoAccepting('grandchild', '/project')).resolves.toBe(true);
  });

  it('fetches missing subagent lineage before replying', async () => {
    const fetchImpl = vi.fn(async (url, init = {}) => {
      const requestPath = new URL(url).pathname;
      if (requestPath === '/permission') return new Response('[]');
      if (requestPath === '/session/child') {
        return Response.json({ id: 'child', parentID: 'root', directory: '/project' });
      }
      if (init.method === 'POST') return Response.json({});
      return new Response('', { status: 404 });
    });
    const { runtime } = createRuntime({
      stored: { permissionAutoAccept: { sessions: { root: true } } },
      fetchImpl,
    });

    await expect(runtime.processPermission({ id: 'perm', sessionID: 'child' }, '/project')).resolves.toBe(true);

    expect(fetchImpl.mock.calls.some(([url, init]) =>
      new URL(url).pathname === '/permission/perm/reply' && init.method === 'POST')).toBe(true);
  });

  it('retries transient replies and deduplicates concurrent events', async () => {
    let replyAttempts = 0;
    const fetchImpl = vi.fn(async (url, init = {}) => {
      const requestPath = new URL(url).pathname;
      if (requestPath === '/permission') return new Response('[]');
      if (requestPath === '/permission/perm/reply' && init.method === 'POST') {
        replyAttempts += 1;
        return replyAttempts === 1 ? new Response('', { status: 503 }) : Response.json({});
      }
      return Response.json({ id: 'root' });
    });
    const { runtime } = createRuntime({
      stored: { permissionAutoAccept: { sessions: { root: true } } },
      fetchImpl,
      retryDelaysMs: [0, 0],
    });
    const permission = { id: 'perm', sessionID: 'root' };

    const first = runtime.processPermission(permission, '/project');
    const second = runtime.processPermission(permission, '/project');

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(replyAttempts).toBe(2);
  });

  it('reconciles pending permissions after reconnect', async () => {
    const fetchImpl = vi.fn(async (url, init = {}) => {
      const requestPath = new URL(url).pathname;
      if (requestPath === '/permission') return Response.json([{ id: 'pending', sessionID: 'root' }]);
      if (requestPath === '/permission/pending/reply' && init.method === 'POST') return Response.json({});
      return Response.json({ id: 'root' });
    });
    const { connect } = createRuntime({
      stored: { permissionAutoAccept: { sessions: { root: true } } },
      fetchImpl,
    });

    connect();
    // The reconcile chain reads settings and response bodies, so its length in
    // microtasks is not fixed; wait for the reply instead of counting ticks
    // (upstream segb 53795a605).
    await vi.waitFor(() => {
      expect(fetchImpl.mock.calls.some(([url]) =>
        new URL(url).pathname === '/permission/pending/reply')).toBe(true);
    });
  });

  it('accepts existing pending permissions when a session policy is enabled', async () => {
    const fetchImpl = vi.fn(async (url, init = {}) => {
      const parsed = new URL(url);
      const requestPath = parsed.pathname;
      if (requestPath === '/permission') {
        return parsed.searchParams.get('directory') === '/project'
          ? Response.json([
            { id: 'root-pending', sessionID: 'root' },
            { id: 'other-pending', sessionID: 'other' },
          ])
          : Response.json([]);
      }
      if (requestPath === '/permission/root-pending/reply' && init.method === 'POST') return Response.json({});
      if (requestPath === '/session/other') return Response.json({ id: 'other' });
      return new Response('', { status: 404 });
    });
    const { runtime } = createRuntime({ fetchImpl });

    await runtime.setSessionPolicy('root', true, '/project');

    const replyPaths = fetchImpl.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([url]) => new URL(url).pathname);
    expect(replyPaths).toEqual(['/permission/root-pending/reply']);
    expect(fetchImpl.mock.calls.some(([url]) =>
      new URL(url).searchParams.get('directory') === '/project')).toBe(true);
    expect(await runtime.load()).toEqual({ sessions: { root: true }, modes: { root: 'auto' }, revision: 1 });
  });

  it('leaves a request held by the safety net unanswered and forgets it once replied', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]'));
    const verdicts = { held: { action: 'hold', score: 0.9, kind: 'git_history' }, safe: { action: 'accept', score: 0.1 } };
    const evaluatePermission = vi.fn(async (permission) => verdicts[permission.id]);
    const onPermissionReplied = vi.fn();
    const { runtime, emit } = createRuntime({
      stored: { permissionAutoAccept: { sessions: { root: 'safety' } } },
      fetchImpl,
      evaluatePermission,
      onPermissionReplied,
    });
    await runtime.load();

    emit({ type: 'permission.asked', properties: { id: 'held', sessionID: 'root', permission: 'bash', metadata: {} } });
    emit({ type: 'permission.asked', properties: { id: 'safe', sessionID: 'root', permission: 'bash', metadata: {} } });
    await flush();

    const replies = fetchImpl.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/reply'));
    expect(replies).toEqual(['http://opencode.test/permission/safe/reply?directory=%2Fproject']);
    expect(evaluatePermission).toHaveBeenCalledTimes(2);

    emit({ type: 'permission.replied', properties: { sessionID: 'root', requestID: 'held', reply: 'once' } });
    expect(onPermissionReplied).toHaveBeenCalledWith('held');
  });

  it('does not consult the safety net for sessions that are not auto-accepting', async () => {
    const evaluatePermission = vi.fn(async () => ({ action: 'hold' }));
    const { runtime, emit } = createRuntime({ evaluatePermission });
    await runtime.load();
    emit({ type: 'permission.asked', properties: { id: 'p', sessionID: 'manual', permission: 'bash', metadata: {} } });
    await flush();
    expect(evaluatePermission).not.toHaveBeenCalled();
  });

  it('answers a safety session only on an accept verdict and reports the request as unanswered when held', async () => {
    const fetchImpl = vi.fn(async (url, init = {}) => {
      const requestPath = new URL(url).pathname;
      if (requestPath === '/permission') return new Response('[]');
      if (init.method === 'POST') return Response.json({});
      return Response.json({ id: 'root' });
    });
    const verdicts = { safe: { action: 'accept', score: 0.1 }, held: { action: 'hold', score: 0.9 } };
    const evaluatePermission = vi.fn(async (permission) => verdicts[permission.id]);
    const { runtime } = createRuntime({
      stored: { permissionAutoAccept: { sessions: { root: 'safety' } } },
      fetchImpl,
      evaluatePermission,
    });

    await expect(runtime.processPermission({ id: 'safe', sessionID: 'root' }, '/project')).resolves.toBe(true);
    await expect(runtime.processPermission({ id: 'held', sessionID: 'root' }, '/project')).resolves.toBe(true);

    const replied = fetchImpl.mock.calls.filter(([url]) => String(url).includes('/safe/reply'));
    const heldReplied = fetchImpl.mock.calls.filter(([url]) => String(url).includes('/held/reply'));
    expect(replied).toHaveLength(1);
    expect(heldReplied).toHaveLength(0);

    // The accepted request needs no user; the held one is the user's to answer.
    await expect(runtime.isPermissionAutoAnswered('root', '/project', 'safe')).resolves.toBe(true);
    await expect(runtime.isPermissionAutoAnswered('root', '/project', 'held')).resolves.toBe(false);
  });

  it('lets an ask session wait for the user and counts neither as answered', async () => {
    const evaluatePermission = vi.fn(async () => ({ action: 'accept' }));
    const { runtime } = createRuntime({
      stored: { permissionAutoAccept: { sessions: { root: 'ask' } } },
      evaluatePermission,
    });

    await expect(runtime.processPermission({ id: 'p', sessionID: 'root' }, '/project')).resolves.toBe(false);
    await expect(runtime.isPermissionAutoAnswered('root', '/project', 'p')).resolves.toBe(false);
  });

  it('converts pre-mode booleans once, with the wired legacy answer, and keeps them on disk before the wiring', async () => {
    const stored = { permissionAutoAccept: { sessions: { old: true, off: false }, revision: 4 } };

    // Not wired yet (the default): answer as `auto`, but the booleans stay.
    const unwired = createRuntime({ stored });
    await expect(unwired.runtime.isSessionAutoAccepting('old')).resolves.toBe(true);
    expect(unwired.getSettings().permissionAutoAccept.sessions.old).toBe(true);

    // Wired: `true` becomes the routing safety net's answer and persists once.
    const wired = createRuntime({ stored, resolveLegacyEnabledMode: async () => 'safety' });
    await expect(wired.runtime.load()).resolves.toEqual({
      sessions: { old: true, off: false },
      modes: { old: 'safety', off: 'ask' },
      revision: 4,
    });
    expect(wired.getSettings().permissionAutoAccept.sessions).toEqual({ old: 'safety', off: 'ask' });
  });

  it('writes the configured default mode onto each new top-level session only', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]'));
    const { runtime, emit, getSettings } = createRuntime({
      stored: {
        permissionAutoAccept: { sessions: {} },
        permissionDefaultMode: 'safety',
      },
      fetchImpl,
    });

    emit({ type: 'session.created', properties: { info: { id: 'top', directory: '/project' } } });
    emit({ type: 'session.created', properties: { info: { id: 'sub', parentID: 'top', directory: '/project' } } });
    await flush();
    // A policy the creating flow already set wins over the default.
    await runtime.setSessionPolicy('chosen', 'auto');
    emit({ type: 'session.created', properties: { info: { id: 'chosen' } } });
    await flush();

    expect(getSettings().permissionAutoAccept.sessions).toEqual({ top: 'safety', chosen: 'auto' });
  });

  it('reports a failed reply outcome through processPermission', async () => {
    const fetchImpl = vi.fn(async (url, init = {}) => {
      const requestPath = new URL(url).pathname;
      if (requestPath === '/permission') return new Response('[]');
      if (init.method === 'POST') return new Response('', { status: 500 });
      return Response.json({ id: 'root' });
    });
    const { runtime } = createRuntime({
      stored: { permissionAutoAccept: { sessions: { root: true } } },
      fetchImpl,
      retryDelaysMs: [0],
    });

    await expect(runtime.processPermission({ id: 'broken', sessionID: 'root' }, '/project')).resolves.toBe(false);
    // An `auto` session answers by itself as far as notifications are concerned,
    // even when this particular reply failed (upstream semantic).
    await expect(runtime.isPermissionAutoAnswered('root', '/project', 'broken')).resolves.toBe(true);
  });
});
