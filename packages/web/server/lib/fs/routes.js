import { createRealpathCache } from '../path-realpath-cache.js';
import { resolveByteRange } from './byte-range.js';
import nodeFsPromises from 'node:fs/promises';
import nodePath from 'node:path';

const OUTSIDE_FILE_GRANT_TTL_MS = 10 * 60 * 1000;
const outsideFileGrants = new Map();

// The MIME types /api/fs/raw answers with. Beyond images, these let the file
// viewer hand PDFs, audio, video and fonts to the browser's own machinery.
const FILE_MIME_MAP = Object.freeze({
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.mmd': 'text/plain',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.weba': 'audio/webm',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
});

const pruneOutsideFileGrants = () => {
  const now = Date.now();
  for (const [token, grant] of outsideFileGrants.entries()) {
    if (!grant || grant.expiresAt <= now) outsideFileGrants.delete(token);
  }
};

export const mintOutsideFileGrant = async (targetPath, {
  scopes = ['stat', 'read', 'raw'],
  fsPromises = nodeFsPromises,
  path = nodePath,
  crypto = globalThis.crypto,
} = {}) => {
  const raw = typeof targetPath === 'string' ? targetPath.trim() : '';
  if (!raw) throw new Error('Path is required');
  const canonicalPath = await fsPromises.realpath(path.resolve(raw));
  const token = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
  const expiresAt = Date.now() + OUTSIDE_FILE_GRANT_TTL_MS;
  outsideFileGrants.set(token, {
    canonicalPath,
    scopes: new Set(scopes),
    expiresAt,
  });
  return { path: canonicalPath, outsideFileGrant: token, expiresAt };
};

const resolveOutsideFileGrant = async ({ token, targetPath, scope, fsPromises }) => {
  pruneOutsideFileGrants();
  const grant = typeof token === 'string' ? outsideFileGrants.get(token.trim()) : null;
  if (!grant) return { ok: false, error: 'Outside workspace file grant is invalid or expired' };
  if (!grant.scopes.has(scope)) return { ok: false, error: 'Outside workspace file grant does not allow this operation' };
  const canonicalPath = await fsPromises.realpath(targetPath);
  if (canonicalPath !== grant.canonicalPath) return { ok: false, error: 'Outside workspace file grant does not match this path' };
  return { ok: true, base: nodePath.dirname(canonicalPath), resolved: canonicalPath };
};

const isOsPermissionError = (error) => (
  error
  && typeof error === 'object'
  && (error.code === 'EACCES' || error.code === 'EPERM')
);

const sendOsPermissionDenied = (res, message) => (
  res.status(403).json({ error: message, reason: 'os-permission' })
);

const EXEC_JOB_TTL_MS = 30 * 60 * 1000;

const createUploadMaxBytes = () => {
  const raw = Number(process.env.OPENCHAMBER_FS_UPLOAD_MAX_BYTES);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 100 * 1024 * 1024;
};

const streamUploadBody = async (req, handle, maxBytes) => {
  let received = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > maxBytes) {
      req.resume?.();
      const error = new Error('Upload exceeds the maximum allowed size');
      error.uploadTooLarge = true;
      throw error;
    }

    let offset = 0;
    while (offset < buffer.length) {
      const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, null);
      if (!Number.isFinite(bytesWritten) || bytesWritten <= 0) {
        throw new Error('Failed to write upload');
      }
      offset += bytesWritten;
    }
  }
};

