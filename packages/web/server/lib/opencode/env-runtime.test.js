import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpenCodeEnvRuntime } from './env-runtime.js';

const originalOpencodeBinary = process.env.OPENCODE_BINARY;
const originalBundledOpencodeBinary = process.env.OPENCHAMBER_BUNDLED_OPENCODE_BINARY;
const originalUseExternalOpencode = process.env.OPENCHAMBER_USE_EXTERNAL_OPENCODE;
const originalPath = process.env.PATH;
const originalUserProfile = process.env.USERPROFILE;
const originalAppData = process.env.APPDATA;
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalProgramFiles = process.env.ProgramFiles;
const originalProgramData = process.env.ProgramData;
const originalComSpec = process.env.ComSpec;
const originalPlatform = process.platform;
const tempDirs = [];
const itIf = (condition) => condition ? it : it.skip;

const createTempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const setPlatform = (platform) => {
  Object.defineProperty(process, 'platform', {
    value: platform,
  });
};

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
  });

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (typeof originalOpencodeBinary === 'string') {
    process.env.OPENCODE_BINARY = originalOpencodeBinary;
  } else {
    delete process.env.OPENCODE_BINARY;
  }

  const restoreEnv = (key, value) => {
    if (typeof value === 'string') process.env[key] = value;
    else delete process.env[key];
  };
  restoreEnv('OPENCHAMBER_BUNDLED_OPENCODE_BINARY', originalBundledOpencodeBinary);
  restoreEnv('OPENCHAMBER_USE_EXTERNAL_OPENCODE', originalUseExternalOpencode);

  restoreEnv('PATH', originalPath);
  restoreEnv('USERPROFILE', originalUserProfile);
  restoreEnv('APPDATA', originalAppData);
  restoreEnv('LOCALAPPDATA', originalLocalAppData);
  restoreEnv('ProgramFiles', originalProgramFiles);
  restoreEnv('ProgramData', originalProgramData);
  restoreEnv('ComSpec', originalComSpec);
});

const createRuntime = (settings, options = {}) => {
  const state = {
    cachedLoginShellEnvSnapshot: null,
    resolvedOpencodeBinary: null,
    resolvedOpencodeBinarySource: null,
    useWslForOpencode: false,
    resolvedWslBinary: null,
    resolvedWslOpencodePath: null,
    resolvedWslDistro: null,
    resolvedNodeBinary: null,
    resolvedBunBinary: null,
    managedOpenCodeShellEnvSnapshot: null,
  };

  const runtime = createOpenCodeEnvRuntime({
    state,
    normalizeDirectoryPath: (value) => value,
    readSettingsFromDiskMigrated: async () => settings,
    spawnSync: options.spawnSync,
  });

  return { runtime, state };
};

