import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const electronBuilderEntry = require.resolve('electron-builder/out/cli/cli.js');
const electronBuilderRequire = createRequire(electronBuilderEntry);
const asarEntry = electronBuilderRequire.resolve('@electron/asar');
const { extractAll } = await import(pathToFileURL(asarEntry).href);

const electronRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(electronRoot, '..', '..');
const defaultSourceApp = path.join(electronRoot, 'dist', 'mac-arm64', 'OpenChamber.app');
const defaultInstalledApp = '/Applications/OpenChamber.app';
const defaultOutputRoot = path.join(electronRoot, 'dist-runtime');
const defaultInstallRoot = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'OpenChamber',
  'runtime',
);

const parseArgs = (argv) => {
  const result = { install: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--install') {
      result.install = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    result[key] = value;
    index += 1;
  }
  return result;
};

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const copyTree = (source, destination) => {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
  });
};

const MACH_O_MAGICS = new Set([
  'feedface',
  'feedfacf',
  'cefaedfe',
  'cffaedfe',
  'cafebabe',
  'cafebabf',
  'bebafeca',
  'bfbafeca',
]);

const isMachO = (filePath) => {
  const handle = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    if (fs.readSync(handle, header, 0, header.length, 0) !== header.length) return false;
    return MACH_O_MAGICS.has(header.toString('hex'));
  } finally {
    fs.closeSync(handle);
  }
};

const readCodeDirectoryHash = (filePath) => {
  const verification = spawnSync('codesign', ['--verify', '--strict', '--verbose=4', filePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (verification.status !== 0) {
    const detail = `${verification.stdout || ''}\n${verification.stderr || ''}`.trim();
    throw new Error(
      `Runtime native code has an invalid signature: ${filePath}`
      + (detail ? `\n${detail}` : ''),
    );
  }

  const result = spawnSync('codesign', ['-d', '--verbose=4', filePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`Unable to inspect CodeDirectory hash: ${filePath}`);
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const hash = output.match(/^CDHash=([a-f0-9]+)$/m)?.[1];
  if (!hash) {
    throw new Error(`Unable to read CodeDirectory hash: ${filePath}`);
  }
  return hash;
};

const walkFiles = (root) => {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(candidate);
      } else if (entry.isFile()) {
        result.push(candidate);
      }
    }
  };
  visit(root);
  return result;
};

const assertNativeRuntimeCompatibility = ({ sourceApp, shellApp }) => {
  const sourceRoot = path.join(sourceApp, 'Contents', 'Resources', 'app.asar.unpacked');
  const shellRoot = path.join(shellApp, 'Contents', 'Resources', 'app.asar.unpacked');
  const mismatches = [];

  for (const sourceFile of walkFiles(sourceRoot)) {
    if (!isMachO(sourceFile)) continue;
    const relativePath = path.relative(sourceRoot, sourceFile);
    const shellFile = path.join(shellRoot, relativePath);
    if (!fs.existsSync(shellFile) || readCodeDirectoryHash(shellFile) !== readCodeDirectoryHash(sourceFile)) {
      mismatches.push(relativePath);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      'Runtime update contains native code that is not present in the notarized shell. '
      + `Rebuild and notarize the shell first:\n${mismatches.join('\n')}`,
    );
  }
};

