import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { stripAppImageArgv0Leak } from '../inherited-env.js';
import { finalizeInterruptedOpenCodeRuns } from './interrupted-runs.js';

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const HEALTH_CHECK_TIMEOUT_MS = parsePositiveInt(process.env.OPENCHAMBER_OPENCODE_HEALTH_TIMEOUT_MS, 5000);
const HEALTH_CHECK_MAX_CONSECUTIVE_FAILURES = parsePositiveInt(
  process.env.OPENCHAMBER_OPENCODE_HEALTH_CONSECUTIVE_FAILURES,
  20
);
const HEALTH_CHECK_INTERVAL_OVERRIDE_MS = parsePositiveInt(process.env.OPENCHAMBER_OPENCODE_HEALTH_INTERVAL_MS, 0);
const HEALTH_CHECK_RESULT_CACHE_MS = parsePositiveInt(process.env.OPENCHAMBER_OPENCODE_HEALTH_CACHE_MS, 750);
const STALE_BUSY_GRACE_MS = parsePositiveInt(
  process.env.OPENCHAMBER_OPENCODE_BUSY_RESTART_GRACE_MS,
  30 * 60 * 1000
);
const STARTUP_TIMEOUT_MS = parsePositiveInt(
  process.env.OPENCHAMBER_OPENCODE_STARTUP_TIMEOUT_MS,
  30000
);
const OPENCODE_HEALTH_PATH = '/global/health';

const formatDurationForLog = (ms) => {
  if (ms >= 60 * 1000 && ms % (60 * 1000) === 0) {
    return `${ms / (60 * 1000)} min`;
  }
  if (ms >= 1000 && ms % 1000 === 0) {
    return `${ms / 1000} sec`;
  }
  return `${ms} ms`;
};

