import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { createRemoteRpcConnectionAcceptor } from './rpc-ws.js';

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

const decodeBody = (frame) => JSON.parse(Buffer.from(frame.bodyBase64 || '', 'base64').toString('utf8'));

const waitForSentFrames = async (socket, count) => {
  const deadline = Date.now() + 2_000;
  while (socket.sent.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('remote RPC websocket', () => {
  it('forwards local API requests over the websocket without remote instance lookup', async () => {
    const socket = new FakeSocket();
    const fetchCalls = [];
    let remoteLookups = 0;

    const accept = createRemoteRpcConnectionAcceptor({
      remoteInstancesRuntime: {
        getInstanceSync: () => {
          remoteLookups += 1;
          return null;
        },
        isHealthy: () => false,
      },
      getLocalBaseUrl: () => 'http://127.0.0.1:45173',
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url, init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        });
      },
      logger: { warn() {} },
    });

    accept(socket);
    socket.emit('message', JSON.stringify({
      type: 'request',
      id: 'local-1',
      target: 'local',
      method: 'GET',
      path: '/api/remote-instances',
      headers: {
        Accept: 'application/json',
        Cookie: 'session-cookie',
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(socket.sent[0]).toEqual({ type: 'ready' });
    expect(remoteLookups).toBe(0);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('http://127.0.0.1:45173/api/remote-instances');
    expect(fetchCalls[0].init.headers.Cookie).toBe('session-cookie');
    expect(socket.sent[1]).toMatchObject({
      type: 'response',
      id: 'local-1',
      target: 'local',
      path: '/api/remote-instances',
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    expect(decodeBody(socket.sent[1])).toEqual({ ok: true });
  });

  it('forwards 17 MiB local session message pages required by desktop history pagination', async () => {
    const socket = new FakeSocket();
    const responseBody = Buffer.alloc(17 * 1024 * 1024, 0x61);

    const accept = createRemoteRpcConnectionAcceptor({
      remoteInstancesRuntime: {
        getInstanceSync: () => null,
        isHealthy: () => false,
      },
      getLocalBaseUrl: () => 'http://127.0.0.1:45173',
      fetchImpl: async () => new Response(responseBody, {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-length': String(responseBody.byteLength),
          'content-type': 'application/json',
        },
      }),
      logger: { warn() {} },
    });

    accept(socket);
    socket.emit('message', JSON.stringify({
      type: 'request',
      id: 'local-large-history',
      target: 'local',
      method: 'GET',
      path: '/api/session/ses_large/message?directory=%2Ftmp&limit=900',
      headers: { Accept: 'application/json' },
    }));

    await waitForSentFrames(socket, 2);

    expect(socket.sent[1]).toMatchObject({
      type: 'response',
      id: 'local-large-history',
      target: 'local',
      status: 200,
    });
    expect(Buffer.from(socket.sent[1].bodyBase64, 'base64')).toHaveLength(responseBody.byteLength);
  });

  it('forwards ordinary remote API requests over one websocket connection', async () => {
    const socket = new FakeSocket();
    const releases = [];
    const fetchCalls = [];
    const successes = [];

    const accept = createRemoteRpcConnectionAcceptor({
      remoteInstancesRuntime: {
        getInstanceSync: () => ({
          id: 'remote-a',
          url: 'http://remote-a.example',
          enabled: true,
          auth: { type: 'bearer', value: 'secret-token' },
          requestHeaders: {
            'CF-Access-Client-Id': 'id-a',
            'CF-Access-Client-Secret': 'secret-a',
          },
        }),
        isHealthy: () => true,
        enterRequestLane: async () => {
          const release = () => releases.push('released');
          return release;
        },
        recordRemoteRequestSuccess: (id) => successes.push(id),
        recordRemoteRequestFailure: () => {
          throw new Error('should not fail');
        },
      },
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url, init });
        return new Response(JSON.stringify({ files: [] }), {
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'must-not-forward',
          },
        });
      },
      logger: { warn() {} },
    });

    accept(socket);
    socket.emit('message', JSON.stringify({
      type: 'request',
      id: 'req-1',
      instanceId: 'remote-a',
      method: 'GET',
      path: '/api/fs/list?path=%2Ftmp',
      headers: {
        Accept: 'application/json',
        Cookie: 'must-not-forward',
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(socket.sent[0]).toEqual({ type: 'ready' });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('http://remote-a.example/api/fs/list?path=%2Ftmp');
    expect(fetchCalls[0].init.headers.Authorization).toBe('Bearer secret-token');
    expect(fetchCalls[0].init.headers.Cookie).toBeUndefined();
    expect(fetchCalls[0].init.headers['CF-Access-Client-Id']).toBe('id-a');
    expect(fetchCalls[0].init.headers['CF-Access-Client-Secret']).toBe('secret-a');
    expect(socket.sent[1]).toMatchObject({
      type: 'response',
      id: 'req-1',
      target: 'remote',
      instanceId: 'remote-a',
      path: '/api/fs/list?path=%2Ftmp',
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    expect(decodeBody(socket.sent[1])).toEqual({ files: [] });
    expect(releases).toEqual(['released']);
    expect(successes).toEqual(['remote-a']);
  });

  it('routes local requests through the request lane with the classified class', async () => {
    const socket = new FakeSocket();
    const laneCalls = [];
    const releases = [];

    const accept = createRemoteRpcConnectionAcceptor({
      remoteInstancesRuntime: {
        getInstanceSync: () => null,
        isHealthy: () => false,
        enterRequestLane: async (id, lane) => {
          laneCalls.push({ id, lane });
          const release = () => releases.push('released');
          return release;
        },
      },
      getLocalBaseUrl: () => 'http://127.0.0.1:45173',
      fetchImpl: async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      }),
      logger: { warn() {} },
    });

    accept(socket);
    socket.emit('message', JSON.stringify({
      type: 'request',
      id: 'local-ai',
      target: 'local',
      method: 'POST',
      path: '/api/text/session-title-candidates',
      headers: { 'Content-Type': 'application/json' },
    }));

    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(laneCalls).toEqual([{ id: 'local', lane: 'ai' }]);
    expect(releases).toEqual(['released']);
    expect(socket.sent[1]).toMatchObject({
      type: 'response',
      id: 'local-ai',
      target: 'local',
      status: 200,
    });
  });

  it('prefers an explicit frame class over server-side classification', async () => {
    const socket = new FakeSocket();
    const laneCalls = [];

    const accept = createRemoteRpcConnectionAcceptor({
      remoteInstancesRuntime: {
        getInstanceSync: () => null,
        isHealthy: () => false,
        enterRequestLane: async (id, lane) => {
          laneCalls.push({ id, lane });
          return () => {};
        },
      },
      getLocalBaseUrl: () => 'http://127.0.0.1:45173',
      fetchImpl: async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      }),
      logger: { warn() {} },
    });

    accept(socket);
    socket.emit('message', JSON.stringify({
      type: 'request',
      id: 'local-override',
      target: 'local',
      method: 'GET',
      path: '/api/fs/list?path=%2Ftmp',
      class: 'io',
      headers: { Accept: 'application/json' },
    }));

    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(laneCalls).toEqual([{ id: 'local', lane: 'io' }]);
  });

  it('rejects local requests when the request lane is busy', async () => {
    const socket = new FakeSocket();
    let fetchCalled = false;

    const accept = createRemoteRpcConnectionAcceptor({
      remoteInstancesRuntime: {
        getInstanceSync: () => null,
        isHealthy: () => false,
        enterRequestLane: async () => {
          const error = Object.assign(new Error('lane busy'), {
            statusCode: 429,
            code: 'REMOTE_LANE_BUSY',
            retryAfterMs: 1_000,
          });
          throw error;
        },
      },
      getLocalBaseUrl: () => 'http://127.0.0.1:45173',
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response('{}');
      },
      logger: { warn() {} },
    });

    accept(socket);
    socket.emit('message', JSON.stringify({
      type: 'request',
      id: 'local-busy',
      target: 'local',
      method: 'GET',
      path: '/api/fs/list',
      headers: { Accept: 'application/json' },
    }));

    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(fetchCalled).toBe(false);
    expect(socket.sent[1]).toMatchObject({
      type: 'response',
      id: 'local-busy',
      target: 'local',
      status: 429,
      statusText: 'lane busy',
    });
    expect(decodeBody(socket.sent[1])).toMatchObject({
      error: 'lane busy',
      code: 'REMOTE_LANE_BUSY',
    });
  });

  it('rejects invalid remote RPC paths before calling fetch', async () => {
    const socket = new FakeSocket();
    let fetchCalled = false;

    const accept = createRemoteRpcConnectionAcceptor({
      remoteInstancesRuntime: {
        getInstanceSync: () => null,
        isHealthy: () => false,
      },
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response('{}');
      },
      logger: { warn() {} },
    });

    accept(socket);
    socket.emit('message', JSON.stringify({
      type: 'request',
      id: 'req-2',
      instanceId: 'remote-a',
      method: 'GET',
      path: 'http://evil.example/api/fs/list',
    }));

    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(fetchCalled).toBe(false);
    expect(socket.sent[1]).toMatchObject({
      type: 'response',
      id: 'req-2',
      target: 'remote',
      instanceId: 'remote-a',
      path: 'http://evil.example/api/fs/list',
      status: 400,
      statusText: 'Invalid remote RPC request',
    });
    expect(decodeBody(socket.sent[1])).toEqual({ error: 'Invalid remote RPC request' });
  });
});