const createCommandTimeoutMs = () => {
  const raw = Number(process.env.OPENCHAMBER_FS_EXEC_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 5 * 60 * 1000;
};

const createGitReadCacheTtlMs = () => {
  const raw = Number(process.env.OPENCHAMBER_GIT_READ_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 30 * 1000;
};

const createGitCheckIgnoreTimeoutMs = () => {
  const raw = Number(process.env.OPENCHAMBER_GIT_CHECK_IGNORE_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 2500;
};

const normalizeCommand = (command) =>
  typeof command === 'string' ? command.trim().replace(/\s+/g, ' ') : '';

const isCacheableGitReadCommand = (command) => {
  const normalized = normalizeCommand(command);
  return /^git rev-parse(?: --(?:absolute-git-dir|git-common-dir|show-toplevel)){1,3}$/.test(normalized);
};

const GIT_READ_CACHE_MAX_ENTRIES = 500;
const GIT_READ_CACHE_MAX_BYTES = 1024 * 1024;

const gitReadEntryBytes = (key, result) =>
  key.length + (result?.stdout?.length || 0) + (result?.stderr?.length || 0);

const isPathWithinRoot = (resolvedPath, rootPath, path, os) => {
  const resolvedRoot = path.resolve(rootPath || os.homedir());
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false;
  }
  return true;
};

const resolveRealWorkspacePath = async ({ resolvedPath, path, realpathCache }) => {
  const parts = [];
  let current = resolvedPath;

  while (true) {
    try {
      const realCurrent = await realpathCache.resolve(current);
      return parts.length > 0 ? path.join(realCurrent, ...parts.reverse()) : realCurrent;
    } catch (error) {
      const err = error;
      if (!err || typeof err !== 'object' || err.code !== 'ENOENT') {
        return path.resolve(resolvedPath);
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(resolvedPath);
    }
    parts.push(path.basename(current));
    current = parent;
  }
};

const resolveWorkspacePath = async ({ targetPath, baseDirectory, path, os, normalizeDirectoryPath, openchamberUserConfigRoot, realpathCache }) => {
  const normalized = normalizeDirectoryPath(targetPath);
  if (!normalized || typeof normalized !== 'string') {
    return { ok: false, error: 'Path is required' };
  }

  const resolved = path.resolve(normalized);
  const resolvedBase = path.resolve(baseDirectory || os.homedir());
  const canonicalBase = await realpathCache.resolve(resolvedBase).catch(() => resolvedBase);

  // Resolve the parent directory (not the file itself) so the link path can be
  // compared against the canonical base consistently — the base may use a
  // different symlink prefix (e.g. /var vs /private/var on macOS). Crucially,
  // resolving only the parent keeps the final symlink component intact, so
  // symlinks inside the workspace whose targets point elsewhere are allowed.
  const canonicalParent = await realpathCache.resolve(path.dirname(resolved)).catch(() => path.dirname(resolved));
  const canonicalLink = path.join(canonicalParent, path.basename(resolved));
  if (isPathWithinRoot(canonicalLink, canonicalBase, path, os)) {
    return { ok: true, base: canonicalBase, resolved: canonicalLink };
  }

  const canonicalResolved = await resolveRealWorkspacePath({ resolvedPath: resolved, path, realpathCache });

  if (isPathWithinRoot(canonicalResolved, canonicalBase, path, os)) {
    return { ok: true, base: canonicalBase, resolved: canonicalResolved };
  }

  if (openchamberUserConfigRoot) {
    const configRoot = path.resolve(openchamberUserConfigRoot);
    const canonicalConfigRoot = await realpathCache.resolve(configRoot).catch(() => configRoot);
    if (isPathWithinRoot(canonicalLink, canonicalConfigRoot, path, os)
      || isPathWithinRoot(canonicalResolved, canonicalConfigRoot, path, os)) {
      return { ok: true, base: canonicalConfigRoot, resolved };
    }
  }

  return { ok: false, error: 'Path is outside of active workspace' };
};

const resolveWorkspacePathFromWorktrees = async ({ targetPath, baseDirectory, path, os, normalizeDirectoryPath, realpathCache }) => {
  const normalized = normalizeDirectoryPath(targetPath);
  if (!normalized || typeof normalized !== 'string') {
    return { ok: false, error: 'Path is required' };
  }

  const resolved = path.resolve(normalized);
  const canonicalResolved = await resolveRealWorkspacePath({ resolvedPath: resolved, path, realpathCache });
  const resolvedBase = path.resolve(baseDirectory || os.homedir());

  try {
    const { getWorktrees } = await import('../git/index.js');
    const worktrees = await getWorktrees(resolvedBase);

    for (const worktree of worktrees) {
      const candidatePath = typeof worktree?.path === 'string'
        ? worktree.path
        : (typeof worktree?.worktree === 'string' ? worktree.worktree : '');
      const candidate = normalizeDirectoryPath(candidatePath);
      if (!candidate) {
        continue;
      }
      const candidateResolved = path.resolve(candidate);
      const canonicalCandidate = await realpathCache.resolve(candidateResolved).catch(() => candidateResolved);
      if (isPathWithinRoot(canonicalResolved, canonicalCandidate, path, os)) {
        return { ok: true, base: canonicalCandidate, resolved: canonicalResolved };
      }
    }
  } catch (error) {
    console.warn('Failed to resolve worktree roots:', error);
  }

  return { ok: false, error: 'Path is outside of active workspace' };
};

const resolveWorkspacePathFromContext = async ({ req, targetPath, resolveRequiredExplicitProjectDirectory, path, os, normalizeDirectoryPath, openchamberUserConfigRoot, realpathCache }) => {
  const resolvedProject = await resolveRequiredExplicitProjectDirectory(req);
  if (!resolvedProject.directory) {
    return { ok: false, error: resolvedProject.error || 'Active workspace is required' };
  }

  const resolved = await resolveWorkspacePath({
    targetPath,
    baseDirectory: resolvedProject.directory,
    path,
    os,
    normalizeDirectoryPath,
    openchamberUserConfigRoot,
    realpathCache,
  });
  if (resolved.ok || resolved.error !== 'Path is outside of active workspace') {
    return resolved;
  }

  return resolveWorkspacePathFromWorktrees({
    targetPath,
    baseDirectory: resolvedProject.directory,
    path,
    os,
    normalizeDirectoryPath,
    realpathCache,
  });
};

const deriveCloneDirectoryName = (remoteUrl) => {
  const remote = typeof remoteUrl === 'string' ? remoteUrl.trim() : '';
  if (!remote) return '';
  const withoutQuery = remote.split(/[?#]/, 1)[0] || remote;
  const match = withoutQuery.match(/([^/:]+?)(?:\.git)?\/?$/);
  return match?.[1]?.trim() || '';
};

const resolveCloneGitIdentity = async (gitIdentityId) => {
  const id = typeof gitIdentityId === 'string' ? gitIdentityId.trim() : '';
  if (!id) return null;
  const { getProfile, getGlobalIdentity } = await import('../git/index.js');
  if (id === 'global') {
    const globalIdentity = await getGlobalIdentity();
    if (!globalIdentity?.userName || !globalIdentity?.userEmail) return null;
    return {
      id: 'global',
      name: 'Global Identity',
      userName: globalIdentity.userName,
      userEmail: globalIdentity.userEmail,
      sshKey: globalIdentity.sshCommand ? globalIdentity.sshCommand.replace('ssh -i ', '') : null,
    };
  }
  return getProfile(id) || null;
};

const escapeCloneSshKeyPath = (sshKeyPath) => {
  const raw = String(sshKeyPath || '').trim();
  if (!raw) return '';
  const normalized = process.platform === 'win32' ? raw.replace(/\\/g, '/') : raw;
  const dangerousChars = /[`$!"';&|<>(){}[\]*?#~]/;
  if (dangerousChars.test(normalized)) {
    throw new Error(`SSH key path contains invalid characters: ${raw}`);
  }
  if (process.platform === 'win32') {
    const driveMatch = normalized.match(/^([A-Za-z]):\//);
    const unixPath = driveMatch ? `/${driveMatch[1].toLowerCase()}${normalized.slice(2)}` : normalized;
    return `'${unixPath}'`;
  }
  return `'${normalized.replace(/'/g, "'\\''")}'`;
};

const resolveReadPathFromContext = async ({ req, targetPath, scope, resolveRequiredExplicitProjectDirectory, path, os, fsPromises, normalizeDirectoryPath, openchamberUserConfigRoot, realpathCache }) => {
  if (req.query?.allowOutsideWorkspace === 'true') {
    const normalized = normalizeDirectoryPath(targetPath);
    if (!normalized || typeof normalized !== 'string') {
      return { ok: false, error: 'Path is required' };
    }
    const resolved = path.resolve(normalized);
    if (req.query?.outsideFileGrant) {
      return resolveOutsideFileGrant({
        token: req.query.outsideFileGrant,
        targetPath: resolved,
        scope,
        fsPromises,
      });
    }
    // Resolve symlinks first: the read/stat/raw handlers re-run realpath() and
    // check the canonical path is within the canonical base. A symlink whose
    // target lives outside its own parent would otherwise fail that check even
    // though allowOutsideWorkspace was explicitly requested.
    const canonicalResolved = await resolveRealWorkspacePath({ resolvedPath: resolved, path, realpathCache });
    return { ok: true, base: path.dirname(canonicalResolved), resolved: canonicalResolved };
  }

  return resolveWorkspacePathFromContext({
    req,
    targetPath,
    resolveRequiredExplicitProjectDirectory,
    path,
    os,
    normalizeDirectoryPath,
    openchamberUserConfigRoot,
    realpathCache,
  });
};

const runCommandInDirectory = ({ shell, shellFlag, command, resolvedCwd, spawn, buildAugmentedPath, commandTimeoutMs }) => {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const envPath = buildAugmentedPath();
    const execEnv = { ...process.env, PATH: envPath };

    const child = spawn(shell, [shellFlag, command], {
      cwd: resolvedCwd,
      env: execEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
      }
    }, commandTimeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        command,
        success: false,
        exitCode: undefined,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: (error && error.message) || 'Command execution failed',
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const exitCode = typeof code === 'number' ? code : undefined;
      const base = {
        command,
        success: exitCode === 0 && !timedOut,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };

      if (timedOut) {
        resolve({
          ...base,
          success: false,
          error: `Command timed out after ${commandTimeoutMs}ms` + (signal ? ` (${signal})` : ''),
        });
        return;
      }

      resolve(base);
    });
  });
};


