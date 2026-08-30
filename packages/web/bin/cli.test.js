import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer } from 'http';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

import { isModuleCliExecution, normalizeCliEntryPath } from './cli-entry.js';
import {
  commands,
  discoverLifecycleInstances,
  discoverRunningInstances,
  discoverUnconfirmedRegistryInstanceOnPort,
  getInstanceFilePath,
  getPidFilePath,
  isOpenchamberCmdline,
  isOpenchamberProcessRunning,
  parseArgs,
  resolveControlTargetInstance,
} from './cli.js';

async function withTempOpenChamberDataDir(fn) {
  const previous = process.env.OPENCHAMBER_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-cli-test-'));
  process.env.OPENCHAMBER_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (typeof previous === 'string') {
      process.env.OPENCHAMBER_DATA_DIR = previous;
    } else {
      delete process.env.OPENCHAMBER_DATA_DIR;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createMockJsonResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

async function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk, encoding, callback) => {
    output += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (typeof encoding === 'function') encoding();
    if (typeof callback === 'function') callback();
    return true;
  };
  try {
    await fn();
    return output;
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function startMockOpenChamberServer(options = {}) {
  const runtime = options.runtime || 'web';
  const pid = Number.isFinite(options.pid) ? options.pid : null;
  let shutdownRequested = false;
  let closed = false;
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/system/info') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ runtime, pid }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/system/shutdown') {
      shutdownRequested = true;
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify({ ok: true }));
      try {
        server.close(() => {
          closed = true;
        });
      } catch {
        closed = true;
      }
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    get shutdownRequested() {
      return shutdownRequested;
    },
    close: async () => {
      if (closed || !server.listening) return;
      await new Promise((resolve) => {
        try {
          server.close(() => {
            closed = true;
            resolve();
          });
        } catch {
          closed = true;
          resolve();
        }
      });
    },
  };
}

async function allocateLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForTcpPort(port, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.setTimeout(250, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function spawnOpenChamberLikeIdleProcess() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'openchamber-idle'], { stdio: 'ignore' });
}

function spawnOpenChamberLikeHungServer(port) {
  const script = `
    const net = require('net');
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.listen(${port}, '127.0.0.1');
    setInterval(() => {}, 1000);
  `;
  return spawn(process.execPath, ['-e', script, 'openchamber-hung-server'], { stdio: 'ignore' });
}

describe('cli args', () => {
  it('accepts legacy daemon flags as no-ops', () => {
    expect(parseArgs(['serve', '--daemon']).removedFlagErrors).toEqual([]);
    expect(parseArgs(['serve', '-d']).removedFlagErrors).toEqual([]);
  });

  it('parses connect-url relay and output flags without prompts', () => {
    const parsed = parseArgs([
      'connect-url',
      '--port',
      '4321',
      '--server',
      'https://openchamber.example.test',
      '--name',
      'Dev host',
      '--relay',
      '--qr',
      '--quiet',
    ]);

    expect(parsed.command).toBe('connect-url');
    expect(parsed.options).toMatchObject({
      port: 4321,
      serverId: 'https://openchamber.example.test',
      name: 'Dev host',
      relay: true,
      qr: true,
      quiet: true,
    });
    expect(parsed.removedFlagErrors).toEqual([]);
  });

  it('parses session control scope and dispatch flags', () => {
    const parsed = parseArgs([
      'session',
      'send',
      '--server',
      'default',
      '--dir',
      '/tmp/project',
      '--session',
      'ses_test',
      '--prompt',
      'continue',
      '--model',
      'openai/gpt-5',
      '--agent',
      'build',
      '--variant',
      'high',
      '--wait',
      '--last-assistant',
      '--timeout',
      '120',
    ]);

    expect(parsed.command).toBe('session');
    expect(parsed.controlAction).toBe('send');
    expect(parsed.options).toMatchObject({
      serverId: 'default',
      directory: '/tmp/project',
      sessionId: 'ses_test',
      prompt: 'continue',
      model: 'openai/gpt-5',
      agent: 'build',
      variant: 'high',
      wait: true,
      lastAssistant: true,
      timeout: '120',
    });
    expect(parsed.removedFlagErrors).toEqual([]);
  });

  it('parses scheduled task creation flags without weakening policy in json mode', () => {
    const parsed = parseArgs([
      'schedule',
      'create',
      '--project',
      'project-a',
      '--name',
      'Nightly review',
      '--prompt',
      'Review the workspace',
      '--model',
      'openai/gpt-5',
      '--daily',
      '23:00',
      '--timezone',
      'Asia/Shanghai',
      '--goal',
      '--goal-token-budget',
      '50000',
      '--json',
    ]);

    expect(parsed.command).toBe('schedule');
    expect(parsed.controlAction).toBe('create');
    expect(parsed.options).toMatchObject({
      projectId: 'project-a',
      name: 'Nightly review',
      prompt: 'Review the workspace',
      model: 'openai/gpt-5',
      daily: '23:00',
      timezone: 'Asia/Shanghai',
      goal: true,
      goalTokenBudget: '50000',
      json: true,
    });
    expect(parsed.removedFlagErrors).toEqual([]);
  });
});

