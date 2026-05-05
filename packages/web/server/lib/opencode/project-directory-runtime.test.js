import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createProjectDirectoryRuntime } from './project-directory-runtime.js';

const tempRoots = [];

const makeTempDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-project-dir-'));
  tempRoots.push(dir);
  return dir;
};

const makeRequest = ({ headerDirectory, queryDirectory, bodyDirectory } = {}) => ({
  get: (name) => (name.toLowerCase() === 'x-opencode-directory' ? headerDirectory : undefined),
  query: queryDirectory === undefined ? {} : { directory: queryDirectory },
  body: bodyDirectory === undefined ? {} : { directory: bodyDirectory },
});

const createRuntime = (settings = {}) => createProjectDirectoryRuntime({
  fsPromises: fs,
  path,
  normalizeDirectoryPath: (value) => value,
  getReadSettingsFromDiskMigrated: () => async () => settings,
  sanitizeProjects: (projects) => Array.isArray(projects) ? projects : [],
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('project directory runtime', () => {
  it('requires an explicit directory for explicit-only resolution', async () => {
    const fallbackDirectory = await makeTempDir();
    const runtime = createRuntime({
      lastDirectory: fallbackDirectory,
      projects: [{ id: 'fallback', path: fallbackDirectory }],
      activeProjectId: 'fallback',
    });

    await expect(runtime.resolveRequiredExplicitProjectDirectory(makeRequest())).resolves.toEqual({
      directory: null,
      error: 'Directory parameter is required',
    });
  });

  it('still allows legacy project directory fallback for display/browse callers', async () => {
    const fallbackDirectory = await makeTempDir();
    const runtime = createRuntime({
      lastDirectory: fallbackDirectory,
      projects: [{ id: 'fallback', path: fallbackDirectory }],
      activeProjectId: 'fallback',
    });

    await expect(runtime.resolveProjectDirectory(makeRequest())).resolves.toEqual({
      directory: path.resolve(fallbackDirectory),
      error: null,
    });
  });

  it('accepts explicit directories from headers, query, and body', async () => {
    const headerDirectory = await makeTempDir();
    const queryDirectory = await makeTempDir();
    const bodyDirectory = await makeTempDir();
    const runtime = createRuntime();

    await expect(runtime.resolveRequiredExplicitProjectDirectory(makeRequest({ headerDirectory }))).resolves.toEqual({
      directory: path.resolve(headerDirectory),
      error: null,
    });
    await expect(runtime.resolveRequiredExplicitProjectDirectory(makeRequest({ queryDirectory }))).resolves.toEqual({
      directory: path.resolve(queryDirectory),
      error: null,
    });
    await expect(runtime.resolveRequiredExplicitProjectDirectory(makeRequest({ bodyDirectory }))).resolves.toEqual({
      directory: path.resolve(bodyDirectory),
      error: null,
    });
  });
});