const writeOpenCodeRuntime = ({ runtimeRoot, opencodeRoot, opencodeVersion }) => {
  const opencodeDir = path.join(runtimeRoot, 'opencode');
  fs.mkdirSync(opencodeDir, { recursive: true });

  const bootstrapPath = path.join(opencodeDir, 'bootstrap.mjs');
  fs.writeFileSync(bootstrapPath, `import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceRoot = process.env.OPENCHAMBER_OPENCODE_SOURCE_ROOT;
const version = process.env.OPENCHAMBER_OPENCODE_VERSION;
const channel = process.env.OPENCHAMBER_OPENCODE_CHANNEL || 'latest';
if (!sourceRoot || !version) {
  throw new Error('OpenChamber did not provide the OpenCode source root and version');
}

Object.assign(globalThis, {
  OPENCODE_VERSION: version,
  OPENCODE_CHANNEL: channel,
});

// v1-line trees keep the entry at packages/opencode; v2 moved it to packages/cli.
const packageRoot = ['packages/opencode', 'packages/cli']
  .map((candidate) => path.join(sourceRoot, candidate))
  .find((candidate) => fs.existsSync(path.join(candidate, 'src', 'index.ts')));
if (!packageRoot) {
  throw new Error('OpenCode source entry (packages/*/src/index.ts) not found under ' + sourceRoot);
}
process.chdir(packageRoot);
await import(pathToFileURL(path.join(packageRoot, 'src', 'index.ts')).href);
`);

  const launcherPath = path.join(opencodeDir, 'opencode');
  fs.writeFileSync(launcherPath, `#!/bin/sh
set -eu
: "\${OPENCHAMBER_BUN_ENGINE:?missing OpenChamber Bun engine}"
: "\${OPENCHAMBER_RUNTIME_ROOT:?missing OpenChamber runtime root}"
: "\${OPENCHAMBER_OPENCODE_SOURCE_ROOT:?missing OpenCode source root}"
: "\${OPENCHAMBER_OPENCODE_VERSION:?missing OpenCode version}"
: "\${OPENCHAMBER_OPENCODE_CHANNEL:?missing OpenCode channel}"
# v2 reads version/channel from build-time defines; v1 reads the globalThis
# assignments made by the bootstrap. Defines are harmless for v1 sources.
exec "$OPENCHAMBER_BUN_ENGINE" \\
  -d "OPENCODE_VERSION:\\"\$OPENCHAMBER_OPENCODE_VERSION\\"" \\
  -d "OPENCODE_CHANNEL:\\"\$OPENCHAMBER_OPENCODE_CHANNEL\\"" \\
  -d "OPENCODE_ARTIFACT:'cli'" \\
  "$OPENCHAMBER_RUNTIME_ROOT/opencode/bootstrap.mjs" "$@"
`);
  fs.chmodSync(launcherPath, 0o755);

  return {
    bootstrapPath,
    launcherPath,
    sourceRoot: opencodeRoot,
    version: opencodeVersion,
  };
};

const validateJavaScript = (runtimeRoot) => {
  const files = [
    path.join(runtimeRoot, 'dist-bundle', 'main.mjs'),
    path.join(runtimeRoot, 'preload.mjs'),
    path.join(runtimeRoot, 'opencode', 'bootstrap.mjs'),
  ];
  for (const filePath of files) {
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
  }
};

