import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const spawnSyncMock = vi.fn();
const finalizeInterruptedOpenCodeRunsMock = vi.fn(() => ({
  dbPath: '/tmp/opencode.db',
  skipped: false,
  reason: null,
  candidateParts: 0,
  updatedParts: 0,
  updatedMessages: 0,
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock('./interrupted-runs.js', () => ({
  finalizeInterruptedOpenCodeRuns: finalizeInterruptedOpenCodeRunsMock,
}));

const { createOpenCodeLifecycleRuntime } = await import('./lifecycle.js');

const originalOpencodeBinary = process.env.OPENCODE_BINARY;
const originalOpenChamberRuntime = process.env.OPENCHAMBER_RUNTIME;
const originalPath = process.env.PATH;
const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
  spawnSyncMock.mockReset();
  finalizeInterruptedOpenCodeRunsMock.mockClear();
  globalThis.fetch = originalFetch;
  if (typeof originalOpenChamberRuntime === 'string') {
    process.env.OPENCHAMBER_RUNTIME = originalOpenChamberRuntime;
  } else {
    delete process.env.OPENCHAMBER_RUNTIME;
  }
  if (typeof originalOpencodeBinary === 'string') {
    process.env.OPENCODE_BINARY = originalOpencodeBinary;
  } else {
    delete process.env.OPENCODE_BINARY;
  }

  if (typeof originalPath === 'string') {
    process.env.PATH = originalPath;
  } else {
    delete process.env.PATH;
  }
});

const createMockChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 12345;
  child.unref = vi.fn();
  child.kill = vi.fn(() => {
    child.signalCode = 'SIGTERM';
    queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  });
  return child;
};

const createRuntime = (overrides = {}) => {
  const { state: stateOverrides = {}, ...dependencyOverrides } = overrides;
  const state = {
    openCodeWorkingDirectory: '/tmp/project',
    openCodeProcess: null,
    openCodePort: null,
    openCodeBaseUrl: null,
    currentRestartPromise: null,
    isRestartingOpenCode: false,
    openCodeApiPrefix: '',
    openCodeApiPrefixDetected: false,
    openCodeApiDetectionTimer: null,
    lastOpenCodeError: null,
    isOpenCodeReady: false,
    openCodeNotReadySince: 0,
    isExternalOpenCode: false,
    isShuttingDown: false,
    healthCheckInterval: null,
    expressApp: null,
    useWslForOpencode: false,
    resolvedWslBinary: null,
    resolvedWslOpencodePath: null,
    resolvedWslDistro: null,
    ...stateOverrides,
  };

  return createOpenCodeLifecycleRuntime({
    state,
    env: {
      ENV_CONFIGURED_OPENCODE_PORT: 45678,
      ENV_CONFIGURED_OPENCODE_HOST: null,
      ENV_EFFECTIVE_PORT: 3001,
      ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1',
      ENV_SKIP_OPENCODE_START: false,
    },
    syncToHmrState: vi.fn(),
    syncFromHmrState: vi.fn(),
    getOpenCodeAuthHeaders: () => ({}),
    buildOpenCodeUrl: (route) => `http://127.0.0.1:${state.openCodePort || 45678}${route}`,
    waitForReady: vi.fn(async () => true),
    normalizeApiPrefix: vi.fn(() => ''),
    applyOpencodeBinaryFromSettings: vi.fn(async () => null),
    ensureOpencodeCliEnv: vi.fn(),
    ensureLocalOpenCodeServerPassword: vi.fn(async () => 'password'),
    resolveManagedOpenCodeLaunchSpec: vi.fn((binary) => ({ binary, args: [], wrapperType: null })),
    setOpenCodePort: vi.fn((port) => {
      state.openCodePort = port;
    }),
    setDetectedOpenCodeApiPrefix: vi.fn(),
    setupProxy: vi.fn(),
    ensureOpenCodeApiPrefix: vi.fn(),
    clearResolvedOpenCodeBinary: vi.fn(),
    buildAugmentedPath: vi.fn(() => '/home/user/.bun/bin:/usr/local/bin:/usr/bin'),
    buildManagedOpenCodePath: vi.fn(() => '/home/user/.bun/bin:/usr/local/bin:/usr/bin'),
    getManagedOpenCodeShellEnvSnapshot: vi.fn(() => ({
      PATH: '/home/user/.bun/bin:/usr/local/bin:/usr/bin',
      SHELL_ONLY: 'yes',
      OPENCODE_SERVER_PASSWORD: 'shell-password',
    })),
    persistManagedOpenCodeAuth: vi.fn(),
    restoreManagedOpenCodeAuth: vi.fn(() => false),
    ...dependencyOverrides,
  });
};

