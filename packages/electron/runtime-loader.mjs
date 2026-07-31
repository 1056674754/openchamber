import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RUNTIME_SCHEMA_VERSION = 1;
export const SHELL_API_VERSION = 1;
export const RUNTIME_MANIFEST_NAME = 'runtime-manifest.json';

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const resolveContainedPath = (root, relativePath) => {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid runtime-relative path: ${String(relativePath)}`);
  }

  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Runtime path escapes its root: ${relativePath}`);
  }
  return resolved;
};

export const readAndValidateRuntime = (runtimeRoot) => {
  const root = fs.realpathSync(runtimeRoot);
  const manifestPath = path.join(root, RUNTIME_MANIFEST_NAME);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (manifest.schemaVersion !== RUNTIME_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported runtime schema ${String(manifest.schemaVersion)}; expected ${RUNTIME_SCHEMA_VERSION}`,
    );
  }
  if (manifest.shellApi !== SHELL_API_VERSION) {
    throw new Error(
      `Incompatible shell API ${String(manifest.shellApi)}; expected ${SHELL_API_VERSION}`,
    );
  }
  if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
    throw new Error('Runtime manifest is missing its id');
  }
  if (typeof manifest.main !== 'string' || manifest.main.length === 0) {
    throw new Error('Runtime manifest is missing its main entrypoint');
  }
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('Runtime manifest is missing its integrity map');
  }

  const mainPath = resolveContainedPath(root, manifest.main);
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
      throw new Error(`Invalid integrity hash for ${relativePath}`);
    }
    const filePath = resolveContainedPath(root, relativePath);
    if (!fs.statSync(filePath).isFile()) {
      throw new Error(`Runtime integrity target is not a file: ${relativePath}`);
    }
    const actualHash = sha256File(filePath);
    if (actualHash !== expectedHash) {
      throw new Error(`Runtime integrity mismatch: ${relativePath}`);
    }
  }

  if (!fs.statSync(mainPath).isFile()) {
    throw new Error(`Runtime main entrypoint is not a file: ${manifest.main}`);
  }

  return { root, manifest, mainPath };
};

export const resolveRuntime = ({
  env = process.env,
  appDataPath,
  embeddedRoot,
}) => {
  const explicitRoot = typeof env.OPENCHAMBER_RUNTIME_DIR === 'string'
    ? env.OPENCHAMBER_RUNTIME_DIR.trim()
    : '';
  if (explicitRoot) {
    return {
      ...readAndValidateRuntime(explicitRoot),
      source: 'external',
      fallbackReason: null,
    };
  }

  const currentRuntime = path.join(appDataPath, 'OpenChamber', 'runtime', 'current');
  try {
    return {
      ...readAndValidateRuntime(currentRuntime),
      source: 'external',
      fallbackReason: null,
    };
  } catch (error) {
    return {
      root: embeddedRoot,
      manifest: null,
      mainPath: path.join(embeddedRoot, 'dist-bundle', 'main.mjs'),
      source: 'embedded',
      fallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
};

