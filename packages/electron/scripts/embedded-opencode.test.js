import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildEmbeddedOpenCodeSignArgs,
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
});