describe('cli entry detection', () => {
  const modulePath = '/tmp/openchamber/bin/cli.js';
  const moduleUrl = pathToFileURL(modulePath).href;

  it('resolves symlinked entry paths before comparing', () => {
    const symlinkPath = '/usr/local/bin/openchamber';
    const realpath = (filePath) => {
      if (filePath === path.resolve(symlinkPath)) {
        return modulePath;
      }
      return filePath;
    };

    expect(isModuleCliExecution(symlinkPath, moduleUrl, realpath)).toBe(true);
  });

  it('falls back to resolved paths when realpath fails', () => {
    const realpath = () => {
      throw new Error('realpath unavailable');
    };

    expect(isModuleCliExecution(modulePath, moduleUrl, realpath)).toBe(true);
  });

  it('returns false for non-matching entry path', () => {
    expect(isModuleCliExecution('/tmp/other-cli.js', moduleUrl)).toBe(false);
  });

  it('returns false for empty entry path', () => {
    expect(isModuleCliExecution('', moduleUrl)).toBe(false);
  });

  it('returns false when module url is not provided', () => {
    expect(isModuleCliExecution(modulePath)).toBe(false);
  });

  it('accepts wrapper binary name fallback when requested', () => {
    const wrapperPath = '/home/user/.local/bin/openchamber';
    expect(isModuleCliExecution(wrapperPath, moduleUrl, undefined, 'openchamber')).toBe(true);
  });

  it('normalizes direct paths when realpath fails', () => {
    const unresolvedPath = './packages/web/bin/cli.js';
    const realpath = () => {
      throw new Error('no symlink resolution');
    };

    expect(normalizeCliEntryPath(unresolvedPath, realpath)).toBe(path.resolve(unresolvedPath));
  });
});

describe('isOpenchamberCmdline', () => {
  it('accepts CLI and server entrypoints', () => {
    expect(isOpenchamberCmdline('node /x/@openchamber/web/bin/cli.js serve')).toBe(true);
    expect(isOpenchamberCmdline('bun /home/u/openchamber/packages/web/server/index.js')).toBe(true);
  });

  it('rejects unrelated processes', () => {
    expect(isOpenchamberCmdline('node /usr/lib/node_modules/npm/bin/npm-cli.js install')).toBe(false);
    expect(isOpenchamberCmdline('')).toBe(false);
    expect(isOpenchamberCmdline(null)).toBe(false);
  });
});

describe('isOpenchamberProcessRunning', () => {
  it('returns false for a dead PID', () => {
    expect(isOpenchamberProcessRunning(2147483646)).toBe(false);
  });

  it.skipIf(process.platform !== 'linux' && process.platform !== 'darwin')(
    'rejects a live process that does not belong to OpenChamber',
    async () => {
      const child = spawn('sleep', ['30'], { stdio: 'ignore' });
      try {
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(isOpenchamberProcessRunning(child.pid)).toBe(false);
      } finally {
        child.kill('SIGKILL');
      }
    }
  );
});

