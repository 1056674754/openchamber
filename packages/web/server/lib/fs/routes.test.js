import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mintOutsideFileGrant, registerFsRoutes } from './routes.js';
import { createProjectDirectoryRuntime } from '../opencode/project-directory-runtime.js';

const tempRoots = [];

const makeTempDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-fs-routes-'));
  tempRoots.push(dir);
  return dir;
};

const createApp = (settings = {}, overrides = {}) => {
  const app = express();
  app.use(express.json());

  const runtime = createProjectDirectoryRuntime({
    fsPromises: overrides.fsPromises ?? fs,
    path,
    normalizeDirectoryPath: (value) => value,
    getReadSettingsFromDiskMigrated: () => async () => settings,
    sanitizeProjects: (projects) => Array.isArray(projects) ? projects : [],
  });

  registerFsRoutes(app, {
    os,
    path,
    fsPromises: overrides.fsPromises ?? fs,
    spawn: vi.fn(),
    crypto,
    normalizeDirectoryPath: (value) => value,
    resolveRequiredExplicitProjectDirectory: runtime.resolveRequiredExplicitProjectDirectory,
    buildAugmentedPath: () => process.env.PATH || '',
    resolveGitBinaryForSpawn: () => 'git',
    openchamberUserConfigRoot: path.join(os.tmpdir(), 'openchamber-test-config'),
  });

  return app;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('fs routes explicit directory policy', () => {
  it('binds outside-workspace grants to one canonical path and scope', async () => {
    const workspace = await makeTempDir();
    const outside = await makeTempDir();
    const imagePath = path.join(outside, 'image.png');
    const otherPath = path.join(outside, 'other.png');
    await fs.writeFile(imagePath, Buffer.from('89504e470d0a1a0a00000000', 'hex'));
    await fs.writeFile(otherPath, Buffer.from('89504e470d0a1a0a00000000', 'hex'));
    const grant = await mintOutsideFileGrant(imagePath, { scopes: ['raw'], fsPromises: fs, path, crypto });
    const app = createApp({ projects: [{ id: 'workspace', path: workspace }] });

    const allowed = await request(app)
      .get('/api/fs/raw')
      .query({ path: imagePath, allowOutsideWorkspace: 'true', outsideFileGrant: grant.outsideFileGrant });
    const mismatched = await request(app)
      .get('/api/fs/raw')
      .query({ path: otherPath, allowOutsideWorkspace: 'true', outsideFileGrant: grant.outsideFileGrant });

    expect(allowed.status).toBe(200);
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.error).toContain('does not match');
  });

  it('rejects workspace-bound writes when directory is missing', async () => {
    const workspace = await makeTempDir();
    const target = path.join(workspace, 'notes.txt');
    const app = createApp({
      lastDirectory: workspace,
      projects: [{ id: 'workspace', path: workspace }],
      activeProjectId: 'workspace',
    });

    const response = await request(app)
      .post('/api/fs/write')
      .send({ path: target, content: 'unsafe fallback' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Directory parameter is required' });
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts workspace-bound writes when directory appears in the request body', async () => {
    const workspace = await makeTempDir();
    const target = path.join(workspace, 'notes.txt');
    const app = createApp();

    const response = await request(app)
      .post('/api/fs/write')
      .send({ path: target, content: 'explicit', directory: workspace });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true });
    await expect(fs.realpath(response.body.path)).resolves.toBe(await fs.realpath(target));
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('explicit');
  });

  it('rejects workspace-bound reads when directory is missing', async () => {
    const workspace = await makeTempDir();
    const target = path.join(workspace, 'notes.txt');
    await fs.writeFile(target, 'existing', 'utf8');
    const app = createApp({
      lastDirectory: workspace,
      projects: [{ id: 'workspace', path: workspace }],
      activeProjectId: 'workspace',
    });

    const response = await request(app).get('/api/fs/read').query({ path: target });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Directory parameter is required' });
  });

  it('accepts workspace-bound reads when directory appears in the query', async () => {
    const workspace = await makeTempDir();
    const target = path.join(workspace, 'notes.txt');
    await fs.writeFile(target, 'existing', 'utf8');
    const app = createApp();

    const response = await request(app).get('/api/fs/read').query({ path: target, directory: workspace });

    expect(response.status).toBe(200);
    expect(response.text).toBe('existing');
  });

  it('uses RFC 5987 filename*= encoding for non-ASCII raw downloads', async () => {
    const workspace = await makeTempDir();
    const target = path.join(workspace, '文件.txt');
    await fs.writeFile(target, 'content', 'utf8');
    const app = createApp();

    const response = await request(app)
      .get('/api/fs/raw')
      .query({ path: target, directory: workspace, download: 'true' });

    expect(response.status).toBe(200);
    const disposition = response.headers['content-disposition'];
    expect(disposition).toContain('filename=".txt"');
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toContain(encodeURIComponent('文件.txt'));
  });

  it('keeps plain filename fallback for ASCII raw downloads', async () => {
    const workspace = await makeTempDir();
    const target = path.join(workspace, 'readme.txt');
    await fs.writeFile(target, 'content', 'utf8');
    const app = createApp();

    const response = await request(app)
      .get('/api/fs/raw')
      .query({ path: target, directory: workspace, download: 'true' });

    expect(response.status).toBe(200);
    const disposition = response.headers['content-disposition'];
    expect(disposition).toContain('filename="readme.txt"');
    expect(disposition).toContain("filename*=UTF-8''readme.txt");
  });

  it('reads allowOutsideWorkspace symlink whose target is outside its parent', async () => {
    const workspace = await makeTempDir();
    const realTarget = path.join(workspace, 'real-target.jsonc');
    await fs.writeFile(realTarget, 'symlink-body', 'utf8');

    const linkParent = await makeTempDir();
    const linkPath = path.join(linkParent, 'link.jsonc');
    await fs.symlink(realTarget, linkPath);

    const app = createApp();

    const response = await request(app)
      .get('/api/fs/read')
      .query({ path: linkPath, allowOutsideWorkspace: 'true' });

    expect(response.status).toBe(200);
    expect(response.text).toBe('symlink-body');
  });

  it('reads workspace-internal symlink whose target is outside the workspace', async () => {
    // Simulates: workspace = ~/.config/opencode, file = oh-my-openagent.jsonc
    // which is a symlink to ~/.omo/omo.jsonc (outside the workspace).
    const workspace = await makeTempDir();
    const outsideTarget = await makeTempDir();
    const realFile = path.join(outsideTarget, 'real-config.jsonc');
    await fs.writeFile(realFile, 'config-body', 'utf8');

    const linkPath = path.join(workspace, 'config-link.jsonc');
    await fs.symlink(realFile, linkPath);

    const app = createApp();

    const response = await request(app)
      .get('/api/fs/read')
      .query({ path: linkPath, directory: workspace });

    expect(response.status).toBe(200);
    expect(response.text).toBe('config-body');
  });

  it('stats workspace-internal symlink whose target is outside the workspace', async () => {
    const workspace = await makeTempDir();
    const outsideTarget = await makeTempDir();
    const realFile = path.join(outsideTarget, 'real-config.json');
    await fs.writeFile(realFile, 'x', 'utf8');

    const linkPath = path.join(workspace, 'link.json');
    await fs.symlink(realFile, linkPath);

    const app = createApp();

    const response = await request(app)
      .get('/api/fs/stat')
      .query({ path: linkPath, directory: workspace });

    expect(response.status).toBe(200);
    expect(response.body.isFile).toBe(true);
  });

  for (const code of ['EACCES', 'EPERM']) {
    it(`maps ${code} directory-list failures to the os-permission contract`, async () => {
      const error = Object.assign(new Error('denied'), { code });
      const protectedDirectory = await makeTempDir();
      const app = createApp({}, {
        fsPromises: {
          ...fs,
          stat: vi.fn(async () => ({ isDirectory: () => true })),
          readdir: vi.fn(async () => { throw error; }),
        },
      });

      const response = await request(app).get('/api/fs/list').query({ path: protectedDirectory });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Access to directory denied', reason: 'os-permission' });
    });
  }
});

