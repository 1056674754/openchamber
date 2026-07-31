const fs = require('node:fs');
const path = require('node:path');
const { execFileSync: defaultExecFileSync } = require('node:child_process');

const EMBEDDED_BUN_IDENTIFIER = 'openchamber-bun-engine';

const buildEmbeddedBunSignArgs = (signingIdentity) => {
  const timestampArg = signingIdentity.startsWith('Developer ID Application:')
    ? '--timestamp'
    : '--timestamp=none';

  return [
    '--force',
    '--options',
    'runtime',
    '--sign',
    signingIdentity,
    '--identifier',
    EMBEDDED_BUN_IDENTIFIER,
    timestampArg,
  ];
};

const resolveEmbeddedBunSource = (
  env = process.env,
  execFileSync = defaultExecFileSync,
) => {
  const configured = typeof env.OPENCHAMBER_BUN_ENGINE_SOURCE === 'string'
    ? env.OPENCHAMBER_BUN_ENGINE_SOURCE.trim()
    : '';
  if (configured) return configured;

  return String(execFileSync('sh', ['-lc', 'command -v bun'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
};

const stageEmbeddedBun = ({
  source,
  resourcesPath,
  signingIdentity,
  execFileSync = defaultExecFileSync,
}) => {
  if (!source || !fs.existsSync(source)) {
    throw new Error(`Embedded Bun source not found: ${source || '(empty)'}`);
  }
  fs.accessSync(source, fs.constants.R_OK | fs.constants.X_OK);
  if (!signingIdentity) {
    throw new Error('Embedding Bun requires CSC_NAME with an Apple Development or Developer ID Application identity.');
  }

  const destinationDir = path.join(resourcesPath, 'engine');
  const binaryPath = path.join(destinationDir, 'bun');
  fs.mkdirSync(destinationDir, { recursive: true });
  fs.copyFileSync(source, binaryPath);
  fs.chmodSync(binaryPath, 0o755);

  execFileSync('codesign', [...buildEmbeddedBunSignArgs(signingIdentity), binaryPath], {
    stdio: 'pipe',
  });
  execFileSync('codesign', ['--verify', '--strict', '--verbose=4', binaryPath], {
    stdio: 'pipe',
  });

  const version = String(execFileSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
  if (!version) throw new Error('Embedded Bun returned an empty version.');

  const metadataPath = path.join(destinationDir, 'metadata.json');
  fs.writeFileSync(metadataPath, `${JSON.stringify({
    identifier: EMBEDDED_BUN_IDENTIFIER,
    version,
  }, null, 2)}\n`);

  return { binaryPath, metadataPath, version };
};

module.exports = {
  EMBEDDED_BUN_IDENTIFIER,
  buildEmbeddedBunSignArgs,
  resolveEmbeddedBunSource,
  stageEmbeddedBun,
};

