import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeTargetArchitecture } from './target-architecture.mjs';
import embeddedOpenCode from './embedded-opencode.cjs';

const { normalizeEmbeddedOpenCodeVersion } = embeddedOpenCode;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const ELF_MACHINE = { x64: 62, arm64: 183 };
const REQUIRED_NATIVE_MODULES = ['better_sqlite3.node', 'pty.node'];

export const linuxAppImageArchSuffix = (architecture) => (
  architecture === 'x64' ? 'x86_64' : 'arm64'
);

export const readElfArchitecture = (filePath) => {
  const header = Buffer.alloc(20);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) {
      throw new Error(`ELF header is truncated: ${filePath}`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
  if (!header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error(`Expected an ELF binary: ${filePath}`);
  }
  const byteOrder = header[5];
  if (byteOrder !== 1 && byteOrder !== 2) {
    throw new Error(`Unsupported ELF byte order: ${filePath}`);
  }
  const machine = byteOrder === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18);
  const architecture = Object.entries(ELF_MACHINE).find(([, value]) => value === machine)?.[0];
  if (!architecture) throw new Error(`Unsupported ELF machine ${machine}: ${filePath}`);
  return architecture;
};

const assertElfArchitecture = (filePath, expectedArchitecture, label) => {
  if (!fs.existsSync(filePath)) throw new Error(`Missing ${label}: ${filePath}`);
  const actual = readElfArchitecture(filePath);
  if (actual !== expectedArchitecture) {
    throw new Error(`${label} architecture mismatch: expected ${expectedArchitecture}, got ${actual} (${filePath})`);
  }
};

const collectFiles = (root, predicate) => {
  const matches = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && predicate(entry.name, fullPath)) matches.push(fullPath);
    }
  };
  visit(root);
  return matches;
};

const readOpenCodeVersion = (binaryPath) => {
  const result = spawnSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });
  if (result.status !== 0) throw new Error(`Failed to run packaged OpenCode: ${binaryPath}`);
  // v1 prints a bare semver; v2 prints `opencode v2.0.2`. metadata.json holds
  // the normalized semver for both layouts.
  return normalizeEmbeddedOpenCodeVersion(result.stdout || '');
};

export const verifyExtractedPayload = ({
  root,
  targetArchitecture,
  runOpenCodeVersion = readOpenCodeVersion,
}) => {
  const desktopPath = path.join(root, 'openchamber.desktop');
  if (!fs.existsSync(desktopPath)) throw new Error(`Missing desktop entry: ${desktopPath}`);
  const desktopEntries = fs.readFileSync(desktopPath, 'utf8').split(/\r?\n/);
  for (const entry of ['Name=OpenChamber', 'Icon=openchamber', 'StartupWMClass=openchamber']) {
    if (!desktopEntries.includes(entry)) throw new Error(`Desktop identity mismatch: missing ${entry}`);
  }
  if (!desktopEntries.some((entry) => entry.startsWith('Exec=AppRun'))) {
    throw new Error('Desktop identity mismatch: expected AppImage AppRun entrypoint');
  }

  assertElfArchitecture(path.join(root, 'openchamber'), targetArchitecture, 'Electron executable');
  const openCodePath = path.join(root, 'resources', 'opencode', 'opencode');
  assertElfArchitecture(openCodePath, targetArchitecture, 'custom OpenCode');
  const metadataPath = path.join(root, 'resources', 'opencode', 'metadata.json');
  if (!fs.existsSync(metadataPath)) throw new Error(`Missing OpenCode metadata: ${metadataPath}`);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const actualVersion = runOpenCodeVersion(openCodePath);
  if (actualVersion !== metadata.version || !actualVersion.endsWith('-sscity')) {
    throw new Error(`Custom OpenCode version mismatch: metadata=${metadata.version || '(empty)'}, binary=${actualVersion || '(empty)'}`);
  }

  const unpackedModules = path.join(root, 'resources', 'app.asar.unpacked', 'node_modules');
  if (!fs.existsSync(unpackedModules)) throw new Error(`Missing unpacked native modules: ${unpackedModules}`);
  const nativeModules = collectFiles(unpackedModules, (name, fullPath) => {
    if (!name.endsWith('.node')) return false;
    const normalizedPath = fullPath.split(path.sep).join('/');
    if (!normalizedPath.includes('/prebuilds/')) return true;
    return normalizedPath.includes(`/prebuilds/linux-${targetArchitecture}/`);
  });
  for (const requiredName of REQUIRED_NATIVE_MODULES) {
    if (!nativeModules.some((modulePath) => path.basename(modulePath) === requiredName)) {
      throw new Error(`Missing packaged native module: ${requiredName}`);
    }
  }
  for (const modulePath of nativeModules) {
    assertElfArchitecture(modulePath, targetArchitecture, 'native module');
  }
  return { nativeModuleCount: nativeModules.length, openCodeVersion: actualVersion };
};