describe('fs upload route', () => {
  const upload = (app, target, directory, body, overwrite = false) => request(app)
    .post('/api/fs/upload')
    .query({ path: target, directory, ...(overwrite ? { overwrite: 'true' } : {}) })
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.from(body));

  it('requires explicit workspace authority', async () => {
    const workspace = await makeTempDir();
    const target = path.join(workspace, 'upload.bin');
    const app = createApp({ projects: [{ id: 'workspace', path: workspace }] });

    const response = await request(app)
      .post('/api/fs/upload')
      .query({ path: target })
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('content'));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Directory parameter is required' });
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('streams a binary file into the owning workspace', async () => {
    const workspace = await makeTempDir();
    const target = path.join(workspace, 'upload.bin');
    const app = createApp();

    const response = await upload(app, target, workspace, Buffer.from([0, 1, 2, 255]));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, path: await fs.realpath(target) });
    await expect(fs.readFile(target)).resolves.toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it('preserves an existing file unless overwrite is explicit', async () => {
    const workspace = await makeTempDir();
    const target = path.join(workspace, 'upload.bin');
    await fs.writeFile(target, 'original');
    const app = createApp();

    const response = await upload(app, target, workspace, 'replacement');

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('already-exists');
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('original');
  });

  it('atomically replaces an existing file when overwrite is explicit', async () => {
    const workspace = await makeTempDir();
    const target = path.join(workspace, 'upload.bin');
    await fs.writeFile(target, 'original');
    const app = createApp();

    const response = await upload(app, target, workspace, 'replacement', true);

    expect(response.status).toBe(200);
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('replacement');
  });

  it('rejects non-binary content types before touching the filesystem', async () => {
    const workspace = await makeTempDir();
    const target = path.join(workspace, 'upload.txt');
    const app = createApp();

    const response = await request(app)
      .post('/api/fs/upload')
      .query({ path: target, directory: workspace })
      .set('Content-Type', 'text/plain')
      .send('content');

    expect(response.status).toBe(415);
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects declared uploads above the configured limit', async () => {
    const previous = process.env.OPENCHAMBER_FS_UPLOAD_MAX_BYTES;
    process.env.OPENCHAMBER_FS_UPLOAD_MAX_BYTES = '3';
    try {
      const workspace = await makeTempDir();
      const target = path.join(workspace, 'upload.bin');
      const app = createApp();

      const response = await upload(app, target, workspace, 'four');

      expect(response.status).toBe(413);
      await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (previous === undefined) delete process.env.OPENCHAMBER_FS_UPLOAD_MAX_BYTES;
      else process.env.OPENCHAMBER_FS_UPLOAD_MAX_BYTES = previous;
    }
  });

  it('rejects a missing destination directory without leaving temp files', async () => {
    const workspace = await makeTempDir();
    const missing = path.join(workspace, 'missing');
    const target = path.join(missing, 'upload.bin');
    const app = createApp();

    const response = await upload(app, target, workspace, 'content');

    expect(response.status).toBe(404);
    expect(response.body.reason).toBe('not-found');
    expect(await fs.readdir(workspace)).toEqual([]);
  });

  it('does not follow an existing workspace symlink to overwrite an outside file', async () => {
    const workspace = await makeTempDir();
    const outside = await makeTempDir();
    const outsideTarget = path.join(outside, 'outside.bin');
    const linkPath = path.join(workspace, 'link.bin');
    await fs.writeFile(outsideTarget, 'outside');
    await fs.symlink(outsideTarget, linkPath);
    const app = createApp();

    const response = await upload(app, linkPath, workspace, 'replacement', true);

    expect(response.status).toBe(403);
    await expect(fs.readFile(outsideTarget, 'utf8')).resolves.toBe('outside');
  });

describe('fs git-dirs (nested repository discovery)', () => {
  const createGitDirsApp = async (tempRoot) =>
    createApp({ projects: [{ id: 'git-dirs-root', path: tempRoot }] });

  it('finds nested repositories and stops at repository boundaries', async () => {
    const tempRoot = await fs.realpath(await makeTempDir());
    await fs.mkdir(path.join(tempRoot, 'proj-a/.git'), { recursive: true });
    await fs.mkdir(path.join(tempRoot, 'proj-a/src'), { recursive: true });
    // A repo inside a repo is behind the boundary and must not be reported.
    await fs.mkdir(path.join(tempRoot, 'proj-a/inner/.git'), { recursive: true });
    await fs.mkdir(path.join(tempRoot, 'proj-b/.git'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'readme.txt'), 'x');

    const res = await request(await createGitDirsApp(tempRoot))
      .get('/api/fs/git-dirs')
      .query({ path: tempRoot, directory: tempRoot });

    expect(res.status).toBe(200);
    expect(res.body.repositories).toEqual([
      { path: path.join(tempRoot, 'proj-a'), name: 'proj-a' },
      { path: path.join(tempRoot, 'proj-b'), name: 'proj-b' },
    ]);
  });

  it('returns an empty list when the root itself is a repository', async () => {
    const tempRoot = await fs.realpath(await makeTempDir());
    await fs.mkdir(path.join(tempRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(tempRoot, 'proj-a/.git'), { recursive: true });

    const res = await request(await createGitDirsApp(tempRoot))
      .get('/api/fs/git-dirs')
      .query({ path: tempRoot, directory: tempRoot });

    expect(res.status).toBe(200);
    expect(res.body.repositories).toEqual([]);
  });

  it('treats a .git file (linked worktree) as a repository boundary', async () => {
    const tempRoot = await fs.realpath(await makeTempDir());
    await fs.mkdir(path.join(tempRoot, 'worktree'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'worktree/.git'), 'gitdir: /elsewhere');

    const res = await request(await createGitDirsApp(tempRoot))
      .get('/api/fs/git-dirs')
      .query({ path: tempRoot, directory: tempRoot });

    expect(res.status).toBe(200);
    expect(res.body.repositories).toEqual([
      { path: path.join(tempRoot, 'worktree'), name: 'worktree' },
    ]);
  });

  it('skips junk directories', async () => {
    const tempRoot = await fs.realpath(await makeTempDir());
    await fs.mkdir(path.join(tempRoot, 'node_modules/dep/.git'), { recursive: true });
    await fs.mkdir(path.join(tempRoot, 'real/.git'), { recursive: true });

    const res = await request(await createGitDirsApp(tempRoot))
      .get('/api/fs/git-dirs')
      .query({ path: tempRoot, directory: tempRoot });

    expect(res.status).toBe(200);
    expect(res.body.repositories).toEqual([
      { path: path.join(tempRoot, 'real'), name: 'real' },
    ]);
  });

  it('follows symlinked directories and reports repositories under the link path', async () => {
    // The project root groups repositories kept elsewhere through links.
    const tempRoot = await fs.realpath(await makeTempDir());
    const elsewhere = await fs.realpath(await makeTempDir());
    await fs.mkdir(path.join(elsewhere, 'api/.git'), { recursive: true });
    await fs.mkdir(path.join(elsewhere, 'web'), { recursive: true });
    await fs.writeFile(path.join(elsewhere, 'web/.git'), 'gitdir: /elsewhere');
    await fs.writeFile(path.join(elsewhere, 'notes.md'), 'x');
    await fs.symlink(path.join(elsewhere, 'api'), path.join(tempRoot, 'api'));
    await fs.symlink(path.join(elsewhere, 'web'), path.join(tempRoot, 'web'));
    await fs.symlink(path.join(elsewhere, 'notes.md'), path.join(tempRoot, 'notes.md'));

    const res = await request(await createGitDirsApp(tempRoot))
      .get('/api/fs/git-dirs')
      .query({ path: tempRoot, directory: tempRoot });

    expect(res.status).toBe(200);
    expect(res.body.repositories).toEqual([
      { path: path.join(tempRoot, 'api'), name: 'api' },
      { path: path.join(tempRoot, 'web'), name: 'web' },
    ]);
  });

  it('walks each real directory once, so a link loop or a second link to a repository does not repeat it', async () => {
    const tempRoot = await fs.realpath(await makeTempDir());
    await fs.mkdir(path.join(tempRoot, 'real/.git'), { recursive: true });
    await fs.symlink(tempRoot, path.join(tempRoot, 'loop'));
    await fs.symlink(path.join(tempRoot, 'real'), path.join(tempRoot, 'again'));

    const res = await request(await createGitDirsApp(tempRoot))
      .get('/api/fs/git-dirs')
      .query({ path: tempRoot, directory: tempRoot });

    expect(res.status).toBe(200);
    expect(res.body.repositories).toEqual([
      { path: path.join(tempRoot, 'again'), name: 'again' },
    ]);
  });

  it('returns repositories in deterministic sorted order', async () => {
    const tempRoot = await fs.realpath(await makeTempDir());
    await fs.mkdir(path.join(tempRoot, 'zebra/.git'), { recursive: true });
    await fs.mkdir(path.join(tempRoot, 'alpha/.git'), { recursive: true });

    const res = await request(await createGitDirsApp(tempRoot))
      .get('/api/fs/git-dirs')
      .query({ path: tempRoot, directory: tempRoot });

    expect(res.body.repositories.map((repo) => repo.name)).toEqual(['alpha', 'zebra']);
  });

  it('returns 400 when path is missing', async () => {
    const res = await request(createApp()).get('/api/fs/git-dirs');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Path is required');
  });

  it('returns 400 when the path is not a directory', async () => {
    const tempRoot = await fs.realpath(await makeTempDir());
    const filePath = path.join(tempRoot, 'file.txt');
    await fs.writeFile(filePath, 'x');

    const res = await request(await createGitDirsApp(tempRoot))
      .get('/api/fs/git-dirs')
      .query({ path: filePath, directory: tempRoot });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Specified path is not a directory', reason: 'not-directory' });
  });

  it('rejects paths outside the active workspace', async () => {
    const res = await request(createApp())
      .get('/api/fs/git-dirs')
      .query({ path: '/definitely/not/a/workspace' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

});