export const createOpenCodeLifecycleRuntime = (deps) => {
  const {
    state,
    env,
    syncToHmrState,
    syncFromHmrState,
    getOpenCodeAuthHeaders,
    buildOpenCodeUrl,
    waitForReady,
    normalizeApiPrefix,
    applyOpencodeBinaryFromSettings,
    ensureOpencodeCliEnv,
    ensureLocalOpenCodeServerPassword,
    resolveManagedOpenCodeLaunchSpec,
    setOpenCodePort,
    setDetectedOpenCodeApiPrefix,
    setupProxy,
    ensureOpenCodeApiPrefix,
    clearResolvedOpenCodeBinary,
    buildAugmentedPath,
    buildManagedOpenCodePath,
    getManagedOpenCodeShellEnvSnapshot,
    prepareManagedOpenCodeEnv = async () => ({}),
    getActiveSessionCount = () => 0,
    persistOpenCodePort = () => {},
    readPersistedOpenCodePort = () => null,
    persistManagedOpenCodeAuth = () => {},
    restoreManagedOpenCodeAuth = () => false,
    recordLifecycleEvent = async () => {},
    getLifecycleLogPath = () => null,
    now = Date.now,
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
  } = deps;

  const listListeningProcessIds = (port) => {
    if (!port || process.platform === 'win32') return [];
    try {
      const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });
      const output = result.stdout || '';
      return [...new Set(output
        .split(/\s+/)
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid))];
    } catch {
      return [];
    }
  };

  const readProcessGroupId = (pid) => {
    if (!pid || process.platform === 'win32') return null;
    try {
      const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 2000,
        windowsHide: true,
      });
      const processGroupId = Number.parseInt(String(result.stdout || '').trim(), 10);
      return Number.isFinite(processGroupId) && processGroupId > 0 ? processGroupId : null;
    } catch {
      return null;
    }
  };

  const signalProcessOnPort = (port, signal) => {
    if (!port) return false;
    const processIds = listListeningProcessIds(port);
    if (processIds.length === 0) return false;

    if (process.platform === 'win32') {
      for (const pid of processIds) {
        try {
          const args = ['/pid', String(pid), '/t'];
          if (signal === 'SIGKILL') args.push('/f');
          spawnSync('taskkill', args, { stdio: 'ignore', timeout: 5000, windowsHide: true });
        } catch {
        }
      }
      return true;
    }

    const ownProcessGroupId = readProcessGroupId(process.pid);
    const signaledTargets = new Set();
    for (const pid of processIds) {
      const processGroupId = process.env.OPENCHAMBER_RUNTIME === 'desktop'
        ? readProcessGroupId(pid)
        : null;
      const target = processGroupId && processGroupId !== ownProcessGroupId ? -processGroupId : pid;
      if (signaledTargets.has(target)) continue;
      signaledTargets.add(target);
      try {
        process.kill(target, signal);
      } catch {
      }
    }
    return signaledTargets.size > 0;
  };

  const killProcessOnPort = (port) => {
    signalProcessOnPort(port, 'SIGKILL');
  };

  const hasChildProcessExited = (child) => !child || child.exitCode !== null || child.signalCode !== null;

  const isManagedOpenCodeProcessAlive = () => {
    const child = state.openCodeProcess;
    if (!child || hasChildProcessExited(child)) return false;
    if (!child.pid) return true;
    try {
      process.kill(child.pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const waitForChildProcessClose = (child, timeoutMs) => new Promise((resolve) => {
    if (!child || hasChildProcessExited(child)) {
      resolve(true);
      return;
    }

    let done = false;
    const finish = (closed) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.off('close', onClose);
      child.off('error', onError);
      resolve(closed);
    };

    const onClose = () => finish(true);
    const onError = () => finish(hasChildProcessExited(child));
    const timer = setTimeout(() => finish(hasChildProcessExited(child)), timeoutMs);

    child.once('close', onClose);
    child.once('error', onError);
  });

  const waitForPortRelease = (port, timeoutMs, hostname = env.ENV_CONFIGURED_OPENCODE_HOSTNAME) => {
    if (!port) {
      return Promise.resolve(true);
    }

    const probeHost = !hostname || hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]'
      ? '127.0.0.1'
      : hostname;
    const deadline = Date.now() + timeoutMs;

    return new Promise((resolve) => {
      const attempt = () => {
        const socket = net.connect({ port, host: probeHost });
        let settled = false;

        const finish = (released) => {
          if (settled) return;
          settled = true;
          socket.removeAllListeners();
          socket.destroy();
          if (released || Date.now() >= deadline) {
            resolve(released);
            return;
          }
          setTimeout(attempt, 150);
        };

        socket.once('connect', () => finish(false));
        socket.once('timeout', () => finish(true));
        socket.once('error', (error) => {
          if (error && typeof error === 'object' && (error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH')) {
            finish(true);
            return;
          }
          finish(false);
        });
        socket.setTimeout(500);
      };

      attempt();
    });
  };

  const terminateStaleManagedOpenCodePort = async (port) => {
    signalProcessOnPort(port, 'SIGTERM');
    if (await waitForPortRelease(port, 2500)) {
      return true;
    }

    signalProcessOnPort(port, 'SIGKILL');
    return await waitForPortRelease(port, 2500);
  };

  const finalizeInterruptedManagedOpenCodeRuns = (reason) => {
    if (state.isExternalOpenCode) {
      return;
    }

    try {
      const result = finalizeInterruptedOpenCodeRuns({ reason });
      if (result.updatedParts > 0 || result.updatedMessages > 0) {
        console.warn(
          `[OpenCode] Finalized ${result.updatedParts} interrupted tool part(s) and ${result.updatedMessages} message(s) after ${reason}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[OpenCode] Failed to finalize interrupted runs after ${reason}: ${message}`);
    }
  };

  const closeManagedOpenCodeChild = async (child) => {
    if (!child) {
      return;
    }

    const pid = child.pid;
    if (!pid || hasChildProcessExited(child)) {
      await waitForChildProcessClose(child, 250);
      return;
    }

    if (process.platform === 'win32') {
      try {
        child.kill();
      } catch {
      }

      if (await waitForChildProcessClose(child, 800)) {
        return;
      }

      try {
        spawnSync('taskkill', ['/pid', String(pid), '/t'], {
          stdio: 'ignore',
          timeout: 3000,
          windowsHide: true,
        });
      } catch {
      }

      if (await waitForChildProcessClose(child, 1500)) {
        return;
      }

      try {
        spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], {
          stdio: 'ignore',
          timeout: 5000,
          windowsHide: true,
        });
      } catch {
      }

      await waitForChildProcessClose(child, 3000);
      return;
    }

    const signalChild = (signal) => {
      if (process.env.OPENCHAMBER_RUNTIME === 'desktop') {
        try {
          process.kill(-pid, signal);
          return;
        } catch {
        }
      }

      try {
        child.kill(signal);
      } catch {
      }
    };

    signalChild('SIGTERM');

    if (await waitForChildProcessClose(child, 2500)) {
      return;
    }

    signalChild('SIGKILL');

    await waitForChildProcessClose(child, 1000);
  };

  const formatCapturedOutput = ({ stdout, stderr }) => {
    const parts = [];
    if (stdout.trim()) {
      parts.push(`stdout:\n${stdout.trim()}`);
    }
    if (stderr.trim()) {
      parts.push(`stderr:\n${stderr.trim()}`);
    }
    return parts.length > 0 ? parts.join('\n\n') : 'No stdout/stderr captured';
  };

  const createManagedOpenCodeServerProcess = async ({ hostname, port, timeout, cwd, env: processEnv, shellEnvKeysCount = 0 }) => {
    let binary = (process.env.OPENCODE_BINARY || 'opencode').trim() || 'opencode';
    let args = ['serve', '--hostname', hostname, '--port', String(port)];
    let launchWrapperType = null;

    if (process.platform === 'win32' && state.useWslForOpencode) {
      throw new Error('Launching OpenCode through WSL is no longer supported. Install OpenCode natively on Windows and configure opencode.cmd or opencode.exe.');
    }

    if (process.platform === 'win32' && !state.useWslForOpencode) {
      const launchSpec = resolveManagedOpenCodeLaunchSpec(binary);
      if (launchSpec?.binary) {
        if (launchSpec.wrapperType) {
          console.log(`Launching OpenCode via ${launchSpec.wrapperType}: ${launchSpec.binary}`);
        }
        launchWrapperType = launchSpec.wrapperType || null;
        binary = launchSpec.binary;
        args = [...(Array.isArray(launchSpec.args) ? launchSpec.args : []), ...args];
      }
    }

    const pathValue = typeof processEnv?.PATH === 'string' ? processEnv.PATH : '';
    const pathEntryCount = pathValue ? pathValue.split(process.platform === 'win32' ? ';' : ':').filter(Boolean).length : 0;
    state.lastOpenCodeLaunchDiagnostics = {
      launchedAt: new Date().toISOString(),
      binary,
      args,
      cwd,
      hostname,
      port,
      wrapperType: launchWrapperType,
      pathEntryCount,
      hasShellEnv: shellEnvKeysCount > 0,
      shellEnvKeysCount,
      lifecycleLogPath: getLifecycleLogPath(),
    };
    console.log('[OpenCode] Launching managed server', state.lastOpenCodeLaunchDiagnostics);

    const child = spawn(binary, args, {
      cwd,
      detached: process.env.OPENCHAMBER_RUNTIME === 'desktop',
      env: processEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const spawnedAt = Date.now();
    let expectedStopReason = null;
    let served = false;
    void recordLifecycleEvent('process_spawn', {
      pid: child.pid ?? null,
      port,
      binary,
      wrapperType: launchWrapperType,
    });
    child.once('exit', (code, signal) => {
      void recordLifecycleEvent('process_exit', {
        pid: child.pid ?? null,
        port,
        code,
        signal,
        expected: expectedStopReason !== null,
        stopReason: expectedStopReason,
        served,
        uptimeMs: Date.now() - spawnedAt,
      });
    });
    child.once('error', (error) => {
      void recordLifecycleEvent('process_error', {
        pid: child.pid ?? null,
        port,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    if (process.env.OPENCHAMBER_RUNTIME === 'desktop' && typeof child.unref === 'function') {
      child.unref();
    }

    // Kill the spawned child if it never becomes ready. Without this, a startup
    // timeout rejects the URL promise but leaves the child process alive as an
    // orphan — it keeps its listening port and accumulates across retries.
    const killUnresolvedChild = () => {
      if (!child.pid || hasChildProcessExited(child)) return;
      try {
        if (process.env.OPENCHAMBER_RUNTIME === 'desktop') {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch {
      }
    };

    const url = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let done = false;
      const finish = (handler, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.stdout?.off('data', onStdout);
        child.stderr?.off('data', onStderr);
        child.off('exit', onExit);
        child.off('error', onError);
        handler(value);
      };

      const onStdout = (chunk) => {
        stdout += chunk.toString();
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (!line.startsWith('opencode server listening')) continue;
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (!match) {
            finish(reject, new Error(`Failed to parse server url from output: ${line}`));
            return;
          }
          finish(resolve, match[1]);
          return;
        }
      };

      const onStderr = (chunk) => {
        stderr += chunk.toString();
      };

      const onExit = (code, signal) => {
        const reason = signal ? `signal ${signal}` : `code ${code}`;
        const appBundleHint = process.platform === 'darwin' && /\/OpenCode\.app\/Contents\/MacOS\/(?:OpenCode|opencode-cli)$/i.test(binary)
          ? ' The configured binary appears to point at the macOS desktop app bundle; OpenChamber needs the standalone opencode CLI.'
          : '';
        finish(reject, new Error(`OpenCode process exited before serving with ${reason}. Binary used: ${binary}.${appBundleHint} ${formatCapturedOutput({ stdout, stderr })}`));
      };

      const onError = (error) => {
        finish(reject, error);
      };

      const timer = setTimeout(() => {
        killUnresolvedChild();
        finish(reject, new Error(`Timeout waiting for OpenCode to start after ${timeout}ms`));
      }, timeout);

      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      child.on('exit', onExit);
      child.on('error', onError);
    });

    child.stderr?.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
    served = true;

    return {
      url,
      get pid() {
        return child.pid;
      },
      get exitCode() {
        return child.exitCode;
      },
      get signalCode() {
        return child.signalCode;
      },
      async close(reason = 'managed_close') {
        expectedStopReason = reason;
        await recordLifecycleEvent('stop_requested', {
          pid: child.pid ?? null,
          port,
          reason,
        });
        await closeManagedOpenCodeChild(child);
        await recordLifecycleEvent('stop_completed', {
          pid: child.pid ?? null,
          port,
          reason,
          code: child.exitCode,
          signal: child.signalCode,
        });
      },
    };
  };

  const resolveManagedOpenCodePort = async (requestedPort, hostname = '127.0.0.1') => {
    if (typeof requestedPort === 'number' && Number.isFinite(requestedPort) && requestedPort > 0) {
      return requestedPort;
    }

    return await new Promise((resolve, reject) => {
      const server = net.createServer();
      const cleanup = () => {
        server.removeAllListeners('error');
        server.removeAllListeners('listening');
      };

      server.once('error', (error) => {
        cleanup();
        reject(error);
      });

      server.once('listening', () => {
        const address = server.address();
        const port = address && typeof address === 'object' ? address.port : 0;
        server.close(() => {
          cleanup();
          if (port > 0) {
            resolve(port);
            return;
          }
          reject(new Error('Failed to allocate OpenCode port'));
        });
      });

      server.listen(0, hostname);
    });
  };

  const isOpenCodeProcessHealthy = async () => {
    if (!state.openCodePort || (!state.openCodeProcess && state.isExternalOpenCode)) {
      return false;
    }

    try {
      const response = await fetch(buildOpenCodeUrl(OPENCODE_HEALTH_PATH, ''), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...getOpenCodeAuthHeaders(),
        },
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      if (!response.ok) return false;
      const body = await response.json().catch(() => null);
      return body?.healthy === true;
    } catch {
      return false;
    }
  };

  const probeExternalOpenCode = async (port, origin) => {
    if (!port || port <= 0) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const base = origin ?? `http://127.0.0.1:${port}`;
      const response = await fetch(`${base}${OPENCODE_HEALTH_PATH}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...getOpenCodeAuthHeaders(),
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return false;
      const body = await response.json().catch(() => null);
      return body?.healthy === true;
    } catch {
      return false;
    }
  };

  const waitForOpenCodePort = async (timeoutMs = 15000) => {
    if (state.openCodePort !== null) {
      return state.openCodePort;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (state.openCodePort !== null) {
        return state.openCodePort;
      }
    }

    throw new Error('Timed out waiting for OpenCode port');
  };

  const START_OPEN_CODE_MAX_ATTEMPTS = 2;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const startOpenCodeOnce = async () => {
    const desiredPort = env.ENV_CONFIGURED_OPENCODE_PORT ?? 0;
    const spawnPort = await resolveManagedOpenCodePort(desiredPort, env.ENV_CONFIGURED_OPENCODE_HOSTNAME);
    console.log(
      desiredPort > 0
        ? `Starting OpenCode on requested port ${desiredPort}...`
        : `Starting OpenCode on allocated port ${spawnPort}...`
    );

    await applyOpencodeBinaryFromSettings({ strict: true });
    ensureOpencodeCliEnv();
    const openCodePassword = await ensureLocalOpenCodeServerPassword({ rotateManaged: true });
    const envPath = typeof buildManagedOpenCodePath === 'function'
      ? buildManagedOpenCodePath()
      : typeof buildAugmentedPath === 'function'
        ? buildAugmentedPath()
      : process.env.PATH;
    const shellEnv = typeof getManagedOpenCodeShellEnvSnapshot === 'function'
      ? getManagedOpenCodeShellEnvSnapshot() || {}
      : {};
    const managedOpenCodeEnv = await prepareManagedOpenCodeEnv();

    try {
      const serverInstance = await createManagedOpenCodeServerProcess({
        hostname: env.ENV_CONFIGURED_OPENCODE_HOSTNAME,
        port: spawnPort,
        timeout: startupTimeoutMs,
        cwd: state.openCodeWorkingDirectory,
        shellEnvKeysCount: Object.keys(shellEnv).length,
        env: stripAppImageArgv0Leak({
          ...shellEnv,
          ...process.env,
          ...managedOpenCodeEnv,
          PATH: envPath,
          OPENCODE_SERVER_PASSWORD: openCodePassword,
        }),
      });

      if (!serverInstance || !serverInstance.url) {
        throw new Error('OpenCode server started but URL is missing');
      }

      const url = new URL(serverInstance.url);
      const port = parseInt(url.port, 10);
      const prefix = normalizeApiPrefix(url.pathname);

      if (await waitForReady(serverInstance.url, 10000)) {
        setOpenCodePort(port);
        persistOpenCodePort(port);
        persistManagedOpenCodeAuth(openCodePassword);
        setDetectedOpenCodeApiPrefix(prefix);

        state.isOpenCodeReady = true;
        state.lastOpenCodeError = null;
        state.openCodeNotReadySince = 0;
        await recordLifecycleEvent('process_ready', {
          pid: serverInstance.pid ?? null,
          port,
        });

        return serverInstance;
      }

      try {
        await serverInstance.close('startup_health_timeout');
      } catch {
      }
      throw new Error('Server started but health check failed (timeout)');
    } catch (error) {
      killProcessOnPort(spawnPort);
      const message = error instanceof Error ? error.message : String(error);
      state.lastOpenCodeError = message;
      state.openCodePort = null;
      syncToHmrState();
      console.error(`Failed to start OpenCode: ${message}`);
      throw error;
    }
  };

  const startOpenCode = async () => {
    let lastError = null;
    for (let attempt = 1; attempt <= START_OPEN_CODE_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await startOpenCodeOnce();
      } catch (error) {
        lastError = error;
        if (error?.code === 'OPENCODE_BINARY_INVALID') {
          break;
        }
        if (attempt >= START_OPEN_CODE_MAX_ATTEMPTS) {
          break;
        }

        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[OpenCode] Managed server startup failed on attempt ${attempt}/${START_OPEN_CODE_MAX_ATTEMPTS}; retrying: ${message}`);
        state.openCodePort = null;
        state.isOpenCodeReady = false;
        state.openCodeNotReadySince = Date.now();
        syncToHmrState();
        await delay(750 * attempt);
      }
    }

    throw lastError;
  };

  const restartOpenCode = async (reason = 'requested') => {
    if (state.isShuttingDown) return;
    if (state.currentRestartPromise) {
      await recordLifecycleEvent('restart_joined', { reason });
      await state.currentRestartPromise;
      return;
    }

    state.currentRestartPromise = (async () => {
      const previousPid = state.openCodeProcess?.pid ?? null;
      const previousPort = state.openCodePort;
      await recordLifecycleEvent('restart_started', {
        reason,
        previousPid,
        previousPort,
        activeSessionCount: getActiveSessionCount(),
      });
      state.isRestartingOpenCode = true;
      state.isOpenCodeReady = false;
      state.openCodeNotReadySince = Date.now();
      console.log('Restarting OpenCode process...');

      if (state.isExternalOpenCode) {
        console.log('Re-probing external OpenCode server...');
        const probePort = state.openCodePort || env.ENV_CONFIGURED_OPENCODE_PORT || 4096;
        const probeOrigin = state.openCodeBaseUrl ?? env.ENV_CONFIGURED_OPENCODE_HOST?.origin;
        const healthy = await probeExternalOpenCode(probePort, probeOrigin);
        if (healthy) {
          console.log(`External OpenCode server on port ${probePort} is healthy`);
          setOpenCodePort(probePort);
          state.isOpenCodeReady = true;
          state.lastOpenCodeError = null;
          state.openCodeNotReadySince = 0;
          syncToHmrState();
        } else {
          state.lastOpenCodeError = `External OpenCode server on port ${probePort} is not responding`;
          console.error(state.lastOpenCodeError);
          throw new Error(state.lastOpenCodeError);
        }

        if (state.expressApp) {
          setupProxy(state.expressApp);
          ensureOpenCodeApiPrefix();
        }
        return;
      }

      const portToKill = state.openCodePort;

      if (state.openCodeProcess) {
        console.log('Stopping existing OpenCode process...');
        try {
          await state.openCodeProcess.close(`restart:${reason}`);
        } catch (error) {
          console.warn('Error closing OpenCode process:', error);
        }
        state.openCodeProcess = null;
        syncToHmrState();
      }

      killProcessOnPort(portToKill);
      if (!(await waitForPortRelease(portToKill, 5000))) {
        killProcessOnPort(portToKill);
        const releasedOnRetry = await waitForPortRelease(portToKill, 5000);
        if (!releasedOnRetry) {
          const listeningProcessIds = listListeningProcessIds(portToKill);
          console.error(
            `[lifecycle] Port ${portToKill} not released after SIGKILL escalation; ${listeningProcessIds.length} listener(s) may persist as orphan(s): [${listeningProcessIds.join(', ')}]`
          );
          await recordLifecycleEvent('port_release_timeout', {
            port: portToKill,
            reason: `restart:${reason}`,
            listeningProcessIds,
          });
        }
      }
      finalizeInterruptedManagedOpenCodeRuns('managed OpenCode restart');

      if (env.ENV_CONFIGURED_OPENCODE_PORT) {
        console.log(`Using OpenCode port from environment: ${env.ENV_CONFIGURED_OPENCODE_PORT}`);
        setOpenCodePort(env.ENV_CONFIGURED_OPENCODE_PORT);
      } else {
        state.openCodePort = null;
        syncToHmrState();
      }

      state.openCodeApiPrefixDetected = true;
      state.openCodeApiPrefix = '';
      if (state.openCodeApiDetectionTimer) {
        clearTimeout(state.openCodeApiDetectionTimer);
        state.openCodeApiDetectionTimer = null;
      }

      state.lastOpenCodeError = null;
      state.openCodeProcess = await startOpenCode();
      syncToHmrState();

      if (state.expressApp) {
        setupProxy(state.expressApp);
        ensureOpenCodeApiPrefix();
      }
      await recordLifecycleEvent('restart_completed', {
        reason,
        previousPid,
        previousPort,
        pid: state.openCodeProcess?.pid ?? null,
        port: state.openCodePort,
      });
    })();

    try {
      await state.currentRestartPromise;
    } catch (error) {
      await recordLifecycleEvent('restart_failed', {
        reason,
        message: error instanceof Error ? error.message : String(error),
      });
      console.error(`Failed to restart OpenCode: ${error.message}`);
      state.lastOpenCodeError = error.message;
      if (!env.ENV_CONFIGURED_OPENCODE_PORT) {
        state.openCodePort = null;
        syncToHmrState();
      }
      state.openCodeApiPrefixDetected = true;
      state.openCodeApiPrefix = '';
      throw error;
    } finally {
      state.currentRestartPromise = null;
      state.isRestartingOpenCode = false;
    }
  };

  const waitForOpenCodeReady = async (timeoutMs = 20000, intervalMs = 400) => {
    if (!state.openCodePort) {
      throw new Error('OpenCode port is not available');
    }

    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
      let timeout = null;
      try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
        const response = await fetch(buildOpenCodeUrl(OPENCODE_HEALTH_PATH, ''), {
          method: 'GET',
          headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        timeout = null;

        if (!response.ok) {
          lastError = new Error(`OpenCode health endpoint responded with status ${response.status}`);
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          continue;
        }

        const body = await response.json().catch(() => null);
        if (body?.healthy !== true) {
          lastError = new Error('OpenCode health endpoint returned unhealthy response');
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          continue;
        }

        state.isOpenCodeReady = true;
        state.lastOpenCodeError = null;
        return;
      } catch (error) {
        lastError = error;
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    if (lastError) {
      state.lastOpenCodeError = lastError.message || String(lastError);
      throw lastError;
    }

    const timeoutError = new Error('Timed out waiting for OpenCode to become ready');
    state.lastOpenCodeError = timeoutError.message;
    throw timeoutError;
  };

  const waitForAgentPresence = async (agentName, timeoutMs = 15000, intervalMs = 300) => {
    if (!state.openCodePort) {
      throw new Error('OpenCode port is not available');
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(buildOpenCodeUrl('/agent'), {
          method: 'GET',
          headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
        });

        if (response.ok) {
          const agents = await response.json();
          if (Array.isArray(agents) && agents.some((agent) => agent?.name === agentName)) {
            return;
          }
        }
      } catch {
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Agent "${agentName}" not available after OpenCode restart`);
  };

  let configRefreshPromise = null;
  const refreshOpenCodeAfterConfigChange = async (reason, options = {}) => {
    const { agentName } = options;
    if (configRefreshPromise) {
      console.log(`Joining in-progress OpenCode configuration refresh requested after ${reason}`);
      const result = await configRefreshPromise;
      if (agentName && result.reloaded) await waitForAgentPresence(agentName);
      return result;
    }

    const refresh = (async () => {
      console.log(`Refreshing OpenCode after ${reason}`);
      clearResolvedOpenCodeBinary();
      await applyOpencodeBinaryFromSettings();
      await restartOpenCode('config_change');
      const external = state.isExternalOpenCode === true;

      try {
        await waitForOpenCodeReady();
        state.isOpenCodeReady = true;
        state.openCodeNotReadySince = 0;
        if (agentName && !external) await waitForAgentPresence(agentName);
        state.isOpenCodeReady = true;
        state.openCodeNotReadySince = 0;
      } catch (error) {
        state.isOpenCodeReady = false;
        state.openCodeNotReadySince = Date.now();
        console.error(`Failed to refresh OpenCode after ${reason}:`, error.message);
        throw error;
      }

      return { reloaded: !external, external };
    })();

    configRefreshPromise = refresh;
    try {
      return await refresh;
    } finally {
      if (configRefreshPromise === refresh) configRefreshPromise = null;
    }
  };

  const bootstrapOpenCodeAtStartup = async () => {
    try {
      syncFromHmrState();
      if (await isOpenCodeProcessHealthy()) {
        console.log(`[HMR] Reusing existing OpenCode process on port ${state.openCodePort}`);
      } else {
        restoreManagedOpenCodeAuth();
        if (env.ENV_SKIP_OPENCODE_START && env.ENV_EFFECTIVE_PORT) {
          const label = env.ENV_CONFIGURED_OPENCODE_HOST ? env.ENV_CONFIGURED_OPENCODE_HOST.origin : `http://localhost:${env.ENV_EFFECTIVE_PORT}`;
          console.log(`Using external OpenCode server at ${label} (skip-start mode)`);
          state.openCodeBaseUrl = env.ENV_CONFIGURED_OPENCODE_HOST?.origin ?? null;
          setOpenCodePort(env.ENV_EFFECTIVE_PORT);
          state.isOpenCodeReady = true;
          state.isExternalOpenCode = true;
          state.lastOpenCodeError = null;
          state.openCodeNotReadySince = 0;
          syncToHmrState();
        } else if (env.ENV_EFFECTIVE_PORT && await probeExternalOpenCode(env.ENV_EFFECTIVE_PORT, env.ENV_CONFIGURED_OPENCODE_HOST?.origin)) {
          const label = env.ENV_CONFIGURED_OPENCODE_HOST ? env.ENV_CONFIGURED_OPENCODE_HOST.origin : `http://localhost:${env.ENV_EFFECTIVE_PORT}`;
          console.log(`Auto-detected existing OpenCode server at ${label}`);
          state.openCodeBaseUrl = env.ENV_CONFIGURED_OPENCODE_HOST?.origin ?? null;
          setOpenCodePort(env.ENV_EFFECTIVE_PORT);
          state.isOpenCodeReady = true;
          state.isExternalOpenCode = true;
          state.lastOpenCodeError = null;
          state.openCodeNotReadySince = 0;
          syncToHmrState();
        } else {
          const lastPort = readPersistedOpenCodePort();
          const previousManagedPort = lastPort && lastPort !== 4096 ? lastPort : null;
          const previousManagedPortHealthy = previousManagedPort
            ? await probeExternalOpenCode(previousManagedPort)
            : false;
          if (previousManagedPortHealthy) {
            console.log(`Reconnected to previous managed OpenCode server on port ${lastPort}`);
            setOpenCodePort(lastPort);
            state.isOpenCodeReady = true;
            // Do NOT set isExternalOpenCode here — this port was persisted by
            // OpenChamber itself, meaning it was a managed server. Marking it
            // external would cause shouldSkipOpenCodeStop to refuse killing the
            // process when the user chooses "Quit and Stop OpenCode".
            state.lastOpenCodeError = null;
            state.openCodeNotReadySince = 0;
            syncToHmrState();
          } else {
            if (previousManagedPort) {
              console.warn(`[OpenCode] Previous managed server on port ${previousManagedPort} is unhealthy; terminating it before replacement`);
              const released = await terminateStaleManagedOpenCodePort(previousManagedPort);
              if (!released) {
                throw new Error(`Unable to release unhealthy previous managed OpenCode port ${previousManagedPort}`);
              }
            }

            if (env.ENV_EFFECTIVE_PORT) {
              console.log(`Using OpenCode port from environment: ${env.ENV_EFFECTIVE_PORT}`);
              setOpenCodePort(env.ENV_EFFECTIVE_PORT);
            } else {
              state.openCodePort = null;
              syncToHmrState();
            }

            state.lastOpenCodeError = null;
            finalizeInterruptedManagedOpenCodeRuns('managed OpenCode startup');
            state.openCodeProcess = await startOpenCode();
            syncToHmrState();
          }
        }
      }
      await waitForOpenCodePort();
      try {
        await waitForOpenCodeReady();
      } catch (error) {
        console.error(`OpenCode readiness check failed: ${error.message}`);
      }
    } catch (error) {
      console.error(`Failed to start OpenCode: ${error.message}`);
      console.log('Continuing without OpenCode integration...');
      state.lastOpenCodeError = error.message;
    }
  };

  /**
   * Perform an immediate (one-shot) health check and restart OpenCode if it
   * remains unhealthy. Callers on the SSE / WS proxy path use this to trigger
   * recovery without waiting for the next periodic interval (up to 15 s).
   *
   * Skips restart when sessions are actively busy — a busy server under
   * concurrent load can fail the health check timeout without actually
   * being dead (the health endpoint competes with LLM work).
   * A missing child-process handle is also treated as health evidence, not
   * as an immediate restart signal. Desktop managed OpenCode processes are
   * detached and can outlive or desync from the in-memory child object while
   * still serving requests on the managed port.
   * Forces restart if sessions stay "busy" and the server stays unhealthy
   * past the stale-busy grace window (staleness guard against stuck session state).
   */
  let lastUnhealthyWithBusySessionsAt = 0;
  let consecutiveHealthFailures = 0;
  let lastCountedHealthFailureAt = 0;
  let healthProbePromise = null;
  let healthCheckCyclePromise = null;
  let lastHealthProbeResult = null;
  let healthFailureCountIntervalMs = 15_000;

  const resetHealthFailureState = () => {
    consecutiveHealthFailures = 0;
    lastUnhealthyWithBusySessionsAt = 0;
    lastCountedHealthFailureAt = 0;
  };

  const probeOpenCodeHealth = async () => {
    const checkedAt = now();
    if (lastHealthProbeResult && checkedAt - lastHealthProbeResult.at < HEALTH_CHECK_RESULT_CACHE_MS) {
      return lastHealthProbeResult.healthy;
    }

    if (healthProbePromise) {
      return healthProbePromise;
    }

    healthProbePromise = isOpenCodeProcessHealthy()
      .then((healthy) => {
        lastHealthProbeResult = { at: now(), healthy };
        return healthy;
      })
      .finally(() => {
        healthProbePromise = null;
      });

    return healthProbePromise;
  };

  const shouldSkipRestartForBusySessions = () => {
    const activeCount = getActiveSessionCount();
    if (activeCount === 0) {
      lastUnhealthyWithBusySessionsAt = 0;
      return false;
    }

    const checkedAt = now();
    if (!lastUnhealthyWithBusySessionsAt) {
      lastUnhealthyWithBusySessionsAt = checkedAt;
      return true;
    }

    if (checkedAt - lastUnhealthyWithBusySessionsAt >= STALE_BUSY_GRACE_MS) {
      console.warn(
        `[lifecycle] OpenCode unhealthy with ${activeCount} busy session(s) for > ${formatDurationForLog(STALE_BUSY_GRACE_MS)} — forcing restart`
      );
      lastUnhealthyWithBusySessionsAt = 0;
      return false;
    }

    return true;
  };

  const recordHealthFailure = (source, detail = '') => {
    const checkedAt = now();
    if (
      lastCountedHealthFailureAt
      && checkedAt - lastCountedHealthFailureAt < healthFailureCountIntervalMs
    ) {
      return false;
    }
    lastCountedHealthFailureAt = checkedAt;
    consecutiveHealthFailures += 1;
    const suffix = detail ? `; ${detail}` : '';
    console.warn(
      `[lifecycle] ${source} health check failed (${consecutiveHealthFailures}/${HEALTH_CHECK_MAX_CONSECUTIVE_FAILURES})${suffix}`
    );
    return consecutiveHealthFailures >= HEALTH_CHECK_MAX_CONSECUTIVE_FAILURES;
  };

  const runHealthCheckCycle = async (source) => {
    if (!state.openCodePort || state.isExternalOpenCode || state.isShuttingDown || state.isRestartingOpenCode) return;
    if (healthCheckCyclePromise) return healthCheckCyclePromise;

    healthCheckCyclePromise = (async () => {
      const healthy = await probeOpenCodeHealth();
      if (!healthy) {
        const processUnavailable = !state.openCodeProcess || !isManagedOpenCodeProcessAlive();
        const listeningProcessIds = process.platform !== 'win32'
          ? listListeningProcessIds(state.openCodePort)
          : [];
        const managedListenerUnavailable = processUnavailable
          && process.platform !== 'win32'
          && listeningProcessIds.length === 0;
        const reachedFailureThreshold = recordHealthFailure(
          source,
          processUnavailable ? 'managed process handle unavailable' : ''
        );
        await recordLifecycleEvent('health_failure', {
          source,
          consecutiveFailures: consecutiveHealthFailures,
          failureThreshold: HEALTH_CHECK_MAX_CONSECUTIVE_FAILURES,
          processUnavailable,
          managedProcessAlive: !processUnavailable,
          managedPid: state.openCodeProcess?.pid ?? null,
          port: state.openCodePort,
          listeningProcessIds,
          activeSessionCount: getActiveSessionCount(),
        });
        if (!managedListenerUnavailable && !reachedFailureThreshold) return;
        if (!managedListenerUnavailable && shouldSkipRestartForBusySessions()) {
          await recordLifecycleEvent('restart_deferred_busy', {
            source,
            consecutiveFailures: consecutiveHealthFailures,
            activeSessionCount: getActiveSessionCount(),
          });
          return;
        }
        console.log(
          managedListenerUnavailable
            ? `[lifecycle] ${source} health check found no managed OpenCode listener, restarting OpenCode...`
            : `[lifecycle] ${source} health check failure threshold reached, restarting OpenCode...`
        );
        consecutiveHealthFailures = 0;
        if (managedListenerUnavailable) {
          lastUnhealthyWithBusySessionsAt = 0;
        }
        lastHealthProbeResult = null;
        await restartOpenCode(managedListenerUnavailable
          ? `health_${source}_listener_missing`
          : `health_${source}_threshold`);
      } else {
        if (consecutiveHealthFailures > 0) {
          await recordLifecycleEvent('health_recovered', {
            source,
            consecutiveFailures: consecutiveHealthFailures,
            pid: state.openCodeProcess?.pid ?? null,
            port: state.openCodePort,
          });
        }
        resetHealthFailureState();
      }
    })().finally(() => {
      healthCheckCyclePromise = null;
    });

    return healthCheckCyclePromise;
  };

  const triggerHealthCheck = async () => {
    try {
      await runHealthCheckCycle('immediate');
    } catch (error) {
      console.error(`[lifecycle] immediate health check error: ${error.message}`);
    }
  };

  const startHealthMonitoring = (healthCheckIntervalMs) => {
    if (state.healthCheckInterval) {
      clearInterval(state.healthCheckInterval);
    }

    const effectiveIntervalMs = HEALTH_CHECK_INTERVAL_OVERRIDE_MS || healthCheckIntervalMs;
    healthFailureCountIntervalMs = effectiveIntervalMs;

    state.healthCheckInterval = setInterval(async () => {
      try {
        await runHealthCheckCycle('periodic');
      } catch (error) {
        console.error(`Health check error: ${error.message}`);
      }
    }, effectiveIntervalMs);
  };

  return {
    killProcessOnPort,
    startOpenCode,
    restartOpenCode,
    waitForOpenCodeReady,
    waitForAgentPresence,
    refreshOpenCodeAfterConfigChange,
    bootstrapOpenCodeAtStartup,
    startHealthMonitoring,
    triggerHealthCheck,
    waitForPortRelease,
  };
};
