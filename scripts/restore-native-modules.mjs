#!/usr/bin/env node
// Restores the Electron-built better_sqlite3.node that the notarized
// OpenChamber shell expects. A plain `bun install` replaces it with the
// upstream Node-ABI prebuild, which then fails the runtime native gate
// (docs/EMBEDDED_OPENCODE_PACKAGING.md §7). The binary cannot be rebuilt
// from source: better-sqlite3@11.10.0 does not compile against Electron 43
// V8 headers and upstream publishes no electron-v148 prebuild, so the
// compiled artifact is kept in artifacts/native/ and restored here.
//
// Runs from the root postinstall. No-ops on non-darwin-arm64 hosts and when
// the installed better-sqlite3 version no longer matches the artifact.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const ARTIFACT_NAME = 'better_sqlite3-v11.10.0-electron-v148-darwin-arm64.node';
const ARTIFACT_VERSION = '11.10.0';
const MODULE_SUBPATH = 'build/Release/better_sqlite3.node';

const sha256 = (filePath) =>
  createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  process.exit(0);
}

const artifactPath = path.join(repoRoot, 'artifacts', 'native', ARTIFACT_NAME);
if (!fs.existsSync(artifactPath)) {
  console.error(`[restore-native] artifact missing: ${artifactPath}`);
  process.exit(1);
}
const artifactSha = fs.readFileSync(`${artifactPath}.sha256`, 'utf8').trim();
if (sha256(artifactPath) !== artifactSha) {
  console.error('[restore-native] artifact sha256 mismatch — refusing to install');
  process.exit(1);
}

const storeRoot = path.join(repoRoot, 'node_modules', '.bun');
const candidates = fs.existsSync(storeRoot)
  ? fs.readdirSync(storeRoot).filter((entry) => entry.startsWith('better-sqlite3@'))
  : [];

if (candidates.length === 0) {
  console.error('[restore-native] no better-sqlite3 package found in node_modules/.bun');
  process.exit(1);
}

let failed = false;

for (const candidate of candidates) {
  const moduleRoot = path.join(storeRoot, candidate, 'node_modules', 'better-sqlite3');
  const targetPath = path.join(moduleRoot, MODULE_SUBPATH);

  let installedVersion = 'unknown';
  try {
    installedVersion = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'), 'utf8')).version;
  } catch {
    // fall through with 'unknown'
  }

  if (installedVersion !== ARTIFACT_VERSION) {
    console.warn(
      `[restore-native] installed better-sqlite3 ${installedVersion} != artifact ${ARTIFACT_VERSION}; `
      + 'skipping. If the runtime native gate now fails, the shell must be rebuilt and notarized '
      + 'for the new better-sqlite3 (docs/EMBEDDED_OPENCODE_PACKAGING.md §7).',
    );
    continue;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (fs.existsSync(targetPath) && sha256(targetPath) === artifactSha) {
    console.log(`[restore-native] ${candidate}: already up to date`);
    continue;
  }

  fs.copyFileSync(artifactPath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  if (sha256(targetPath) !== artifactSha) {
    console.error(`[restore-native] ${candidate}: copy failed verification`);
    failed = true;
    continue;
  }
  console.log(`[restore-native] ${candidate}: restored Electron-built ${MODULE_SUBPATH}`);
}

process.exit(failed ? 1 : 0);