// Nested repository discovery bounds: only shallow walks are useful for the
// Git tab's "pick a repository" picker, and deep/monorepo trees can explode
// otherwise. Directories deeper than maxDepth or beyond the visit cap are
// silently not searched.
const GIT_DIRS_MAX_DEPTH = 3;
const GIT_DIRS_MAX_DIRS = 100;
const GIT_DIRS_SKIP_LIST = new Set(['node_modules', 'dist', 'build', '.venv', 'target', '.next']);

// Walks rootPath and returns every nested git repository path (a directory
// containing a `.git` entry — a directory, a worktree pointer file, or a
// symlink). A repository boundary stops descent: nested repos inside repos
// are not reported. The root itself, when it is a repo, yields no results.
// Symlinked directories are followed, the way the file tree follows them: a
// parent folder of links to repositories kept elsewhere is a common way to
// group them into one project. Each real directory is walked once, so a link
// loop or two links to one repository cannot repeat it, and repositories are
// reported under the path the link gives them inside the project.
const findGitDirectories = async ({ rootPath, fsPromises, path: pathModule, maxDepth, maxDirs }) => {
  const results = [];
  const walkedRealPaths = new Set();
  let visited = 0;

  const walk = async (dir, depth) => {
    if (visited >= maxDirs) {
      return;
    }

    let realPath;
    try {
      realPath = await fsPromises.realpath(dir);
    } catch (error) {
      if (dir === rootPath) {
        throw error;
      }
      return;
    }
    if (walkedRealPaths.has(realPath)) {
      return;
    }
    walkedRealPaths.add(realPath);

    let dirents;
    try {
      dirents = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch (error) {
      // Unreadable subtree — skip it unless it is the root itself, which the
      // route maps to 403/404/500 through the shared error handling.
      if (dir === rootPath) {
        throw error;
      }
      return;
    }
    visited += 1;

    let isRepoBoundary = false;
    const subdirectories = [];
    for (const dirent of dirents) {
      if (dirent.name === '.git') {
        isRepoBoundary = true;
        continue;
      }
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) {
        continue;
      }
      if (GIT_DIRS_SKIP_LIST.has(dirent.name)) {
        continue;
      }
      if (depth >= maxDepth) {
        continue;
      }
      if (dirent.isSymbolicLink()) {
        // A link to a file, or a dangling one, is not a place to look.
        const target = await fsPromises.stat(pathModule.join(dir, dirent.name)).catch(() => null);
        if (!target?.isDirectory()) {
          continue;
        }
      }
      subdirectories.push(dirent.name);
    }

    if (isRepoBoundary) {
      if (dir !== rootPath) {
        results.push(dir);
      }
      return;
    }

    subdirectories.sort();
    for (const name of subdirectories) {
      if (visited >= maxDirs) {
        break;
      }
      await walk(pathModule.join(dir, name), depth + 1);
    }
  };

  await walk(rootPath, 0);
  return results;
};