describe('OpenCode lifecycle', () => {
  it('joins overlapping configuration refreshes into one lifecycle operation', async () => {
    let rejectApply;
    const applyOpencodeBinaryFromSettings = vi.fn(() => new Promise((_resolve, reject) => {
      rejectApply = reject;
    }));
    const runtime = createRuntime({ applyOpencodeBinaryFromSettings });

    const first = runtime.refreshOpenCodeAfterConfigChange('first request');
    const second = runtime.refreshOpenCodeAfterConfigChange('second request');
    expect(applyOpencodeBinaryFromSettings).toHaveBeenCalledTimes(1);

    rejectApply(new Error('test failure'));
    const results = await Promise.allSettled([first, second]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(applyOpencodeBinaryFromSettings).toHaveBeenCalledTimes(1);
  });

  it('reports an external config refresh without waiting for agent presence', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ healthy: true }),
    }));
    const runtime = createRuntime({
      state: {
        isExternalOpenCode: true,
        openCodePort: 45678,
      },
    });

    const result = await runtime.refreshOpenCodeAfterConfigChange('agent creation', {
      agentName: 'build',
    });

    expect(result).toEqual({ reloaded: false, external: true });
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/agent'),
      expect.anything(),
    );
  });

  it('launches managed OpenCode with the managed PATH', async () => {
    delete process.env.OPENCODE_BINARY;
    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime();
    const server = await runtime.startOpenCode();
    const [binary, args, options] = spawnMock.mock.calls[0];

    expect(binary).toBe('opencode');
    expect(args).toEqual(['serve', '--hostname', '127.0.0.1', '--port', '45678']);
    expect(options.env.PATH).toBe('/home/user/.bun/bin:/usr/local/bin:/usr/bin');
    expect(options.env.SHELL_ONLY).toBe('yes');
    expect(options.env.OPENCODE_SERVER_PASSWORD).toBe('password');

    await server.close();
  });

  it('detaches and persists auth for desktop managed OpenCode', async () => {
    process.env.OPENCHAMBER_RUNTIME = 'desktop';
    delete process.env.OPENCODE_BINARY;
    const persistManagedOpenCodeAuth = vi.fn();
    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime({ persistManagedOpenCodeAuth });
    const server = await runtime.startOpenCode();
    const [, , options] = spawnMock.mock.calls[0];

    expect(options.detached).toBe(true);
    expect(child.unref).toHaveBeenCalled();
    expect(persistManagedOpenCodeAuth).toHaveBeenCalledWith('password');

    await server.close();
  });

  it('terminates the detached desktop OpenCode process group on close', async () => {
    process.env.OPENCHAMBER_RUNTIME = 'desktop';
    delete process.env.OPENCODE_BINARY;
    const child = createMockChild();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      expect(pid).toBe(-child.pid);
      expect(signal).toBe('SIGTERM');
      child.signalCode = 'SIGTERM';
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      return true;
    });
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime();
    const server = await runtime.startOpenCode();
    await server.close();

    expect(killSpy).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
    expect(child.kill).not.toHaveBeenCalledWith('SIGTERM');
  });

  it('restores persisted auth before reconnecting to the previous managed port', async () => {
    delete process.env.OPENCODE_BINARY;
    const restoreManagedOpenCodeAuth = vi.fn(() => true);
    globalThis.fetch = vi.fn(async (url) => {
      const text = String(url);
      if (text.includes(':4096/global/health')) {
        return { ok: false, json: async () => ({ healthy: false }) };
      }
      if (text.includes(':56789/global/health')) {
        return { ok: true, json: async () => ({ healthy: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const runtime = createRuntime({
      env: {
        ENV_CONFIGURED_OPENCODE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOST: null,
        ENV_EFFECTIVE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1',
        ENV_SKIP_OPENCODE_START: false,
      },
      restoreManagedOpenCodeAuth,
      readPersistedOpenCodePort: vi.fn(() => 56789),
    });

    await runtime.bootstrapOpenCodeAtStartup();

    expect(restoreManagedOpenCodeAuth).toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('does not attach to an unrelated OpenCode server on the default port', async () => {
    delete process.env.OPENCODE_BINARY;
    globalThis.fetch = vi.fn(async (url) => {
      const text = String(url);
      if (text.includes(':4096/global/health')) {
        return { ok: true, json: async () => ({ healthy: true }) };
      }
      return { ok: true, json: async () => ({ healthy: true }) };
    });

    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime({
      env: {
        ENV_CONFIGURED_OPENCODE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOST: null,
        ENV_EFFECTIVE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1',
        ENV_SKIP_OPENCODE_START: false,
      },
      readPersistedOpenCodePort: vi.fn(() => null),
    });

    await runtime.bootstrapOpenCodeAtStartup();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining(':4096/global/health'),
      expect.anything(),
    );
  });

  it('terminates an unhealthy previous managed process group before launching its replacement', async () => {
    process.env.OPENCHAMBER_RUNTIME = 'desktop';
    delete process.env.OPENCODE_BINARY;
    const stalePid = 43210;
    const ownProcessGroupId = 99999;
    spawnSyncMock.mockImplementation((command, args) => {
      if (command === 'lsof') {
        return { stdout: `${stalePid}\n` };
      }
      if (command === 'ps' && args.includes(String(stalePid))) {
        return { stdout: `${stalePid}\n` };
      }
      if (command === 'ps' && args.includes(String(process.pid))) {
        return { stdout: `${ownProcessGroupId}\n` };
      }
      return { stdout: '' };
    });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    globalThis.fetch = vi.fn(async (url) => {
      const text = String(url);
      if (text.includes(':4096/global/health') || text.includes(':56789/global/health')) {
        return { ok: false, json: async () => ({ healthy: false }) };
      }
      return { ok: true, json: async () => ({ healthy: true }) };
    });

    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime({
      env: {
        ENV_CONFIGURED_OPENCODE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOST: null,
        ENV_EFFECTIVE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1',
        ENV_SKIP_OPENCODE_START: false,
      },
      readPersistedOpenCodePort: vi.fn(() => 56789),
    });

    await runtime.bootstrapOpenCodeAtStartup();

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'lsof',
      ['-nP', '-iTCP:56789', '-sTCP:LISTEN', '-t'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
    expect(killSpy).toHaveBeenCalledWith(-stalePid, 'SIGTERM');
    expect(killSpy.mock.invocationCallOrder[0]).toBeLessThan(spawnMock.mock.invocationCallOrder[0]);
  });

  it('requires repeated failures before restarting a reconnected managed port without a child handle', async () => {
    delete process.env.OPENCODE_BINARY;
    const restoreManagedOpenCodeAuth = vi.fn(() => true);
    let previousManagedPortHealthy = true;
    spawnSyncMock.mockImplementation((command) => {
      if (command === 'lsof') {
        return { stdout: '43210\n' };
      }
      return { stdout: '' };
    });
    globalThis.fetch = vi.fn(async (url) => {
      const text = String(url);
      if (text.includes(':4096/global/health')) {
        return { ok: false, json: async () => ({ healthy: false }) };
      }
      if (text.includes(':56789/global/health')) {
        return {
          ok: previousManagedPortHealthy,
          json: async () => ({ healthy: previousManagedPortHealthy }),
        };
      }
      if (text.includes('/global/health')) {
        return { ok: false, json: async () => ({ healthy: false }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime({
      env: {
        ENV_CONFIGURED_OPENCODE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOST: null,
        ENV_EFFECTIVE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1',
        ENV_SKIP_OPENCODE_START: false,
      },
      restoreManagedOpenCodeAuth,
      readPersistedOpenCodePort: vi.fn(() => 56789),
    });

    await runtime.bootstrapOpenCodeAtStartup();
    expect(spawnMock).not.toHaveBeenCalled();

    previousManagedPortHealthy = false;
    for (let index = 0; index < 19; index += 1) {
      await runtime.triggerHealthCheck();
    }

    expect(spawnMock).not.toHaveBeenCalled();

    await runtime.triggerHealthCheck();

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('does not restart an unavailable managed process immediately while sessions are busy', async () => {
    delete process.env.OPENCODE_BINARY;
    const restoreManagedOpenCodeAuth = vi.fn(() => true);
    let previousManagedPortHealthy = true;
    spawnSyncMock.mockImplementation((command) => {
      if (command === 'lsof') {
        return { stdout: '43210\n' };
      }
      return { stdout: '' };
    });
    globalThis.fetch = vi.fn(async (url) => {
      const text = String(url);
      if (text.includes(':4096/global/health')) {
        return { ok: false, json: async () => ({ healthy: false }) };
      }
      if (text.includes(':56789/global/health')) {
        return {
          ok: previousManagedPortHealthy,
          json: async () => ({ healthy: previousManagedPortHealthy }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const runtime = createRuntime({
      env: {
        ENV_CONFIGURED_OPENCODE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOST: null,
        ENV_EFFECTIVE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1',
        ENV_SKIP_OPENCODE_START: false,
      },
      getActiveSessionCount: vi.fn(() => 1),
      restoreManagedOpenCodeAuth,
      readPersistedOpenCodePort: vi.fn(() => 56789),
    });

    await runtime.bootstrapOpenCodeAtStartup();
    expect(spawnMock).not.toHaveBeenCalled();

    previousManagedPortHealthy = false;
    await runtime.triggerHealthCheck();

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('restarts a dead reconnected managed port immediately even when sessions look busy', async () => {
    delete process.env.OPENCODE_BINARY;
    const restoreManagedOpenCodeAuth = vi.fn(() => true);
    let previousManagedPortHealthy = true;
    globalThis.fetch = vi.fn(async (url) => {
      const text = String(url);
      if (text.includes(':4096/global/health')) {
        return { ok: false, json: async () => ({ healthy: false }) };
      }
      if (text.includes(':56789/global/health')) {
        return {
          ok: previousManagedPortHealthy,
          json: async () => ({ healthy: previousManagedPortHealthy }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime({
      env: {
        ENV_CONFIGURED_OPENCODE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOST: null,
        ENV_EFFECTIVE_PORT: null,
        ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1',
        ENV_SKIP_OPENCODE_START: false,
      },
      getActiveSessionCount: vi.fn(() => 1),
      restoreManagedOpenCodeAuth,
      readPersistedOpenCodePort: vi.fn(() => 56789),
    });

    await runtime.bootstrapOpenCodeAtStartup();
    expect(spawnMock).not.toHaveBeenCalled();

    previousManagedPortHealthy = false;
    await runtime.triggerHealthCheck();

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to buildAugmentedPath when buildManagedOpenCodePath is not provided', async () => {
    delete process.env.OPENCODE_BINARY;
    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime({
      buildManagedOpenCodePath: undefined,
      buildAugmentedPath: vi.fn(() => '/home/user/.cargo/bin:/usr/local/bin'),
    });
    const server = await runtime.startOpenCode();
    const [, , options] = spawnMock.mock.calls[0];

    expect(options.env.PATH).toBe('/home/user/.cargo/bin:/usr/local/bin');

    await server.close();
  });

  it('falls back to process.env.PATH when neither build function is provided', async () => {
    delete process.env.OPENCODE_BINARY;
    process.env.PATH = '/usr/bin:/bin';
    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime({
      buildManagedOpenCodePath: undefined,
      buildAugmentedPath: undefined,
    });
    const server = await runtime.startOpenCode();
    const [, , options] = spawnMock.mock.calls[0];

    expect(options.env.PATH).toBe('/usr/bin:/bin');

    await server.close();
  });

  it('uses global health for readiness checks', async () => {
    delete process.env.OPENCODE_BINARY;
    globalThis.fetch = vi.fn(async (url) => {
      const text = String(url);
      if (text.endsWith('/global/health')) {
        return { ok: true, json: async () => ({ healthy: true }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime();
    const server = await runtime.startOpenCode();

    await runtime.waitForOpenCodeReady(50, 1);

    const urls = globalThis.fetch.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('http://127.0.0.1:45678/global/health');
    expect(urls).not.toContain('http://127.0.0.1:45678/config');
    expect(urls).not.toContain('http://127.0.0.1:45678/agent');

    await server.close();
  });

  it('reports the binary when managed OpenCode exits before becoming ready', async () => {
    delete process.env.OPENCODE_BINARY;
    const firstChild = createMockChild();
    const secondChild = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        firstChild.emit('exit', null, 'SIGTERM');
      });
      return firstChild;
    });
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        secondChild.emit('exit', null, 'SIGTERM');
      });
      return secondChild;
    });

    const runtime = createRuntime();

    await expect(runtime.startOpenCode()).rejects.toThrow('OpenCode process exited before serving with signal SIGTERM. Binary used: opencode. No stdout/stderr captured');
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry managed startup when the configured OpenCode binary is invalid', async () => {
    delete process.env.OPENCODE_BINARY;
    const error = new Error('Configured OpenCode binary not found: /missing/opencode');
    error.code = 'OPENCODE_BINARY_INVALID';
    const applyOpencodeBinaryFromSettings = vi.fn(async () => {
      throw error;
    });

    const runtime = createRuntime({ applyOpencodeBinaryFromSettings });

    await expect(runtime.startOpenCode()).rejects.toThrow('Configured OpenCode binary not found: /missing/opencode');
    expect(applyOpencodeBinaryFromSettings).toHaveBeenCalledTimes(1);
    expect(applyOpencodeBinaryFromSettings).toHaveBeenCalledWith({ strict: true });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('retries managed OpenCode startup once after a pre-ready exit', async () => {
    delete process.env.OPENCODE_BINARY;
    const firstChild = createMockChild();
    const secondChild = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        firstChild.emit('exit', null, 'SIGTERM');
      });
      return firstChild;
    });
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        secondChild.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return secondChild;
    });

    const runtime = createRuntime();
    const server = await runtime.startOpenCode();

    expect(spawnMock).toHaveBeenCalledTimes(2);
    await server.close();
  });
});