const validateOpenCodeSourceRuntime = ({
  runtimeRoot,
  shellApp,
  opencodeRoot,
  opencodeVersion,
}) => {
  const enginePath = path.join(shellApp, 'Contents', 'Resources', 'engine', 'bun');
  const launcherPath = path.join(runtimeRoot, 'opencode', 'opencode');
  fs.accessSync(enginePath, fs.constants.R_OK | fs.constants.X_OK);
  const output = String(execFileSync(launcherPath, ['--version'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENCHAMBER_BUN_ENGINE: enginePath,
      OPENCHAMBER_RUNTIME_ROOT: runtimeRoot,
      OPENCHAMBER_OPENCODE_SOURCE_ROOT: opencodeRoot,
      OPENCHAMBER_OPENCODE_VERSION: opencodeVersion,
      OPENCHAMBER_OPENCODE_CHANNEL: 'latest',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
  // v2 reports `opencode v<version>`; v1 reported the bare version. Normalize
  // both to the bare -sscity version for the comparison.
  const normalized = output.replace(/^opencode\s+v?/, '');
  if (normalized !== opencodeVersion) {
    throw new Error(`OpenCode source runtime reported ${output || '(empty)'}; expected ${opencodeVersion}`);
  }
};

const validateServerImport = ({ runtimeRoot, shellApp }) => {
  const executable = path.join(shellApp, 'Contents', 'MacOS', 'OpenChamber');
  const serverUrl = pathToFileURL(
    path.join(runtimeRoot, 'node_modules', '@openchamber', 'web', 'server', 'index.js'),
  ).href;
  const script = `import(${JSON.stringify(serverUrl)})
    .then(() => process.exit(0))
    .catch((error) => { console.error(error); process.exit(1); });`;
  execFileSync(executable, ['--input-type=module', '--eval', script], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      OPENCHAMBER_RUNTIME: 'desktop',
      OPENCHAMBER_SKIP_OPENCODE_START: 'true',
      OPENCODE_SKIP_START: 'true',
    },
    stdio: 'pipe',
  });
};

const replaceSymlink = (linkPath, target) => {
  const temporary = `${linkPath}.new-${process.pid}`;
  fs.rmSync(temporary, { force: true, recursive: false });
  fs.symlinkSync(target, temporary);
  fs.renameSync(temporary, linkPath);
};

const installRuntime = ({ builtRoot, manifest, installRoot }) => {
  const versionsRoot = path.join(installRoot, 'versions');
  const destination = path.join(versionsRoot, manifest.id);
  fs.mkdirSync(versionsRoot, { recursive: true });

  if (!fs.existsSync(destination)) {
    const staging = path.join(installRoot, `.staging-${manifest.id}-${process.pid}`);
    fs.rmSync(staging, { recursive: true, force: true });
    copyTree(builtRoot, staging);
    fs.renameSync(staging, destination);
  }

  const currentLink = path.join(installRoot, 'current');
  let previousTarget = null;
  try {
    previousTarget = fs.readlinkSync(currentLink);
  } catch {
  }
  if (previousTarget && previousTarget !== path.join('versions', manifest.id)) {
    replaceSymlink(path.join(installRoot, 'previous'), previousTarget);
  }
  replaceSymlink(currentLink, path.join('versions', manifest.id));
  return destination;
};

const buildRuntime = (options) => {
  const sourceApp = path.resolve(options.sourceApp || defaultSourceApp);
  const installedShellUsable = fs.existsSync(
    path.join(defaultInstalledApp, 'Contents', 'Resources', 'engine', 'bun'),
  );
  const shellApp = path.resolve(
    options.shellApp || (installedShellUsable ? defaultInstalledApp : sourceApp),
  );
  const outputRoot = path.resolve(options.output || defaultOutputRoot);
  const installRoot = path.resolve(options.installRoot || defaultInstallRoot);
  // Fork default is opencode-v2 (the current line). The v1 sibling `opencode`
  // must stay unselected by a bare run: a default-fallback build once packaged
  // the v1 source and displaced an activated v2 runtime (2026-10-03).
  const opencodeRootOrigin = options.opencodeRoot
    ? 'option'
    : process.env.OPENCHAMBER_OPENCODE_SOURCE_ROOT ? 'env' : 'default(opencode-v2)';
  const opencodeRoot = fs.realpathSync(
    options.opencodeRoot || process.env.OPENCHAMBER_OPENCODE_SOURCE_ROOT || path.resolve(repoRoot, '..', 'opencode-v2'),
  );

  const resources = path.join(sourceApp, 'Contents', 'Resources');
  const asarPath = path.join(resources, 'app.asar');
  const unpackedPath = path.join(resources, 'app.asar.unpacked');
  fs.accessSync(asarPath, fs.constants.R_OK);
  fs.accessSync(path.join(shellApp, 'Contents', 'Resources', 'engine', 'bun'), fs.constants.R_OK | fs.constants.X_OK);
  assertNativeRuntimeCompatibility({ sourceApp, shellApp });

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-runtime-build-'));
  try {
    extractAll(asarPath, temporaryRoot);
    copyTree(unpackedPath, temporaryRoot);
    copyTree(path.join(resources, 'web-dist'), path.join(temporaryRoot, 'web-dist'));
    copyTree(path.join(resources, 'icons'), path.join(temporaryRoot, 'icons'));

    // OpenCode v1-line trees keep the package at packages/opencode; the v2
    // architecture moved the CLI package to packages/cli.
    const readOpencodePackageVersion = () => {
      for (const candidate of ['packages/opencode', 'packages/cli']) {
        const packagePath = path.join(opencodeRoot, candidate, 'package.json');
        if (fs.existsSync(packagePath)) return String(readJson(packagePath).version || '');
      }
      throw new Error(`OpenCode package.json not found under ${opencodeRoot}`);
    };
    const opencodeVersion = readOpencodePackageVersion();
    if (!/^\d+\.\d+\.\d+-sscity(?:[.+-].*)?$/.test(opencodeVersion)) {
      throw new Error(`OpenCode source version must identify the custom -sscity build: ${opencodeVersion || '(empty)'}`);
    }

    writeOpenCodeRuntime({
      runtimeRoot: temporaryRoot,
      opencodeRoot,
      opencodeVersion,
    });
    validateJavaScript(temporaryRoot);
    validateOpenCodeSourceRuntime({
      runtimeRoot: temporaryRoot,
      shellApp,
      opencodeRoot,
      opencodeVersion,
    });
    validateServerImport({ runtimeRoot: temporaryRoot, shellApp });

    const runtimePackage = readJson(path.join(temporaryRoot, 'package.json'));
    const integrityPaths = [
      'dist-bundle/main.mjs',
      'preload.mjs',
      'web-dist/index.html',
      'opencode/bootstrap.mjs',
      'opencode/opencode',
      'package.json',
    ];
    const files = Object.fromEntries(
      integrityPaths.map((relativePath) => [
        relativePath,
        sha256File(path.join(temporaryRoot, relativePath)),
      ]),
    );
    const contentId = crypto.createHash('sha256')
      .update(JSON.stringify(files))
      .digest('hex')
      .slice(0, 12);
    const version = String(runtimePackage.version || 'unknown');
    const id = `${version.replace(/[^a-zA-Z0-9._-]/g, '_')}-${contentId}`;
    const manifest = {
      schemaVersion: 1,
      shellApi: 1,
      id,
      version,
      createdAt: new Date().toISOString(),
      main: 'dist-bundle/main.mjs',
      files,
      opencode: {
        mode: 'bun-source',
        channel: 'latest',
        sourceRoot: opencodeRoot,
        version: opencodeVersion,
      },
    };
    fs.writeFileSync(
      path.join(temporaryRoot, 'runtime-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const builtRoot = path.join(outputRoot, id);
    fs.rmSync(builtRoot, { recursive: true, force: true });
    fs.mkdirSync(outputRoot, { recursive: true });
    copyTree(temporaryRoot, builtRoot);

    const installed = options.install
      ? installRuntime({ builtRoot, manifest, installRoot })
      : null;
    return { builtRoot, installed, manifest, shellApp, sourceApp, opencodeRootOrigin };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

try {
  const options = parseArgs(process.argv.slice(2));
  const result = buildRuntime(options);
  console.log(`[electron] runtime built: ${result.builtRoot}`);
  console.log(`[electron] runtime id: ${result.manifest.id}`);
  console.log(`[electron] OpenCode source: ${result.manifest.opencode.sourceRoot} (${result.opencodeRootOrigin})`);
  console.log(`[electron] OpenCode version: ${result.manifest.opencode.version}`);
  if (result.installed) {
    console.log(`[electron] runtime activated: ${result.installed}`);
  }
} catch (error) {
  console.error(`[electron] runtime build failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
}
