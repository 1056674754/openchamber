export const createGracefulShutdownRuntime = (dependencies) => {
  const {
    process,
    shutdownTimeoutMs,
    getExitOnShutdown,
    getIsShuttingDown,
    setIsShuttingDown,
    syncToHmrState,
    openCodeWatcherRuntime,
    openCodeConfigFileWatcherRuntime,
    sessionRuntime,
    scheduledTasksRuntime,
    sessionGoalRuntime,
    sessionAssistRuntime,
    contextObligatoryRuntime,
    messageQueueRuntime,
    getHealthCheckInterval,
    clearHealthCheckInterval,
    getTerminalRuntime,
    setTerminalRuntime,
    getMessageStreamRuntime,
    setMessageStreamRuntime,
    getDevTunnelRuntime,
    setDevTunnelRuntime,
    shouldSkipOpenCodeStop,
    getOpenCodePort,
    getOpenCodeProcess,
    setOpenCodeProcess,
    killProcessOnPort,
    waitForPortRelease,
    getManagedOpenCodePorts = () => [],
    clearManagedOpenCodePorts = () => {},
    getServer,
    getUiAuthController,
    setUiAuthController,
    getActiveTunnelController,
    setActiveTunnelController,
    tunnelAuthController,
    getRemoteInstancesRuntime,
    // Optional guest/relay teardown hooks (upstream ff8679be0). The host wiring
    // passes them from index.js; until then they stay undefined and shutdown
    // behaves exactly as before.
    beginGuestServiceShutdown,
    stopAllGuestServices,
    getGuestSurfaceRuntime,
    getRealtimeProxyRuntime,
    getDictationRuntime,
    getRelayService,
    getRelayReconcileTimer,
  } = dependencies;

  let shutdownPromise = null;
  const serverConnections = new Set();
  let closingHttpServer = false;

  // Track TCP sockets before listen(): HTTP stops tracking them on upgrade,
  // even when no WebSocket handler completes the handshake.
  const trackServerConnections = (server) => {
    const onConnection = (socket) => {
      if (closingHttpServer) {
        socket.destroy();
        return;
      }
      serverConnections.add(socket);
      socket.once('close', () => serverConnections.delete(socket));
    };
    server.on('connection', onConnection);
    server.once('close', () => server.off('connection', onConnection));
  };

  // Not async: callers coalescing onto an in-flight shutdown must receive the
  // exact in-flight promise, which an async wrapper would re-wrap.
  const gracefulShutdown = (options = {}) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = runShutdown(options);
    return shutdownPromise;
  };

  const runShutdown = async (options = {}) => {
    if (getIsShuttingDown()) return;

    setIsShuttingDown(true);
    // Close guest-service admission synchronously so no new guest start can
    // race the teardown sequence below (upstream ff8679be0).
    beginGuestServiceShutdown?.();
    syncToHmrState();
    console.log('Starting graceful shutdown...');
    const exitProcess = typeof options.exitProcess === 'boolean' ? options.exitProcess : getExitOnShutdown();

    // Both embedded stop() and daemon exits use this sequence. Stop viewers
    // before draining their services; one failed runtime must not skip the
    // rest of host teardown.
    const cleanupOperations = [
      () => getRelayReconcileTimer && clearInterval(getRelayReconcileTimer()),
      () => getGuestSurfaceRuntime?.()?.stop(),
      () => getRealtimeProxyRuntime?.()?.stop(),
      () => getRelayService?.()?.stop(),
      () => getDictationRuntime?.()?.stop(),
      () => openCodeWatcherRuntime.stop(),
      () => openCodeConfigFileWatcherRuntime?.stop(),
      () => sessionRuntime.dispose(),
      () => sessionAssistRuntime?.stop?.(),
      () => sessionGoalRuntime?.stop?.(),
      () => contextObligatoryRuntime?.stop?.(),
      () => messageQueueRuntime?.stop?.(),
      () => scheduledTasksRuntime?.stop?.(),
      () => stopAllGuestServices?.(),
    ];
    for (const cleanup of cleanupOperations) {
      try {
        await cleanup();
      } catch {
        // One failed runtime must not skip the rest of host teardown.
      }
    }

    const remoteInstancesRuntime = getRemoteInstancesRuntime?.();
    if (remoteInstancesRuntime) {
      try {
        remoteInstancesRuntime.shutdown();
      } catch {}
    }

    const healthCheckInterval = getHealthCheckInterval();
    if (healthCheckInterval) {
      clearHealthCheckInterval(healthCheckInterval);
    }

    const terminalRuntime = getTerminalRuntime();
    if (terminalRuntime) {
      try {
        await terminalRuntime.shutdown();
      } catch {
      } finally {
        setTerminalRuntime(null);
      }
    }

    const messageStreamRuntime = getMessageStreamRuntime();
    if (messageStreamRuntime) {
      try {
        await messageStreamRuntime.close();
      } catch {
      } finally {
        setMessageStreamRuntime(null);
      }
    }

    const devTunnelRuntime = getDevTunnelRuntime?.();
    if (devTunnelRuntime) {
      try {
        devTunnelRuntime.dispose();
      } catch {
      } finally {
        setDevTunnelRuntime?.(null);
      }
    }

    const skipOpenCodeStop = shouldSkipOpenCodeStop(options);
    if (!skipOpenCodeStop) {
      const portToKill = getOpenCodePort();
      const openCodeProcess = getOpenCodeProcess();
      const portsToKill = [];
      const addPortToKill = (port) => {
        if (!Number.isFinite(port) || port <= 0 || portsToKill.includes(port)) return;
        portsToKill.push(port);
      };
      addPortToKill(portToKill);
      for (const port of getManagedOpenCodePorts()) {
        addPortToKill(port);
      }

      if (openCodeProcess) {
        console.log('Stopping OpenCode process...');
        try {
          await openCodeProcess.close('app_shutdown');
        } catch (error) {
          console.warn('Error closing OpenCode process:', error);
        }
        setOpenCodeProcess(null);
      }

      for (const port of portsToKill) {
        killProcessOnPort(port);
        if (!(await waitForPortRelease(port, 5000))) {
          console.warn(`Timed out waiting for OpenCode port ${port} to be released during shutdown`);
        }
      }
      clearManagedOpenCodePorts();
    } else {
      console.log('Skipping OpenCode shutdown (external server or preserved managed server)');
      const openCodeProcess = getOpenCodeProcess();
      if (openCodeProcess) {
        setOpenCodeProcess(null);
      }
    }

    const server = getServer();
    if (server) {
      closingHttpServer = true;
      let closeTimeout = null;
      try {
        await Promise.race([
          new Promise((resolve) => {
            server.close(() => {
              console.log('HTTP server closed');
              resolve();
            });
            // The backend has stopped. Active SSE/HTTP clients must not keep
            // Desktop waiting for the outer shutdown deadline.
            server.closeAllConnections?.();
            // Includes upgraded sockets and reconnects accepted while the
            // services above were draining. No child-process grace is cut short.
            for (const socket of serverConnections) socket.destroy();
          }),
          new Promise((resolve) => {
            closeTimeout = setTimeout(() => {
              console.warn('Server close timeout reached, forcing shutdown');
              resolve();
            }, shutdownTimeoutMs);
          }),
        ]);
      } finally {
        if (closeTimeout) {
          clearTimeout(closeTimeout);
        }
      }
    }

    const uiAuthController = getUiAuthController();
    if (uiAuthController) {
      uiAuthController.dispose();
      setUiAuthController(null);
    }

    const activeTunnelController = getActiveTunnelController();
    if (activeTunnelController) {
      console.log('Stopping active tunnel...');
      activeTunnelController.stop();
      setActiveTunnelController(null);
      tunnelAuthController.clearActiveTunnel();
    }

    console.log('Graceful shutdown complete');
    if (exitProcess) {
      process.exit(0);
    }
  };

  return {
    gracefulShutdown,
    trackServerConnections,
  };
};
