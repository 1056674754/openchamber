#!/usr/bin/env bun
// Standalone binary entrypoint — extracts embedded assets and starts OpenChamber server.

import 'reflect-metadata';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { EMBEDDED_ASSETS } from './embedded-assets.generated.mjs';

const STANDALONE_VERSION = '1.10.0-modified-by-sscity';

// Derive assets version from binary content hash to avoid stale caches
const ASSETS_HASH = createHash('sha256')
  .update(Array.from(EMBEDDED_ASSETS.keys()).sort().join(','))
  .digest('hex')
  .slice(0, 16);

const ASSETS_DIR = join(homedir(), '.openchamber', 'embedded-assets', ASSETS_HASH);
const ASSETS_OK = join(ASSETS_DIR, '.ok');

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

// Point server to extracted assets
process.env.OPENCHAMBER_DIST_DIR = ASSETS_DIR;

// Parse CLI args — supports both standalone mode and `serve` subcommand compatibility
const rawArgs = process.argv.slice(2);
const isServe = rawArgs[0] === 'serve';
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

// `serve` subcommand: print port and exit.
// Daemonization is handled by `nohup ... &` in ssh-manager's startRemoteServerManaged.
if (isServe) {
  console.log(port);
  process.exit(0);
}

// Foreground mode (child process): start server directly.
// Prevent runCliEntryIfMain from auto-starting server when importing
process.argv[1] = '/dev/null/not-a-match';

const { startWebUiServer } = await import('../server/index.js');
const handle = await startWebUiServer({ port, host });

console.log(`OpenChamber running on port ${handle.getPort()}`);

process.on('SIGINT', () => { process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });