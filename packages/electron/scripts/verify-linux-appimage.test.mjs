import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { linuxAppImageArchSuffix, readElfArchitecture, verifyExtractedPayload } from './verify-linux-appimage.mjs';

const writeElf = (filePath, architecture) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const header = Buffer.alloc(20);
  header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  header.writeUInt16LE(architecture === 'x64' ? 62 : 183, 18);
  fs.writeFileSync(filePath, header, { mode: 0o755 });
};

const createPayload = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-payload-test-'));
  fs.writeFileSync(path.join(root, 'openchamber.desktop'), [
    '[Desktop Entry]',
    'Name=OpenChamber',
    'Exec=AppRun --no-sandbox %U',
    'Icon=openchamber',
    'StartupWMClass=openchamber',
    '',
  ].join('\n'));
  writeElf(path.join(root, 'openchamber'), 'x64');
  writeElf(path.join(root, 'resources/opencode/opencode'), 'x64');
  fs.writeFileSync(path.join(root, 'resources/opencode/metadata.json'), JSON.stringify({
    identifier: 'opencode',
    version: '1.18.9-sscity',
  }));
  for (const name of ['better_sqlite3.node', 'pty.node']) {
    writeElf(path.join(root, 'resources/app.asar.unpacked/node_modules', name), 'x64');
  }
  return root;
};

test('reads supported ELF architectures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-elf-test-'));
  try {
    writeElf(path.join(root, 'x64'), 'x64');
    writeElf(path.join(root, 'arm64'), 'arm64');
    assert.equal(readElfArchitecture(path.join(root, 'x64')), 'x64');
    assert.equal(readElfArchitecture(path.join(root, 'arm64')), 'arm64');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uses electron-builder architecture suffixes', () => {
  assert.equal(linuxAppImageArchSuffix('x64'), 'x86_64');
  assert.equal(linuxAppImageArchSuffix('arm64'), 'arm64');
});

test('verifies custom OpenCode and native payload architecture', () => {
  const root = createPayload();
  try {
    const result = verifyExtractedPayload({
      root,
      targetArchitecture: 'x64',
      runOpenCodeVersion: () => '1.18.9-sscity',
    });
    assert.equal(result.nativeModuleCount, 2);
    assert.equal(result.openCodeVersion, '1.18.9-sscity');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an official or mismatched OpenCode binary', () => {
  const root = createPayload();
  try {
    assert.throws(() => verifyExtractedPayload({
      root,
      targetArchitecture: 'x64',
      runOpenCodeVersion: () => '1.18.9',
    }), /Custom OpenCode version mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
