import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { stripAppImageArgv0Leak, stripAppImageLauncherEnv } from '../inherited-env.js';
import { finalizeInterruptedOpenCodeRuns } from './interrupted-runs.js';
import { applyProviderEnvAliases } from './provider-env-aliases.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, recordProtocolModeFromVersion, resolveProtocolMode } from './protocol-mode.js';
import { topUpV1Migration } from './v1-migration-topup.js';

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
// v2-track readiness path (spine OC2-S3): OpenCode 2.0.8 removed
// `/global/health`; `GET /api/info` answering 200 is the whole readiness
// answer, and its payload carries `{ version, pid, urls, paths }`.
const OPENCODE_V2_INFO_PATH = '/api/info';
const MANAGED_STDERR_TAIL_MAX_BYTES = 32 * 1024;
const HEALTH_FAILURE_DETAIL_MAX_LENGTH = 1000;

const getBoundedTextTail = (value, maxBytes) => {
  const buffer = Buffer.from(String(value ?? ''));
  if (buffer.byteLength <= maxBytes) return buffer.toString();
  return buffer.subarray(buffer.byteLength - maxBytes).toString();
};

export const sanitizeLifecycleDiagnosticText = (value) => String(value ?? '')
  .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[redacted]@')
  .replace(/\b(Bearer)\s+[^\s,;]+/gi, '$1 [redacted]')
  .replace(/\b(Authorization\s*:\s*(?:Basic|Digest|Token))\s+[^\s,;]+/gi, '$1 [redacted]')
  .replace(/\b(authorization\s*=\s*(?:Basic|Digest|Token))\s+[^\s,;]+/gi, '$1 [redacted]')
  .replace(/\b(password|passwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*([^\s,;]+)/gi, '$1=[redacted]');

export const classifyLifecycleHealthError = (error) => {
  const name = String(error?.name || '');
  const code = String(error?.code || error?.cause?.code || '');
  const message = String(error?.message || error || 'Unknown error');
  const detail = sanitizeLifecycleDiagnosticText(`${name || 'Error'}: ${message}`)
    .slice(0, HEALTH_FAILURE_DETAIL_MAX_LENGTH);
  if (name === 'TimeoutError' || name === 'AbortError' || /timed?\s*out/i.test(message)) {
    return { class: 'timeout', detail };
  }
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENOTFOUND/i.test(code)) {
    return { class: 'connection', detail };
  }
  return { class: 'error', detail };
};

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
    onOpenCodeRestarted = null,
    now = Date.now,
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
    topUpV1SessionMigration = topUpV1Migration,
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

  const snapshotManagedOpenCodeProcess = (child = state.openCodeProcess) => {
    if (!child) return null;
    const snapshot = {
      pid: child.pid || null,
      exitCode: child.exitCode ?? null,
      signalCode: child.signalCode ?? null,
      stderrTail: getBoundedTextTail(
        sanitizeLifecycleDiagnosticText(child.stderrTail ?? ''),
        MANAGED_STDERR_TAIL_MAX_BYTES,
      ),
    };
    state.lastManagedOpenCodeProcess = snapshot;
    return snapshot;
  };

  const captureRestartDiagnostics = (reason) => {
    const processSnapshot = snapshotManagedOpenCodeProcess();
    const diagnostics = {
      reason: sanitizeLifecycleDiagnosticText(String(reason || 'managed-restart'))
        .slice(0, HEALTH_FAILURE_DETAIL_MAX_LENGTH),
      healthFailure: state.lastOpenCodeHealthFailure ? { ...state.lastOpenCodeHealthFailure } : null,
      process: processSnapshot
        ? { ...processSnapshot, alive: isManagedOpenCodeProcessAlive() }
        : null,
      busySessionCount: getActiveSessionCount(),
      at: new Date(now()).toISOString(),
    };
    state.lastOpenCodeRestartDiagnostics = diagnostics;
    console.warn('[lifecycle] managed OpenCode restart diagnostics', diagnostics);
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

  const finalizeInterruptedManagedOpenCodeRuns = (reason, options = {}) => {
    if (state.isExternalOpenCode) {
      return;
    }

    try {
      const result = finalizeInterruptedOpenCodeRuns({ reason, ...options });
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
    // On POSIX a closed parent can still own a live group (a tool ignoring
    // SIGTERM keeps running after the server closed its stdio), so only the
    // win32 check may shortcut the tree termination below.
    if (!pid || (process.platform === 'win32' && hasChildProcessExited(child))) {
      await waitForChildProcessClose(child, 250);
      return;
    }

    const signalChild = (signal) => {
      // Only a detached child is its own process group leader; signaling the
      // group of a non-detached child would be a no-op at best.
      if (process.env.OPENCHAMBER_RUNTIME === 'desktop') {
        try {
          process.kill(-pid, signal);
        } catch {
        }
      }

      try {
        if (!hasChildProcessExited(child)) child.kill(signal);
      } catch {
      }
    };

    if (process.platform === 'win32') {
      // Windows child.kill() terminates only the parent. Kill the owned tree
      // while its parent still exists, otherwise /T cannot find its children.
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

    signalChild('SIGTERM');
    // Parent exit does not prove group exit. Tools can ignore SIGTERM and keep
    // running after their server has exited and closed its own stdio.
    await waitForChildProcessClose(child, 2500);

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

  const createManagedOpenCodeServerProcess = async ({ resolvedBinary, hostname, port, timeout, cwd, env: processEnv, shellEnvKeysCount = 0 }) => {
    let binary = (resolvedBinary || process.env.OPENCODE_BINARY || 'opencode').trim() || 'opencode';
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
    let runtimeStderrTail = '';
    let observedExitCode = null;
    let observedSignalCode = null;
    const appendRuntimeStderr = (chunk) => {
      runtimeStderrTail = getBoundedTextTail(
        `${runtimeStderrTail}${String(chunk ?? '')}`,
        MANAGED_STDERR_TAIL_MAX_BYTES,
      );
    };
    const getManagedProcessSnapshot = () => ({
      pid: child.pid || null,
      exitCode: observedExitCode ?? child.exitCode ?? null,
      signalCode: observedSignalCode ?? child.signalCode ?? null,
      stderrTail: getBoundedTextTail(
        sanitizeLifecycleDiagnosticText(runtimeStderrTail),
        MANAGED_STDERR_TAIL_MAX_BYTES,
      ),
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
      if (code !== null && code !== undefined) observedExitCode = code;
      if (signal !== null && signal !== undefined) observedSignalCode = signal;
      state.lastManagedOpenCodeProcess = getManagedProcessSnapshot();
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
          // v1 prints `opencode server listening on <url>`; OpenCode 2.x drops
          // the `opencode` prefix (upstream 654705f7d). The v1 form is matched
          // first so its malformed-line error is preserved exactly, then the
          // unprefixed v2 form resolves the same URL.
          if (line.startsWith('opencode server listening')) {
            const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
            if (!match) {
              finish(reject, new Error(`Failed to parse server url from output: ${line}`));
              return;
            }
            finish(resolve, match[1]);
            return;
          }
          const v2Match = line.match(/server listening on\s+(https?:\/\/\S+)/);
          if (v2Match) {
            finish(resolve, v2Match[1]);
            return;
          }
        }
      };

      const onStderr = (chunk) => {
        appendRuntimeStderr(chunk);
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
        finish(reject, new Error(`Timeout waiting for OpenCode to start after ${timeout}ms`));
      }, timeout);

      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      child.on('exit', onExit);
      child.on('error', onError);
    }).catch(async (error) => {
      // Ownership starts at spawn: a server that never becomes ready (timeout,
      // parse failure, early exit) is closed with its descendants instead of
      // being left orphaned with its listening port, accumulating across retries.
      expectedStopReason = expectedStopReason ?? 'startup_failed';
      await closeManagedOpenCodeChild(child);
      throw error;
    });

    child.stderr?.on('data', (chunk) => {
      appendRuntimeStderr(chunk);
      process.stderr.write(sanitizeLifecycleDiagnosticText(chunk));
    });
    served = true;

    return {
      url,
      get pid() {
        return child.pid;
      },
      get exitCode() {
        return observedExitCode ?? child.exitCode;
      },
      get signalCode() {
        return observedSignalCode ?? child.signalCode;
      },
      get stderrTail() {
        return getManagedProcessSnapshot().stderrTail;
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

  /**
   * v2-track readiness probe: a 200 from `/api/info` is the whole answer, and
   * its `version` records the protocol mode. Returns `{ matched: false }` when
   * the server does not answer, so callers keep their v1 failure detail
   * verbatim.
   */
  const probeOpenCodeInfo = async () => {
    try {
      const response = await fetch(buildOpenCodeUrl(OPENCODE_V2_INFO_PATH, ''), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...getOpenCodeAuthHeaders(),
        },
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { matched: false, status: response.status };
      }
      const body = await response.json().catch(() => null);
      if (typeof body?.version === 'string' && body.version.trim()) {
        recordProtocolModeFromVersion(DEFAULT_PROTOCOL_MODE_SERVER_ID, body.version.trim(), 'info-probe');
      }
      return { matched: true, healthy: true, failure: null };
    } catch {
      return { matched: false, status: null };
    }
  };

  const v2TrackActive = () => resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2';

  const probeOpenCodeHealthDetailed = async () => {
    if (!state.openCodePort || (!state.openCodeProcess && state.isExternalOpenCode)) {
      return {
        healthy: false,
        failure: { class: 'error', detail: 'Managed OpenCode process or port is unavailable' },
      };
    }

    // A recorded v2 instance never had `/global/health`; probe `/api/info`
    // directly. Every other resolution (v1 default, env override) keeps the
    // v1 probe first and falls back once it fails, so a v1 server's outcome
    // and failure detail are unchanged.
    if (v2TrackActive()) {
      const v2 = await probeOpenCodeInfo();
      if (v2.matched) return { healthy: true, failure: null };
      return {
        healthy: false,
        failure: {
          class: 'invalid_response',
          detail: `Info endpoint returned HTTP ${v2.status ?? 'unknown'}`,
        },
      };
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
      if (!response.ok) {
        if ((await probeOpenCodeInfo()).matched) return { healthy: true, failure: null };
        return {
          healthy: false,
          failure: { class: 'invalid_response', detail: `Health endpoint returned HTTP ${response.status ?? 'unknown'}` },
        };
      }
      let body;
      try {
        body = await response.json();
      } catch {
        if ((await probeOpenCodeInfo()).matched) return { healthy: true, failure: null };
        return {
          healthy: false,
          failure: { class: 'invalid_response', detail: 'Health endpoint returned invalid JSON' },
        };
      }
      if (body?.healthy !== true) {
        if ((await probeOpenCodeInfo()).matched) return { healthy: true, failure: null };
        return {
          healthy: false,
          failure: { class: 'invalid_response', detail: 'Health endpoint did not report healthy=true' },
        };
      }
      if (typeof body?.version === 'string' && body.version.trim()) {
        recordProtocolModeFromVersion(DEFAULT_PROTOCOL_MODE_SERVER_ID, body.version.trim(), 'health-probe');
      }
      return { healthy: true, failure: null };
    } catch (error) {
      return { healthy: false, failure: classifyLifecycleHealthError(error) };
    }
  };

  const isOpenCodeProcessHealthy = async () => {
    const result = await probeOpenCodeHealthDetailed();
    if (!result.healthy) {
      state.lastOpenCodeHealthFailure = {
        ...result.failure,
        at: new Date(now()).toISOString(),
      };
    }
    return result.healthy;
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
      if (response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.healthy === true) {
          if (typeof body?.version === 'string' && body.version.trim()) {
            recordProtocolModeFromVersion(DEFAULT_PROTOCOL_MODE_SERVER_ID, body.version.trim(), 'external-health');
          }
          return true;
        }
      } else if (v2TrackActive() || response.status === 404) {
        // OpenCode 2.x has no `/global/health`; a 200 from `/api/info` is the
        // readiness answer (spine OC2-S3). A 404 from the v1 probe is the only
        // cheap hint that the upstream might be 2.x, so only then spend the
        // extra request.
        const infoResponse = await fetch(`${base.replace(/\/+$/, '')}${OPENCODE_V2_INFO_PATH}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...getOpenCodeAuthHeaders(),
          },
          signal: controller.signal,
        });
        if (infoResponse.ok) {
          const info = await infoResponse.json().catch(() => null);
          if (typeof info?.version === 'string' && info.version.trim()) {
            recordProtocolModeFromVersion(DEFAULT_PROTOCOL_MODE_SERVER_ID, info.version.trim(), 'external-info');
          }
          return true;
        }
      }
      return false;
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
    const resolvedBinary = ensureOpencodeCliEnv();
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

    const processEnv = stripAppImageLauncherEnv(stripAppImageArgv0Leak(applyProviderEnvAliases({
      ...shellEnv,
      ...process.env,
      ...managedOpenCodeEnv,
      PATH: envPath,
      // OpenCode 2 reads OPENCODE_PASSWORD before the legacy name, so a
      // user's own OPENCODE_PASSWORD would otherwise win and every request
      // we send with openCodePassword would get 401 (upstream 8dd842a3b).
      // OpenCode 1.x ignores the variable, so v1 behaviour is unchanged.
      OPENCODE_PASSWORD: openCodePassword,
      OPENCODE_SERVER_PASSWORD: openCodePassword,
    })));
    managedProcessEnv = processEnv;

    try {
      const serverInstance = await createManagedOpenCodeServerProcess({
        resolvedBinary,
        hostname: env.ENV_CONFIGURED_OPENCODE_HOSTNAME,
        port: spawnPort,
        timeout: startupTimeoutMs,
        cwd: state.openCodeWorkingDirectory,
        shellEnvKeysCount: Object.keys(shellEnv).length,
        env: processEnv,
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
    // Re-arm OpenCode's own V1 -> V2 session import for sessions a bundled
    // OpenCode 1.x created after the migration already completed (upstream
    // `654705f7d` + `ee99e079d`). Managed process only, before spawn, never
    // fatal: the module self-guards by skipping databases without a completed
    // v2 migration, so a pure v1 install is untouched.
    if (!state.isExternalOpenCode && !state.isShuttingDown) {
      try {
        const topUp = topUpV1SessionMigration();
        if (topUp && topUp.status !== 'skipped') {
          console.log('[OpenCode] V1 session migration top-up:', topUp);
        }
      } catch (error) {
        console.warn('[OpenCode] V1 session migration top-up failed:', error instanceof Error ? error.message : error);
      }
    }

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

      captureRestartDiagnostics(reason);
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
      // Same rationale as the startup path: keep the full-DB finalization scan
      // off the restart critical path, with a cutoff captured before the new
      // process starts so its live parts are exempt.
      const finalizeCutoffMs = Date.now();
      void Promise.resolve()
        .then(() => finalizeInterruptedManagedOpenCodeRuns('managed OpenCode restart', { beforeMs: finalizeCutoffMs }))
        .catch((error) => {
          console.warn('[OpenCode] Background interrupted-run finalization failed:', error);
        });

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
      try {
        onOpenCodeRestarted?.();
      } catch (error) {
        console.warn('Failed to rebind event stream after OpenCode restart:', error?.message ?? error);
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
          // v2 fallback (spine OC2-S3): OpenCode 2.x has no `/global/health`;
          // a 200 from `/api/info` means ready, and its version records the
          // mode. The v1 error text is kept when the fallback also fails.
          if ((await probeOpenCodeInfo()).matched) {
            state.isOpenCodeReady = true;
            state.lastOpenCodeError = null;
            return;
          }
          lastError = new Error(`OpenCode health endpoint responded with status ${response.status}`);
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          continue;
        }

        const body = await response.json().catch(() => null);
        if (body?.healthy !== true) {
          if ((await probeOpenCodeInfo()).matched) {
            state.isOpenCodeReady = true;
            state.lastOpenCodeError = null;
            return;
          }
          lastError = new Error('OpenCode health endpoint returned unhealthy response');
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          continue;
        }

        if (typeof body?.version === 'string' && body.version.trim()) {
          recordProtocolModeFromVersion(DEFAULT_PROTOCOL_MODE_SERVER_ID, body.version.trim(), 'ready-wait');
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
    // v2 track (upstream 654705f7d): `/api/agent` answers `{ location, data }`
    // and names agents `id`. The v1 request shape is untouched.
    const v2Track = resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2';
    while (Date.now() < deadline) {
      try {
        const response = await fetch(buildOpenCodeUrl(v2Track ? '/api/agent' : '/agent'), {
          method: 'GET',
          headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
        });

        if (response.ok) {
          if (v2Track) {
            const body = await response.json();
            const agents = Array.isArray(body) ? body : body?.data;
            if (Array.isArray(agents) && agents.some((agent) => agent?.id === agentName)) {
              return;
            }
          } else {
            const agents = await response.json();
            if (Array.isArray(agents) && agents.some((agent) => agent?.name === agentName)) {
              return;
            }
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

      // Config-watcher in opencode invalidates per-instance caches (tools/MCP/skills)
      // on file changes, so running sessions pick up fresh config at their next turn
      // boundary without a process restart. Set OPENCHAMBER_CONFIG_HOT_RELOAD=false
      // to fall back to the legacy full-restart behavior.
      const useHotReload = options.forceRestart !== true
        && process.env.OPENCHAMBER_CONFIG_HOT_RELOAD !== 'false';
      if (useHotReload) {
        console.log(`[openchamber] Config hot-reload: skipping process restart for ${reason}`);
      } else {
        await restartOpenCode('config_change');
      }

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
            const finalizeCutoffMs = Date.now();
            state.openCodeProcess = await startOpenCode();
            syncToHmrState();
            // Interrupted-run finalization scans the whole OpenCode `part`
            // table and can take tens of seconds on multi-million-row DBs;
            // running it before startOpenCode stalled cold boot behind a
            // bookkeeping pass. Fire-and-forget after the server is up, with a
            // cutoff taken before the new process started so live parts of the
            // restarted server are never mistaken for interrupted ones.
            void Promise.resolve()
              .then(() => finalizeInterruptedManagedOpenCodeRuns('managed OpenCode startup', { beforeMs: finalizeCutoffMs }))
              .catch((error) => {
                console.warn('[OpenCode] Background interrupted-run finalization failed:', error);
              });
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
  /** The managed OpenCode's launch environment; null before the first launch. */
  let managedProcessEnv = null;

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
        const diagnosticDetail = state.lastOpenCodeHealthFailure?.detail || '';
        state.lastOpenCodeHealthFailure = {
          ...(state.lastOpenCodeHealthFailure || { class: 'error', detail: diagnosticDetail }),
          source,
          at: new Date(now()).toISOString(),
        };
        const reachedFailureThreshold = recordHealthFailure(
          source,
          [processUnavailable ? 'managed process handle unavailable' : '', diagnosticDetail]
            .filter(Boolean)
            .join('; ')
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
    /** The managed OpenCode's launch environment; null for an external OpenCode or before the first launch. */
    getManagedOpenCodeProcessEnv: () => (state.isExternalOpenCode ? null : managedProcessEnv),
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
