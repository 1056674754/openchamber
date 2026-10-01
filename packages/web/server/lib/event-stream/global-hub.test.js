import { describe, expect, it, vi } from 'vitest';

import { createGlobalMessageStreamHub } from './global-hub.js';

function createSseResponse({ blocks = [] } = {}) {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read() {
            if (index < blocks.length) {
              return { value: encoder.encode(blocks[index++]), done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    },
  };
}

async function waitForAssertion(assertion) {
  const deadline = Date.now() + 1000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

describe('createGlobalMessageStreamHub', () => {
  it('reports a replay gap when the requested cursor has fallen out of the buffer', async () => {
    const received = [];
    const hub = createGlobalMessageStreamHub({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      upstreamReconnectDelayMs: 100,
      replayLimit: 2,
      fetchImpl: async () => createSseResponse({
        blocks: [
          'id: evt-1\ndata: {"type":"session.updated","properties":{}}\n\n',
          'id: evt-2\ndata: {"type":"session.updated","properties":{}}\n\n',
          'id: evt-3\ndata: {"type":"session.updated","properties":{}}\n\n',
        ],
      }),
    });

    hub.subscribeEvent((event) => {
      received.push(event.eventId);
    });

    try {
      hub.start();
      await waitForAssertion(() => {
        expect(received).toEqual(['evt-1', 'evt-2', 'evt-3']);
      });

      const replay = hub.replayFrom('evt-2');
      expect(replay.gap).toBe(false);
      expect(replay.events.map((event) => event.eventId)).toEqual(['evt-3']);
      expect(hub.replayFrom('evt-1')).toEqual({ events: [], gap: true });
    } finally {
      hub.stop();
    }
  });

  it('continues fanout when an event subscriber throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const received = [];
    const hub = createGlobalMessageStreamHub({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      upstreamReconnectDelayMs: 100,
      fetchImpl: async () => createSseResponse({
        blocks: [
          'id: evt-1\ndata: {"type":"session.updated","properties":{}}\n\n',
        ],
      }),
    });

    hub.subscribeEvent(() => {
      throw new Error('subscriber failed');
    });
    hub.subscribeEvent((event) => {
      received.push(event.eventId);
    });

    try {
      hub.start();
      await waitForAssertion(() => {
        expect(received).toEqual(['evt-1']);
      });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      hub.stop();
      warnSpy.mockRestore();
    }
  });

  it('continues status fanout when a status subscriber throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const received = [];
    const hub = createGlobalMessageStreamHub({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      upstreamReconnectDelayMs: 100,
      fetchImpl: async () => createSseResponse(),
    });

    hub.subscribeStatus(() => {
      throw new Error('status subscriber failed');
    });
    hub.subscribeStatus((status) => {
      received.push(status.type);
    });

    try {
      hub.start();
      await waitForAssertion(() => {
        expect(received).toContain('connect');
      });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      hub.stop();
      warnSpy.mockRestore();
    }
  });

  it('continues fanout when an async event subscriber rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const received = [];
    const hub = createGlobalMessageStreamHub({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      upstreamReconnectDelayMs: 100,
      fetchImpl: async () => createSseResponse({
        blocks: [
          'id: evt-1\ndata: {"type":"session.updated","properties":{}}\n\n',
        ],
      }),
    });

    hub.subscribeEvent(async () => {
      throw new Error('async subscriber failed');
    });
    hub.subscribeEvent((event) => {
      received.push(event.eventId);
    });

    try {
      hub.start();
      await waitForAssertion(() => {
        expect(received).toEqual(['evt-1']);
      });
      await waitForAssertion(() => {
        expect(warnSpy).toHaveBeenCalled();
      });
    } finally {
      hub.stop();
      warnSpy.mockRestore();
    }
  });
});

