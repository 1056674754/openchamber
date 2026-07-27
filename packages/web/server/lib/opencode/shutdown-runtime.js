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
    getHealthCheckInterval,
    clearHealthCheckInterval,
    getTerminalRuntime,
    setTerminalRuntime,
    getMessageStreamRuntime,
    setMessageStreamRuntime,
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
  } = dependencies;

  const gracefulShutdown = async (options = {}) => {
    if (getIsShuttingDown()) return;

    setIsShuttingDown(true);
    syncToHmrState();
    console.log('Starting graceful shutdown...');
    const exitProcess = typeof options.exitProcess === 'boolean' ? options.exitProcess : getExitOnShutdown();

    openCodeWatcherRuntime.stop();
    openCodeConfigFileWatcherRuntime?.stop();
    sessionRuntime.dispose();
    scheduledTasksRuntime?.stop?.();
    sessionGoalRuntime?.stop?.();
    sessionAssistRuntime?.stop?.();
    contextObligatoryRuntime?.stop?.();

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
          await openCodeProcess.close();
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
      let closeTimeout = null;
      try {
        await Promise.race([
          new Promise((resolve) => {
            server.close(() => {
              console.log('HTTP server closed');
              resolve();
            });
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
  };
};
