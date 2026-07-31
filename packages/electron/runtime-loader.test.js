import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  readAndValidateRuntime,
  resolveRuntime,
  RUNTIME_MANIFEST_NAME,
} from './runtime-loader.mjs';

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-runtime-loader-'));
  tempDirs.push(dir);
  return dir;
};

const writeRuntime = (root, content = 'export const ready = true;\n') => {
  const main = path.join(root, 'dist-bundle', 'main.mjs');
  fs.mkdirSync(path.dirname(main), { recursive: true });
  fs.writeFileSync(main, content);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  fs.writeFileSync(path.join(root, RUNTIME_MANIFEST_NAME), `${JSON.stringify({
    schemaVersion: 1,
    shellApi: 1,
    id: 'runtime-test',
    main: 'dist-bundle/main.mjs',
    files: {
      'dist-bundle/main.mjs': hash,
    },
  }, null, 2)}\n`);
};

describe('stable shell runtime selection', () => {
  it('loads a valid explicit external runtime', () => {
    const runtime = createTempDir();
    writeRuntime(runtime);
    expect(resolveRuntime({
      env: { OPENCHAMBER_RUNTIME_DIR: runtime },
      appDataPath: createTempDir(),
      embeddedRoot: '/embedded',
    })).toMatchObject({
      root: fs.realpathSync(runtime),
      source: 'external',
    });
  });

  it('falls back to the embedded runtime when current is absent', () => {
    const appData = createTempDir();
    expect(resolveRuntime({
      env: {},
      appDataPath: appData,
      embeddedRoot: '/embedded',
    })).toMatchObject({
      root: '/embedded',
      source: 'embedded',
    });
  });

  it('rejects a modified runtime entrypoint', () => {
    const runtime = createTempDir();
    writeRuntime(runtime);
    fs.appendFileSync(path.join(runtime, 'dist-bundle', 'main.mjs'), 'broken\n');
    expect(() => readAndValidateRuntime(runtime)).toThrow('Runtime integrity mismatch');
  });

  it('rejects manifest paths outside the runtime root', () => {
    const runtime = createTempDir();
    fs.writeFileSync(path.join(runtime, RUNTIME_MANIFEST_NAME), `${JSON.stringify({
      schemaVersion: 1,
      shellApi: 1,
      id: 'runtime-test',
      main: '../main.mjs',
      files: {},
    })}\n`);
    expect(() => readAndValidateRuntime(runtime)).toThrow('escapes its root');
  });
});

