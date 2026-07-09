#!/usr/bin/env node
import { accessSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TRUST_LABEL = 'OpenChamber Local';
const APP_NAME = 'OpenChamber.app';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronDir = resolve(scriptDir, '..');
const repoRoot = resolve(electronDir, '..', '..');
const installAppPath = `/Applications/${APP_NAME}`;
const builtAppCandidates = [
  resolve(electronDir, 'dist/mac-arm64/OpenChamber.app'),
  resolve(electronDir, 'dist/mac/OpenChamber.app'),
  resolve(electronDir, 'dist/mac-universal/OpenChamber.app'),
];

const args = new Set(process.argv.slice(2));

const usage = `Usage: node packages/electron/scripts/install-local-trusted.mjs [options]

Builds a local OpenChamber app bundle, installs it to /Applications, and adds a
machine-local Gatekeeper trust rule. This is not a Developer ID release flow.

Options:
  --skip-build          Install the existing package/electron/dist app bundle
  --no-open             Do not open OpenChamber after installation
  --no-reset-services   Do not restart syspolicyd/trustd before trust checks
  --help                Show this message
`;

const quoteArg = (arg) => {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
};

const commandLabel = (command, commandArgs) => {
  return [command, ...commandArgs].map(quoteArg).join(' ');
};

const run = (command, commandArgs, options = {}) => {
  console.log(`\n$ ${commandLabel(command, commandArgs)}`);
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || repoRoot,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  });

  if (result.error) {
    console.error(`[electron] failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0 && !options.allowFailure) {
    if (options.capture) {
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
    }
    console.error(`[electron] command failed: ${commandLabel(command, commandArgs)}`);
    process.exit(result.status || 1);
  }

  return result;
};

const pathExists = (path) => {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
};

const findBuiltApp = () => {
  return builtAppCandidates.find(pathExists) || null;
};

const printCaptured = (result) => {
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
};

const restartSecurityServices = () => {
  console.log('\n[electron] restarting Gatekeeper trust services for a clean local assessment...');
  run('sudo', ['killall', 'syspolicyd', 'trustd'], { allowFailure: true });
  run('sleep', ['3']);
};

const assessInstalledApp = () => {
  const result = run('spctl', ['-a', '-vv', installAppPath], {
    capture: true,
    allowFailure: true,
  });
  printCaptured(result);
  return result;
};

if (args.has('--help')) {
  console.log(usage);
  process.exit(0);
}

if (process.platform !== 'darwin') {
  console.error('[electron] local trusted install is only supported on macOS.');
  process.exit(1);
}

if (!args.has('--skip-build')) {
  run('bun', ['run', '--cwd', electronDir, 'package:app']);
}

const builtAppPath = findBuiltApp();
if (!builtAppPath) {
  console.error('[electron] no built OpenChamber.app was found under packages/electron/dist.');
  console.error('[electron] run without --skip-build, or build package:app first.');
  process.exit(1);
}

console.log(`\n[electron] installing local app bundle: ${builtAppPath}`);
console.log('[electron] this installs a machine-local trust rule, not a notarized Developer ID release.');

run('sudo', ['-v']);

if (!args.has('--no-reset-services')) {
  restartSecurityServices();
}

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', builtAppPath]);

run('sudo', ['rm', '-rf', installAppPath]);
run('sudo', ['ditto', builtAppPath, installAppPath]);
run('sudo', ['xattr', '-dr', 'com.apple.quarantine', installAppPath], { allowFailure: true });
run('sudo', ['spctl', '--remove', '--label', TRUST_LABEL], { allowFailure: true });
run('sudo', ['spctl', '--add', '--label', TRUST_LABEL, installAppPath]);
run('sudo', ['spctl', '--enable', '--label', TRUST_LABEL]);

let assessment = assessInstalledApp();
const assessmentOutput = `${assessment.stdout || ''}${assessment.stderr || ''}`;
if (assessment.status !== 0 && /Too many open files/i.test(assessmentOutput) && !args.has('--no-reset-services')) {
  console.warn('[electron] spctl reported Too many open files; restarting trust services once and retrying.');
  restartSecurityServices();
  assessment = assessInstalledApp();
}

if (assessment.status !== 0) {
  console.error('[electron] installed app was not accepted by Gatekeeper on this machine.');
  console.error('[electron] if spctl still reports Too many open files, restart macOS and run this script again.');
  process.exit(assessment.status || 1);
}

run('codesign', ['-dvvv', '--entitlements', ':-', installAppPath]);

if (!args.has('--no-open')) {
  run('open', [installAppPath]);
}

console.log(`\n[electron] installed and locally trusted: ${installAppPath}`);
