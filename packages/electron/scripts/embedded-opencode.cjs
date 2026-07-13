const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync: defaultExecFileSync } = require('node:child_process');

// electron-builder's final recursive signing pass normalizes a bare Mach-O
// identifier to its executable basename. Keep our pre-signing and metadata
// aligned with that stable final designated requirement.
const EMBEDDED_OPENCODE_IDENTIFIER = 'opencode';

const buildEmbeddedOpenCodeSignArgs = (signingIdentity) => {
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
    EMBEDDED_OPENCODE_IDENTIFIER,
    timestampArg,
  ];
};

const resolveEmbeddedOpenCodeSource = (env = process.env) => {
  const configured = typeof env.OPENCHAMBER_EMBEDDED_OPENCODE_SOURCE === 'string'
    ? env.OPENCHAMBER_EMBEDDED_OPENCODE_SOURCE.trim()
    : '';
  return configured || path.join(os.homedir(), '.opencode', 'bin', 'opencode');
};

const stageEmbeddedOpenCode = ({
  source,
  resourcesPath,
  signingIdentity,
  execFileSync = defaultExecFileSync,
}) => {
  if (!source || !fs.existsSync(source)) {
    throw new Error(`Embedded OpenCode source not found: ${source || '(empty)'}`);
  }
  fs.accessSync(source, fs.constants.R_OK | fs.constants.X_OK);
  if (!signingIdentity) {
    throw new Error('Embedding OpenCode requires CSC_NAME with an Apple Development or Developer ID Application identity.');
  }

  const destinationDir = path.join(resourcesPath, 'opencode');
  const binaryPath = path.join(destinationDir, 'opencode');
  fs.mkdirSync(destinationDir, { recursive: true });
  fs.copyFileSync(source, binaryPath);
  fs.chmodSync(binaryPath, 0o755);

  execFileSync('codesign', [...buildEmbeddedOpenCodeSignArgs(signingIdentity), binaryPath], {
    stdio: 'pipe',
  });
  execFileSync('codesign', ['--verify', '--strict', '--verbose=4', binaryPath], {
    stdio: 'pipe',
  });

  const version = String(execFileSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
  if (!version) throw new Error('Embedded OpenCode returned an empty version.');

  const metadataPath = path.join(destinationDir, 'metadata.json');
  fs.writeFileSync(metadataPath, `${JSON.stringify({
    identifier: EMBEDDED_OPENCODE_IDENTIFIER,
    version,
  }, null, 2)}\n`);

  return { binaryPath, metadataPath, version };
};

module.exports = {
  EMBEDDED_OPENCODE_IDENTIFIER,
  buildEmbeddedOpenCodeSignArgs,
  resolveEmbeddedOpenCodeSource,
  stageEmbeddedOpenCode,
};
