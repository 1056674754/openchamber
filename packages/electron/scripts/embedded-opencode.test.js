import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync as realExecFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildEmbeddedOpenCodeSignArgs,
  normalizeEmbeddedOpenCodeVersion,
  resolveEmbeddedOpenCodeSource,
  stageEmbeddedOpenCode,
} = require('./embedded-opencode.cjs');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-embedded-opencode-'));
  tempDirs.push(dir);
  return dir;
};

describe('embedded OpenCode packaging', () => {
  it('keeps the default packaging source separate from the CLI installation', () => {
    expect(resolveEmbeddedOpenCodeSource({})).toBe(
      path.join(os.homedir(), '.openchamber', 'bin', 'opencode'),
    );
  });

  it('accepts an explicit packaging source override', () => {
    expect(resolveEmbeddedOpenCodeSource({
      OPENCHAMBER_EMBEDDED_OPENCODE_SOURCE: '/tmp/custom-opencode',
    })).toBe('/tmp/custom-opencode');
  });

  it('uses a stable identifier and disables timestamps only for local development signing', () => {
    expect(buildEmbeddedOpenCodeSignArgs('Apple Development: Example (TEAM123)')).toEqual([
      '--force',
      '--options',
      'runtime',
      '--sign',
      'Apple Development: Example (TEAM123)',
      '--identifier',
      'opencode',
      '--timestamp=none',
    ]);

    expect(buildEmbeddedOpenCodeSignArgs('Developer ID Application: Example (TEAM123)')).toEqual([
      '--force',
      '--options',
      'runtime',
      '--sign',
      'Developer ID Application: Example (TEAM123)',
      '--identifier',
      'opencode',
      '--timestamp',
    ]);
  });

  it('copies, signs, verifies, and records the custom OpenCode version', () => {
    const root = createTempDir();
    const source = path.join(root, 'source-opencode');
    const resources = path.join(root, 'OpenChamber.app', 'Contents', 'Resources');
    fs.writeFileSync(source, '#!/bin/sh\necho 1.17.20-my\n');
    fs.chmodSync(source, 0o755);
    const calls = [];

    const result = stageEmbeddedOpenCode({
      source,
      resourcesPath: resources,
      signingIdentity: 'Apple Development: Example (TEAM123)',
      execFileSync: (command, args) => {
        calls.push({ command, args });
        if (command.endsWith('/opencode') && args[0] === '--version') return '1.17.20-my\n';
        return '';
      },
    });

    expect(fs.statSync(result.binaryPath).mode & 0o111).not.toBe(0);
    expect(result.version).toBe('1.17.20-my');
    expect(calls[0]).toMatchObject({ command: 'codesign' });
    expect(calls[1]).toEqual({ command: 'codesign', args: ['--verify', '--strict', '--verbose=4', result.binaryPath] });
    expect(JSON.parse(fs.readFileSync(result.metadataPath, 'utf8'))).toEqual({
      identifier: 'opencode',
      version: '1.17.20-my',
    });
  });

  it('stages an unsigned custom OpenCode binary for Linux AppImage packaging', () => {
    const root = createTempDir();
    const source = path.join(root, 'source-opencode');
    const resources = path.join(root, 'linux-unpacked', 'resources');
    fs.writeFileSync(source, '#!/bin/sh\necho 1.18.9-sscity\n');
    fs.chmodSync(source, 0o755);
    const calls = [];

    const result = stageEmbeddedOpenCode({
      source,
      resourcesPath: resources,
      requireSigning: false,
      execFileSync: (command, args) => {
        calls.push({ command, args });
        if (command.endsWith('/opencode') && args[0] === '--version') return '1.18.9-sscity\n';
        return '';
      },
    });

    expect(result.version).toBe('1.18.9-sscity');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ command: result.binaryPath, args: ['--version'] });
  });

  it('stages the custom x64-baseline CLI as opencode.exe for Windows packages', () => {
    const root = createTempDir();
    const source = path.join(root, 'opencode-windows-x64-baseline.exe');
    const resources = path.join(root, 'win-arm64-unpacked', 'resources');
    fs.writeFileSync(source, 'custom windows binary');
    fs.chmodSync(source, 0o755);

    const result = stageEmbeddedOpenCode({
      source,
      resourcesPath: resources,
      binaryName: 'opencode.exe',
      requireSigning: false,
      execFileSync: (command, args) => {
        if (command.endsWith('/opencode.exe') && args[0] === '--version') return '1.18.10-sscity\n';
        return '';
      },
    });

    expect(path.basename(result.binaryPath)).toBe('opencode.exe');
    expect(result.version).toBe('1.18.10-sscity');
    expect(fs.readFileSync(result.binaryPath, 'utf8')).toBe('custom windows binary');
  });
});

