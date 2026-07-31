import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildEmbeddedBunSignArgs,
  resolveEmbeddedBunSource,
  stageEmbeddedBun,
} = require('./embedded-bun.cjs');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-embedded-bun-'));
  tempDirs.push(dir);
  return dir;
};

describe('embedded Bun engine packaging', () => {
  it('accepts an explicit engine override', () => {
    expect(resolveEmbeddedBunSource({
      OPENCHAMBER_BUN_ENGINE_SOURCE: '/tmp/custom-bun',
    })).toBe('/tmp/custom-bun');
  });

  it('timestamps Developer ID builds and keeps local builds offline', () => {
    expect(buildEmbeddedBunSignArgs('Apple Development: Example (TEAM123)')).toContain('--timestamp=none');
    expect(buildEmbeddedBunSignArgs('Developer ID Application: Example (TEAM123)')).toContain('--timestamp');
  });

  it('copies, signs, verifies, and records the engine version', () => {
    const root = createTempDir();
    const source = path.join(root, 'source-bun');
    const resources = path.join(root, 'OpenChamber.app', 'Contents', 'Resources');
    fs.writeFileSync(source, '#!/bin/sh\necho 1.3.14\n');
    fs.chmodSync(source, 0o755);
    const calls = [];

    const result = stageEmbeddedBun({
      source,
      resourcesPath: resources,
      signingIdentity: 'Developer ID Application: Example (TEAM123)',
      execFileSync: (command, args) => {
        calls.push({ command, args });
        if (command.endsWith('/bun') && args[0] === '--version') return '1.3.14\n';
        return '';
      },
    });

    expect(fs.statSync(result.binaryPath).mode & 0o111).not.toBe(0);
    expect(result.version).toBe('1.3.14');
    expect(calls[0]).toMatchObject({ command: 'codesign' });
    expect(JSON.parse(fs.readFileSync(result.metadataPath, 'utf8'))).toEqual({
      identifier: 'openchamber-bun-engine',
      version: '1.3.14',
    });
  });
});

