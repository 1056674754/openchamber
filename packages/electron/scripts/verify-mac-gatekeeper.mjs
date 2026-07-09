import { accessSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultAppPath = resolve(scriptDir, '../dist/mac-arm64/OpenChamber.app');
const appPath = process.argv[2] ? resolve(process.argv[2]) : defaultAppPath;

const run = (command, args, options = {}) => {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  });

  if (result.error) {
    console.error(`[electron] failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }

  return result;
};

if (process.platform !== 'darwin') {
  console.error('[electron] Gatekeeper verification requires macOS.');
  process.exit(1);
}

try {
  accessSync(appPath);
} catch {
  console.error(`[electron] app bundle not found: ${appPath}`);
  process.exit(1);
}

const nested = run(
  '/usr/bin/find',
  [appPath, '(', '-name', '*.app', '-o', '-name', '*.framework', '-o', '-name', '*.dylib', '-o', '-perm', '-111', ')'],
  { capture: true },
);

if (nested.status === 0) {
  const count = nested.stdout.trim() ? nested.stdout.trim().split(/\r?\n/).length : 0;
  console.log(`[electron] nested app/framework/dylib/executable objects: ${count}`);
} else {
  process.stderr.write(nested.stderr || '');
  console.warn('[electron] unable to count nested signing objects; continuing verification.');
}

const verify = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
if (verify.status !== 0) {
  console.error('[electron] codesign verification failed.');
  process.exit(verify.status || 1);
}

const details = run('codesign', ['-dvvv', '--entitlements', ':-', appPath]);
if (details.status !== 0) {
  console.error('[electron] unable to display signing details.');
  process.exit(details.status || 1);
}

const assessment = run('spctl', ['-a', '-vv', appPath]);
if (assessment.status !== 0) {
  console.error('[electron] Gatekeeper assessment failed.');
  process.exit(assessment.status || 1);
}

console.log('\n[electron] Gatekeeper verification passed.');