export const registerFsRoutes = (app, dependencies) => {
  const {
    os,
    path,
    fsPromises,
    spawn,
    platform = process.platform,
    crypto,
    normalizeDirectoryPath,
    resolveRequiredExplicitProjectDirectory,
    buildAugmentedPath,
    resolveGitBinaryForSpawn,
    openchamberUserConfigRoot,
  } = dependencies;
  const realpathCache = createRealpathCache({
    realpath: fsPromises.realpath.bind(fsPromises),
  });

  const spawnDetached = (command, args) => new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: 'ignore', detached: true });
    } catch (error) {
      reject(new Error('Failed to launch file browser', { cause: error }));
      return;
    }
    const onError = (error) => {
      child.removeListener('spawn', onSpawn);
      reject(new Error('Failed to launch file browser', { cause: error }));
    };
    const onSpawn = () => {
      child.removeListener('error', onError);
      child.unref();
      resolve();
    };
    child.once('error', onError);
    child.once('spawn', onSpawn);
  });

  const execJobs = new Map();
  const commandTimeoutMs = createCommandTimeoutMs();
  const gitReadCacheTtlMs = createGitReadCacheTtlMs();
  const gitCheckIgnoreTimeoutMs = createGitCheckIgnoreTimeoutMs();
  const gitReadCache = new Map();
  const inFlightGitReadCache = new Map();

  const pruneExecJobs = () => {
    const now = Date.now();
    for (const [jobId, job] of execJobs.entries()) {
      if (!job || typeof job !== 'object') {
        execJobs.delete(jobId);
        continue;
      }
      const updatedAt = typeof job.updatedAt === 'number' ? job.updatedAt : 0;
      if (updatedAt && now - updatedAt > EXEC_JOB_TTL_MS) {
        execJobs.delete(jobId);
      }
    }
  };

  const pruneGitReadCache = () => {
    if (gitReadCacheTtlMs <= 0) {
      return;
    }
    const now = Date.now();
    for (const [key, entry] of gitReadCache.entries()) {
      if (!entry || now - entry.at > gitReadCacheTtlMs) {
        gitReadCache.delete(key);
      }
    }
  };

  const setGitReadCacheEntry = (key, result) => {
    gitReadCache.delete(key);
    gitReadCache.set(key, { result, at: Date.now() });

    let totalBytes = 0;
    for (const [entryKey, entry] of gitReadCache) {
      totalBytes += gitReadEntryBytes(entryKey, entry.result);
    }

    while (
      gitReadCache.size > GIT_READ_CACHE_MAX_ENTRIES ||
      (totalBytes > GIT_READ_CACHE_MAX_BYTES && gitReadCache.size > 1)
    ) {
      const oldest = gitReadCache.entries().next().value;
      if (!oldest) {
        break;
      }
      totalBytes -= gitReadEntryBytes(oldest[0], oldest[1].result);
      gitReadCache.delete(oldest[0]);
    }
  };

  const runCommandWithGitReadCache = async ({ shell, shellFlag, command, resolvedCwd }) => {
    const cacheable = gitReadCacheTtlMs > 0 && isCacheableGitReadCommand(command);
    const cacheKey = cacheable ? `${resolvedCwd}\0${normalizeCommand(command)}` : null;

    if (cacheKey) {
      const cached = gitReadCache.get(cacheKey);
      if (cached && Date.now() - cached.at < gitReadCacheTtlMs) {
        gitReadCache.delete(cacheKey);
        gitReadCache.set(cacheKey, cached);
        return { ...cached.result, command };
      }
      if (cached) {
        gitReadCache.delete(cacheKey);
      }

      const inFlight = inFlightGitReadCache.get(cacheKey);
      if (inFlight) {
        const result = await inFlight;
        return { ...result, command };
      }
    }

    const runPromise = runCommandInDirectory({
      shell,
      shellFlag,
      command,
      resolvedCwd,
      spawn,
      buildAugmentedPath,
      commandTimeoutMs,
    }).then((result) => {
      if (cacheKey && result && result.success) {
        setGitReadCacheEntry(cacheKey, result);
      }
      return result;
    }).finally(() => {
      if (cacheKey && inFlightGitReadCache.get(cacheKey) === runPromise) {
        inFlightGitReadCache.delete(cacheKey);
      }
    });

    if (cacheKey) {
      inFlightGitReadCache.set(cacheKey, runPromise);
    }

    return runPromise;
  };

  const runExecJob = async (job) => {
    job.status = 'running';
    job.updatedAt = Date.now();

    const results = [];
    for (const command of job.commands) {
      if (typeof command !== 'string' || !command.trim()) {
        results.push({ command, success: false, error: 'Invalid command' });
        continue;
      }

      try {
        const result = await runCommandWithGitReadCache({
          shell: job.shell,
          shellFlag: job.shellFlag,
          command,
          resolvedCwd: job.resolvedCwd,
        });
        results.push(result);
      } catch (error) {
        results.push({
          command,
          success: false,
          error: (error && error.message) || 'Command execution failed',
        });
      }

      job.results = results;
      job.updatedAt = Date.now();
    }

    job.results = results;
    job.success = results.every((r) => r.success);
    job.status = 'done';
    job.finishedAt = Date.now();
    job.updatedAt = Date.now();
  };

  app.get('/api/fs/home', (_req, res) => {
    try {
      const home = os.homedir();
      if (!home || typeof home !== 'string' || home.length === 0) {
        return res.status(500).json({ error: 'Failed to resolve home directory' });
      }
      return res.json({ home });
    } catch (error) {
      console.error('Failed to resolve home directory:', error);
      return res.status(500).json({ error: (error && error.message) || 'Failed to resolve home directory' });
    }
  });

  app.post('/api/fs/mkdir', async (req, res) => {
    try {
      const { path: dirPath, allowOutsideWorkspace } = req.body ?? {};
      if (typeof dirPath !== 'string' || !dirPath.trim()) {
        return res.status(400).json({ error: 'Path is required' });
      }

      let resolvedPath = '';
      if (allowOutsideWorkspace) {
        resolvedPath = path.resolve(normalizeDirectoryPath(dirPath));
      } else {
        const resolved = await resolveWorkspacePathFromContext({
          req,
          targetPath: dirPath,
          resolveRequiredExplicitProjectDirectory,
          path,
          os,
          normalizeDirectoryPath,
          openchamberUserConfigRoot,
          realpathCache,
        });
        if (!resolved.ok) {
          return res.status(400).json({ error: resolved.error });
        }
        resolvedPath = resolved.resolved;
      }

      await fsPromises.mkdir(resolvedPath, { recursive: true });
      return res.json({ success: true, path: resolvedPath });
    } catch (error) {
      console.error('Failed to create directory:', error);
      return res.status(500).json({ error: error.message || 'Failed to create directory' });
    }
  });

  app.post('/api/fs/clone', async (req, res) => {
    try {
      const { remoteUrl, destinationPath, gitIdentityId } = req.body ?? {};
      const remote = typeof remoteUrl === 'string' ? remoteUrl.trim() : '';
      const destination = typeof destinationPath === 'string' ? destinationPath.trim() : '';
      if (!remote) {
        return res.status(400).json({ error: 'Repository URL is required' });
      }
      if (!destination) {
        return res.status(400).json({ error: 'Destination path is required' });
      }

      let resolvedDestination = path.resolve(normalizeDirectoryPath(destination));
      let parentPath = path.dirname(resolvedDestination);
      let directoryName = path.basename(resolvedDestination);

      const cloneIntoDestinationDirectory = destination.endsWith('/') || destination.endsWith('\\');
      if (cloneIntoDestinationDirectory) {
        const inferredName = deriveCloneDirectoryName(remote);
        if (!inferredName) {
          return res.status(400).json({ error: 'Could not infer repository directory name from URL' });
        }
        parentPath = resolvedDestination;
        directoryName = inferredName;
        resolvedDestination = path.join(parentPath, directoryName);
      } else {
        try {
          const stat = await fsPromises.stat(resolvedDestination);
          if (stat.isDirectory()) {
            const inferredName = deriveCloneDirectoryName(remote);
            if (!inferredName) {
              return res.status(400).json({ error: 'Could not infer repository directory name from URL' });
            }
            parentPath = resolvedDestination;
            directoryName = inferredName;
            resolvedDestination = path.join(parentPath, directoryName);
          }
        } catch (error) {
          if (!error || error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
      if (!directoryName || directoryName === '.' || directoryName === '..') {
        return res.status(400).json({ error: 'Destination path must include a directory name' });
      }

      const identity = await resolveCloneGitIdentity(gitIdentityId);
      const gitArgs = ['clone', '--', remote, directoryName];
      const sshKeyPath = typeof identity?.sshKey === 'string' ? identity.sshKey.trim() : '';
      if (sshKeyPath) {
        gitArgs.unshift(`core.sshCommand=ssh -i ${escapeCloneSshKeyPath(sshKeyPath)} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new`);
        gitArgs.unshift('-c');
      }

      await fsPromises.mkdir(parentPath, { recursive: true });
      try {
        await fsPromises.access(resolvedDestination);
        return res.status(409).json({ error: 'Destination path already exists' });
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }

      const output = await new Promise((resolve, reject) => {
        const child = spawn(resolveGitBinaryForSpawn(), gitArgs, {
          cwd: parentPath,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PATH: buildAugmentedPath ? buildAugmentedPath(process.env.PATH || '') : process.env.PATH,
            GIT_TERMINAL_PROMPT: '0',
          },
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
          const combined = `${stdout}\n${stderr}`.trim();
          if (code === 0) {
            resolve(combined);
            return;
          }
          const message = combined || `git clone failed with exit code ${code}`;
          reject(new Error(message));
        });
      });

      if (identity?.userName && identity?.userEmail) {
        try {
          const { setLocalIdentity } = await import('../git/index.js');
          await setLocalIdentity(resolvedDestination, identity);
        } catch (error) {
          console.warn('Failed to apply git identity after clone:', error);
        }
      }

      return res.json({ success: true, path: resolvedDestination, output });
    } catch (error) {
      console.error('Failed to clone repository:', error);
      return res.status(500).json({ error: error.message || 'Failed to clone repository' });
    }
  });

  app.get('/api/fs/stat', async (req, res) => {
    const filePath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    try {
      const resolved = await resolveReadPathFromContext({
        req,
        targetPath: filePath,
        scope: 'stat',
        resolveRequiredExplicitProjectDirectory,
        path,
        os,
        fsPromises,
        normalizeDirectoryPath,
        openchamberUserConfigRoot,
        realpathCache,
      });
      if (!resolved.ok) {
        return res.status(400).json({ error: resolved.error });
      }

      const stats = await fsPromises.stat(resolved.resolved);
      if (!stats.isFile()) {
        return res.status(400).json({ error: 'Specified path is not a file' });
      }

      return res.json({ path: resolved.resolved, isFile: true, size: stats.size, mtimeMs: stats.mtimeMs });
    } catch (error) {
      const err = error;
      if (err && typeof err === 'object' && err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      if (err && typeof err === 'object' && (err.code === 'EACCES' || err.code === 'EPERM')) {
        return res.status(403).json({ error: 'Access to file denied' });
      }
      console.error('Failed to stat file:', error);
      return res.status(500).json({ error: (error && error.message) || 'Failed to stat file' });
    }
  });

  app.get('/api/fs/read', async (req, res) => {
    const filePath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    const optional = req.query.optional === 'true';
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    try {
      const resolved = await resolveReadPathFromContext({
        req,
        targetPath: filePath,
        scope: 'read',
        resolveRequiredExplicitProjectDirectory,
        path,
        os,
        fsPromises,
        normalizeDirectoryPath,
        openchamberUserConfigRoot,
        realpathCache,
      });
      if (!resolved.ok) {
        return res.status(400).json({ error: resolved.error });
      }

      const stats = await fsPromises.stat(resolved.resolved);
      if (!stats.isFile()) {
        return res.status(400).json({ error: 'Specified path is not a file' });
      }

      const content = await fsPromises.readFile(resolved.resolved, 'utf8');
      return res.type('text/plain').send(content);
    } catch (error) {
      const err = error;
      if (err && typeof err === 'object' && err.code === 'ENOENT') {
        if (optional) {
          return res.type('text/plain').send('');
        }
        return res.status(404).json({ error: 'File not found' });
      }
      if (err && typeof err === 'object' && (err.code === 'EACCES' || err.code === 'EPERM')) {
        return res.status(403).json({ error: 'Access to file denied' });
      }
      console.error('Failed to read file:', error);
      return res.status(500).json({ error: (error && error.message) || 'Failed to read file' });
    }
  });

  app.get('/api/fs/raw', async (req, res) => {
    const filePath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    try {
      const resolved = await resolveReadPathFromContext({
        req,
        targetPath: filePath,
        scope: 'raw',
        resolveRequiredExplicitProjectDirectory,
        path,
        os,
        fsPromises,
        normalizeDirectoryPath,
        openchamberUserConfigRoot,
        realpathCache,
      });
      if (!resolved.ok) {
        return res.status(400).json({ error: resolved.error });
      }

      const stats = await fsPromises.stat(resolved.resolved);
      if (!stats.isFile()) {
        return res.status(400).json({ error: 'Specified path is not a file' });
      }

      const ext = path.extname(resolved.resolved).toLowerCase();
      const mimeType = FILE_MIME_MAP[ext] || 'application/octet-stream';

      const download = req.query.download === 'true';
      if (download) {
        const fileName = path.basename(resolved.resolved);
        const asciiOnly = fileName.replace(/[^\u0000-\u007F]/g, '');
        const fallback = asciiOnly || 'file';
        const encoded = encodeURIComponent(fileName);
        res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
      }

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Accept-Ranges', 'bytes');

      // A byte span is streamed from disk rather than read whole: the audio
      // and video players ask for one on every seek, and a recording can be
      // hundreds of megabytes.
      const range = resolveByteRange(req.headers?.range, stats.size);
      if (range.kind === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${stats.size}`);
        return res.status(416).end();
      }
      if (range.kind === 'range') {
        const handle = await fsPromises.open(resolved.resolved, 'r');
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`);
        res.setHeader('Content-Length', String(range.end - range.start + 1));
        res.type(mimeType);
        // The handle closes with the stream, on success and on failure alike.
        const stream = handle.createReadStream({ start: range.start, end: range.end });
        stream.on('error', (error) => {
          console.error('Failed to stream raw file range:', error);
          res.destroy(error);
        });
        stream.pipe(res);
        return undefined;
      }

      const content = await fsPromises.readFile(resolved.resolved);
      return res.type(mimeType).send(content);
    } catch (error) {
      const err = error;
      if (err && typeof err === 'object' && err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      if (err && typeof err === 'object' && (err.code === 'EACCES' || err.code === 'EPERM')) {
        return res.status(403).json({ error: 'Access to file denied' });
      }
      console.error('Failed to read raw file:', error);
      return res.status(500).json({ error: (error && error.message) || 'Failed to read file' });
    }
  });

  app.post('/api/fs/write', async (req, res) => {
    const { path: filePath, content } = req.body || {};
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'Path is required' });
    }
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content is required' });
    }

    try {
      const resolved = await resolveWorkspacePathFromContext({
        req,
        targetPath: filePath,
        resolveRequiredExplicitProjectDirectory,
        path,
        os,
        normalizeDirectoryPath,
        openchamberUserConfigRoot,
        realpathCache,
      });
      if (!resolved.ok) {
        return res.status(400).json({ error: resolved.error });
      }

      const writePath = await fsPromises.realpath(resolved.resolved).catch((error) => {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          return resolved.resolved;
        }
        throw error;
      });
      const canonicalBase = await fsPromises.realpath(resolved.base).catch(() => path.resolve(resolved.base));
      if (!isPathWithinRoot(writePath, canonicalBase, path, os)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const existing = await fsPromises.readFile(writePath, 'utf8').catch(() => null);
      if (existing === content) {
        return res.json({ success: true, path: resolved.resolved });
      }

      await fsPromises.mkdir(path.dirname(writePath), { recursive: true });

      const tmp = `${writePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        await fsPromises.writeFile(tmp, content, 'utf8');
        await fsPromises.rename(tmp, writePath);
      } catch (error) {
        await fsPromises.unlink(tmp).catch(() => {});
        throw error;
      }
      return res.json({ success: true, path: resolved.resolved });
    } catch (error) {
      const err = error;
      if (err && typeof err === 'object' && (err.code === 'EACCES' || err.code === 'EPERM')) {
        return res.status(403).json({ error: 'Access denied' });
      }
      console.error('Failed to write file:', error);
      return res.status(500).json({ error: (error && error.message) || 'Failed to write file' });
    }
  });

  app.post('/api/fs/upload', async (req, res) => {
    const filePath = typeof req.query?.path === 'string' ? req.query.path.trim() : '';
    const overwrite = req.query?.overwrite === 'true';
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/octet-stream')) {
      return res.status(415).json({ error: 'Content-Type must be application/octet-stream' });
    }

    const maxUploadBytes = createUploadMaxBytes();
    const declaredSize = Number(req.headers?.['content-length']);
    if (Number.isFinite(declaredSize) && declaredSize > maxUploadBytes) {
      req.resume?.();
      return res.status(413).json({ error: `File exceeds maximum size of ${maxUploadBytes} bytes` });
    }

    try {
      const resolved = await resolveWorkspacePathFromContext({
        req,
        targetPath: filePath,
        resolveRequiredExplicitProjectDirectory,
        path,
        os,
        normalizeDirectoryPath,
        openchamberUserConfigRoot,
        realpathCache,
      });
      if (!resolved.ok) {
        return res.status(400).json({ error: resolved.error });
      }

      const canonicalBase = await fsPromises.realpath(resolved.base).catch(() => path.resolve(resolved.base));
      const canonicalParent = await fsPromises.realpath(path.dirname(resolved.resolved));
      if (!isPathWithinRoot(canonicalParent, canonicalBase, path, os)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const existingPath = await fsPromises.realpath(resolved.resolved).catch((error) => {
        if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
        throw error;
      });
      const writePath = existingPath || path.join(canonicalParent, path.basename(resolved.resolved));
      if (!isPathWithinRoot(writePath, canonicalBase, path, os)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (existingPath) {
        const stats = await fsPromises.stat(existingPath);
        if (stats.isDirectory()) {
          return res.status(400).json({ error: 'Specified path is a directory' });
        }
        if (!overwrite) {
          req.resume?.();
          return res.status(409).json({ error: 'File already exists', reason: 'already-exists' });
        }
      }

      const tmp = `${writePath}.upload-${crypto.randomUUID()}`;
      let tempExists = false;
      try {
        const handle = await fsPromises.open(tmp, 'wx');
        tempExists = true;
        let streamError = null;
        try {
          await streamUploadBody(req, handle, maxUploadBytes);
        } catch (error) {
          streamError = error;
        }
        try {
          await handle.close();
        } catch (error) {
          if (!streamError) throw error;
        }
        if (streamError) throw streamError;

        if (overwrite) {
          await fsPromises.rename(tmp, writePath);
        } else {
          await fsPromises.link(tmp, writePath);
          await fsPromises.unlink(tmp).catch(() => {});
        }
        tempExists = false;
      } catch (error) {
        if (tempExists) {
          await fsPromises.unlink(tmp).catch(() => {});
        }
        throw error;
      }

      return res.json({ success: true, path: resolved.resolved });
    } catch (error) {
      const err = error;
      if (err && typeof err === 'object' && err.code === 'EEXIST') {
        return res.status(409).json({ error: 'File already exists', reason: 'already-exists' });
      }
      if (err && typeof err === 'object' && err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Destination directory not found', reason: 'not-found' });
      }
      if (err && typeof err === 'object' && err.uploadTooLarge) {
        return res.status(413).json({ error: `File exceeds maximum size of ${maxUploadBytes} bytes` });
      }
      if (err && typeof err === 'object' && (err.code === 'EISDIR' || err.code === 'ENOTDIR')) {
        return res.status(400).json({ error: 'Specified path is a directory' });
      }
      if (isOsPermissionError(err)) {
        return sendOsPermissionDenied(res, 'Access denied');
      }
      console.error('Failed to upload file:', error);
      return res.status(500).json({ error: (error && error.message) || 'Failed to upload file' });
    }
  });

  app.post('/api/fs/delete', async (req, res) => {
    const { path: targetPath } = req.body || {};
    if (!targetPath || typeof targetPath !== 'string') {
      return res.status(400).json({ error: 'Path is required' });
    }

    try {
      const resolved = await resolveWorkspacePathFromContext({
        req,
        targetPath,
        resolveRequiredExplicitProjectDirectory,
        path,
        os,
        normalizeDirectoryPath,
        openchamberUserConfigRoot,
        realpathCache,
      });
      if (!resolved.ok) {
        return res.status(400).json({ error: resolved.error });
      }

      await fsPromises.rm(resolved.resolved, { recursive: true, force: true });
      return res.json({ success: true, path: resolved.resolved });
    } catch (error) {
      const err = error;
      if (err && typeof err === 'object' && err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File or directory not found' });
      }
      if (err && typeof err === 'object' && (err.code === 'EACCES' || err.code === 'EPERM')) {
        return res.status(403).json({ error: 'Access denied' });
      }
      console.error('Failed to delete path:', error);
      return res.status(500).json({ error: (error && error.message) || 'Failed to delete path' });
    }
  });

  app.post('/api/fs/rename', async (req, res) => {
    const { oldPath, newPath } = req.body || {};
    if (!oldPath || typeof oldPath !== 'string') {
      return res.status(400).json({ error: 'oldPath is required' });
    }
    if (!newPath || typeof newPath !== 'string') {
      return res.status(400).json({ error: 'newPath is required' });
    }

    try {
      const resolvedOld = await resolveWorkspacePathFromContext({
        req,
        targetPath: oldPath,
        resolveRequiredExplicitProjectDirectory,
        path,
        os,
        normalizeDirectoryPath,
        openchamberUserConfigRoot,
        realpathCache,
      });
      if (!resolvedOld.ok) {
        return res.status(400).json({ error: resolvedOld.error });
      }

      const resolvedNew = await resolveWorkspacePathFromContext({
        req,
        targetPath: newPath,
        resolveRequiredExplicitProjectDirectory,
        path,
        os,
        normalizeDirectoryPath,
        openchamberUserConfigRoot,
        realpathCache,
      });
      if (!resolvedNew.ok) {
        return res.status(400).json({ error: resolvedNew.error });
      }

      if (resolvedOld.base !== resolvedNew.base) {
        return res.status(400).json({ error: 'Source and destination must share the same workspace root' });
      }

      await fsPromises.rename(resolvedOld.resolved, resolvedNew.resolved);
      return res.json({ success: true, path: resolvedNew.resolved });
    } catch (error) {
      const err = error;
      if (err && typeof err === 'object' && err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Source path not found' });
      }
      if (err && typeof err === 'object' && (err.code === 'EACCES' || err.code === 'EPERM')) {
        return res.status(403).json({ error: 'Access denied' });
      }
      console.error('Failed to rename path:', error);
      return res.status(500).json({ error: (error && error.message) || 'Failed to rename path' });
    }
  });

  app.post('/api/fs/reveal', async (req, res) => {
    const { path: targetPath } = req.body || {};
    if (!targetPath || typeof targetPath !== 'string') {
      return res.status(400).json({ error: 'Path is required' });
    }

    try {
      const resolved = path.resolve(targetPath.trim());
      await fsPromises.access(resolved);

      if (platform === 'darwin') {
        const stat = await fsPromises.stat(resolved);
        if (stat.isDirectory()) {
          await spawnDetached('open', [resolved]);
        } else {
          await spawnDetached('open', ['-R', resolved]);
        }
      } else if (platform === 'win32') {
        const stat = await fsPromises.stat(resolved);
        const escapedPath = resolved.replace(/'/g, "''");
        const explorerArg = stat.isDirectory() ? escapedPath : `/select,${escapedPath}`;
        const command = `Start-Process -FilePath explorer.exe -ArgumentList '${explorerArg}'`;
        await new Promise((resolve, reject) => {
          const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
            windowsHide: true,
            stdio: 'ignore',
          });
          child.once('error', reject);
          child.once('exit', (code) => {
            if (code === 0) {
              resolve();
              return;
            }
            reject(new Error(`Explorer launch failed with code ${code ?? 'unknown'}`));
          });
        });
      } else {
        const stat = await fsPromises.stat(resolved);
        const dir = stat.isDirectory() ? resolved : path.dirname(resolved);
        await spawnDetached('xdg-open', [dir]);
      }

      return res.json({ success: true, path: resolved });
    } catch (error) {
      const err = error;
      if (err && typeof err === 'object' && err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Path not found' });
      }
      console.error('Failed to reveal path:', error);
      return res.status(500).json({ error: (error && error.message) || 'Failed to reveal path' });
    }
  });

  app.post('/api/fs/exec', async (req, res) => {
    const { commands, cwd, background } = req.body || {};
    if (!Array.isArray(commands) || commands.length === 0) {
      return res.status(400).json({ error: 'Commands array is required' });
    }
    if (!cwd || typeof cwd !== 'string') {
      return res.status(400).json({ error: 'Working directory (cwd) is required' });
    }

    pruneExecJobs();
    pruneGitReadCache();

    try {
      const resolvedCwd = path.resolve(normalizeDirectoryPath(cwd));
      const stats = await fsPromises.stat(resolvedCwd);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Specified cwd is not a directory' });
      }

      const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh');
      const shellFlag = process.platform === 'win32' ? '/c' : '-c';

      const jobId = crypto.randomUUID();
      const job = {
        jobId,
        status: 'queued',
        success: null,
        commands,
        resolvedCwd,
        shell,
        shellFlag,
        results: [],
        startedAt: Date.now(),
        finishedAt: null,
        updatedAt: Date.now(),
      };

      execJobs.set(jobId, job);

      const isBackground = background === true;
      if (isBackground) {
        void runExecJob(job).catch((error) => {
          job.status = 'done';
          job.success = false;
          job.results = Array.isArray(job.results) ? job.results : [];
          job.results.push({
            command: '',
            success: false,
            error: (error && error.message) || 'Command execution failed',
          });
          job.finishedAt = Date.now();
          job.updatedAt = Date.now();
        });

        return res.status(202).json({
          jobId,
          status: 'running',
        });
      }

      await runExecJob(job);
      return res.json({
        jobId,
        status: job.status,
        success: job.success === true,
        results: job.results,
      });
    } catch (error) {
      console.error('Failed to execute commands:', error);
      return res.status(500).json({ error: (error && error.message) || 'Failed to execute commands' });
    }
  });

  app.get('/api/fs/exec/:jobId', (req, res) => {
    const jobId = typeof req.params?.jobId === 'string' ? req.params.jobId : '';
    if (!jobId) {
      return res.status(400).json({ error: 'Job id is required' });
    }

    pruneExecJobs();

    const job = execJobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    job.updatedAt = Date.now();
    return res.json({
      jobId: job.jobId,
      status: job.status,
      success: job.success === true,
      results: Array.isArray(job.results) ? job.results : [],
    });
  });

  app.get('/api/fs/list', async (req, res) => {
    const rawPath = typeof req.query.path === 'string' && req.query.path.trim().length > 0
      ? req.query.path.trim()
      : os.homedir();
    const respectGitignore = req.query.respectGitignore === 'true';
    let requestedPath = '';
    let resolvedPath = '';

    const isPlansDirectory = (value) => {
      if (!value || typeof value !== 'string') return false;
      const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
      return normalized.endsWith('/.opencode/plans') || normalized.endsWith('.opencode/plans');
    };

    try {
      requestedPath = path.resolve(normalizeDirectoryPath(rawPath));
      resolvedPath = await realpathCache.resolve(requestedPath);

      const stats = await fsPromises.stat(resolvedPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Specified path is not a directory', reason: 'not-directory' });
      }

      const dirents = await fsPromises.readdir(resolvedPath, { withFileTypes: true });
      let ignoredPaths = new Set();
      if (respectGitignore) {
        try {
          const pathsToCheck = dirents.map((d) => d.name);
          if (pathsToCheck.length > 0) {
            try {
              const result = await new Promise((resolve) => {
                const child = spawn(resolveGitBinaryForSpawn(), ['check-ignore', '--', ...pathsToCheck], {
                  cwd: resolvedPath,
                  windowsHide: true,
                  // Diagnostics are unused here. An unread pipe can block Git forever.
                  stdio: ['ignore', 'pipe', 'ignore'],
                });

                let stdout = '';
                let settled = false;
                let timeout = null;
                const finish = (value) => {
                  if (settled) return;
                  settled = true;
                  if (timeout) clearTimeout(timeout);
                  resolve(value);
                };

                if (gitCheckIgnoreTimeoutMs > 0) {
                  timeout = setTimeout(() => {
                    try {
                      child.kill('SIGKILL');
                    } catch {
                    }
                    finish('');
                  }, gitCheckIgnoreTimeoutMs);
                }

                child.stdout.on('data', (data) => { stdout += data.toString(); });
                child.on('close', () => finish(stdout));
                child.on('error', () => finish(''));
              });

              result.split('\n').filter(Boolean).forEach((name) => {
                const fullPath = path.join(resolvedPath, name.trim());
                ignoredPaths.add(fullPath);
              });
            } catch {
            }
          }
        } catch {
        }
      }

      const entries = await Promise.all(
        dirents.map(async (dirent) => {
          const physicalEntryPath = path.join(resolvedPath, dirent.name);
          if (respectGitignore && ignoredPaths.has(physicalEntryPath)) {
            return null;
          }

          let isDirectory = dirent.isDirectory();
          const isSymbolicLink = dirent.isSymbolicLink();

          if (!isDirectory && isSymbolicLink) {
            try {
              const linkStats = await fsPromises.stat(physicalEntryPath);
              isDirectory = linkStats.isDirectory();
            } catch {
              isDirectory = false;
            }
          }

          return {
            name: dirent.name,
            path: path.join(requestedPath, dirent.name),
            isDirectory,
            isFile: dirent.isFile(),
            isSymbolicLink,
          };
        })
      );

      return res.json({
        path: requestedPath,
        entries: entries.filter(Boolean),
      });
    } catch (error) {
      const err = error;
      const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
      const isPlansPath = code === 'ENOENT' && (
        isPlansDirectory(resolvedPath)
        || isPlansDirectory(requestedPath)
        || isPlansDirectory(rawPath)
      );
      if (code !== 'ENOENT') {
        console.error('Failed to list directory:', error);
      }
      if (code === 'ENOENT') {
        if (isPlansPath) {
          return res.json({ path: requestedPath || resolvedPath || rawPath, entries: [] });
        }
        return res.status(404).json({ error: 'Directory not found', reason: 'not-found' });
      }
      if (isOsPermissionError(err)) {
        return res.status(403).json({ error: 'Access to directory denied', reason: 'os-permission' });
      }
      return res.status(500).json({ error: (error && error.message) || 'Failed to list directory' });
    }
  });

  app.get('/api/fs/git-dirs', async (req, res) => {
    const rawPath = typeof req.query.path === 'string' && req.query.path.trim().length > 0
      ? req.query.path.trim()
      : '';
    if (!rawPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    try {
      const resolved = await resolveWorkspacePathFromContext({
        req,
        targetPath: rawPath,
        resolveRequiredExplicitProjectDirectory,
        path,
        os,
        normalizeDirectoryPath,
        openchamberUserConfigRoot,
        realpathCache,
      });
      if (!resolved.ok) {
        return res.status(400).json({ error: resolved.error });
      }

      const stats = await fsPromises.stat(resolved.resolved);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Specified path is not a directory', reason: 'not-directory' });
      }

      const repositories = await findGitDirectories({
        rootPath: resolved.resolved,
        fsPromises,
        path,
        maxDepth: GIT_DIRS_MAX_DEPTH,
        maxDirs: GIT_DIRS_MAX_DIRS,
      });

      return res.json({
        path: resolved.resolved,
        repositories: repositories.map((repoPath) => ({
          path: repoPath,
          name: path.basename(repoPath),
        })),
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code === 'ENOENT') {
        return res.status(404).json({ error: 'Directory not found', reason: 'not-found' });
      }
      if (isOsPermissionError(error)) {
        return sendOsPermissionDenied(res, 'Access to directory denied');
      }
      console.error('Failed to find git directories:', error);
      return res.status(500).json({ error: (error && error.message) || 'Failed to find git directories' });
    }
  });

};
