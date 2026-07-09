import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const APPLE_DEVELOPMENT_PREFIX = 'Apple Development:';
const DEVELOPER_ID_PREFIX = 'Developer ID Application:';

const readCodesigningIdentities = () => {
  if (process.platform !== 'darwin') return null;

  try {
    const output = execFileSync('security', ['find-identity', '-p', 'codesigning', '-v'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return output
      .split(/\r?\n/)
      .map((line) => line.match(/"([^"]+)"/)?.[1]?.trim() || '')
      .filter(Boolean);
  } catch {
    return null;
  }
};

const findIdentity = (prefix) => {
  return readCodesigningIdentities()?.find((identity) => identity.startsWith(prefix)) || null;
};

const env = { ...process.env };
const rawBuilderArgs = process.argv.slice(2);
const isReleaseSigningCheck = rawBuilderArgs.includes('--check-release-signing');
const builderArgs = rawBuilderArgs.filter((arg) => arg !== '--check-release-signing');
const isMac = process.platform === 'darwin';
const isDirBuild = builderArgs.includes('--dir');
const hasCertificateBundle = Boolean(env.CSC_LINK);
const hasExplicitIdentity = Boolean(env.CSC_NAME);
const disablesTimestamp = builderArgs.some((arg) => {
  return arg === '-c.mac.timestamp=none' || arg === '--config.mac.timestamp=none';
});

if (isMac && isDirBuild && !hasExplicitIdentity && !hasCertificateBundle) {
  const identity = findIdentity(APPLE_DEVELOPMENT_PREFIX);
  if (identity) {
    env.CSC_NAME = identity;
    builderArgs.push('-c.mac.timestamp=none');
    console.log(`[electron] using local app-only codesigning identity: ${identity}`);
  } else {
    console.warn('[electron] no Apple Development codesigning identity found; --dir build may be ad-hoc signed.');
  }
}

if (isMac && !isDirBuild) {
  if (disablesTimestamp) {
    console.error('[electron] release packaging must not disable signing timestamps.');
    process.exit(1);
  }

  if (hasExplicitIdentity && !env.CSC_NAME.startsWith(DEVELOPER_ID_PREFIX)) {
    console.error(`[electron] release packaging requires a ${DEVELOPER_ID_PREFIX} identity.`);
    console.error(`[electron] refused signing identity: ${env.CSC_NAME}`);
    console.error('[electron] use package:app for local app-only builds.');
    process.exit(1);
  }

  if (!hasExplicitIdentity && !hasCertificateBundle) {
    const identity = findIdentity(DEVELOPER_ID_PREFIX);
    if (!identity) {
      console.error(`[electron] release packaging requires a ${DEVELOPER_ID_PREFIX} certificate.`);
      console.error('[electron] no Developer ID Application identity was found in the keychain.');
      console.error('[electron] use package:app for local app-only builds, or install/provide release signing credentials.');
      process.exit(1);
    }

    env.CSC_NAME = identity;
    console.log(`[electron] using release codesigning identity: ${identity}`);
  } else if (hasCertificateBundle && !hasExplicitIdentity) {
    console.log('[electron] using CSC_LINK certificate material for release signing; verify with spctl after packaging.');
  }
}

if (isReleaseSigningCheck) {
  console.log('[electron] release signing preflight passed.');
  process.exit(0);
}

const builderCli = require.resolve('electron-builder/out/cli/cli.js');

const result = spawnSync(process.execPath, [builderCli, ...builderArgs], {
  env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[electron] failed to start electron-builder: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
