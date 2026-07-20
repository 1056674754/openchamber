import { afterEach, describe, expect, it } from 'bun:test';
import { createEventPipeline } from '../event-pipeline';

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalWebSocket = globalThis.WebSocket;

function installDomStubs() {
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  };

  globalThis.window = {
    location: {
      href: 'http://127.0.0.1:3000/',
      origin: 'http://127.0.0.1:3000',
    },
    addEventListener() {},
    removeEventListener() {},
  };

  globalThis.WebSocket = undefined;
}

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
  }

  emitOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  emitMessage(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  emitClose(event = {}) {
    this.readyState = 3;
    this.onclose?.(event);
  }
}

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.WebSocket = originalWebSocket;
  FakeWebSocket.instances = [];
});

function createSdkWithSingleEvent(event, hold) {
  return {
    global: {
      event: async () => ({
        stream: (async function* () {
          yield event;
          await hold;
        })(),
      }),
    },
  };
}

function withTimeout(promise, ms, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function waitForValue(read, message, timeoutMs = 700) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = read();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

// Helper to create an SDK that yields multiple events in sequence, then holds.
function createSdkWithEvents(events, hold) {
  return {
    global: {
      event: async () => ({
        stream: (async function* () {
          for (const event of events) {
            yield event;
          }
          await hold;
        })(),
      }),
    },
  };
}

// Run a pipeline against a pre-seeded event stream, collect every dispatched
// event, wait long enough for the 16ms flush window to elapse, then tear it
// down. Returns the list of { directory, payload } that onEvent saw.
async function runPipelineWithEvents(events, waitMs = 80) {
  installDomStubs();

  let releaseStream;
  const hold = new Promise((resolve) => {
    releaseStream = resolve;
  });

  const received = [];
  const sdk = createSdkWithEvents(events, hold);
  const { cleanup } = createEventPipeline({
    sdk,
    onEvent: (directory, payload) => {
      received.push({ directory, payload });
    },
  });

  await new Promise((resolve) => setTimeout(resolve, waitMs));
  cleanup();
  releaseStream();

  return received;
}

describe('createEventPipeline', () => {
  it('does not report connected until upstream ready and forwards replay-gap metadata', async () => {
    installDomStubs();
    globalThis.WebSocket = FakeWebSocket;
    const reconnects = [];

    const pipeline = createEventPipeline({
      sdk: {
        global: {
          event: async () => {
            throw new Error('SSE should not be used in ws mode');
          },
        },
      },
      transport: 'ws',
      onEvent: () => {},
      onReconnect: (metadata) => {
        reconnects.push(metadata);
      },
    });

    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();
    socket.emitMessage({ type: 'transport-ready', scope: 'global' });
    expect(reconnects).toEqual([]);

    socket.emitMessage({ type: 'ready', scope: 'global', replayGap: true });
    expect(reconnects).toEqual([{ replayGap: true }]);
    pipeline.cleanup();
  });

  it('reports an upstream disconnect without closing the local websocket', async () => {
    installDomStubs();
    globalThis.WebSocket = FakeWebSocket;
    const disconnects = [];

    const pipeline = createEventPipeline({
      sdk: {
        global: {
          event: async () => {
            throw new Error('SSE should not be used in ws mode');
          },
        },
      },
      transport: 'ws',
      onEvent: () => {},
      onDisconnect: (reason) => {
        disconnects.push(reason);
      },
    });

    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();
    socket.emitMessage({ type: 'transport-ready', scope: 'global' });
    socket.emitMessage({ type: 'ready', scope: 'global', replayGap: false });
    socket.emitMessage({ type: 'disconnected', reason: 'upstream_stall' });

    expect(disconnects).toEqual(['upstream_stall']);
    expect(socket.readyState).toBe(1);
    pipeline.cleanup();
  });

  it('falls back to payload.properties.directory when the SDK event omits top-level directory', async () => {
    installDomStubs();

    let releaseStream;
    const hold = new Promise((resolve) => {
      releaseStream = resolve;
    });

    const received = [];
    const sdk = createSdkWithSingleEvent({
      payload: {
        type: 'session.status',
        properties: {
          directory: 'C:/Users/daveotero/localdev/openchamber',
          sessionID: 'session-1',
          status: { type: 'busy' },
        },
      },
    }, hold);

    const delivered = new Promise((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (directory, payload) => {
          received.push({ directory, payload });
          cleanup();
          releaseStream();
          resolve();
        },
      });
    });

    await delivered;

    expect(received).toHaveLength(1);
    expect(received[0].directory).toBe('C:/Users/daveotero/localdev/openchamber');
    expect(received[0].payload.type).toBe('session.status');
  });

  it('prefers the explicit top-level event directory when present', async () => {
    installDomStubs();

    let releaseStream;
    const hold = new Promise((resolve) => {
      releaseStream = resolve;
    });

    const received = [];
    const sdk = createSdkWithSingleEvent({
      directory: 'C:/top-level',
      payload: {
        type: 'session.status',
        properties: {
          directory: 'C:/nested',
          sessionID: 'session-2',
          status: { type: 'busy' },
        },
      },
    }, hold);

    const delivered = new Promise((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (directory, payload) => {
          received.push({ directory, payload });
          cleanup();
          releaseStream();
          resolve();
        },
      });
    });

    await delivered;

    expect(received).toHaveLength(1);
    expect(received[0].directory).toBe('C:/top-level');
    expect(received[0].payload.type).toBe('session.status');
  });

  it('uses payload.properties.directory when the top-level directory is an empty string', async () => {
    installDomStubs();

    let releaseStream;
    const hold = new Promise((resolve) => {
      releaseStream = resolve;
    });

    const received = [];
    const sdk = createSdkWithSingleEvent({
      directory: '',
      payload: {
        type: 'message.part.updated',
        properties: {
          directory: 'C:/fallback-dir',
          part: {
            id: 'part-1',
            type: 'text',
            messageID: 'message-1',
          },
        },
      },
    }, hold);

    const delivered = new Promise((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (directory, payload) => {
          received.push({ directory, payload });
          cleanup();
          releaseStream();
          resolve();
        },
      });
    });

    await delivered;

    expect(received).toHaveLength(1);
    expect(received[0].directory).toBe('C:/fallback-dir');
    expect(received[0].payload.type).toBe('message.part.updated');
  });

  it('keeps truly global events on the global channel when no directory is present anywhere', async () => {
    installDomStubs();

    let releaseStream;
    const hold = new Promise((resolve) => {
      releaseStream = resolve;
    });

    const received = [];
    const sdk = createSdkWithSingleEvent({
      payload: {
        type: 'server.connected',
        properties: {},
      },
    }, hold);

    const delivered = new Promise((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (directory, payload) => {
          received.push({ directory, payload });
          cleanup();
          releaseStream();
          resolve();
        },
      });
    });

    await delivered;

    expect(received).toHaveLength(1);
    expect(received[0].directory).toBe('global');
    expect(received[0].payload.type).toBe('server.connected');
  });

  it('keeps message.part.delta events when a newer message.part.updated is queued for the same field', async () => {
    installDomStubs();

    let releaseStream;
    const hold = new Promise((resolve) => {
      releaseStream = resolve;
    });

    const received = [];

    // The pipeline only routes/coalesces events. Whether this delta is already
    // represented by the newer snapshot is reducer state, not queue state.
    const directory = '/test/dir';
    const sdk = createSdkWithEvents([
      // T0: message.part.updated for part-A
      {
        payload: {
          type: 'message.part.updated',
          properties: {
            directory,
            part: { id: 'part-A', type: 'text', messageID: 'msg-1' },
          },
        },
      },
      // T1: message.part.delta for part-A
      {
        payload: {
          type: 'message.part.delta',
          properties: {
            directory,
            messageID: 'msg-1',
            partID: 'part-A',
            field: 'text',
            delta: ' world',
          },
        },
      },
      // T2: message.part.updated for part-A — coalesces with T0
      {
        payload: {
          type: 'message.part.updated',
          properties: {
            directory,
            part: { id: 'part-A', type: 'text', messageID: 'msg-1' },
          },
        },
      },
    ], hold);

    const delivered = new Promise((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (dir, payload) => {
          received.push({ directory: dir, payload });
          if (received.length === 2) {
            cleanup();
            releaseStream();
            resolve();
          }
        },
      });
    });

    await delivered;

    expect(received.length).toBe(2);
    expect(received[0].payload.type).toBe('message.part.updated');
    expect(received[1].payload.type).toBe('message.part.delta');
    expect(received[1].payload.properties.delta).toBe(' world');
  });

  it('keeps delta events for other fields on the same part', async () => {
    const received = await runPipelineWithEvents([
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.delta',
          properties: {
            messageID: 'msg-1',
            partID: 'part-1',
            field: 'reasoning',
            delta: 'before',
          },
        },
      },
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.updated',
          properties: {
            part: { id: 'part-1', type: 'text', messageID: 'msg-1' },
          },
        },
      },
    ]);

    expect(received).toHaveLength(2);
    expect(received[0].payload.type).toBe('message.part.delta');
    expect(received[0].payload.properties.field).toBe('reasoning');
    expect(received[1].payload.type).toBe('message.part.updated');
  });

  it('keeps text delta after an initial part.updated when no newer part.updated replaced it', async () => {
    const received = await runPipelineWithEvents([
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.updated',
          properties: {
            part: { id: 'part-1', type: 'text', messageID: 'msg-1' },
          },
        },
      },
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.delta',
          properties: {
            messageID: 'msg-1',
            partID: 'part-1',
            field: 'text',
            delta: 'hello',
          },
        },
      },
    ]);

    expect(received).toHaveLength(2);
    expect(received[0].payload.type).toBe('message.part.updated');
    expect(received[1].payload.type).toBe('message.part.delta');
    expect(received[1].payload.properties.delta).toBe('hello');
  });

  it('coalesces message.part.updated events for the same part', async () => {
    installDomStubs();

    let releaseStream;
    const hold = new Promise((resolve) => {
      releaseStream = resolve;
    });

    const received = [];
    const directory = '/test/dir';

    const sdk = createSdkWithEvents([
      {
        payload: {
          type: 'message.part.updated',
          properties: {
            directory,
            part: { id: 'part-A', type: 'text', messageID: 'msg-1' },
          },
        },
      },
      {
        payload: {
          type: 'message.part.updated',
          properties: {
            directory,
            part: { id: 'part-A', type: 'text', messageID: 'msg-1' },
          },
        },
      },
    ], hold);

    const delivered = new Promise((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (dir, payload) => {
          received.push({ directory: dir, payload });
          cleanup();
          releaseStream();
          resolve();
        },
      });
    });

    await delivered;

    // Only 1 event should be delivered (coalesced)
    expect(received.length).toBe(1);
    expect(received[0].payload.type).toBe('message.part.updated');
  });

  it('routes events before queueing so coalescing happens on the resolved directory', async () => {
    installDomStubs();

    let releaseStream;
    const hold = new Promise((resolve) => {
      releaseStream = resolve;
    });

    const received = [];
    const sdk = createSdkWithEvents([
      {
        directory: 'global',
        payload: {
          type: 'message.part.updated',
          properties: {
            part: { id: 'part-A', type: 'text', messageID: 'msg-1' },
          },
        },
      },
      {
        directory: '/real-dir',
        payload: {
          type: 'message.part.updated',
          properties: {
            part: { id: 'part-A', type: 'text', messageID: 'msg-1', text: 'next' },
          },
        },
      },
    ], hold);

    const delivered = new Promise((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        routeDirectory: (directory, payload) => {
          if (payload.type === 'message.part.updated') {
            return '/resolved-dir';
          }
          return directory;
        },
        onEvent: (dir, payload) => {
          received.push({ directory: dir, payload });
          cleanup();
          releaseStream();
          resolve();
        },
      });
    });

    await delivered;

    expect(received).toHaveLength(1);
    expect(received[0].directory).toBe('/resolved-dir');
    expect(received[0].payload.type).toBe('message.part.updated');
    expect(received[0].payload.properties.part.text).toBe('next');
  });

  it('consumes websocket message stream frames when transport is ws', async () => {
    installDomStubs();
    globalThis.WebSocket = FakeWebSocket;

    const received = [];
    const sdk = {
      global: {
        event: async () => {
          throw new Error('SSE should not be used in ws mode');
        },
      },
    };

    const delivered = new Promise((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        transport: 'ws',
        onEvent: (directory, payload) => {
          received.push({ directory, payload });
          cleanup();
          resolve();
        },
      });
    });

    await Promise.resolve();

    const socket = FakeWebSocket.instances[0];
    expect(socket?.url).toContain('/api/global/event/ws');

    socket.emitOpen();
    socket.emitMessage({ type: 'ready', scope: 'global' });
    socket.emitMessage({
      type: 'event',
      eventId: 'evt-1',
      directory: '/tmp/project',
      payload: {
        type: 'session.status',
        properties: {
          sessionID: 'session-1',
        },
      },
    });

    await delivered;

    expect(received).toEqual([
      {
        directory: '/tmp/project',
        payload: {
          type: 'session.status',
          properties: {
            sessionID: 'session-1',
          },
        },
      },
    ]);
  });

  it('retries websocket when it closes before ready in auto mode', async () => {
    installDomStubs();
    globalThis.WebSocket = FakeWebSocket;

    const disconnectReasons = [];
    let reconnectCount = 0;
    const sdk = {
      global: {
        event: async () => {
          throw new Error('SSE should not be used in auto websocket mode');
        },
      },
    };

    const recovered = new Promise((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        transport: 'auto',
        reconnectDelayMs: 0,
        onEvent: () => {},
        onDisconnect: (reason) => {
          disconnectReasons.push(reason);
        },
        onReconnect: () => {
          reconnectCount += 1;
          if (reconnectCount === 1) {
            cleanup();
            resolve();
          }
        },
      });
    });

    await Promise.resolve();
    const socket = FakeWebSocket.instances[0];
    socket.emitClose();

    const nextSocket = await waitForValue(
      () => FakeWebSocket.instances[1],
      'timed out waiting for websocket retry after close before ready',
    );
    nextSocket.emitOpen();
    nextSocket.emitMessage({ type: 'ready', scope: 'global' });

    await recovered;

    expect(disconnectReasons).toEqual(['ws_closed_before_ready']);
  });

  it('retries websocket when it does not become ready in auto mode', async () => {
    installDomStubs();
    globalThis.WebSocket = FakeWebSocket;

    const sdk = {
      global: {
        event: async () => {
          throw new Error('SSE should not be used in auto websocket mode');
        },
      },
    };

    let cleanup;
    const recovered = new Promise((resolve) => {
      const pipeline = createEventPipeline({
        sdk,
        transport: 'auto',
        reconnectDelayMs: 0,
        wsReadyTimeoutMs: 20,
        onEvent: () => {},
        onReconnect: () => {
          cleanup?.();
          resolve();
        },
      });
      cleanup = pipeline.cleanup;
    });

    await Promise.resolve();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();

    try {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const nextSocket = await waitForValue(
        () => FakeWebSocket.instances[1],
        'timed out waiting for websocket retry after ready timeout',
      );
      nextSocket.emitOpen();
      nextSocket.emitMessage({ type: 'ready', scope: 'global' });
      await withTimeout(recovered, 500, 'timed out waiting for websocket retry after ready timeout');
    } finally {
      cleanup?.();
    }
  });

  it('passes the last websocket event id when reconnecting websocket', async () => {
    installDomStubs();
    globalThis.WebSocket = FakeWebSocket;
    const originalConsoleError = console.error;
    console.error = () => {};

    const received = [];
    const sdk = {
      global: {
        event: async () => {
          throw new Error('SSE should not be used in auto websocket mode');
        },
      },
    };
    let cleanup;

    const delivered = new Promise((resolve) => {
      const pipeline = createEventPipeline({
        sdk,
        transport: 'auto',
        reconnectDelayMs: 0,
        wsReadyTimeoutMs: 20,
        onEvent: (directory, payload) => {
          received.push({ directory, payload });
          resolve();
        },
      });
      cleanup = pipeline.cleanup;
    });

    try {
      await Promise.resolve();

      const firstSocket = FakeWebSocket.instances[0];
      firstSocket.emitOpen();
      firstSocket.emitMessage({ type: 'ready', scope: 'global' });
      firstSocket.emitMessage({
        type: 'event',
        eventId: 'evt-1',
        directory: '/tmp/project',
        payload: {
          type: 'session.status',
          properties: {
            sessionID: 'session-1',
          },
        },
      });
      firstSocket.emitClose();

      await delivered;
      const secondSocket = await waitForValue(
        () => FakeWebSocket.instances[1],
        'timed out waiting for websocket reconnect with last event id',
      );
      expect(secondSocket?.url).toContain('lastEventId=evt-1');

      expect(received.some((entry) => entry.payload.type === 'session.status')).toBe(true);
    } finally {
      cleanup?.();
      console.error = originalConsoleError;
    }
  });

  it('passes websocket server id metadata without applying local directory routing', async () => {
    installDomStubs();
    globalThis.WebSocket = FakeWebSocket;

    const received = [];
    let routeDirectoryCalls = 0;
    let cleanup;

    const delivered = new Promise((resolve) => {
      const pipeline = createEventPipeline({
        sdk: {
          global: {
            event: async () => {
              throw new Error('SSE should not be used for websocket metadata test');
            },
          },
        },
        transport: 'ws',
        onEvent: (directory, payload, meta) => {
          received.push({ directory, payload, meta });
          resolve();
        },
        routeDirectory: () => {
          routeDirectoryCalls += 1;
          return '/local-reroute';
        },
      });
      cleanup = pipeline.cleanup;
    });

    try {
      await Promise.resolve();
      const socket = FakeWebSocket.instances[0];
      socket.emitOpen();
      socket.emitMessage({ type: 'ready', scope: 'global' });
      socket.emitMessage({
        type: 'event',
        serverId: 'remote-a',
        directory: '/remote/project',
        payload: {
          type: 'session.status',
          properties: {
            sessionID: 'remote-session',
            status: { type: 'busy' },
          },
        },
      });

      await delivered;
      cleanup?.();

      expect(routeDirectoryCalls).toBe(0);
      expect(received).toEqual([
        {
          directory: '/remote/project',
          payload: {
            type: 'session.status',
            properties: {
              sessionID: 'remote-session',
              status: { type: 'busy' },
            },
          },
          meta: { serverId: 'remote-a' },
        },
      ]);
    } finally {
      cleanup?.();
    }
  });

  it('retries websocket after an abnormal websocket close outside the quick-drop window', async () => {
    installDomStubs();
    globalThis.WebSocket = FakeWebSocket;
    const originalDateNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;

    const disconnectReasons = [];
    let reconnectCount = 0;
    const sdk = {
      global: {
        event: async () => {
          throw new Error('SSE should not be used in auto websocket mode');
        },
      },
    };

    let cleanup;
    const recovered = new Promise((resolve) => {
      const pipeline = createEventPipeline({
        sdk,
        transport: 'auto',
        reconnectDelayMs: 0,
        wsReadyTimeoutMs: 20,
        onEvent: () => {},
        onDisconnect: (reason) => {
          disconnectReasons.push(reason);
        },
        onReconnect: () => {
          reconnectCount += 1;
          if (reconnectCount === 2) {
            resolve();
          }
        },
      });
      cleanup = pipeline.cleanup;
    });

    try {
      await Promise.resolve();

      const socket = FakeWebSocket.instances[0];
      socket.emitOpen();
      socket.emitMessage({ type: 'ready', scope: 'global' });
      now += 5_000;
      socket.emitClose({ code: 1006 });

      const nextSocket = await waitForValue(
        () => FakeWebSocket.instances[1],
        'timed out waiting for websocket retry after abnormal close',
      );
      nextSocket.emitOpen();
      nextSocket.emitMessage({ type: 'ready', scope: 'global' });

      await withTimeout(recovered, 500, 'timed out waiting for abnormal-close websocket retry');

      expect(disconnectReasons).toEqual(['ws_unstable_close:code=1006']);
    } finally {
      cleanup?.();
      Date.now = originalDateNow;
    }
  });

  it('marks the pipeline disconnected on heartbeat timeout and recovers on the next websocket connect', async () => {
    installDomStubs();
    globalThis.WebSocket = FakeWebSocket;

    const disconnectReasons = [];
    let reconnectCount = 0;

    const sdk = {
      global: {
        event: async () => {
          throw new Error('SSE should not be used in ws mode');
        },
      },
    };

    const recovered = new Promise((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        transport: 'ws',
        heartbeatTimeoutMs: 20,
        reconnectDelayMs: 0,
        wsReadyTimeoutMs: 20,
        onEvent: () => {},
        onDisconnect: (reason) => {
          disconnectReasons.push(reason);
        },
        onReconnect: () => {
          reconnectCount += 1;
          if (reconnectCount === 2) {
            cleanup();
            resolve();
          }
        },
      });
    });

    await Promise.resolve();

    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.emitOpen();
    firstSocket.emitMessage({ type: 'ready', scope: 'global' });

    await new Promise((resolve) => setTimeout(resolve, 35));

    const secondSocket = FakeWebSocket.instances[1];
    expect(secondSocket).toBeDefined();

    secondSocket.emitOpen();
    secondSocket.emitMessage({ type: 'ready', scope: 'global' });

    await recovered;

    expect(disconnectReasons).toEqual(['ws_heartbeat_timeout']);
    expect(reconnectCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// P1 — Per-directory queue isolation
// ---------------------------------------------------------------------------

describe('createEventPipeline — per-directory isolation (P1)', () => {
  it('delivers events from two directories without losing either', async () => {
    const received = await runPipelineWithEvents([
      {
        directory: 'dir-a',
        payload: {
          type: 'session.status',
          properties: { sessionID: 's-a', status: { type: 'busy' } },
        },
      },
      {
        directory: 'dir-b',
        payload: {
          type: 'session.status',
          properties: { sessionID: 's-b', status: { type: 'idle' } },
        },
      },
    ]);

    const dirs = received.map((r) => r.directory).sort();
    expect(dirs).toEqual(['dir-a', 'dir-b']);
  });

  it('keeps distinct sessionIDs in the same directory as independent coalesce slots', async () => {
    const received = await runPipelineWithEvents([
      {
        directory: 'dir-a',
        payload: {
          type: 'session.status',
          properties: { sessionID: 's1', status: { type: 'busy' } },
        },
      },
      {
        directory: 'dir-a',
        payload: {
          type: 'session.status',
          properties: { sessionID: 's2', status: { type: 'busy' } },
        },
      },
    ]);

    expect(received).toHaveLength(2);
    const sessionIds = received.map((r) => r.payload.properties.sessionID).sort();
    expect(sessionIds).toEqual(['s1', 's2']);
  });

  it('collapses repeated session.status for the same session down to the latest', async () => {
    const received = await runPipelineWithEvents([
      {
        directory: 'dir-a',
        payload: {
          type: 'session.status',
          properties: { sessionID: 's1', status: { type: 'busy' } },
        },
      },
      {
        directory: 'dir-a',
        payload: {
          type: 'session.status',
          properties: { sessionID: 's1', status: { type: 'idle' } },
        },
      },
    ]);

    expect(received).toHaveLength(1);
    expect(received[0].payload.properties.status.type).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Option C — message.part.delta coalescing
// ---------------------------------------------------------------------------

describe('createEventPipeline — delta coalescing (Option C)', () => {
  it('accumulates consecutive deltas for the same (messageID, partID, field) into one event', async () => {
    const events = ['Hello ', 'world', ', ', 'how ', 'are ', 'you?'].map((chunk) => ({
      directory: 'dir-a',
      payload: {
        type: 'message.part.delta',
        properties: {
          messageID: 'msg-1',
          partID: 'part-1',
          field: 'text',
          delta: chunk,
        },
      },
    }));

    const received = await runPipelineWithEvents(events);

    expect(received).toHaveLength(1);
    expect(received[0].payload.type).toBe('message.part.delta');
    expect(received[0].payload.properties.delta).toBe('Hello world, how are you?');
    expect(received[0].payload.properties.messageID).toBe('msg-1');
    expect(received[0].payload.properties.partID).toBe('part-1');
    expect(received[0].payload.properties.field).toBe('text');
  });

  it('does NOT merge deltas across different fields on the same part', async () => {
    const received = await runPipelineWithEvents([
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.delta',
          properties: {
            messageID: 'msg-1',
            partID: 'part-1',
            field: 'text',
            delta: 'A',
          },
        },
      },
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.delta',
          properties: {
            messageID: 'msg-1',
            partID: 'part-1',
            field: 'reasoning',
            delta: 'B',
          },
        },
      },
    ]);

    expect(received).toHaveLength(2);
    const fieldDelta = received.map((r) => [
      r.payload.properties.field,
      r.payload.properties.delta,
    ]).sort();
    expect(fieldDelta).toEqual([
      ['reasoning', 'B'],
      ['text', 'A'],
    ]);
  });

  it('does NOT merge deltas across different parts on the same message', async () => {
    const received = await runPipelineWithEvents([
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.delta',
          properties: {
            messageID: 'msg-1',
            partID: 'part-1',
            field: 'text',
            delta: 'AAA',
          },
        },
      },
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.delta',
          properties: {
            messageID: 'msg-1',
            partID: 'part-2',
            field: 'text',
            delta: 'BBB',
          },
        },
      },
    ]);

    expect(received).toHaveLength(2);
    const byPart = Object.fromEntries(
      received.map((r) => [r.payload.properties.partID, r.payload.properties.delta]),
    );
    expect(byPart['part-1']).toBe('AAA');
    expect(byPart['part-2']).toBe('BBB');
  });

  it('starts a fresh delta entry after a part snapshot for the same part', async () => {
    const received = await runPipelineWithEvents([
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.delta',
          properties: {
            messageID: 'msg-1',
            partID: 'part-1',
            field: 'text',
            delta: 'ab',
          },
        },
      },
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'part-1',
              messageID: 'msg-1',
              type: 'text',
              text: 'ab',
            },
          },
        },
      },
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.delta',
          properties: {
            messageID: 'msg-1',
            partID: 'part-1',
            field: 'text',
            delta: 'c',
          },
        },
      },
    ]);

    expect(received.map((event) => event.payload.type)).toEqual([
      'message.part.delta',
      'message.part.updated',
      'message.part.delta',
    ]);
    expect(received[0].payload.properties.delta).toBe('ab');
    expect(received[2].payload.properties.delta).toBe('c');
  });

  it('does NOT merge deltas across different directories (per-directory queues)', async () => {
    const received = await runPipelineWithEvents([
      {
        directory: 'dir-a',
        payload: {
          type: 'message.part.delta',
          properties: {
            messageID: 'msg-1',
            partID: 'part-1',
            field: 'text',
            delta: 'from-a',
          },
        },
      },
      {
        directory: 'dir-b',
        payload: {
          type: 'message.part.delta',
          properties: {
            messageID: 'msg-1',
            partID: 'part-1',
            field: 'text',
            delta: 'from-b',
          },
        },
      },
    ]);

    expect(received).toHaveLength(2);
    const byDir = Object.fromEntries(
      received.map((r) => [r.directory, r.payload.properties.delta]),
    );
    expect(byDir['dir-a']).toBe('from-a');
    expect(byDir['dir-b']).toBe('from-b');
  });

  it('does not touch non-delta events (session.status still replaced, not concatenated)', async () => {
    const received = await runPipelineWithEvents([
      {
        directory: 'dir-a',
        payload: {
          type: 'session.status',
          properties: { sessionID: 's1', status: { type: 'busy' } },
        },
      },
      {
        directory: 'dir-a',
        payload: {
          type: 'session.status',
          properties: { sessionID: 's1', status: { type: 'idle' } },
        },
      },
    ]);

    expect(received).toHaveLength(1);
    expect(received[0].payload.properties.status.type).toBe('idle');
  });
});