describe('global hub protocol-mode intake (spine OC2-S2)', () => {
  const wireBlock = (id, type, data, extra = '') => (
    `data: {"id":"${id}","created":1000,"type":"${type}","location":{"directory":"/repo"},"data":${JSON.stringify(data)}}${extra}\n\n`
  );

  it('keeps the v1 upstream path and hands translated subscribers the same events on v1 mode', async () => {
    const paths = [];
    const raw = [];
    const translated = [];
    const hub = createGlobalMessageStreamHub({
      buildOpenCodeUrl: (pathname) => {
        paths.push(pathname);
        return `http://127.0.0.1:4096${pathname}`;
      },
      getOpenCodeAuthHeaders: () => ({}),
      resolveUpstreamProtocolMode: () => 'v1',
      upstreamReconnectDelayMs: 100,
      fetchImpl: async () => createSseResponse({
        blocks: [
          'id: evt-1\ndata: {"type":"session.status","properties":{"sessionID":"s1","status":{"type":"busy"}}}\n\n',
        ],
      }),
    });

    hub.subscribeEvent((event) => raw.push(event));
    hub.subscribeTranslatedEvent((event) => translated.push(event));

    try {
      hub.start();
      await waitForAssertion(() => {
        expect(translated).toHaveLength(1);
      });
      expect(paths).toEqual(['/global/event']);
      // v1 identity: translated subscribers get the very same event objects.
      expect(translated[0]).toBe(raw[0]);
    } finally {
      hub.stop();
    }
  });

  it('switches the upstream path to /api/event on v2 mode', async () => {
    const paths = [];
    const hub = createGlobalMessageStreamHub({
      buildOpenCodeUrl: (pathname) => {
        paths.push(pathname);
        return `http://127.0.0.1:4096${pathname}`;
      },
      getOpenCodeAuthHeaders: () => ({}),
      resolveUpstreamProtocolMode: () => 'v2',
      upstreamReconnectDelayMs: 100,
      fetchImpl: async () => createSseResponse({ blocks: [wireBlock('evt-1', 'server.connected', {})] }),
    });

    try {
      hub.start();
      await waitForAssertion(() => {
        expect(paths).toContain('/api/event');
      });
    } finally {
      hub.stop();
    }
  });

  it('fans raw wire to event subscribers and v1 vocabulary to translated subscribers on v2 mode', async () => {
    const raw = [];
    const translated = [];
    const hub = createGlobalMessageStreamHub({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      resolveUpstreamProtocolMode: () => 'v2',
      upstreamReconnectDelayMs: 100,
      fetchImpl: async () => createSseResponse({
        blocks: [
          wireBlock('evt-1', 'session.execution.succeeded', { sessionID: 's1' }),
          // Streaming deltas translate to nothing for server consumers but
          // must still reach the browser path untouched.
          wireBlock('evt-2', 'session.text.delta', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 1, delta: 'hi' }),
        ],
      }),
    });

    hub.subscribeEvent((event) => raw.push(event));
    hub.subscribeTranslatedEvent((event) => translated.push(event));

    try {
      hub.start();
      await waitForAssertion(() => {
        expect(raw).toHaveLength(2);
      });
      expect(raw.map((event) => event.payload.type)).toEqual(['session.execution.succeeded', 'session.text.delta']);

      expect(translated.map((event) => event.payload.type)).toEqual(['session.status', 'session.idle']);
      expect(translated[0].payload.properties.status).toEqual({ type: 'idle' });
      expect(translated[0].payload.properties.sessionID).toBe('s1');
      // Derived event ids stay traceable to the source wire event.
      expect(translated[0].eventId).toBe('evt-1#0');
      expect(translated[1].eventId).toBe('evt-1#1');
      expect(translated[0].directory).toBe('/repo');
      // Translated events never enter the replay buffer; the browser replay
      // speaks raw wire (the entry after evt-1 is the untouched delta).
      expect(hub.replayFrom('evt-1').events.map((entry) => entry.payload.type)).toEqual(['session.text.delta']);
      expect(hub.replayFrom('evt-2').events).toEqual([]);
    } finally {
      hub.stop();
    }
  });

  it('notifies translated subscribers once per translated event with per-event envelopes', async () => {
    const translated = [];
    const hub = createGlobalMessageStreamHub({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      resolveUpstreamProtocolMode: () => 'v2',
      upstreamReconnectDelayMs: 100,
      fetchImpl: async () => createSseResponse({
        blocks: [
          // An interrupted execution synthesizes status + idle-abort; a
          // shutdown interruption synthesizes nothing.
          wireBlock('evt-1', 'session.execution.interrupted', { sessionID: 's1', reason: 'shutdown' }),
          wireBlock('evt-2', 'session.execution.interrupted', { sessionID: 's1', reason: 'user' }),
        ],
      }),
    });

    hub.subscribeTranslatedEvent((event) => translated.push(event));

    try {
      hub.start();
      await waitForAssertion(() => {
        expect(translated).toHaveLength(2);
      });
      expect(translated.map((event) => event.payload.type)).toEqual(['session.status', 'session.idle']);
      expect(translated[1].eventId).toBe('evt-2#1');
      expect(translated[1].payload.properties.aborted).toBe(true);
    } finally {
      hub.stop();
    }
  });
});
