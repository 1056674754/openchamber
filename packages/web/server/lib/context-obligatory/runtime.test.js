import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveUpstreamRequestPath } from '../opencode/upstream-v2-paths.js';
import { createContextObligatoryRuntime } from './runtime.js';

const json = (body) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

describe('context obligatory runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('injects pinned text in chronological order after compaction and records the summary cursor', async () => {
    const requests = [];
    let sessionReads = 0;
    vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      requests.push({ path: url.pathname, method: init.method ?? 'GET', body: init.body, search: url.searchParams.get('directory') });
      if (url.pathname === '/session/ses_1' && init.method === 'PATCH') return json({});
      if (url.pathname === '/session/ses_1') {
        sessionReads += 1;
        return json({
          id: 'ses_1',
          metadata: { openchamber: { context_obligatory_messages: [
            { id: 'msg_2', createdAt: 20, role: 'assistant' },
            { id: 'msg_1', createdAt: 10, role: 'user' },
          ] } },
        });
      }
      if (url.pathname === '/session/ses_1/message') return json([
        { info: { id: 'msg_agent', role: 'assistant', providerID: 'provider', modelID: 'model', agent: 'build' } },
        { info: { id: 'msg_summary', role: 'assistant', summary: true, time: { completed: 30 } } },
      ]);
      if (url.pathname === '/session/ses_1/message/msg_1') return json({ parts: [{ type: 'text', text: 'First' }] });
      if (url.pathname === '/session/ses_1/message/msg_2') return json({ parts: [{ type: 'text', text: 'Second' }] });
      if (url.pathname === '/session/ses_1/prompt_async') return json({});
      throw new Error(`Unexpected ${url.pathname}`);
    }));
    const runtime = createContextObligatoryRuntime({
      buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
      getOpenCodeAuthHeaders: () => ({}),
      sessionKnowledgeRuntime: {
        resolvePending: vi.fn(async () => ({ text: 'Pinned project knowledge', signature: 'knowledge-v1' })),
        readDeliveredSignature: () => '',
        readPins: () => ({ notes: ['note-1'], plans: [] }),
        metadataKey: 'knowledge_context_delivered',
      },
    });

    await runtime.processPayload(
      { type: 'session.compacted', properties: { sessionID: 'ses_1' } },
      '/repo',
      'default',
    );

    const prompt = requests.find((request) => request.path.endsWith('/prompt_async'));
    const payload = JSON.parse(prompt.body);
    expect(prompt.search).toBe('/repo');
    expect(payload).toMatchObject({
      model: { providerID: 'provider', modelID: 'model' },
      agent: 'build',
      parts: [{ type: 'text', synthetic: true }],
    });
    expect(payload.parts[0].text.indexOf('First')).toBeLessThan(payload.parts[0].text.indexOf('Second'));
    expect(payload.parts[0].text).toContain('Pinned project knowledge');
    expect(payload.parts[0].text).toContain('continuing the pre-compaction work');
    expect(payload.parts[0].text).toContain('use it silently as background context');
    expect(payload.parts[0].text).toContain('Only if no tasks or next steps remain');
    expect(payload.parts[0].text).toContain('no more than one short paragraph');
    const patch = requests.find((request) => request.method === 'PATCH');
    expect(JSON.parse(patch.body).metadata.openchamber.context_obligatory_last_compaction_message_id).toBe('msg_summary');
    expect(JSON.parse(patch.body).metadata.openchamber.knowledge_context_delivered).toBe('knowledge-v1');
    expect(sessionReads).toBe(2);
    runtime.stop();
  });

  it('ignores ordinary idle events without making requests', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const runtime = createContextObligatoryRuntime({
      buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
      getOpenCodeAuthHeaders: () => ({}),
    });
    await runtime.processPayload({ type: 'session.status', properties: { sessionID: 'ses_1', status: { type: 'idle' } } }, '/repo', 'default');
    expect(fetchImpl).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('skips reinject when directory is missing', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const runtime = createContextObligatoryRuntime({
      buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
      getOpenCodeAuthHeaders: () => ({}),
    });
    await runtime.processPayload({ type: 'session.compacted', properties: { sessionID: 'ses_1' } }, '', 'default');
    expect(fetchImpl).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('skips child sessions with parentID', async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/session/ses_child') {
        return json({ id: 'ses_child', parentID: 'ses_parent', metadata: { openchamber: { context_obligatory_messages: [
          { id: 'msg_1', createdAt: 10, role: 'user' },
        ] } } });
      }
      throw new Error(`Unexpected ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    const runtime = createContextObligatoryRuntime({
      buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
      getOpenCodeAuthHeaders: () => ({}),
    });
    await runtime.processPayload({ type: 'session.compacted', properties: { sessionID: 'ses_child' } }, '/repo', 'default');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    runtime.stop();
  });

  it('dedupes by last compaction cursor', async () => {
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/session/ses_1' && init.method !== 'PATCH') {
        return json({
          id: 'ses_1',
          metadata: { openchamber: {
            context_obligatory_messages: [{ id: 'msg_1', createdAt: 10, role: 'user' }],
            context_obligatory_last_compaction_message_id: 'msg_summary',
          } },
        });
      }
      if (url.pathname === '/session/ses_1/message') {
        return json([
          { info: { id: 'msg_agent', role: 'assistant', providerID: 'provider', modelID: 'model' } },
          { info: { id: 'msg_summary', role: 'assistant', summary: true, time: { completed: 30 } } },
        ]);
      }
      throw new Error(`Unexpected ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    const runtime = createContextObligatoryRuntime({
      buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
      getOpenCodeAuthHeaders: () => ({}),
    });
    await runtime.processPayload({ type: 'session.compacted', properties: { sessionID: 'ses_1' } }, '/repo', 'default');
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('prompt_async'))).toBe(false);
    runtime.stop();
  });

  it('continues injecting when one pinned message is missing', async () => {
    const requests = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      requests.push(url.pathname);
      if (url.pathname === '/session/ses_1' && init.method === 'PATCH') return json({});
      if (url.pathname === '/session/ses_1') {
        return json({
          id: 'ses_1',
          metadata: { openchamber: { context_obligatory_messages: [
            { id: 'msg_missing', createdAt: 5, role: 'user' },
            { id: 'msg_1', createdAt: 10, role: 'user' },
          ] } },
        });
      }
      if (url.pathname === '/session/ses_1/message') return json([
        { info: { id: 'msg_agent', role: 'assistant', providerID: 'provider', modelID: 'model' } },
        { info: { id: 'msg_summary', role: 'assistant', summary: true, time: { completed: 30 } } },
      ]);
      if (url.pathname === '/session/ses_1/message/msg_missing') {
        return new Response('missing', { status: 404 });
      }
      if (url.pathname === '/session/ses_1/message/msg_1') return json({ parts: [{ type: 'text', text: 'Kept' }] });
      if (url.pathname === '/session/ses_1/prompt_async') return json({});
      throw new Error(`Unexpected ${url.pathname}`);
    }));
    const runtime = createContextObligatoryRuntime({
      buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
      getOpenCodeAuthHeaders: () => ({}),
    });
    await runtime.processPayload({ type: 'session.compacted', properties: { sessionID: 'ses_1' } }, '/repo', 'default');
    const promptPath = requests.find((path) => path.endsWith('/prompt_async'));
    expect(promptPath).toBeTruthy();
    runtime.stop();
  });

  it('isolates inflight work across serverIds and routes remote through /api', async () => {
    const started = [];
    const controllers = [];
    vi.stubGlobal('fetch', vi.fn((input) => new Promise((resolve) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      started.push(url.href);
      controllers.push(() => resolve(json({
        id: 'ses_1',
        parentID: 'block',
        metadata: { openchamber: { context_obligatory_messages: [] } },
      })));
    })));
    const runtime = createContextObligatoryRuntime({
      buildOpenCodeUrl: (path) => `http://local.test${path}`,
      getOpenCodeAuthHeaders: () => ({}),
      resolveRemoteUpstream: (serverId) => ({
        baseUrl: `http://${serverId}.example`,
        headers: { Authorization: 'Bearer remote' },
      }),
    });

    const localPromise = runtime.processPayload(
      { type: 'session.compacted', properties: { sessionID: 'ses_1' } },
      '/repo-a',
      'default',
    );
    const remotePromise = runtime.processPayload(
      { type: 'session.compacted', properties: { sessionID: 'ses_1' } },
      '/repo-b',
      'remote-a',
    );

    await Promise.resolve();
    expect(started).toHaveLength(2);
    expect(started[0]).toContain('http://local.test/session/ses_1');
    expect(started[1]).toContain('http://remote-a.example/api/session/ses_1');
    controllers.forEach((finish) => finish());
    await Promise.all([localPromise, remotePromise]);
    runtime.stop();
  });
});

