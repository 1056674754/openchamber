import { sendMessageStreamWsEvent, sendMessageStreamWsFrame } from './protocol.js';

function shouldTriggerUpstreamHealthCheck(upstream) {
  if (!upstream) {
    return true;
  }

  if (!upstream.body) {
    return upstream.ok || upstream.status >= 500;
  }

  return upstream.status >= 500;
}

export function createGlobalMessageStreamWsBridge({
  globalHub,
  ownsGlobalHub,
  wsClients,
  processForwardedEventPayload,
  triggerHealthCheck,
  heartbeatIntervalMs,
  remoteGlobalEventFanout = null,
}) {
  const clients = new Set();
  const clientLastEventIds = new Map();
  const readyClients = new Set();
  let unsubscribeRemoteGlobalEventFanout = null;

  const removeClient = (socket) => {
    clients.delete(socket);
    clientLastEventIds.delete(socket);
    readyClients.delete(socket);
    wsClients.delete(socket);
  };

  const replayEvents = (socket, requestedLastEventId) => {
    for (const entry of globalHub.replayAfter(requestedLastEventId)) {
      const sent = sendMessageStreamWsEvent(socket, entry.payload, {
        directory: entry.directory,
        eventId: entry.eventId,
      });
      if (!sent) {
        removeClient(socket);
        return;
      }
    }
  };

  const markReady = (socket, requestedLastEventId) => {
    if (socket.readyState !== 1) {
      return;
    }

    const sent = sendMessageStreamWsFrame(socket, {
      type: 'ready',
      scope: 'global',
    });
    if (!sent) {
      removeClient(socket);
      return;
    }

    readyClients.add(socket);
    wsClients.add(socket);
    replayEvents(socket, requestedLastEventId);
  };

  const stopHubIfUnused = () => {
    if (ownsGlobalHub && clients.size === 0) {
      globalHub.stop();
    }
    if (clients.size === 0 && unsubscribeRemoteGlobalEventFanout) {
      unsubscribeRemoteGlobalEventFanout();
      unsubscribeRemoteGlobalEventFanout = null;
    }
  };

  const startRemoteGlobalEventFanout = () => {
    if (!remoteGlobalEventFanout || unsubscribeRemoteGlobalEventFanout) {
      return;
    }

    unsubscribeRemoteGlobalEventFanout = remoteGlobalEventFanout.subscribe((event) => {
      if (!event?.serverId || !event.payload) {
        return;
      }

      for (const socket of Array.from(clients)) {
        if (!wsClients.has(socket)) {
          continue;
        }
        const sent = sendMessageStreamWsEvent(socket, event.payload, {
          directory: event.directory,
          eventId: event.eventId,
          serverId: event.serverId,
        });
        if (!sent) {
          removeClient(socket);
        }
      }
      stopHubIfUnused();
    });
  };

  const closeClientsWithInitialError = ({ message, closeReason = message, triggerHealthCheckFor = null }) => {
    for (const socket of Array.from(clients)) {
      sendMessageStreamWsFrame(socket, { type: 'error', message });
      try {
        socket.close(1011, closeReason);
      } catch {
      }
      removeClient(socket);
    }

    if (unsubscribeRemoteGlobalEventFanout) {
      unsubscribeRemoteGlobalEventFanout();
      unsubscribeRemoteGlobalEventFanout = null;
    }

    if (triggerHealthCheckFor === true || (triggerHealthCheckFor && shouldTriggerUpstreamHealthCheck(triggerHealthCheckFor))) {
      triggerHealthCheck?.();
    }

    if (ownsGlobalHub) {
      globalHub.stop();
    }
  };

  const unsubscribeEvent = globalHub.subscribeEvent(({ payload, directory, eventId }) => {
    for (const socket of Array.from(clients)) {
      if (!readyClients.has(socket)) {
        continue;
      }
      const sent = sendMessageStreamWsEvent(socket, payload, {
        directory,
        eventId,
      });
      if (!sent) {
        removeClient(socket);
      }
    }

    processForwardedEventPayload(payload, (syntheticPayload) => {
      for (const socket of Array.from(clients)) {
        if (!readyClients.has(socket)) {
          continue;
        }
        const sent = sendMessageStreamWsEvent(socket, syntheticPayload, { directory: 'global' });
        if (!sent) {
          removeClient(socket);
        }
      }
    });
  });

  const unsubscribeStatus = globalHub.subscribeStatus((status) => {
    if (status.type === 'connect') {
      for (const socket of Array.from(clients)) {
        if (!readyClients.has(socket)) {
          markReady(socket, clientLastEventIds.get(socket) ?? '');
        }
      }
      return;
    }

    if (status.type === 'initial-error') {
      const error = status.error;
      if (error?.type === 'upstream_unavailable') {
        closeClientsWithInitialError({
          message: `OpenCode event stream unavailable (${error.status})`,
          closeReason: 'OpenCode event stream unavailable',
          triggerHealthCheckFor: error.response,
        });
        return;
      }

      closeClientsWithInitialError({
        message: status.buildUrlFailed ? 'OpenCode service unavailable' : 'Failed to connect to OpenCode event stream',
        closeReason: status.buildUrlFailed ? 'OpenCode service unavailable' : 'Failed to connect to OpenCode event stream',
        triggerHealthCheckFor: !status.buildUrlFailed,
      });
      return;
    }

    if (status.type === 'error' && status.error?.type === 'stream_error') {
      console.warn('Message stream WS proxy error:', status.error.error);
    }
  });

  const accept = (socket, { requestedLastEventId = '' } = {}) => {
    const pingInterval = setInterval(() => {
      if (socket.readyState !== 1) {
        return;
      }

      try {
        socket.ping();
      } catch {
      }
    }, heartbeatIntervalMs);

    // Heartbeat must fire unconditionally so the client's heartbeat timer
    // stays alive even when the upstream SSE reader is reconnecting.  If the
    // hub is disconnected the client would otherwise time out after 30 s,
    // causing a visible "Connection lost" toast even though the bridge will
    // resume forwarding events once the upstream reconnects.
    const heartbeatInterval = setInterval(() => {
      if (socket.readyState !== 1) {
        return;
      }

      sendMessageStreamWsEvent(socket, { type: 'openchamber:heartbeat', timestamp: Date.now() }, { directory: 'global' });
    }, heartbeatIntervalMs);

    socket.on('close', () => {
      clearInterval(pingInterval);
      clearInterval(heartbeatInterval);
      removeClient(socket);
      stopHubIfUnused();
    });

    socket.on('error', () => {
      void 0;
    });

    clients.add(socket);
    clientLastEventIds.set(socket, requestedLastEventId);
    globalHub.start();

    // Send ready frame immediately — prevents client-side wsReadyTimeoutMs.
    // Event replay is deferred to when the upstream connects (via status subscriber).
    sendMessageStreamWsFrame(socket, { type: 'ready', scope: 'global' });
    wsClients.add(socket);
    startRemoteGlobalEventFanout();

    if (globalHub.isConnected()) {
      readyClients.add(socket);
      replayEvents(socket, requestedLastEventId);
    }
  };

  const close = () => {
    unsubscribeEvent();
    unsubscribeStatus();
    if (unsubscribeRemoteGlobalEventFanout) {
      unsubscribeRemoteGlobalEventFanout();
      unsubscribeRemoteGlobalEventFanout = null;
    }
    remoteGlobalEventFanout?.close?.();
    if (ownsGlobalHub) {
      globalHub.stop();
    }
    for (const socket of Array.from(clients)) {
      removeClient(socket);
    }
  };

  return {
    accept,
    close,
  };
}
