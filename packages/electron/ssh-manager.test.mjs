import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';

import { ElectronSshManager } from './ssh-manager.mjs';

const servers = [];
const tempDirs = [];

const createChild = () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = () => {
    child.exitCode = 0;
    return true;
  };
  return child;
};

const listen = async (server) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return `http://127.0.0.1:${address.port}`;
};

const readBody = async (req) => {
  let body = '';
  for await (const chunk of req) body += chunk.toString();
  return body;
};

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await new Promise((resolve) => server.close(() => resolve()));
  }
  while (tempDirs.length > 0) {
    await fsp.rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('ElectronSshManager', () => {
  for (const scenario of ['explicit XDG with spaces', 'unset XDG', 'missing XDG with home fallback']) {
    test.skipIf(process.platform === 'win32')(`executes remote discovery, install and launch with ${scenario}`, async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber ssh paths-'));
      tempDirs.push(home);
      const xdg = path.join(home, 'cache directory');
      const cache = scenario === 'unset XDG' ? path.join(home, '.cache') : xdg;
      const bin = scenario === 'missing XDG with home fallback'
        ? path.join(home, '.bun', 'bin')
        : path.join(cache, '.bun', 'bin');
      fs.mkdirSync(bin, { recursive: true });
      const executable = (file, script) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
      };
      executable(path.join(bin, 'bun'), 'printf "%s\\n" "$@" > "$HOME/install-args"');
      executable(path.join(bin, 'opencode'), 'printf "1.2.3\\n"');
      executable(path.join(bin, 'openchamber'), `
if [ "$1" = "--version" ]; then printf '1.2.3\\n'; exit 0; fi
printf '%s' "$PATH" > "$HOME/launch-path"
printf '%s' "$OPENCODE_BINARY" > "$HOME/launch-opencode"
printf '4321\\n'`);
      // An earlier candidate with a different version must not win discovery.
      executable(path.join(home, '.openchamber', 'npm-global', 'bin', 'openchamber'), 'printf "0.9.0\\n"');
      const tools = path.join(home, 'tools');
      executable(path.join(tools, 'npm'), 'exit 88');
      const env = { HOME: home, PATH: `${tools}:/usr/bin:/bin` };
      if (scenario !== 'unset XDG') env.XDG_CACHE_HOME = xdg;
      const manager = new ElectronSshManager({
        settingsFilePath: path.join(home, 'settings.json'),
        appVersion: '1.2.3',
        emit: () => undefined,
      });
      manager.runRemoteCommand = async (_parsed, _controlPath, script) =>
        execFileSync('/bin/sh', ['-c', script], { env, encoding: 'utf8', timeout: 5000 });
      manager.remoteServerRunning = async () => true;
      const parsed = { destination: 'user@example.test', args: [] };

      await manager.installOpenChamberManaged(parsed, '/unused.sock', '1.2.3', 'auto');
      expect(fs.readFileSync(path.join(home, 'install-args'), 'utf8')).toBe('add\n-g\n@openchamber/web@1.2.3\n');
      // The fork launches the server detached and reports the requested port,
      // so pin it where upstream's foreground serve printed its own port.
      const result = await manager.ensureRemoteServer({
        id: 'ssh-paths', auth: {}, remoteOpenchamber: { mode: 'managed', installMethod: 'auto', preferredPort: 4321 },
      }, parsed, '/unused.sock');
      // The detached launch may still be writing its environment probes.
      for (let i = 0; i < 100; i++) {
        if (fs.existsSync(path.join(home, 'launch-opencode'))
          && fs.readFileSync(path.join(home, 'launch-opencode'), 'utf8').length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(result.remoteBinPath).toBe(path.join(bin, 'openchamber'));
      expect(result.remotePort).toBe(4321);
      expect(fs.readFileSync(path.join(home, 'launch-opencode'), 'utf8')).toBe(path.join(bin, 'opencode'));
      const launchPath = fs.readFileSync(path.join(home, 'launch-path'), 'utf8').split(':');
      expect(launchPath).toContain(path.join(cache, '.bun', 'bin'));
      expect(launchPath).toContain(path.join(home, '.bun', 'bin'));
    });
  }

  test('runs Windows SSH commands without ControlMaster and hides the process window', async () => {
    const calls = [];
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(os.tmpdir(), 'unused-settings.json'),
      appVersion: '0.0.0-test',
      emit: () => undefined,
      platform: 'win32',
      spawn: (command, args, options) => {
        calls.push({ command, args, options });
        const child = createChild();
        queueMicrotask(() => {
          child.stdout.end('Linux\n');
          child.exitCode = 0;
          child.emit('close', 0);
        });
        return child;
      },
    });
    const parsed = { destination: 'user@example.test', args: [] };

    await expect(manager.runRemoteCommand(parsed, 'C:\\Temp\\unused.sock', 'uname -s')).resolves.toBe('Linux\n');

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('ssh');
    expect(calls[0].options.windowsHide).toBe(true);
    expect(calls[0].args).toContain('ControlMaster=no');
    expect(calls[0].args).toContain('ControlPath=none');
    expect(calls[0].args).toContain('StrictHostKeyChecking=accept-new');
    expect(calls[0].args).not.toContain('ControlPath=C:\\Temp\\unused.sock');
  });

  test('creates a PowerShell-backed askpass helper on Windows', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-ssh-askpass-test-'));
    tempDirs.push(tempDir);
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(tempDir, 'settings.json'),
      appVersion: '0.0.0-test',
      emit: () => undefined,
      platform: 'win32',
    });

    const result = await manager.writeAskpassFiles(tempDir);

    expect(path.basename(result.askpassPath)).toBe('askpass.cmd');
    expect(result.cleanupPaths.map((filePath) => path.basename(filePath))).toEqual(['askpass.cmd', 'askpass.ps1']);
    expect(await fsp.readFile(path.join(tempDir, 'askpass.cmd'), 'utf8')).toContain('WindowsPowerShell');
    expect(await fsp.readFile(path.join(tempDir, 'askpass.ps1'), 'utf8')).toContain('OPENCHAMBER_SSH_ASKPASS_VALUE');
  });

  test('runs each Windows port forward as an independent hidden SSH process', async () => {
    const calls = [];
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(os.tmpdir(), 'unused-settings.json'),
      appVersion: '0.0.0-test',
      emit: () => undefined,
      platform: 'win32',
      spawn: (command, args, options) => {
        calls.push({ command, args, options });
        return createChild();
      },
    });
    const parsed = { destination: 'user@example.test', args: [] };
    manager.sshAuth.set(parsed, {
      askpassPath: 'C:\\OpenChamber\\askpass.cmd',
      sshPassword: 'secret-value',
      children: new Set(),
    });

    await manager.spawnMainForward(parsed, 'C:\\Temp\\unused.sock', '127.0.0.1', 3000, 4000);
    await manager.spawnExtraForward(parsed, 'C:\\Temp\\unused.sock', {
      id: 'dynamic-1',
      type: 'dynamic',
      localHost: '127.0.0.1',
      localPort: 5000,
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.command).toBe('ssh');
      expect(call.args).toContain('ControlPath=none');
      expect(call.args).toContain('-N');
      expect(call.options.windowsHide).toBe(true);
      expect(call.options.env.SSH_ASKPASS).toBe('C:\\OpenChamber\\askpass.cmd');
      expect(call.options.env.OPENCHAMBER_SSH_ASKPASS_VALUE).toBe('secret-value');
    }
    expect(calls[0].args).toContain('-L');
    expect(calls[1].args).toContain('-D');
  });

  // The fake exits like `ssh -O forward` does: stderr first, then close.
  const createControlMasterManager = ({ code, stderr = '' }) => {
    const calls = [];
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(os.tmpdir(), 'unused-settings.json'),
      appVersion: '0.0.0-test',
      emit: () => undefined,
      platform: 'darwin',
      spawn: (command, args, options) => {
        calls.push({ command, args, options });
        const child = createChild();
        setImmediate(() => {
          if (stderr) child.stderr.write(stderr);
          child.exitCode = code;
          child.emit('close', code);
        });
        return child;
      },
    });
    return { calls, manager };
  };

  test('hands the main forward to the ControlMaster instead of keeping an SSH client running', async () => {
    const { calls, manager } = createControlMasterManager({ code: 0 });
    const parsed = { destination: 'user@example.test', args: [] };

    const child = await manager.spawnMainForward(parsed, '/tmp/control.sock', '127.0.0.1', 3000, 4000);

    expect(child).toBeNull();
    expect(calls).toHaveLength(1);
    const { args, options } = calls[0];
    expect(args).toContain('ControlPath=/tmp/control.sock');
    expect(args).not.toContain('ControlPath=none');
    // `-N -L` through a mux opens a remote login shell and exits with its
    // status, which is how an exit 1 was mistaken for a dead tunnel (#4132).
    expect(args).not.toContain('-N');
    expect(args.slice(args.indexOf('-O'), args.indexOf('-O') + 4)).toEqual(['-O', 'forward', '-L', '127.0.0.1:3000:127.0.0.1:4000']);
    expect(options.windowsHide).toBeUndefined();
  });

  test("fails the connection with the master's reason when it cannot take the main forward", async () => {
    const { manager } = createControlMasterManager({
      code: 255,
      stderr: 'mux_client_forward: forwarding request failed: Port forwarding failed\nmuxclient: master forward request failed\n',
    });
    const parsed = { destination: 'user@example.test', args: [] };

    await expect(manager.spawnMainForward(parsed, '/tmp/control.sock', '127.0.0.1', 3000, 4000))
      .rejects.toThrow('muxclient: master forward request failed');
  });

  test('keeps a master-held forward while its port answers and drops it once the master is gone', async () => {
    // Every ssh call here is `-O check`, answered as a dead master.
    const { manager } = createControlMasterManager({ code: 255 });
    const statuses = [];
    manager.emit = (_event, status) => statuses.push(status);
    manager.connect = async () => undefined;
    const liveServer = http.createServer();
    const livePort = Number(new URL(await listen(liveServer)).port);
    const deadServer = http.createServer();
    const deadPort = Number(new URL(await listen(deadServer)).port);
    await new Promise((resolve) => deadServer.close(resolve));
    servers.splice(servers.indexOf(deadServer), 1);
    for (const [id, localPort] of [['ssh-live', livePort], ['ssh-dead', deadPort]]) {
      manager.sessions.set(id, {
        instance: { id, remoteOpenchamber: { mode: 'external' } },
        parsed: { destination: 'user@example.test', args: [] },
        controlPath: '/unused.sock',
        askpassCleanupPaths: [],
        localPort,
        master: null,
        mainForward: null,
        extraForwards: [],
      });
      manager.spawnMonitor(id);
    }

    await new Promise((resolve) => setTimeout(resolve, 2600));
    for (const id of ['ssh-live', 'ssh-dead']) {
      clearTimeout(manager.monitorTimers.get(id));
    }

    expect(manager.sessions.has('ssh-live')).toBe(true);
    expect(statuses.filter((status) => status.id === 'ssh-live')).toEqual([]);
    expect(statuses.find((status) => status.id === 'ssh-dead' && status.phase === 'degraded')?.detail)
      .toBe('SSH ControlMaster is not reachable. Reconnecting');
  });

  test('stops in-flight commands and forwards when disconnecting Windows SSH', async () => {
    const killedChildren = [];
    const spawnedChildren = [];
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(os.tmpdir(), 'unused-settings.json'),
      appVersion: '0.0.0-test',
      emit: () => undefined,
      platform: 'win32',
      spawn: () => {
        const child = createChild();
        child.kill = () => {
          killedChildren.push(child);
          child.exitCode = 1;
          child.emit('close', 1);
          return true;
        };
        spawnedChildren.push(child);
        return child;
      },
    });
    const parsed = { destination: 'user@example.test', args: [] };
    const mainForward = createChild();
    const extraForward = createChild();
    for (const child of [mainForward, extraForward]) {
      child.kill = () => {
        killedChildren.push(child);
        child.exitCode = 0;
        return true;
      };
    }
    manager.sshAuth.set(parsed, {
      askpassPath: 'C:\\OpenChamber\\askpass.cmd',
      sshPassword: null,
      children: new Set(),
    });
    manager.sessions.set('ssh-1', {
      instance: { remoteOpenchamber: { mode: 'external', keepRunning: true } },
      parsed,
      controlPath: 'C:\\Temp\\unused.sock',
      askpassCleanupPaths: [],
      startedByUs: false,
      remotePort: null,
      master: null,
      mainForward,
      extraForwards: [{ id: 'dynamic-1', child: extraForward }],
    });

    let commandError = null;
    const command = manager.runRemoteCommand(parsed, 'C:\\Temp\\unused.sock', 'uname -s').catch((error) => {
      commandError = error;
    });
    await manager.disconnectInternal('ssh-1', false);

    await command;
    expect(commandError?.message).toBe('Remote command failed');
    expect(spawnedChildren).toHaveLength(1);
    expect(new Set(killedChildren)).toEqual(new Set([spawnedChildren[0], mainForward, extraForward]));
    expect(manager.sessions.has('ssh-1')).toBe(false);
  });

  test('reports bounded, sanitized, and redacted SSH master stderr when startup fails', async () => {
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(os.tmpdir(), 'unused-settings.json'),
      appVersion: '0.0.0-test',
      emit: () => undefined,
      spawn: () => {
        const child = createChild();
        queueMicrotask(() => {
          child.exitCode = 1;
          child.emit('close', 1);
        });
        return child;
      },
    });
    const parsed = { destination: 'user@example.test', args: [] };
    const master = createChild();
    manager.sshAuth.set(parsed, {
      askpassPath: '/tmp/askpass.sh',
      sshPassword: 'secret-value',
      children: new Set(),
    });
    manager.trackSshProcess(master, parsed);
    master.stderr.write(`muxclient socket failed: secret-value\u0007${'x'.repeat(3000)}`);
    master.exitCode = 255;

    try {
      await manager.waitForMasterReady(parsed, '/tmp/control.sock', 1, master);
      throw new Error('Expected SSH master startup to fail');
    } catch (error) {
      expect(error.message).toStartWith('muxclient socket failed: [redacted]');
      expect(error.message).not.toContain('secret-value');
      expect(error.message).not.toContain('\u0007');
      expect(error.message.length).toBeLessThanOrEqual(2000);
    }
  });

  test('stores a client token for forwarded OpenChamber hosts when UI password is configured', async () => {
    let loginPayload = null;
    const server = http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/auth/session') {
        loginPayload = JSON.parse(await readBody(req));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authenticated: true, clientToken: 'ssh-client-token' }));
        return;
      }
      res.writeHead(404).end();
    });
    const localUrl = await listen(server);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-ssh-manager-test-'));
    tempDirs.push(tempDir);
    const settingsFilePath = path.join(tempDir, 'settings.json');
    const manager = new ElectronSshManager({
      settingsFilePath,
      appVersion: '0.0.0-test',
      emit: () => undefined,
    });

    const token = await manager.issueClientToken(localUrl, 'ui-secret');
    await manager.updateHostRuntime('ssh-1', 'SSH Host', localUrl, token);

    const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
    expect(loginPayload).toMatchObject({
      password: 'ui-secret',
      trustDevice: true,
      issueClientToken: true,
    });
    expect(settings.desktopHosts).toEqual([{ id: 'ssh-1', label: 'SSH Host', url: localUrl, apiUrl: localUrl, clientToken: 'ssh-client-token' }]);
  });

  test('creates a deduplicated client token when remote UI password is disabled', async () => {
    let clientPayload = null;
    const server = http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/api/client-auth/clients') {
        clientPayload = JSON.parse(await readBody(req));
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: 'no-password-client-token' }));
        return;
      }
      res.writeHead(404).end();
    });
    const localUrl = await listen(server);
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(os.tmpdir(), 'unused-settings.json'),
      appVersion: '0.0.0-test',
      emit: () => undefined,
    });

    const token = await manager.issueClientToken(localUrl, '', 'dev3');

    expect(token).toBe('no-password-client-token');
    expect(clientPayload).toEqual({
      label: 'OpenChamber Desktop SSH',
      clientKind: 'desktop-ssh',
      dedupeKey: 'desktop-ssh:dev3',
    });
  });

  test('installs OpenChamber into a home-owned npm prefix', async () => {
    const commands = [];
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(os.tmpdir(), 'unused-settings.json'),
      appVersion: '1.2.3',
      emit: () => undefined,
    });
    manager.resolveRemoteTool = async (_parsed, _controlPath, name) => (name === 'npm' ? '/usr/bin/npm' : null);
    manager.runRemoteCommand = async (_parsed, _controlPath, script) => {
      commands.push(script);
      return '';
    };

    await manager.installOpenChamberManaged(
      { destination: 'user@example.test', args: [] },
      '/tmp/control.sock',
      '1.2.3',
      { installMethod: 'auto' },
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('--prefix "$HOME/.openchamber/npm-global"');
    expect(commands[0]).not.toMatch(/npm install -g @openchamber/);
  });

  test('lists every remote OpenChamber binary with its reported version', async () => {
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(os.tmpdir(), 'unused-settings.json'),
      appVersion: '1.2.3',
      emit: () => undefined,
    });
    manager.runRemoteCommand = async () => [
      '/home/pi/.openchamber/npm-global/bin/openchamber\t1.18.2-sscity',
      '/usr/bin/openchamber\t0.9.0',
      '',
    ].join('\n');

    const candidates = await manager.remoteOpenChamberCandidates(
      { destination: 'user@example.test', args: [] },
      '/tmp/control.sock',
    );

    expect(candidates).toEqual([
      { binPath: '/home/pi/.openchamber/npm-global/bin/openchamber', version: '1.18.2-sscity' },
      { binPath: '/usr/bin/openchamber', version: '0.9.0' },
    ]);
  });

  test('starts and stops the resolved OpenChamber binary', async () => {
    const commands = [];
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(os.tmpdir(), 'unused-settings.json'),
      appVersion: '1.2.3',
      emit: () => undefined,
    });
    manager.resolveRemoteTool = async () => '/home/pi/.opencode/bin/opencode';
    manager.runRemoteCommand = async (_parsed, _controlPath, script) => {
      commands.push(script);
      return '4321\n';
    };
    const parsed = { destination: 'user@example.test', args: [] };
    const binPath = '/home/pi/.openchamber/npm-global/bin/openchamber';

    const port = await manager.startRemoteServerManaged(
      parsed,
      '/tmp/control.sock',
      { id: 'ssh-1', auth: {}, remoteOpenchamber: { mode: 'managed' } },
      4321,
      binPath,
    );
    await manager.stopRemoteServerBestEffort(parsed, '/tmp/control.sock', 4321, binPath);

    expect(port).toBe(4321);
    expect(commands[0]).toContain(`nohup '${binPath}' serve --foreground`);
    expect(commands[0]).toContain("OPENCODE_BINARY='/home/pi/.opencode/bin/opencode'");
    expect(commands[0]).toContain('$HOME/.opencode/bin:');
    expect(commands[0]).toContain('managed-4321.log');
    expect(commands[0]).toContain("printf '%s\\n' 4321");
    expect(commands[1]).toBe(`'${binPath}' stop --port 4321`);
  });

  test('waits for a newly started remote server to become healthy', async () => {
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(os.tmpdir(), 'unused-settings.json'),
      appVersion: '1.2.3',
      emit: () => undefined,
    });
    let attempts = 0;
    manager.remoteServerRunning = async () => {
      attempts += 1;
      return attempts >= 3;
    };

    await expect(manager.waitForRemoteServerRunning(
      { destination: 'user@example.test', args: [] },
      '/tmp/control.sock',
      4321,
      null,
      { timeoutMs: 100, initialPollMs: 1 },
    )).resolves.toBe(true);
    expect(attempts).toBe(3);
  });

  test('uses the latest persisted keepRunning policy when disconnecting', async () => {
    const settingsFilePath = path.join(os.tmpdir(), `openchamber-ssh-policy-${Date.now()}.json`);
    await fsp.writeFile(settingsFilePath, JSON.stringify({
      desktopSshInstances: [{
        id: 'ssh-policy',
        sshCommand: 'ssh user@example.test',
        connectionTimeoutSec: 60,
        remoteOpenchamber: {
          mode: 'managed',
          keepRunning: false,
          bindHost: '127.0.0.1',
          installMethod: 'auto',
          uploadBundleOverSsh: false,
        },
        localForward: { bindHost: '127.0.0.1' },
        auth: {},
        portForwards: [],
      }],
    }));
    const manager = new ElectronSshManager({
      settingsFilePath,
      appVersion: '1.2.3',
      emit: () => undefined,
    });
    const stopped = [];
    manager.stopRemoteServerBestEffort = async (...args) => { stopped.push(args); };
    manager.stopControlMasterBestEffort = async () => undefined;
    manager.sessions.set('ssh-policy', {
      instance: {
        id: 'ssh-policy',
        remoteOpenchamber: { mode: 'managed', keepRunning: true },
      },
      parsed: { destination: 'user@example.test', args: [] },
      controlPath: '/tmp/control.sock',
      remotePort: 4321,
      remoteBinPath: '/bin/openchamber',
      startedByUs: true,
      ownsRemoteServer: true,
      extraForwards: [],
      askpassCleanupPaths: [],
    });

    await manager.disconnectInternal('ssh-policy', true);
    expect(stopped).toHaveLength(1);
    expect(stopped[0]?.slice(2)).toEqual([4321, '/bin/openchamber']);
    await fsp.rm(settingsFilePath, { force: true });
  });

  test('requires a UI password before publishing the remote server', async () => {
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(os.tmpdir(), 'unused-settings.json'),
      appVersion: '1.2.3',
      emit: () => undefined,
    });
    manager.resolveRemoteTool = async () => '/home/pi/.opencode/bin/opencode';
    let started = '';
    manager.runRemoteCommand = async (_parsed, _controlPath, script) => {
      started = script;
      return '4321\n';
    };
    const parsed = { destination: 'user@example.test', args: [] };
    const exposed = {
      id: 'ssh-1',
      auth: {},
      remoteOpenchamber: { mode: 'managed', bindHost: '0.0.0.0' },
    };

    await expect(manager.startRemoteServerManaged(parsed, '/tmp/control.sock', exposed, 4321, '/bin/openchamber'))
      .rejects.toThrow(/requires a UI password/);

    await manager.startRemoteServerManaged(
      parsed,
      '/tmp/control.sock',
      {
        ...exposed,
        auth: { openchamberPassword: { enabled: true, value: 'remote-secret', store: 'settings' } },
      },
      4321,
      '/bin/openchamber',
    );
    expect(started).toContain('--hostname 0.0.0.0');
    expect(started).toContain('OPENCHAMBER_UI_PASSWORD=');
  });

  test('refuses to rewrite the shared settings file when it is not valid JSON', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-ssh-manager-test-'));
    tempDirs.push(tempDir);
    const settingsFilePath = path.join(tempDir, 'settings.json');
    fs.writeFileSync(settingsFilePath, '{corrupted');
    const manager = new ElectronSshManager({
      settingsFilePath,
      appVersion: '0.0.0-test',
      emit: () => undefined,
    });

    await expect(manager.setInstances({ instances: [] })).rejects.toThrow(/not valid JSON/);

    // The corrupted file must remain untouched so the rest of the settings stay recoverable.
    expect(fs.readFileSync(settingsFilePath, 'utf8')).toBe('{corrupted');
  });

  test('refuses non-object settings roots (array) without rewriting the file', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-ssh-manager-test-'));
    tempDirs.push(tempDir);
    const settingsFilePath = path.join(tempDir, 'settings.json');
    fs.writeFileSync(settingsFilePath, '[]');
    const manager = new ElectronSshManager({
      settingsFilePath,
      appVersion: '0.0.0-test',
      emit: () => undefined,
    });

    await expect(manager.setInstances({ instances: [] })).rejects.toThrow(/not a JSON object/);
    expect(fs.readFileSync(settingsFilePath, 'utf8')).toBe('[]');
  });

  test('keeps a .prev copy of the previous settings generation on write', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-ssh-manager-test-'));
    tempDirs.push(tempDir);
    const settingsFilePath = path.join(tempDir, 'settings.json');
    fs.writeFileSync(settingsFilePath, JSON.stringify({ existing: true }, null, 2));
    const manager = new ElectronSshManager({
      settingsFilePath,
      appVersion: '0.0.0-test',
      emit: () => undefined,
    });

    await manager.setInstances({ instances: [{ id: 'ssh-1', nickname: 'Host', sshCommand: 'ssh host' }] });

    const prev = JSON.parse(fs.readFileSync(`${settingsFilePath}.prev`, 'utf8'));
    expect(prev.existing).toBe(true);
    const next = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
    expect(next.desktopSshInstances).toHaveLength(1);
    // Unrelated on-disk keys must survive the read-modify-write (wipe regression guard).
    expect(next.existing).toBe(true);
  });

  test.skipIf(process.platform === 'win32')('finds the newest nvm npm that the SSH login shell does not have on PATH', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-ssh-nvm-'));
    const executable = (file, script) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    };
    // Numeric order, not text order: v9 sorts after v24 as text.
    for (const version of ['v9.11.2', 'v24.18.0']) {
      const bin = path.join(home, '.nvm', 'versions', 'node', version, 'bin');
      executable(path.join(bin, 'node'), 'exit 0');
      executable(path.join(bin, 'npm'), `printf '%s' "$PATH" > "$HOME/npm-path"; printf '${version}' > "$HOME/npm-version"`);
    }
    const env = { HOME: home, PATH: '/usr/bin:/bin' };
    const manager = new ElectronSshManager({
      settingsFilePath: path.join(home, 'settings.json'),
      appVersion: '1.2.3',
      emit: () => undefined,
    });
    manager.runRemoteCommand = async (_parsed, _controlPath, script) =>
      execFileSync('/bin/sh', ['-c', script], { env, encoding: 'utf8', timeout: 5000 });

    try {
      await manager.installOpenChamberManaged({ destination: 'user@example.test', args: [] }, '/unused.sock', '1.2.3', 'auto');
      expect(fs.readFileSync(path.join(home, 'npm-version'), 'utf8')).toBe('v24.18.0');
      expect(fs.readFileSync(path.join(home, 'npm-path'), 'utf8').split(':')[0])
        .toBe(path.join(home, '.nvm', 'versions', 'node', 'v24.18.0', 'bin'));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
