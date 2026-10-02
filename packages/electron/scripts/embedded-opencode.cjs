const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync: defaultExecFileSync } = require('node:child_process');

// electron-builder's final recursive signing pass normalizes a bare Mach-O
// identifier to its executable basename. Keep our pre-signing and metadata
// aligned with that stable final designated requirement.
const EMBEDDED_OPENCODE_IDENTIFIER = 'opencode';

// OpenCode v2 ships its CLI as the `@opencode/cli` npm platform-package
// tarball (compiled binary under package/bin/) instead of the v1 single
// compiled binary. Both layouts stage as exactly one executable plus
// metadata.json, so the signing flow is layout-independent.
const OPENCODE_TARBALL_PATTERN = /\.(?:tgz|tar\.gz)$/i;

// v1-line OpenCode trees keep the CLI package at packages/opencode; the v2
// architecture moved it to packages/cli. Same candidates and order as
// build-runtime.mjs — keep the two lists synchronized.
const OPENCODE_PACKAGE_DIR_CANDIDATES = ['packages/opencode', 'packages/cli'];

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
  return configured || path.join(os.homedir(), '.openchamber', 'bin', 'opencode');
};

// v1 answers `--version` with a bare semver; v2 answers `opencode v2.0.2`.
// metadata.json and the packaged-artifact verifiers compare the semver only,
// for both layouts.
const normalizeEmbeddedOpenCodeVersion = (output) => {
  const text = String(output || '').trim();
  const match = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/.exec(text);
  return match ? match[0] : text;
};

const isExecutableFile = (filePath) => {
  try {
    return fs.statSync(filePath).isFile() && fs.accessSync(filePath, fs.constants.X_OK) === undefined;
  } catch {
    return false;
  }
};

