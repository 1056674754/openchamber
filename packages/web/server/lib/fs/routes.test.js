import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerFsRoutes } from './routes.js';
import { createProjectDirectoryRuntime } from '../opencode/project-directory-runtime.js';

const tempRoots = [];

const makeTempDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-fs-routes-'));
  tempRoots.push(dir);
  return dir;
};

const createApp = (settings = {}) => {
  const app = express();
  app.use(express.json());

  const runtime = createProjectDirectoryRuntime({
    fsPromises: fs,
    path,
    normalizeDirectoryPath: (value) => value,
    getReadSettingsFromDiskMigrated: () => async () => settings,
    sanitizeProjects: (projects) => Array.isArray(projects) ? projects : [],
  });

  registerFsRoutes(app, {
    os,
    path,
    fsPromises: fs,
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
    expect(response.body).toMatchObject({ success: true, path: target });
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
});
