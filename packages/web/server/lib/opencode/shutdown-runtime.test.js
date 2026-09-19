import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';

import { createGracefulShutdownRuntime } from './shutdown-runtime.js';

const createRuntime = (server, overrides = {}) => createGracefulShutdownRuntime({
  process: { exit: vi.fn() },
  shutdownTimeoutMs: 1000,
  getExitOnShutdown: () => false,
  getIsShuttingDown: () => false,
  setIsShuttingDown: vi.fn(),
  syncToHmrState: vi.fn(),
  openCodeWatcherRuntime: { stop: vi.fn() },
  sessionRuntime: { dispose: vi.fn() },
  scheduledTasksRuntime: { stop: vi.fn() },
  getHealthCheckInterval: () => null,
  clearHealthCheckInterval: vi.fn(),
  getTerminalRuntime: () => null,
  setTerminalRuntime: vi.fn(),
  getMessageStreamRuntime: () => null,
  setMessageStreamRuntime: vi.fn(),
  getDevTunnelRuntime: () => null,
  setDevTunnelRuntime: vi.fn(),
  shouldSkipOpenCodeStop: () => true,
  getOpenCodePort: () => null,
  getOpenCodeProcess: () => null,
  setOpenCodeProcess: vi.fn(),
  killProcessOnPort: vi.fn(),
  waitForPortRelease: vi.fn(async () => true),
  getServer: () => server,
  getUiAuthController: () => null,
  setUiAuthController: vi.fn(),
  getActiveTunnelController: () => null,
  setActiveTunnelController: vi.fn(),
  tunnelAuthController: { clearActiveTunnel: vi.fn() },
  getManagedOpenCodePorts: () => [],
  clearManagedOpenCodePorts: vi.fn(),
  ...overrides,
});

describe('graceful shutdown runtime', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clears the server close timeout when the server closes first', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = {
      close: vi.fn((callback) => {
        callback();
      }),
    };

    const runtime = createRuntime(server);
    await runtime.gracefulShutdown({ exitProcess: false });

    vi.advanceTimersByTime(1000);

    expect(warnSpy).not.toHaveBeenCalledWith('Server close timeout reached, forcing shutdown');
    expect(vi.getTimerCount()).toBe(0);
  });

  // The production server runs on Node; Bun's node:http shim does not honor
  // closeAllConnections() after close(), so this regression case is Node-only
  // and only registered there.
  if (typeof globalThis.Bun === 'undefined') {
  it('closes an active HTTP stream instead of waiting for the shutdown deadline', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: fixture\n\n');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const request = http.get(`http://127.0.0.1:${server.address().port}`);
    request.on('error', () => {});
    const response = await new Promise((resolve) => request.once('response', resolve));
    response.resume();
    const closed = new Promise((resolve) => response.once('close', resolve));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await createRuntime(server).gracefulShutdown({ exitProcess: false });
      expect(warning).not.toHaveBeenCalledWith('Server close timeout reached, forcing shutdown');
      await closed;
    } finally {
      request.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  }

  it('stops the configuration watcher during shutdown', async () => {
    const openCodeConfigFileWatcherRuntime = { stop: vi.fn() };
    const runtime = createRuntime(null, { openCodeConfigFileWatcherRuntime });

    await runtime.gracefulShutdown({ exitProcess: false });

    expect(openCodeConfigFileWatcherRuntime.stop).toHaveBeenCalledTimes(1);
  });

  it('disposes the dev tunnel before closing the HTTP server', async () => {
    const order = [];
    const devTunnelRuntime = { dispose: vi.fn(() => order.push('tunnel')) };
    const setDevTunnelRuntime = vi.fn();
    const server = { close: vi.fn((callback) => { order.push('server'); callback(); }) };
    const runtime = createRuntime(server, {
      getDevTunnelRuntime: () => devTunnelRuntime,
      setDevTunnelRuntime,
    });

    await runtime.gracefulShutdown({ exitProcess: false });

    expect(order).toEqual(['tunnel', 'server']);
    expect(setDevTunnelRuntime).toHaveBeenCalledWith(null);
  });

  it('stops every tracked managed OpenCode port when shutdown explicitly stops OpenCode', async () => {
    const killProcessOnPort = vi.fn();
    const waitForPortRelease = vi.fn(async () => true);
    const clearManagedOpenCodePorts = vi.fn();
    const openCodeProcess = { close: vi.fn(async () => {}) };
    const runtime = createRuntime(null, {
      shouldSkipOpenCodeStop: () => false,
      getOpenCodePort: () => 53755,
      getOpenCodeProcess: () => openCodeProcess,
      killProcessOnPort,
      waitForPortRelease,
      getManagedOpenCodePorts: () => [52552, 53755, 52552],
      clearManagedOpenCodePorts,
    });

    await runtime.gracefulShutdown({ exitProcess: false, stopOpenCode: true });

    expect(openCodeProcess.close).toHaveBeenCalled();
    expect(killProcessOnPort).toHaveBeenCalledTimes(2);
    expect(killProcessOnPort).toHaveBeenNthCalledWith(1, 53755);
    expect(killProcessOnPort).toHaveBeenNthCalledWith(2, 52552);
    expect(waitForPortRelease).toHaveBeenCalledTimes(2);
    expect(clearManagedOpenCodePorts).toHaveBeenCalled();
  });
});