const findAppImage = (version, architecture) => {
  const suffix = linuxAppImageArchSuffix(architecture);
  const expected = path.join(electronRoot, 'dist', `OpenChamber-${version}-linux-${suffix}.AppImage`);
  if (!fs.existsSync(expected)) throw new Error(`Linux AppImage not found: ${expected}`);
  return expected;
};

const findSquashfsOffset = (appImagePath) => {
  const descriptor = fs.openSync(appImagePath, 'r');
  try {
    const prefix = Buffer.alloc(4 * 1024 * 1024);
    const bytesRead = fs.readSync(descriptor, prefix, 0, prefix.length, 0);
    const payload = prefix.subarray(0, bytesRead);
    let offset = payload.indexOf(Buffer.from('hsqs'));
    while (offset >= 0 && offset + 32 <= payload.length) {
      const inodeCount = payload.readUInt32LE(offset + 4);
      const blockSize = payload.readUInt32LE(offset + 12);
      const compression = payload.readUInt16LE(offset + 20);
      const blockLog = payload.readUInt16LE(offset + 22);
      const majorVersion = payload.readUInt16LE(offset + 28);
      if (
        inodeCount > 0
        && blockSize >= 4096
        && blockSize <= 1024 * 1024
        && (blockSize & (blockSize - 1)) === 0
        && compression >= 1
        && compression <= 6
        && blockLog === Math.log2(blockSize)
        && majorVersion === 4
      ) {
        return offset;
      }
      offset = payload.indexOf(Buffer.from('hsqs'), offset + 1);
    }
    throw new Error(`AppImage squashfs payload not found: ${appImagePath}`);
  } finally {
    fs.closeSync(descriptor);
  }
};

const extractAppImage = (appImagePath, destination) => {
  fs.chmodSync(appImagePath, fs.statSync(appImagePath).mode | 0o100);
  const result = spawnSync(appImagePath, ['--appimage-extract'], {
    cwd: destination,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 120_000,
  });
  if (result.status === 0) return path.join(destination, 'squashfs-root');

  const extractedRoot = path.join(destination, 'squashfs-root');
  const fallback = spawnSync('unsquashfs', [
    '-no-progress',
    '-offset',
    String(findSquashfsOffset(appImagePath)),
    '-d',
    extractedRoot,
    appImagePath,
  ], {
    cwd: destination,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 120_000,
  });
  if (fallback.status !== 0) {
    throw new Error(
      `Failed to extract AppImage: ${appImagePath}\n`
      + `self-extract: ${(result.stderr || '').trim()}\n`
      + `unsquashfs: ${(fallback.stderr || '').trim()}`,
    );
  }
  return extractedRoot;
};

const main = () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package.json'), 'utf8'));
  const architecture = normalizeTargetArchitecture(process.env.OPENCHAMBER_TARGET_ARCH || process.arch).node;
  const appImagePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : findAppImage(packageJson.version, architecture);
  assertElfArchitecture(appImagePath, architecture, 'AppImage');

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-appimage-'));
  try {
    const result = verifyExtractedPayload({
      root: extractAppImage(appImagePath, temporaryDirectory),
      targetArchitecture: architecture,
    });
    console.log(`[electron] verified Linux ${architecture} AppImage: ${appImagePath}`);
    console.log(`[electron] verified custom OpenCode ${result.openCodeVersion} and ${result.nativeModuleCount} native modules`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
