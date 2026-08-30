#!/usr/bin/env bun
// Standalone binary entrypoint — extracts embedded assets and starts OpenChamber server.

import 'reflect-metadata';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { EMBEDDED_ASSETS } from './embedded-assets.generated.mjs';
import { EMBEDDED_OPENCHAMBER_PLUGIN } from './embedded-plugin.generated.mjs';
import { STANDALONE_VERSION } from './standalone-version.mjs';

// Derive assets version from binary content hash to avoid stale caches
const ASSETS_HASH = createHash('sha256')
  .update(Array.from(EMBEDDED_ASSETS.keys()).sort().join(','))
  .digest('hex')
  .slice(0, 16);

const ASSETS_DIR = join(homedir(), '.openchamber', 'embedded-assets', ASSETS_HASH);
const ASSETS_OK = join(ASSETS_DIR, '.ok');
const OPENCHAMBER_DATA_DIR = process.env.OPENCHAMBER_DATA_DIR
  ? resolve(process.env.OPENCHAMBER_DATA_DIR)
  : join(homedir(), '.config', 'openchamber');
const PLUGIN_ENTRY = join(OPENCHAMBER_DATA_DIR, 'opencode-notifier');

// Extract assets on first run
if (!existsSync(ASSETS_OK)) {
  mkdirSync(ASSETS_DIR, { recursive: true });
  for (const [relPath, b64] of EMBEDDED_ASSETS) {
    const fullPath = join(ASSETS_DIR, relPath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, Buffer.from(b64, 'base64'));
  }
  writeFileSync(ASSETS_OK, '');
}

const pluginBuffer = Buffer.from(EMBEDDED_OPENCHAMBER_PLUGIN, 'base64');
const pluginHash = createHash('sha256').update(pluginBuffer).digest('hex');
const installedPluginHash = existsSync(PLUGIN_ENTRY)
  ? createHash('sha256').update(readFileSync(PLUGIN_ENTRY)).digest('hex')
  : null;
if (installedPluginHash !== pluginHash) {
  mkdirSync(OPENCHAMBER_DATA_DIR, { recursive: true });
  const temporaryPluginEntry = `${PLUGIN_ENTRY}.${process.pid}.tmp`;
  writeFileSync(temporaryPluginEntry, pluginBuffer, { mode: 0o600 });
  renameSync(temporaryPluginEntry, PLUGIN_ENTRY);
}

// Point server to extracted assets
process.env.OPENCHAMBER_DIST_DIR = ASSETS_DIR;

// Parse CLI args — supports both standalone mode and `serve` subcommand compatibility
const rawArgs = process.argv.slice(2);
const isServe = rawArgs[0] === 'serve';
const isStop = rawArgs[0] === 'stop';
const args = isServe ? rawArgs.slice(1) : rawArgs;

// --version
if (args[0] === '--version' || args[0] === '-v' || args[0] === '-V') {
  console.log(STANDALONE_VERSION);
  process.exit(0);
}

// Resolve --port and --host (also --hostname alias for managed mode compatibility)
const portIdx = args.indexOf('--port');
const hostIdx = args.indexOf('--host');
const hostnameIdx = args.indexOf('--hostname');
const host = hostIdx >= 0 ? args[hostIdx + 1] : (hostnameIdx >= 0 ? args[hostnameIdx + 1] : undefined);
const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : (process.env.OPENCHAMBER_PORT ? parseInt(process.env.OPENCHAMBER_PORT, 10) : 3000);
const runtimeDir = join(OPENCHAMBER_DATA_DIR, 'standalone');
const pidFile = join(runtimeDir, `openchamber-${port}.pid`);

if (isStop) {
  if (existsSync(pidFile)) {
    const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
    try {
      unlinkSync(pidFile);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  console.log(`Stopped OpenChamber on port ${port}`);
  process.exit(0);
}

// `serve` subcommand: print port and exit.
// Managed SSH starts `serve --foreground` under nohup and owns its lifecycle.
const foregroundServe = isServe && (args.includes('--foreground') || args.includes('--no-daemon'));
if (isServe && !foregroundServe) {
  console.log(port);
  process.exit(0);
}

// Foreground mode (child process): start server directly.
// Prevent runCliEntryIfMain from auto-starting server when importing
process.argv[1] = '/dev/null/not-a-match';

const { startWebUiServer } = await import('../server/index.js');
const handle = await startWebUiServer({ port, host });

mkdirSync(runtimeDir, { recursive: true });
writeFileSync(pidFile, `${process.pid}\n`, 'utf8');

console.log(`OpenChamber running on port ${handle.getPort()}`);

let shuttingDown = false;
const cleanupPidFile = () => {
  try {
    if (existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() === String(process.pid)) {
      unlinkSync(pidFile);
    }
  } catch {
  }
};
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  cleanupPidFile();
  await handle.stop().catch(() => undefined);
  process.exit(0);
};

process.on('exit', cleanupPidFile);
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
