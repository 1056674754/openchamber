import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionRuntime } from './session-runtime.js';

describe('session runtime', () => {
  const runtimes = [];

  afterEach(() => {
    for (const runtime of runtimes) {
      runtime.dispose();
    }
    runtimes.length = 0;
  });

  it('broadcasts attention clears through the shared broadcaster', () => {
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error('SSE fallback should not be used when broadcastEvent is provided');
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload);
      },
    });
    runtimes.push(runtime);

    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: {
        sessionID: 'session-1',
        status: {
          type: 'busy',
        },
      },
    });
    runtime.markUserMessageSent('session-1');
    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: {
        sessionID: 'session-1',
        status: {
          type: 'idle',
        },
      },
    });
    runtime.markSessionViewed('session-1', 'client-1');

    expect(events).toContainEqual({
      type: 'openchamber:session-status',
      properties: expect.objectContaining({
        sessionID: 'session-1',
        status: 'idle',
        needsAttention: true,
      }),
    });
    expect(events.at(-1)).toEqual({
      type: 'openchamber:session-status',
      properties: {
        sessionID: 'session-1',
        status: 'idle',
        timestamp: expect.any(Number),
        metadata: {},
        needsAttention: false,
      },
    });
  });

  it('accepts legacy session.status info.type payloads', () => {
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error('SSE fallback should not be used when broadcastEvent is provided');
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload);
      },
    });
    runtimes.push(runtime);

    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: {
        sessionID: 'legacy-session-1',
        info: {
          type: 'busy',
        },
      },
    });

    expect(events).toContainEqual({
      type: 'openchamber:session-status',
      properties: expect.objectContaining({
        sessionID: 'legacy-session-1',
        status: 'busy',
      }),
    });
  });

  it('broadcasts idle activity when cooldown expires', () => {
    vi.useFakeTimers();
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error('SSE fallback should not be used when broadcastEvent is provided');
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload);
      },
    });

    try {
      runtime.processOpenCodeSsePayload({
        type: 'session.status',
        properties: {
          sessionID: 'session-activity-1',
          status: {
            type: 'busy',
          },
        },
      });
      runtime.processOpenCodeSsePayload({
        type: 'session.status',
        properties: {
          sessionID: 'session-activity-1',
          status: {
            type: 'idle',
          },
        },
      });

      const activityPhases = () => events
        .filter((event) => event.type === 'openchamber:session-activity')
        .map((event) => event.properties.phase);

      expect(activityPhases()).toEqual(['busy', 'cooldown']);

      vi.advanceTimersByTime(1999);
      expect(activityPhases()).toEqual(['busy', 'cooldown']);

      vi.advanceTimersByTime(1);

      expect(activityPhases()).toEqual(['busy', 'cooldown', 'idle']);
    } finally {
      runtime.dispose();
      vi.useRealTimers();
    }
  });

  it('interrupts busy sessions after restart and broadcasts terminal events once', () => {
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent: (event) => events.push(event),
    });
    runtimes.push(runtime);
    const status = (sessionID, type) => runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID, status: { type } },
    });

    status('session-busy-1', 'busy');
    status('session-busy-2', 'retry');
    status('session-idle', 'idle');
    expect(runtime.getActiveSessionCount()).toBe(2);
    events.length = 0;

    expect(runtime.interruptBusySessionsAfterRestart()).toEqual({
      sessionIds: ['session-busy-1', 'session-busy-2'],
    });

    expect(runtime.getActiveSessionCount()).toBe(0);
    const terminalEvents = events.filter((event) => (
      event.type === 'openchamber:session-status' || event.type === 'session.error'
    ));
    expect(terminalEvents).toHaveLength(4);
    for (const sessionId of ['session-busy-1', 'session-busy-2']) {
      expect(terminalEvents).toContainEqual({
        type: 'openchamber:session-status',
        properties: expect.objectContaining({ sessionID: sessionId, status: 'idle' }),
      });
      expect(terminalEvents).toContainEqual({
        type: 'session.error',
        properties: {
          sessionID: sessionId,
          error: {
            name: 'MessageAbortedError',
            message: 'The running turn was interrupted when OpenCode restarted.',
          },
        },
      });
    }
    expect(terminalEvents.some((event) => event.properties.sessionID === 'session-idle')).toBe(false);

    events.length = 0;
    expect(runtime.interruptBusySessionsAfterRestart()).toEqual({ sessionIds: [] });
    expect(events).toEqual([]);
  });

  it('suppresses unread while viewed and records it after the view is cleared', () => {
    const unreadStore = {
      recordActivity: vi.fn(),
      markRead: vi.fn(),
      getUnreadState: vi.fn(() => null),
      flush: vi.fn(),
      dispose: vi.fn(),
    };
    const runtime = createSessionRuntime({
      writeSseEvent: vi.fn(),
      getNotificationClients: () => new Set(),
      broadcastEvent: vi.fn(),
      unreadStore,
    });
    runtimes.push(runtime);

    runtime.markSessionViewed('session-viewed', 'client-1');
    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID: 'session-viewed', status: { type: 'busy' } },
    });
    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID: 'session-viewed', status: { type: 'idle' } },
    });

    expect(unreadStore.recordActivity).not.toHaveBeenCalled();

    runtime.markSessionUnviewed('session-viewed', 'client-1');
    runtime.markUserMessageSent('session-viewed');
    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID: 'session-viewed', status: { type: 'busy' } },
    });
    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID: 'session-viewed', status: { type: 'idle' } },
    });

    expect(unreadStore.recordActivity).toHaveBeenCalledOnce();
    expect(unreadStore.recordActivity).toHaveBeenCalledWith('session-viewed', { hasError: false });
  });

  it('expires a viewed client when its heartbeat stops', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));
    const unreadStore = {
      recordActivity: vi.fn(),
      markRead: vi.fn(),
      getUnreadState: vi.fn(() => null),
      flush: vi.fn(),
      dispose: vi.fn(),
    };
    const runtime = createSessionRuntime({
      writeSseEvent: vi.fn(),
      getNotificationClients: () => new Set(),
      broadcastEvent: vi.fn(),
      unreadStore,
    });

    try {
      runtime.markSessionViewed('session-expired', 'client-1');
      runtime.markUserMessageSent('session-expired');
      runtime.processOpenCodeSsePayload({
        type: 'session.status',
        properties: { sessionID: 'session-expired', status: { type: 'busy' } },
      });
      vi.advanceTimersByTime(60_001);
      runtime.processOpenCodeSsePayload({
        type: 'session.status',
        properties: { sessionID: 'session-expired', status: { type: 'idle' } },
      });

      expect(unreadStore.recordActivity).toHaveBeenCalledOnce();
      expect(runtime.getSessionAttentionState('session-expired')?.isViewed).toBe(false);
    } finally {
      runtime.dispose();
      vi.useRealTimers();
    }
  });
});
