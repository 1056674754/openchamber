import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';

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

describe('graceful shutdown runtime (guest/relay teardown and socket drain)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createRuntime = (server, overrides = {}) => {
    const runtime = createGracefulShutdownRuntime({
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
    if (server instanceof http.Server) runtime.trackServerConnections(server);
    return runtime;
  };

  it('drains processes before closing sockets accepted during cleanup, including after a cleanup failure', async () => {
    const server = http.createServer();
    const cleanupStarted = Promise.withResolvers();
    const finishCleanup = Promise.withResolvers();
    const sockets = new Set();
    const clients = [];
    server.on('upgrade', (_request, socket) => sockets.add(socket));
    const terminalShutdown = vi.fn(async () => {
      expect([...sockets].every((socket) => !socket.destroyed)).toBe(true);
    });
    const processClose = vi.fn(async () => {
      expect(terminalShutdown).toHaveBeenCalledOnce();
      expect([...sockets].every((socket) => !socket.destroyed)).toBe(true);
    });
    const runtime = createRuntime(server, {
      stopAllGuestServices: async () => {
        cleanupStarted.resolve();
        await finishCleanup.promise;
        throw new Error('fixture cleanup failure');
      },
      getTerminalRuntime: () => ({ shutdown: terminalShutdown }),
      shouldSkipOpenCodeStop: () => false,
      getOpenCodeProcess: () => ({ close: processClose }),
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const shutdown = runtime.gracefulShutdown({ exitProcess: false });
    expect(runtime.gracefulShutdown({ exitProcess: false })).toBe(shutdown);
    await cleanupStarted.promise;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const closed = [];
      for (let index = 0; index < 8; index += 1) {
        const client = net.connect(server.address().port, '127.0.0.1');
        clients.push(client);
        client.resume();
        closed.push(once(client, 'close'));
        const upgraded = once(server, 'upgrade');
        client.write('GET /api/global/event/ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
        await upgraded;
      }
      expect(sockets.size).toBe(8);
      expect(processClose).not.toHaveBeenCalled();
      finishCleanup.resolve();
      await shutdown;
      expect(processClose).toHaveBeenCalledOnce();
      expect(warning).not.toHaveBeenCalledWith('Server close timeout reached, forcing shutdown');
      await Promise.all(closed);
      expect(server.listening).toBe(false);
    } finally {
      finishCleanup.resolve();
      for (const socket of sockets) socket.destroy();
      for (const client of clients) client.destroy();
      await shutdown;
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('stops guest services during shutdown', async () => {
    const server = {
      close: vi.fn((callback) => {
        callback();
      }),
    };
    const stopAllGuestServices = vi.fn(async () => {});

    const runtime = createRuntime(server, { stopAllGuestServices });
    await runtime.gracefulShutdown({ exitProcess: false });

    expect(stopAllGuestServices).toHaveBeenCalledTimes(1);
  });

  it('continues shutdown when stopping guest services fails', async () => {
    const server = {
      close: vi.fn((callback) => {
        callback();
      }),
    };
    const stopAllGuestServices = vi.fn(async () => {
      throw new Error('guest teardown failed');
    });
    const terminalRuntime = { shutdown: vi.fn(async () => {}) };

    const runtime = createRuntime(server, {
      stopAllGuestServices,
      getTerminalRuntime: () => terminalRuntime,
    });
    await runtime.gracefulShutdown({ exitProcess: false });

    expect(stopAllGuestServices).toHaveBeenCalledTimes(1);
    expect(terminalRuntime.shutdown).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalled();
  });

  it('closes guest admission synchronously and cleans every runtime once across repeated shutdown calls', async () => {
    vi.useFakeTimers();
    const order = [];
    const cleanup = (name) => vi.fn(() => { order.push(name); });
    const viewers = { stop: cleanup('viewers') };
    const proxy = { stop: cleanup('proxy') };
    const dictation = { stop: cleanup('dictation') };
    const relay = { stop: cleanup('relay') };
    const gate = cleanup('gate');
    const guests = cleanup('guests');
    const reconcile = vi.fn();
    const timer = setInterval(reconcile, 100);
    const runtime = createRuntime(null, {
      beginGuestServiceShutdown: gate,
      stopAllGuestServices: guests,
      getGuestSurfaceRuntime: () => viewers,
      getRealtimeProxyRuntime: () => proxy,
      getDictationRuntime: () => dictation,
      getRelayService: () => relay,
      getRelayReconcileTimer: () => timer,
    });
    const first = runtime.gracefulShutdown();
    expect(gate).toHaveBeenCalledTimes(1);
    expect(runtime.gracefulShutdown()).toBe(first);
    await first;
    await runtime.gracefulShutdown();
    expect(order).toEqual(['gate', 'viewers', 'proxy', 'relay', 'dictation', 'guests']);
    await vi.advanceTimersByTimeAsync(200);
    expect(reconcile).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('isolates failed viewer and relay cleanup and still drains guests and exits', async () => {
    const stop = vi.fn(() => { throw new Error('stop failed'); });
    const stopAllGuestServices = vi.fn(async () => {});
    const dictation = { stop: vi.fn() };
    const process = { exit: vi.fn() };
    const runtime = createRuntime(null, {
      process,
      getGuestSurfaceRuntime: () => ({ stop }),
      getRelayService: () => ({ stop }),
      getDictationRuntime: () => dictation,
      stopAllGuestServices,
    });
    await runtime.gracefulShutdown({ exitProcess: true });
    expect(stop).toHaveBeenCalledTimes(2);
    expect(dictation.stop).toHaveBeenCalledTimes(1);
    expect(stopAllGuestServices).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