describe('lifecycle instance discovery', () => {
  it('keeps pid and instance files when live port probe confirms a cmdline mismatch', async () => {
    await withTempOpenChamberDataDir(async () => {
      const port = 45123;
      const pid = 12345;
      const pidFile = await getPidFilePath(port);
      const instanceFile = await getInstanceFilePath(port);
      fs.writeFileSync(pidFile, String(pid));
      fs.writeFileSync(instanceFile, JSON.stringify({ port, launchMode: 'daemon', startedAt: 123 }, null, 2));

      const instances = await discoverRunningInstances({
        fetchImpl: async () => createMockJsonResponse({ runtime: 'web', pid }),
        getOpenchamberProcessState: () => 'mismatched',
      });

      expect(instances).toEqual([
        expect.objectContaining({ port, pid, runtime: 'web', source: 'registry+probe' }),
      ]);
      expect(fs.existsSync(pidFile)).toBe(true);
      expect(fs.existsSync(instanceFile)).toBe(true);
    });
  });

  it('removes stale pid and instance files when a cmdline mismatch is not confirmed by live probe', async () => {
    await withTempOpenChamberDataDir(async () => {
      const port = 45124;
      const pid = 12346;
      const pidFile = await getPidFilePath(port);
      const instanceFile = await getInstanceFilePath(port);
      fs.writeFileSync(pidFile, String(pid));
      fs.writeFileSync(instanceFile, JSON.stringify({ port, launchMode: 'daemon' }, null, 2));

      const instances = await discoverRunningInstances({
        fetchImpl: async () => createMockJsonResponse(null, false),
        getOpenchamberProcessState: () => 'mismatched',
      });

      expect(instances).toEqual([]);
      expect(fs.existsSync(pidFile)).toBe(false);
      expect(fs.existsSync(instanceFile)).toBe(false);
    });
  });

  it('preserves matched pid and instance files when the recorded port probe is inconclusive', async () => {
    await withTempOpenChamberDataDir(async () => {
      const port = 45126;
      const pid = 12347;
      const pidFile = await getPidFilePath(port);
      const instanceFile = await getInstanceFilePath(port);
      fs.writeFileSync(pidFile, String(pid));
      fs.writeFileSync(instanceFile, JSON.stringify({ port, launchMode: 'daemon' }, null, 2));

      const instances = await discoverRunningInstances({
        fetchImpl: async () => createMockJsonResponse(null, false),
        getOpenchamberProcessState: () => 'matched',
      });

      expect(instances).toEqual([]);
      expect(fs.existsSync(pidFile)).toBe(true);
      expect(fs.existsSync(instanceFile)).toBe(true);
    });
  });

  it('preserves unknown-identity pid and instance files when the recorded port probe is inconclusive', async () => {
    await withTempOpenChamberDataDir(async () => {
      const port = 45129;
      const pid = 12350;
      const pidFile = await getPidFilePath(port);
      const instanceFile = await getInstanceFilePath(port);
      fs.writeFileSync(pidFile, String(pid));
      fs.writeFileSync(instanceFile, JSON.stringify({ port, launchMode: 'daemon' }, null, 2));

      const instances = await discoverRunningInstances({
        fetchImpl: async () => createMockJsonResponse(null, false),
        getOpenchamberProcessState: () => 'unknown',
      });

      expect(instances).toEqual([]);
      expect(fs.existsSync(pidFile)).toBe(true);
      expect(fs.existsSync(instanceFile)).toBe(true);
    });
  });

  it('uses the live system-info pid instead of a stale OpenChamber-looking pid-file pid', async () => {
    await withTempOpenChamberDataDir(async () => {
      const port = 45127;
      const stalePid = 12348;
      const livePid = 54321;
      const pidFile = await getPidFilePath(port);
      const instanceFile = await getInstanceFilePath(port);
      fs.writeFileSync(pidFile, String(stalePid));
      fs.writeFileSync(instanceFile, JSON.stringify({ port, launchMode: 'daemon' }, null, 2));

      const instances = await discoverRunningInstances({
        fetchImpl: async () => createMockJsonResponse({ runtime: 'web', pid: livePid }),
        getOpenchamberProcessState: () => 'matched',
      });

      expect(instances).toEqual([
        expect.objectContaining({ port, pid: livePid, runtime: 'web', source: 'registry+probe' }),
      ]);
    });
  });

  it('uses the explicit host when probing a pid-file entry without a stored host', async () => {
    await withTempOpenChamberDataDir(async () => {
      const port = 45128;
      const pid = 12349;
      const host = '192.0.2.10';
      const urls = [];
      fs.writeFileSync(await getPidFilePath(port), String(pid));
      fs.writeFileSync(await getInstanceFilePath(port), JSON.stringify({ port, launchMode: 'daemon' }, null, 2));

      const instances = await discoverLifecycleInstances(
        { explicitPort: true, port, host },
        {
          fetchImpl: async (url) => {
            urls.push(String(url));
            return createMockJsonResponse({ runtime: 'web', pid });
          },
          getOpenchamberProcessState: () => 'matched',
        },
      );

      expect(instances).toEqual([
        expect.objectContaining({ port, pid, runtime: 'web', source: 'registry+probe' }),
      ]);
      expect(new URL(urls[0]).hostname).toBe(host);
    });
  });

  it('tries loopback before treating an explicit-host pid-file probe as inconclusive', async () => {
    await withTempOpenChamberDataDir(async () => {
      const port = 45130;
      const pid = 12351;
      const host = '192.0.2.11';
      const urls = [];
      fs.writeFileSync(await getPidFilePath(port), String(pid));
      fs.writeFileSync(await getInstanceFilePath(port), JSON.stringify({ port, launchMode: 'daemon' }, null, 2));

      const instances = await discoverLifecycleInstances(
        { explicitPort: true, port, host },
        {
          fetchImpl: async (url) => {
            urls.push(String(url));
            return new URL(String(url)).hostname === '127.0.0.1'
              ? createMockJsonResponse({ runtime: 'web', pid })
              : createMockJsonResponse(null, false);
          },
          getOpenchamberProcessState: () => 'matched',
        },
      );

      expect(urls.map((url) => new URL(url).hostname)).toContain(host);
      expect(urls.map((url) => new URL(url).hostname)).toContain('127.0.0.1');
      expect(instances).toEqual([
        expect.objectContaining({ port, pid, runtime: 'web', source: 'registry+probe' }),
      ]);
    });
  });

  it('does not accept a fallback loopback probe with a different pid for a concrete host registry', async () => {
    await withTempOpenChamberDataDir(async () => {
      const port = 45131;
      const pid = 12352;
      const otherPid = 54322;
      const host = '192.0.2.12';
      const pidFile = await getPidFilePath(port);
      const instanceFile = await getInstanceFilePath(port);
      fs.writeFileSync(pidFile, String(pid));
      fs.writeFileSync(instanceFile, JSON.stringify({ port, host, launchMode: 'daemon' }, null, 2));

      const instances = await discoverLifecycleInstances(
        { explicitPort: true, port, host },
        {
          fetchImpl: async (url) => {
            return new URL(String(url)).hostname === '127.0.0.1'
              ? createMockJsonResponse({ runtime: 'web', pid: otherPid })
              : createMockJsonResponse(null, false);
          },
          getOpenchamberProcessState: () => 'matched',
        },
      );

      expect(instances).toEqual([]);
      expect(fs.existsSync(pidFile)).toBe(true);
      expect(fs.existsSync(instanceFile)).toBe(true);
    });
  });

  it('discovers an explicit live OpenChamber port without a pid-file registry entry', async () => {
    await withTempOpenChamberDataDir(async () => {
      const port = 45125;
      const instances = await discoverLifecycleInstances(
        { explicitPort: true, port },
        { fetchImpl: async () => createMockJsonResponse({ runtime: 'web', pid: null }) },
      );

      expect(instances).toEqual([
        expect.objectContaining({ port, pid: null, runtime: 'web', source: 'probe' }),
      ]);
    });
  });

  it('cleans a matched pid-file entry without stopping it when the recorded port is free', async () => {
    await withTempOpenChamberDataDir(async () => {
      const port = await allocateLoopbackPort();
      const child = spawnOpenChamberLikeIdleProcess();
      const pidFile = await getPidFilePath(port);
      const instanceFile = await getInstanceFilePath(port);
      try {
        await new Promise((resolve) => setTimeout(resolve, 150));
        fs.writeFileSync(pidFile, String(child.pid));
        fs.writeFileSync(instanceFile, JSON.stringify({ port, host: '127.0.0.1', launchMode: 'daemon' }, null, 2));

        const instance = await discoverUnconfirmedRegistryInstanceOnPort(port, { host: '127.0.0.1' });

        expect(instance).toBeNull();
        expect(fs.existsSync(pidFile)).toBe(false);
        expect(fs.existsSync(instanceFile)).toBe(false);
        expect(child.exitCode).toBeNull();
      } finally {
        child.kill('SIGKILL');
      }
    });
  });
});

