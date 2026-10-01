import { createUpstreamSseReader } from './upstream-reader.js';
import { translateWireEvent, wireEventDirectory } from './translate-v2.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from '../opencode/protocol-mode.js';

// Raised from 512 → 2048 to improve recovery after brief disconnects during
// long-running agent sessions where many events accumulate quickly.
export const MESSAGE_STREAM_GLOBAL_REPLAY_LIMIT = 2048;

export function createGlobalMessageStreamHub({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  fetchImpl = fetch,
  upstreamStallTimeoutMs,
  upstreamReconnectDelayMs,
  replayLimit = MESSAGE_STREAM_GLOBAL_REPLAY_LIMIT,
  resolveUpstreamProtocolMode = () => resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID),
}) {
  const eventSubscribers = new Set();
  const translatedEventSubscribers = new Set();
  const statusSubscribers = new Set();
  const replay = [];

  let controller = null;
  let reader = null;
  let connected = false;
  let everConnected = false;
  let buildUrlFailed = false;

  const notifySubscriber = (kind, subscriber, payload) => {
    try {
      const result = subscriber(payload);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => {
          console.warn(`Global message stream ${kind} subscriber failed:`, error);
        });
      }
    } catch (error) {
      console.warn(`Global message stream ${kind} subscriber failed:`, error);
    }
  };

  const notifyStatus = (status) => {
    for (const subscriber of Array.from(statusSubscribers)) {
      notifySubscriber('status', subscriber, status);
    }
  };

  const normalizeEvent = ({ envelope, payload }) => {
    const directory =
      typeof envelope?.directory === 'string' && envelope.directory.length > 0 ? envelope.directory : 'global';
    const eventId = typeof envelope?.eventId === 'string' && envelope.eventId.length > 0 ? envelope.eventId : undefined;
    return {
      envelope,
      payload,
      directory,
      eventId,
    };
  };

  /**
   * Server-consumer intake (spine plan OC2-S2). The browser path keeps the raw
   * wire payload; this second subscriber set receives the v1 vocabulary the
   * server's own runtimes (message queue, permissions, goals, notifications,
   * session activity) were written against.
   *
   * v1 mode forwards the very same normalized event objects, so consumers
   * behave exactly as before the dual-track split. v2 mode translates each
   * wire event into zero or more v1 events and notifies once per translated
   * event. Translated events never enter the replay buffer: replay only feeds
   * browser clients, which read the raw wire.
   */
  const notifyTranslated = (normalized) => {
    if (translatedEventSubscribers.size === 0) {
      return;
    }
    if (resolveUpstreamProtocolMode() !== 'v2') {
      for (const subscriber of Array.from(translatedEventSubscribers)) {
        notifySubscriber('event', subscriber, normalized);
      }
      return;
    }

    const translatedEvents = translateWireEvent(normalized.payload);
    const wireDirectory = wireEventDirectory(normalized.payload);
    for (const [index, translated] of translatedEvents.entries()) {
      const directory = wireDirectory || 'global';
      const eventId = normalized.eventId !== undefined
        ? `${normalized.eventId}#${index}`
        : undefined;
      const entry = {
        envelope: { eventId, directory, payload: translated },
        payload: translated,
        directory,
        eventId,
      };
      for (const subscriber of Array.from(translatedEventSubscribers)) {
        notifySubscriber('event', subscriber, entry);
      }
    }
  };

  const start = () => {
    if (reader) {
      return;
    }

    controller = new AbortController();
    reader = createUpstreamSseReader({
      signal: controller.signal,
      stallTimeoutMs: upstreamStallTimeoutMs,
      reconnectDelayMs: upstreamReconnectDelayMs,
      fetchImpl,
      buildUrl: () => {
        buildUrlFailed = false;
        try {
          // OpenCode 2 moved the global event stream from `/global/event` to
          // `/api/event`; the branch keeps the v1 track byte-identical.
          const upstreamPath = resolveUpstreamProtocolMode() === 'v2' ? '/api/event' : '/global/event';
          return new URL(buildOpenCodeUrl(upstreamPath, ''));
        } catch {
          buildUrlFailed = true;
          throw new Error('OpenCode service unavailable');
        }
      },
      getHeaders: getOpenCodeAuthHeaders,
      onConnect({ lastEventId }) {
        connected = true;
        const wasReady = everConnected;
        everConnected = true;
        notifyStatus({
          type: 'connect',
          wasReady,
          replayGap: wasReady && !lastEventId,
        });
      },
      onDisconnect({ reason }) {
        connected = false;
        notifyStatus({ type: 'disconnect', reason });
      },
      onEvent(event) {
        const normalized = normalizeEvent(event);
        if (normalized.eventId) {
          replay.push(normalized);
          if (replay.length > replayLimit) {
            replay.splice(0, replay.length - replayLimit);
          }
        }

        for (const subscriber of Array.from(eventSubscribers)) {
          notifySubscriber('event', subscriber, normalized);
        }
        notifyTranslated(normalized);
      },
      onError(error) {
        if (controller?.signal.aborted) {
          return;
        }

        notifyStatus({
          type: everConnected ? 'error' : 'initial-error',
          error,
          buildUrlFailed,
        });
      },
    });

    void reader.start();
  };

  const stop = () => {
    connected = false;
    reader?.stop();
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    reader = null;
    controller = null;
    everConnected = false;
    buildUrlFailed = false;
  };

  return {
    start,
    stop,
    isConnected() {
      return connected;
    },
    hasConnected() {
      return everConnected;
    },
    subscribeEvent(subscriber) {
      eventSubscribers.add(subscriber);
      return () => {
        eventSubscribers.delete(subscriber);
      };
    },
    subscribeTranslatedEvent(subscriber) {
      translatedEventSubscribers.add(subscriber);
      return () => {
        translatedEventSubscribers.delete(subscriber);
      };
    },
    subscribeStatus(subscriber) {
      statusSubscribers.add(subscriber);
      return () => {
        statusSubscribers.delete(subscriber);
      };
    },
    replayFrom(eventId) {
      if (!eventId) {
        return { events: [], gap: false };
      }

      const index = replay.findIndex((entry) => entry.eventId === eventId);
      return index === -1
        ? { events: [], gap: true }
        : { events: replay.slice(index + 1), gap: false };
    },
  };
}