describe('context obligatory runtime (v2 protocol mode)', () => {
  afterEach(() => {
    delete process.env.OPENCHAMBER_PROTOCOL_MODE;
  });

  it('restores pinned text as one waking synthetic after the selection switches', async () => {
    process.env.OPENCHAMBER_PROTOCOL_MODE = 'v2';
    const requests = [];
    const session = {
      id: 'ses_1',
      metadata: { openchamber: { context_obligatory_messages: [
        { id: 'msg_1', createdAt: 10, role: 'user' },
      ] } },
    };
    vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      requests.push({ path: url.pathname, method: init.method ?? 'GET', body: init.body, search: url.search });
      if (url.pathname === '/api/session/ses_1' && init.method === 'PATCH') return json({});
      if (url.pathname === '/api/session/ses_1') return json(session);
      if (url.pathname === '/api/session/active') return json({});
      if (url.pathname === '/api/session/ses_1/children') return json([]);
      if (url.pathname === '/api/session/ses_1/message') return json([
        { info: { id: 'msg_agent', role: 'assistant', providerID: 'provider', modelID: 'model', agent: 'build' } },
        { info: { id: 'msg_summary', role: 'assistant', summary: true, time: { completed: 30 } } },
      ]);
      if (url.pathname === '/api/session/ses_1/message/msg_1') return json({ parts: [{ type: 'text', text: 'First' }] });
      if (init.method === 'POST' && url.pathname.startsWith('/api/session/ses_1/')) return json({ data: {} });
      throw new Error(`Unexpected ${url.pathname}`);
    }));
    const runtime = createContextObligatoryRuntime({
      // The real upstream-URL boundary, so the v2 posts carry /api paths.
      buildOpenCodeUrl: (path) => `http://opencode.test${resolveUpstreamRequestPath(path, 'v2')}`,
      getOpenCodeAuthHeaders: () => ({}),
      sessionKnowledgeRuntime: {
        resolvePending: vi.fn(async () => ({ text: 'Pinned project knowledge', signature: 'knowledge-v1' })),
        readDeliveredSignature: () => '',
        readPins: () => ({ notes: [], plans: [] }),
        metadataKey: 'knowledge_context_delivered',
      },
    });

    await runtime.processPayload(
      { type: 'session.compacted', properties: { sessionID: 'ses_1' } },
      '/repo',
      'default',
    );

    const posts = requests.filter((request) => request.method === 'POST');
    expect(posts.map((request) => request.path)).toEqual([
      '/api/session/ses_1/model',
      '/api/session/ses_1/agent',
      '/api/session/ses_1/synthetic',
    ]);
    expect(JSON.parse(posts[0].body)).toEqual({ model: { providerID: 'provider', id: 'model' } });
    expect(JSON.parse(posts[1].body)).toEqual({ agent: 'build' });
    const synthetic = JSON.parse(posts[2].body);
    expect(synthetic.text).toContain('First');
    expect(synthetic.text).toContain('Pinned project knowledge');
    expect(synthetic.text).toContain('continuing the pre-compaction work');
    expect(synthetic.resume).toBeUndefined();
    // v2 scopes through the location query, not ?directory=.
    expect(posts[0].search).toContain('location%5Bdirectory%5D=%2Frepo');
    expect(posts[0].search).not.toContain('directory=');
    const patch = requests.find((request) => request.method === 'PATCH');
    expect(JSON.parse(patch.body).metadata.openchamber.context_obligatory_last_compaction_message_id).toBe('msg_summary');
    runtime.stop();
  });
});