describe('lifecycle commands with unmanaged explicit ports', () => {
  it('serve refuses to start on a live OpenChamber port without requiring pid files', async () => {
    await withTempOpenChamberDataDir(async () => {
      const server = await startMockOpenChamberServer();
      try {
        await expect(commands.serve({ explicitPort: true, port: server.port, quiet: true })).rejects.toThrow(
          /already running on port/
        );
      } finally {
        await server.close();
      }
    });
  });

  it('status --port reports a live unmanaged server when the registry is empty', async () => {
    await withTempOpenChamberDataDir(async () => {
      const server = await startMockOpenChamberServer();
      try {
        const output = await captureStdout(() => commands.status({ explicitPort: true, port: server.port, json: true }));
        const payload = JSON.parse(output);
        expect(payload.state).toBe('running');
        expect(payload.runningCount).toBe(1);
        expect(payload.instances).toEqual([
          expect.objectContaining({ runtime: 'unmanaged', port: server.port, pid: null }),
        ]);
      } finally {
        await server.close();
      }
    });
  });

  it('stop --port reaches unmanaged shutdown when the registry is empty', async () => {
    await withTempOpenChamberDataDir(async () => {
      const server = await startMockOpenChamberServer();
      try {
        await commands.stop({ explicitPort: true, port: server.port, quiet: true, suppressQuietOutput: true });
        expect(server.shutdownRequested).toBe(true);
      } finally {
        await server.close();
      }
    });
  });

  it('stop --port can recover a matched pid-file instance whose HTTP endpoint is unresponsive', async () => {
    await withTempOpenChamberDataDir(async () => {
      const port = await allocateLoopbackPort();
      const child = spawnOpenChamberLikeHungServer(port);
      const pidFile = await getPidFilePath(port);
      const instanceFile = await getInstanceFilePath(port);
      try {
        expect(await waitForTcpPort(port)).toBe(true);
        fs.writeFileSync(pidFile, String(child.pid));
        fs.writeFileSync(instanceFile, JSON.stringify({ port, host: '127.0.0.1', launchMode: 'daemon' }, null, 2));

        await commands.stop({ explicitPort: true, port, host: '127.0.0.1', quiet: true, suppressQuietOutput: true });

        expect(fs.existsSync(pidFile)).toBe(false);
        expect(fs.existsSync(instanceFile)).toBe(false);
        expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      } finally {
        child.kill('SIGKILL');
      }
    });
  });

  it('plain stop ignores a stale CLI registry entry that resolves to desktop runtime', async () => {
    await withTempOpenChamberDataDir(async () => {
      const server = await startMockOpenChamberServer({ runtime: 'desktop' });
      const child = spawn('sleep', ['30'], { stdio: 'ignore' });
      const pidFile = await getPidFilePath(server.port);
      const instanceFile = await getInstanceFilePath(server.port);
      try {
        await new Promise((resolve) => setTimeout(resolve, 150));
        fs.writeFileSync(pidFile, String(child.pid));
        fs.writeFileSync(instanceFile, JSON.stringify({ port: server.port, launchMode: 'daemon' }, null, 2));

        await commands.stop({ quiet: true, suppressQuietOutput: true });

        expect(server.shutdownRequested).toBe(false);
        expect(fs.existsSync(pidFile)).toBe(false);
        expect(fs.existsSync(instanceFile)).toBe(false);
      } finally {
        child.kill('SIGKILL');
        await server.close();
      }
    });
  });

  it('restart --port restarts a live unmanaged server through the shared explicit-port discovery path', async () => {
    await withTempOpenChamberDataDir(async () => {
      const server = await startMockOpenChamberServer();
      const calls = [];
      const host = '127.0.0.1';
      try {
        const output = await captureStdout(() => commands.restart.call({
          stop: async (options) => {
            calls.push(['stop', options.port, options.host]);
          },
          serve: async (options) => {
            calls.push(['serve', options.port, options.host]);
            return options.port;
          },
        }, { explicitPort: true, port: server.port, host, json: true }));

        const payload = JSON.parse(output);
        expect(calls).toEqual([
          ['stop', server.port, host],
          ['serve', server.port, host],
        ]);
        expect(payload.restartedCount).toBe(1);
        expect(payload.results).toEqual([
          expect.objectContaining({ fromPort: server.port, toPort: server.port, ok: true }),
        ]);
      } finally {
        await server.close();
      }
    });
  });
});