describe('embedded OpenCode v2 dual-layout resolution', () => {
  const writeFakeBinary = (filePath, versionLine) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `#!/bin/sh\necho ${versionLine}\n`);
    fs.chmodSync(filePath, 0o755);
  };

  it('normalizes bare v1 and prefixed v2 --version output to the semver', () => {
    expect(normalizeEmbeddedOpenCodeVersion('1.18.9-sscity\n')).toBe('1.18.9-sscity');
    expect(normalizeEmbeddedOpenCodeVersion('opencode v2.0.2\n')).toBe('2.0.2');
    expect(normalizeEmbeddedOpenCodeVersion('opencode v2.1.0-beta.3')).toBe('2.1.0-beta.3');
    expect(normalizeEmbeddedOpenCodeVersion('1.18.1-sscity.20260102-030405\n')).toBe('1.18.1-sscity.20260102-030405');
    expect(normalizeEmbeddedOpenCodeVersion('')).toBe('');
    expect(normalizeEmbeddedOpenCodeVersion('command not found')).toBe('command not found');
  });

  it('resolves a v2 CLI package directory with a compiled dist binary and ignores the JS entry stub', () => {
    const root = createTempDir();
    const cliRoot = path.join(root, 'packages', 'cli');
    const binaryContent = '#!/bin/sh\necho 2.0.21-sscity\n';
    writeFakeBinary(path.join(cliRoot, 'dist', 'cli-darwin-arm64', 'bin', 'opencode'), '2.0.21-sscity');
    // The v2 source tree ships this JavaScript entry stub; exact-name
    // resolution must never pick it up.
    fs.mkdirSync(path.join(cliRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(cliRoot, 'bin', 'opencode.cjs'), 'stub');
    const resources = path.join(root, 'OpenChamber.app', 'Contents', 'Resources');
    const calls = [];

    const result = stageEmbeddedOpenCode({
      source: cliRoot,
      resourcesPath: resources,
      requireSigning: false,
      execFileSync: (command, args) => {
        calls.push({ command, args });
        if (command.endsWith('/opencode') && args[0] === '--version') return '2.0.21-sscity\n';
        return '';
      },
    });

    expect(result.version).toBe('2.0.21-sscity');
    expect(fs.readFileSync(result.binaryPath, 'utf8')).toBe(binaryContent);
    expect(JSON.parse(fs.readFileSync(result.metadataPath, 'utf8'))).toEqual({
      identifier: 'opencode',
      version: '2.0.21-sscity',
    });
    expect(calls.filter((call) => call.command !== 'codesign')).toHaveLength(1);
  });

  it('resolves a v2 checkout root via the packages/cli dist candidate', () => {
    const root = createTempDir();
    writeFakeBinary(path.join(root, 'packages', 'cli', 'dist', 'cli-darwin-arm64', 'bin', 'opencode'), '2.0.21-sscity');
    const resources = path.join(root, 'OpenChamber.app', 'Contents', 'Resources');

    const result = stageEmbeddedOpenCode({
      source: root,
      resourcesPath: resources,
      requireSigning: false,
      execFileSync: (command, args) => {
        if (command.endsWith('/opencode') && args[0] === '--version') return '2.0.21-sscity\n';
        return '';
      },
    });

    expect(result.version).toBe('2.0.21-sscity');
    expect(fs.statSync(result.binaryPath).isFile()).toBe(true);
  });

  it('fails loudly when a v2 source tree has no compiled binary', () => {
    const root = createTempDir();
    const cliRoot = path.join(root, 'packages', 'cli');
    fs.mkdirSync(path.join(cliRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cliRoot, 'src', 'index.ts'), 'export {};\n');
    // The JavaScript entry stub must never become the embedded fallback.
    fs.mkdirSync(path.join(cliRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(cliRoot, 'bin', 'opencode.cjs'), 'stub');
    const resources = path.join(root, 'OpenChamber.app', 'Contents', 'Resources');

    expect(() => stageEmbeddedOpenCode({
      source: root,
      resourcesPath: resources,
      requireSigning: false,
      execFileSync: () => '',
    })).toThrow(/No compiled OpenCode binary found.*EMBEDDED_OPENCODE_PACKAGING\.md/s);
    expect(fs.existsSync(path.join(resources, 'opencode', 'opencode'))).toBe(false);
  });

  it('stages a v2 npm platform-package tarball by extracting it with a relative tar path', () => {
    const root = createTempDir();
    const binaryContent = '#!/bin/sh\necho 2.0.21-sscity\n';
    const packageBinDir = path.join(root, 'pkg', 'package', 'bin');
    fs.mkdirSync(packageBinDir, { recursive: true });
    fs.writeFileSync(path.join(packageBinDir, 'opencode'), binaryContent);
    fs.chmodSync(path.join(packageBinDir, 'opencode'), 0o755);
    const tarball = path.join(root, 'cli-darwin-arm64-2.0.21.tgz');
    realExecFileSync('tar', ['-czf', tarball, '-C', path.join(root, 'pkg'), 'package']);
    const resources = path.join(root, 'OpenChamber.app', 'Contents', 'Resources');
    const calls = [];

    const result = stageEmbeddedOpenCode({
      source: tarball,
      resourcesPath: resources,
      requireSigning: false,
      execFileSync: (command, args, options) => {
        calls.push({ command, args });
        if (command === 'tar') return realExecFileSync('tar', args, options);
        if (command.endsWith('/opencode') && args[0] === '--version') return '2.0.21-sscity\n';
        return '';
      },
    });

    // The archive must be addressed relative to the extraction cwd: GNU tar
    // under Git Bash on Windows reads an absolute path as a remote host.
    const tarCall = calls.find((call) => call.command === 'tar');
    expect(tarCall).toBeDefined();
    expect(path.isAbsolute(tarCall.args[1])).toBe(false);
    expect(result.version).toBe('2.0.21-sscity');
    expect(fs.readFileSync(result.binaryPath, 'utf8')).toBe(binaryContent);
    expect(JSON.parse(fs.readFileSync(result.metadataPath, 'utf8'))).toEqual({
      identifier: 'opencode',
      version: '2.0.21-sscity',
    });
  });

  it('records the normalized semver when a v2 binary prefixes its --version output', () => {
    const root = createTempDir();
    const source = path.join(root, 'source-opencode');
    const resources = path.join(root, 'OpenChamber.app', 'Contents', 'Resources');
    fs.writeFileSync(source, '#!/bin/sh\necho "opencode v2.0.21-sscity"\n');
    fs.chmodSync(source, 0o755);

    const result = stageEmbeddedOpenCode({
      source,
      resourcesPath: resources,
      requireSigning: false,
      execFileSync: (command, args) => {
        if (command.endsWith('/opencode') && args[0] === '--version') return 'opencode v2.0.21-sscity\n';
        return '';
      },
    });

    expect(result.version).toBe('2.0.21-sscity');
    expect(JSON.parse(fs.readFileSync(result.metadataPath, 'utf8'))).toEqual({
      identifier: 'opencode',
      version: '2.0.21-sscity',
    });
  });
});