describe('OpenCode env runtime', () => {
  it('throws a specific error for a missing configured OpenCode binary in strict mode', async () => {
    const { runtime } = createRuntime({ opencodeBinary: '/missing/opencode' });

    await expect(runtime.applyOpencodeBinaryFromSettings({ strict: true })).rejects.toMatchObject({
      code: 'OPENCODE_BINARY_INVALID',
      message: expect.stringContaining('Configured OpenCode binary not found: /missing/opencode'),
    });
  });

  it('throws a specific error for a configured directory without an executable CLI in strict mode', async () => {
    const dir = createTempDir('openchamber-opencode-dir-');
    const { runtime } = createRuntime({ opencodeBinary: dir });

    await expect(runtime.applyOpencodeBinaryFromSettings({ strict: true })).rejects.toMatchObject({
      code: 'OPENCODE_BINARY_INVALID',
      message: expect.stringContaining('Configured OpenCode binary directory does not contain an executable'),
    });
  });

  it('applies a valid configured executable OpenCode binary', async () => {
    const dir = createTempDir('openchamber-opencode-bin-');
    const binary = path.join(dir, 'opencode');
    fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(binary, 0o755);
    const { runtime, state } = createRuntime({ opencodeBinary: binary });

    await expect(runtime.applyOpencodeBinaryFromSettings({ strict: true })).resolves.toBe(binary);
    expect(process.env.OPENCODE_BINARY).toBe(binary);
    expect(state.resolvedOpencodeBinary).toBe(binary);
    expect(state.resolvedOpencodeBinarySource).toBe('settings');
  });

  it('prefers the packaged OpenCode binary over a configured external binary', async () => {
    const dir = createTempDir('openchamber-opencode-bundled-');
    const bundled = path.join(dir, 'bundled-opencode');
    const configured = path.join(dir, 'configured-opencode');
    fs.writeFileSync(bundled, '#!/bin/sh\nexit 0\n');
    fs.writeFileSync(configured, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(bundled, 0o755);
    fs.chmodSync(configured, 0o755);
    process.env.OPENCHAMBER_BUNDLED_OPENCODE_BINARY = bundled;

    const { runtime, state } = createRuntime({ opencodeBinary: configured });

    await expect(runtime.applyOpencodeBinaryFromSettings({ strict: true })).resolves.toBe(bundled);
    expect(process.env.OPENCODE_BINARY).toBe(bundled);
    expect(state.resolvedOpencodeBinary).toBe(bundled);
    expect(state.resolvedOpencodeBinarySource).toBe('bundled');
  });

  it('recognizes the packaged OpenCode binary by canonical path', () => {
    const dir = createTempDir('openchamber-opencode-bundled-canonical-');
    const bundled = path.join(dir, 'bundled-opencode');
    fs.writeFileSync(bundled, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(bundled, 0o755);
    process.env.OPENCHAMBER_BUNDLED_OPENCODE_BINARY = bundled;
    const { runtime } = createRuntime({});

    expect(runtime.isBundledOpenCodeCliPath(bundled)).toBe(true);
    expect(runtime.isBundledOpenCodeCliPath(path.join(dir, '.', 'bundled-opencode'))).toBe(true);
    expect(runtime.isBundledOpenCodeCliPath(path.join(dir, 'other'))).toBe(false);
  });

  it('allows an explicit external-binary escape hatch for desktop troubleshooting', async () => {
    const dir = createTempDir('openchamber-opencode-external-');
    const bundled = path.join(dir, 'bundled-opencode');
    const configured = path.join(dir, 'configured-opencode');
    fs.writeFileSync(bundled, '#!/bin/sh\nexit 0\n');
    fs.writeFileSync(configured, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(bundled, 0o755);
    fs.chmodSync(configured, 0o755);
    process.env.OPENCHAMBER_BUNDLED_OPENCODE_BINARY = bundled;
    process.env.OPENCHAMBER_USE_EXTERNAL_OPENCODE = 'true';

    const { runtime, state } = createRuntime({ opencodeBinary: configured });

    await expect(runtime.applyOpencodeBinaryFromSettings({ strict: true })).resolves.toBe(configured);
    expect(state.resolvedOpencodeBinarySource).toBe('settings');
  });

  it('resolves an explicit Windows binary wrapped in quotes', () => {
    setPlatform('win32');
    const dir = createTempDir('openchamber-opencode-quoted-');
    const binary = path.join(dir, 'opencode.exe');
    fs.writeFileSync(binary, '');
    process.env.OPENCODE_BINARY = `"${binary}"`;
    process.env.PATH = '';
    const { runtime } = createRuntime({});

    expect(runtime.resolveOpencodeCliPath()).toBe(binary);
  });

  it('applies a configured Windows binary wrapped in quotes', async () => {
    setPlatform('win32');
    const dir = createTempDir('openchamber-opencode-quoted-setting-');
    const binary = path.join(dir, 'opencode.exe');
    fs.writeFileSync(binary, '');
    const { runtime } = createRuntime({ opencodeBinary: `"${binary}"` });

    await expect(runtime.applyOpencodeBinaryFromSettings({ strict: true })).resolves.toBe(binary);
  });

  it('clears AppImage ARGV0 when applying a login-shell env snapshot', () => {
    const previousArgv0 = process.env.ARGV0;
    process.env.ARGV0 = '/path/to/OpenChamber.AppImage';
    delete process.env.OPENCHAMBER_ARGV0_TEST_MARKER;
    const { runtime, state } = createRuntime({});
    state.cachedLoginShellEnvSnapshot = {
      PATH: '/usr/bin',
      ARGV0: '/leaked/from/shell.AppImage',
      OPENCHAMBER_ARGV0_TEST_MARKER: '1',
    };

    try {
      runtime.applyLoginShellEnvSnapshot();
      expect(process.env.ARGV0).toBeUndefined();
      expect(process.env.OPENCHAMBER_ARGV0_TEST_MARKER).toBe('1');
    } finally {
      delete process.env.OPENCHAMBER_ARGV0_TEST_MARKER;
      if (previousArgv0 === undefined) delete process.env.ARGV0;
      else process.env.ARGV0 = previousArgv0;
    }
  });

  it('clears AppImage ARGV0 even when no login-shell snapshot is available', () => {
    const previousArgv0 = process.env.ARGV0;
    process.env.ARGV0 = '/path/to/OpenChamber.AppImage';
    const { runtime, state } = createRuntime({});
    state.cachedLoginShellEnvSnapshot = null;

    try {
      runtime.applyLoginShellEnvSnapshot();
      expect(process.env.ARGV0).toBeUndefined();
    } finally {
      if (previousArgv0 === undefined) delete process.env.ARGV0;
      else process.env.ARGV0 = previousArgv0;
    }
  });

  it('keeps shell startup output out of the login-shell snapshot', () => {
    setPlatform('darwin');
    const previousShell = process.env.SHELL;
    const shell = path.join(createTempDir('openchamber-shell-'), 'zsh');
    fs.writeFileSync(shell, '#!/bin/sh\n', { mode: 0o755 });
    process.env.SHELL = shell;
    try {
      const { runtime, state } = createRuntime({}, {
        // Stands in for a shell whose interactive rc file prints a banner to
        // stdout before it runs the probe command: only the `echo` part of the
        // command and `env -0` are emulated.
        spawnSync: (_command, args) => {
          const echoed = args[1].match(/^echo (\S+); /);
          const stdout = `Welcome to test-host\n${echoed ? `${echoed[1]}\n` : ''}HOME=/home/test-user\0PATH=/shell/bin\0`;
          return { status: 0, stdout, stderr: '' };
        },
      });
      state.cachedLoginShellEnvSnapshot = undefined;

      expect(runtime.getLoginShellEnvSnapshot()).toEqual({ HOME: '/home/test-user', PATH: '/shell/bin' });
    } finally {
      if (previousShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = previousShell;
    }
  });

  it('discovers the system npm prefix on Windows', () => {
    setPlatform('win32');
    const root = createTempDir('openchamber-opencode-windows-fallbacks-');
    const programFiles = path.join(root, 'Program Files');
    const userProfile = path.join(root, 'User');
    const npmShim = path.join(programFiles, 'nodejs', 'opencode.cmd');
    fs.mkdirSync(path.dirname(npmShim), { recursive: true });
    fs.writeFileSync(npmShim, '');
    process.env.PATH = '';
    process.env.ProgramFiles = programFiles;
    process.env.USERPROFILE = userProfile;
    process.env.APPDATA = path.join(root, 'Roaming');
    process.env.ProgramData = path.join(root, 'ProgramData');
    delete process.env.OPENCODE_BINARY;

    const { runtime } = createRuntime({});
    expect(runtime.resolveOpencodeCliPath()).toBe(npmShim);
  });

  it('discovers the Scoop executable on Windows', () => {
    setPlatform('win32');
    const root = createTempDir('openchamber-opencode-scoop-fallback-');
    const userProfile = path.join(root, 'User');
    const scoopExecutable = path.join(userProfile, 'scoop', 'shims', 'opencode.exe');
    fs.mkdirSync(path.dirname(scoopExecutable), { recursive: true });
    fs.writeFileSync(scoopExecutable, '');
    process.env.PATH = '';
    process.env.ProgramFiles = path.join(root, 'Program Files');
    process.env.USERPROFILE = userProfile;
    process.env.APPDATA = path.join(root, 'Roaming');
    process.env.ProgramData = path.join(root, 'ProgramData');
    delete process.env.OPENCODE_BINARY;

    const { runtime } = createRuntime({});
    expect(runtime.resolveOpencodeCliPath()).toBe(scoopExecutable);
  });

  it('does not auto-detect the Windows OpenCode desktop app as the CLI', () => {
    setPlatform('win32');
    const root = createTempDir('openchamber-opencode-desktop-app-');
    const localAppData = path.join(root, 'AppData', 'Local');
    const desktopExecutable = path.join(localAppData, 'Programs', 'opencode', 'opencode.exe');
    fs.mkdirSync(path.dirname(desktopExecutable), { recursive: true });
    fs.writeFileSync(desktopExecutable, '');
    process.env.PATH = '';
    process.env.LOCALAPPDATA = localAppData;
    process.env.USERPROFILE = path.join(root, 'User');
    process.env.APPDATA = path.join(root, 'AppData', 'Roaming');
    process.env.ProgramFiles = path.join(root, 'Program Files');
    process.env.ProgramData = path.join(root, 'ProgramData');
    delete process.env.OPENCODE_BINARY;

    const { runtime } = createRuntime({}, {
      spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
    });

    expect(runtime.resolveOpencodeCliPath()).toBeNull();
  });

  it('rejects a configured Windows OpenCode desktop app executable', async () => {
    setPlatform('win32');
    const root = createTempDir('openchamber-opencode-desktop-setting-');
    const localAppData = path.join(root, 'AppData', 'Local');
    const desktopExecutable = path.join(localAppData, 'Programs', 'opencode', 'opencode.exe');
    fs.mkdirSync(path.dirname(desktopExecutable), { recursive: true });
    fs.writeFileSync(desktopExecutable, '');
    process.env.LOCALAPPDATA = localAppData;
    const { runtime } = createRuntime({ opencodeBinary: desktopExecutable });

    await expect(runtime.applyOpencodeBinaryFromSettings({ strict: true })).rejects.toMatchObject({
      code: 'OPENCODE_BINARY_INVALID',
      message: expect.stringContaining('OpenCode desktop app'),
    });
  });

  itIf(process.platform === 'darwin')('rejects known macOS OpenCode app bundle executable paths', async () => {
    const { runtime } = createRuntime({ opencodeBinary: '/Applications/OpenCode.app/Contents/MacOS/OpenCode' });

    await expect(runtime.applyOpencodeBinaryFromSettings({ strict: true })).rejects.toMatchObject({
      code: 'OPENCODE_BINARY_INVALID',
      message: expect.stringContaining('macOS desktop app bundle'),
    });
  });

  it('rejects WSL settings in strict mode', async () => {
    setPlatform('win32');
    const { runtime } = createRuntime({ opencodeBinary: 'wsl:/usr/local/bin/opencode' });

    await expect(runtime.applyOpencodeBinaryFromSettings({ strict: true })).rejects.toMatchObject({
      message: expect.stringContaining('uses WSL'),
    });
  });

  it('does not auto-detect OpenCode from WSL fallback paths', () => {
    setPlatform('win32');
    const dir = createTempDir('openchamber-wsl-opencode-');
    const wslBinary = path.join(dir, 'wsl.exe');
    fs.writeFileSync(wslBinary, '');
    process.env.PATH = dir;
    process.env.SystemRoot = dir;
    process.env.WSL_BINARY = wslBinary;
    delete process.env.OPENCODE_BINARY;

    const calls = [];
    const spawnSyncMock = (command, args) => {
      calls.push({ command, args });
      if (command === 'where') {
        return { status: 1, stdout: '', stderr: '' };
      }
      if (command === wslBinary) {
        return { status: 0, stdout: '/home/alice/.opencode/bin/opencode\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    };
    const { runtime, state } = createRuntime({}, { spawnSync: spawnSyncMock });

    expect(runtime.resolveOpencodeCliPath()).toBeNull();
    expect(state.useWslForOpencode).toBe(false);
    expect(state.resolvedWslBinary).toBeNull();
    expect(state.resolvedWslOpencodePath).toBeNull();
    expect(state.resolvedOpencodeBinarySource).toBeNull();

    const wslCall = calls.find((call) => call.command === wslBinary);
    expect(wslCall).toBeUndefined();
  });

  it('launches Windows cmd shims through cmd call without embedded quotes', () => {
    setPlatform('win32');
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
    const dir = createTempDir('openchamber-opencode-cmd-');
    const shim = path.join(dir, 'opencode.cmd');
    fs.writeFileSync(shim, '@echo off\r\nexit /b 0\r\n');
    const { runtime } = createRuntime({});

    expect(runtime.resolveManagedOpenCodeLaunchSpec(shim)).toEqual({
      binary: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'call', shim],
      wrapperType: 'cmd-wrapper',
    });
  });

  it('resolves an npm-installed OpenCode 2.x cmd shim to its packaged Windows executable', () => {
    setPlatform('win32');
    const npmDir = createTempDir('openchamber-opencode-npm-v2-');
    const shim = path.join(npmDir, 'opencode.cmd');
    const nativeBinary = path.join(npmDir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
    fs.mkdirSync(path.dirname(nativeBinary), { recursive: true });
    fs.writeFileSync(nativeBinary, '');
    fs.writeFileSync(shim, '@ECHO off\r\n"%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe" %*\r\n');
    const { runtime } = createRuntime({});

    expect(runtime.resolveManagedOpenCodeLaunchSpec(shim)).toEqual({
      binary: nativeBinary,
      args: [],
      wrapperType: 'native-wrapper',
    });
  });

  it('still resolves a 1.x npm cmd shim to its packaged Windows executable', () => {
    setPlatform('win32');
    const npmDir = createTempDir('openchamber-opencode-npm-v1-');
    const shim = path.join(npmDir, 'opencode.cmd');
    // The 1.x shim launches its own package's bin shim, which postinstall
    // replaced with the platform binary — arch-independent path.
    const nativeBinary = path.join(npmDir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
    fs.mkdirSync(path.dirname(nativeBinary), { recursive: true });
    fs.writeFileSync(nativeBinary, '');
    fs.writeFileSync(shim, '@ECHO off\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe" %*\r\n');
    const { runtime } = createRuntime({});

    expect(runtime.resolveManagedOpenCodeLaunchSpec(shim)).toEqual({
      binary: nativeBinary,
      args: [],
      wrapperType: 'native-wrapper',
    });
  });
});