describe('lifecycle mode policy parity', () => {
  it('status --json and --quiet share the same discovery outcome for an unmanaged port', async () => {
    await withTempOpenChamberDataDir(async () => {
      const server = await startMockOpenChamberServer({ pid: 4242 });
      try {
        const jsonOutput = await captureStdout(() => commands.status({
          explicitPort: true,
          port: server.port,
          json: true,
        }));
        const quietOutput = await captureStdout(() => commands.status({
          explicitPort: true,
          port: server.port,
          quiet: true,
        }));

        const payload = JSON.parse(jsonOutput);
        expect(payload.state).toBe('running');
        expect(payload.instances[0]).toEqual(expect.objectContaining({
          runtime: 'unmanaged',
          port: server.port,
          pid: 4242,
        }));
        expect(quietOutput).toContain(`port ${server.port}`);
      } finally {
        await server.close();
      }
    });
  });

  it('stop --json refuses desktop-managed ports without prompting', async () => {
    await withTempOpenChamberDataDir(async () => {
      const server = await startMockOpenChamberServer({ runtime: 'desktop' });
      try {
        const output = await captureStdout(() => commands.stop({
          explicitPort: true,
          port: server.port,
          json: true,
        }));
        const payload = JSON.parse(output);
        expect(payload.stoppedCount).toBe(0);
        expect(payload.results).toEqual([
          expect.objectContaining({ port: server.port, runtime: 'desktop', stopped: false, reason: 'desktop-managed' }),
        ]);
        expect(server.shutdownRequested).toBe(false);
      } finally {
        await server.close();
      }
    });
  });
});

