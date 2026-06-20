import { afterEach, describe, expect, it, vi } from 'vitest';

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