const findOpenCodeBinaryInPackageDist = (packageRoot, binaryName) => {
  const distRoot = path.join(packageRoot, 'dist');
  if (!fs.existsSync(distRoot)) return null;
  for (const entry of fs.readdirSync(distRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(distRoot, entry.name, 'bin', binaryName);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
};

const resolveOpenCodeBinaryFromDirectory = (directory, binaryName) => {
  // Extracted npm platform-package roots and per-target dist directories keep
  // the binary under bin/<name>; a bare <name> file is accepted too. The
  // exact-name match never hits the v2 JavaScript entry stub (opencode.cjs).
  for (const candidate of [path.join(directory, 'bin', binaryName), path.join(directory, binaryName)]) {
    if (isExecutableFile(candidate)) return candidate;
  }

  // A built CLI package directory (v1-line packages/opencode or v2
  // packages/cli): dist/<target>/bin/<name>.
  const built = findOpenCodeBinaryInPackageDist(directory, binaryName);
  if (built) return built;

  // A checkout root: probe the package candidates in the established
  // v1-then-v2 order (see build-runtime.mjs).
  for (const candidate of OPENCODE_PACKAGE_DIR_CANDIDATES) {
    const packageRoot = path.join(directory, candidate);
    if (!fs.existsSync(packageRoot)) continue;
    const found = findOpenCodeBinaryInPackageDist(packageRoot, binaryName);
    if (found) return found;
  }

  throw new Error(
    `No compiled OpenCode binary found in ${directory}. `
    + `A v2 source tree only ships a JavaScript entry stub (bin/${binaryName}.cjs), which cannot be embedded: `
    + 'the offline recovery fallback must be a real executable that answers --version. '
    + 'Build the binary per docs/EMBEDDED_OPENCODE_PACKAGING.md section 1 '
    + '(OPENCODE_CHANNEL=latest and an -sscity version), then stage it to ~/.openchamber/bin/opencode '
    + 'or point OPENCHAMBER_EMBEDDED_OPENCODE_SOURCE at the built binary, '
    + `for example <root>/packages/cli/dist/<target>/bin/${binaryName}.`,
  );
};

const findOpenCodeBinaryInTarball = (root, binaryName) => {
  const target = binaryName.toLowerCase();
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === target) return candidate;
      if (entry.isDirectory()) {
        const found = visit(candidate);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(root);
};

const resolveOpenCodeTarballSource = (tarballPath, { binaryName, execFileSync }) => {
  // Readable is enough: npm tarballs are commonly downloaded without an
  // execute bit.
  fs.accessSync(tarballPath, fs.constants.R_OK);
  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-opencode-cli-'));
  try {
    // npm platform-package tarballs are gzipped tar on every platform. The
    // archive is addressed relative to the destination: GNU tar under Git Bash
    // on Windows reads an absolute `D:\...` path as a remote host.
    execFileSync('tar', ['-xzf', path.relative(extractionRoot, tarballPath)], {
      cwd: extractionRoot,
      stdio: 'pipe',
    });
    const binaryPath = findOpenCodeBinaryInTarball(extractionRoot, binaryName);
    if (!binaryPath) {
      throw new Error(`OpenCode CLI tarball did not contain ${binaryName}: ${tarballPath}`);
    }
    return {
      binaryPath,
      cleanup: () => fs.rmSync(extractionRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(extractionRoot, { recursive: true, force: true });
    throw error;
  }
};

// Resolves the configured staging source to the concrete executable that gets
// embedded:
// - a plain file is the v1 single compiled binary and is staged as-is;
// - a .tgz/.tar.gz file is the v2 npm platform-package tarball and is
//   extracted to locate the binary;
// - a directory is a v2 source or extracted tree and must contain a compiled
//   binary (never a JavaScript entry stub).
const resolveEmbeddedOpenCodeLayout = (source, { binaryName, execFileSync }) => {
  const stats = fs.statSync(source);
  if (stats.isFile()) {
    if (OPENCODE_TARBALL_PATTERN.test(source)) {
      return resolveOpenCodeTarballSource(source, { binaryName, execFileSync });
    }
    // v1 layout: unchanged read+execute requirements for byte-stable behavior.
    fs.accessSync(source, fs.constants.R_OK | fs.constants.X_OK);
    return { binaryPath: source };
  }
  if (stats.isDirectory()) {
    fs.accessSync(source, fs.constants.R_OK | fs.constants.X_OK);
    return { binaryPath: resolveOpenCodeBinaryFromDirectory(source, binaryName) };
  }
  throw new Error(`Embedded OpenCode source is neither a binary, a tarball, nor a directory: ${source}`);
};

const stageEmbeddedOpenCode = ({
  source,
  resourcesPath,
  binaryName = 'opencode',
  signingIdentity,
  requireSigning = true,
  execFileSync = defaultExecFileSync,
}) => {
  if (!source || !fs.existsSync(source)) {
    throw new Error(`Embedded OpenCode source not found: ${source || '(empty)'}`);
  }

  const layout = resolveEmbeddedOpenCodeLayout(source, { binaryName, execFileSync });
  try {
    const destinationDir = path.join(resourcesPath, 'opencode');
    const binaryPath = path.join(destinationDir, binaryName);
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.copyFileSync(layout.binaryPath, binaryPath);
    fs.chmodSync(binaryPath, 0o755);

    if (signingIdentity) {
      execFileSync('codesign', [...buildEmbeddedOpenCodeSignArgs(signingIdentity), binaryPath], {
        stdio: 'pipe',
      });
      execFileSync('codesign', ['--verify', '--strict', '--verbose=4', binaryPath], {
        stdio: 'pipe',
      });
    }

    const version = normalizeEmbeddedOpenCodeVersion(String(execFileSync(binaryPath, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })));
    if (!version) throw new Error('Embedded OpenCode returned an empty version.');

    const metadataPath = path.join(destinationDir, 'metadata.json');
    fs.writeFileSync(metadataPath, `${JSON.stringify({
      identifier: EMBEDDED_OPENCODE_IDENTIFIER,
      version,
    }, null, 2)}\n`);

    return { binaryPath, metadataPath, version };
  } finally {
    layout.cleanup?.();
  }
};

module.exports = {
  EMBEDDED_OPENCODE_IDENTIFIER,
  buildEmbeddedOpenCodeSignArgs,
  normalizeEmbeddedOpenCodeVersion,
  resolveEmbeddedOpenCodeLayout,
  resolveEmbeddedOpenCodeSource,
  stageEmbeddedOpenCode,
};