describe('control command target resolution', () => {
  it('uses an explicit control port without requiring CLI lifecycle registration', async () => {
    const target = await resolveControlTargetInstance({
      options: { explicitPort: true, port: 5190 },
    });

    expect(target).toEqual({
      port: 5190,
      runtime: 'explicit',
      source: 'explicit-port',
    });
  });

  it('prefers the healthy Desktop port persisted in shared settings', async () => {
    await withTempOpenChamberDataDir(async (dataDir) => {
      const server = await startMockOpenChamberServer({ runtime: 'desktop' });
      try {
        fs.writeFileSync(
          path.join(dataDir, 'settings.json'),
          JSON.stringify({ desktopLocalPort: server.port }),
          'utf8',
        );

        const target = await resolveControlTargetInstance({ options: {} });

        expect(target).toEqual(expect.objectContaining({
          port: server.port,
          runtime: 'desktop',
          source: 'desktop-settings+probe',
        }));
      } finally {
        await server.close();
      }
    });
  });
});

describe('control command CLI integration', () => {
  it('discovers Desktop settings and authenticates an actual projects request', async () => {
    await withTempOpenChamberDataDir(async (dataDir) => {
      const token = 'fixture-desktop-token';
      let receivedAuthorization = null;
      let receivedPayload = null;
      const server = createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/api/system/info') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ runtime: 'desktop', pid: process.pid }));
          return;
        }

        if (req.method === 'POST' && req.url === '/api/openchamber/control') {
          receivedAuthorization = req.headers.authorization || null;
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            receivedPayload = JSON.parse(body);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              projects: [{ id: 'fixture', label: 'Fixture project', path: '/fixture' }],
            }));
          });
          return;
        }

        res.writeHead(404);
        res.end();
      });

      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      fs.writeFileSync(
        path.join(dataDir, 'settings.json'),
        JSON.stringify({
          desktopLocalPort: port,
          desktopLocalClientToken: token,
        }),
        'utf8',
      );

      try {
        const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
        const child = spawn(process.execPath, [cliPath, 'projects', 'list', '--json'], {
          env: {
            ...process.env,
            OPENCHAMBER_DATA_DIR: dataDir,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        const exitCode = await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        });

        expect(exitCode, stderr).toBe(0);
        expect(JSON.parse(stdout)).toEqual({
          status: 'ok',
          projects: [{ id: 'fixture', label: 'Fixture project', path: '/fixture' }],
        });
        expect(receivedAuthorization).toBe(`Bearer ${token}`);
        expect(receivedPayload).toEqual({
          action: 'projects.list',
          input: { serverId: 'default' },
        });
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
