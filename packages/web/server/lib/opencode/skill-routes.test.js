import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';

import { registerSkillRoutes } from './skill-routes.js';

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, () => resolve(server));
});

// Harness for the OpenCode-discovered skills list route only; every other
// route's dependencies stay unused in these tests.
const createSkillsApp = ({ stubPort, discoverSkills: discoverSkillsOverride }) => {
  const app = express();
  registerSkillRoutes(app, {
    fs,
    os,
    path,
    resolveOptionalProjectDirectory: async (req) => {
      const directory = typeof req.query.directory === 'string' ? req.query.directory : '';
      return directory ? { directory, error: null } : { directory: null, error: null };
    },
    resolveProjectDirectory: async () => ({ directory: null, error: null }),
    readSettingsFromDisk: async () => ({}),
    sanitizeSkillCatalogs: () => [],
    getCuratedSkillsSources: () => [],
    parseSkillRepoSource: () => ({ ok: false }),
    fetchGitHubRepoMetas: async () => ({}),
    getSkillSources: () => [],
    discoverSkills: discoverSkillsOverride ?? (() => []),
    mergeDiscoveredSkills: (remote, local) => [...(remote ?? []), ...(local ?? [])],
    isManagedSkillPath: () => false,
    SKILL_SCOPE: { USER: 'user', PROJECT: 'project' },
    getOpenCodePort: () => stubPort,
    buildOpenCodeUrl: () => `http://127.0.0.1:${stubPort}/`,
    getOpenCodeAuthHeaders: () => ({}),
  });
  return app;
};

describe('skills list partial flag (upstream 90267ff3f)', () => {
  const servers2 = [];
  let projectRoot2;

  afterEach(async () => {
    await Promise.all(servers2.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    if (projectRoot2) {
      fs.rmSync(projectRoot2, { recursive: true, force: true });
      projectRoot2 = null;
    }
  });

  it('flags the list as partial when the OpenCode skill list fails, and not when it succeeds', async () => {
    projectRoot2 = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-skills-partial-'));
    fs.mkdirSync(path.join(projectRoot2, '.agents', 'skills', 'disk-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot2, '.agents', 'skills', 'disk-skill', 'SKILL.md'),
      '---\nname: disk-skill\ndescription: On disk\n---\nBody\n',
    );
    const diskSkill = { name: 'disk-skill', path: path.join(projectRoot2, '.agents', 'skills', 'disk-skill'), description: 'On disk' };
    let failing = true;
    const stub = express();
    stub.get('/skill', (_req, res) => {
      if (failing) {
        res.status(500).json({ error: 'boom' });
        return;
      }
      res.json([]);
    });
    const stubServer = await listen(stub);
    servers2.push(stubServer);
    const stubPort = stubServer.address().port;

    const appServer = await listen(createSkillsApp({ stubPort, discoverSkills: () => [diskSkill] }));
    servers2.push(appServer);
    const appPort = appServer.address().port;
    const url = `http://127.0.0.1:${appPort}/api/config/skills?directory=${encodeURIComponent(projectRoot2)}`;

    const failed = await (await fetch(url)).json();
    expect(failed.openCodeSkillsUnavailable).toBe(true);
    expect(failed.skills.map((skill) => skill.name)).toContain('disk-skill');

    failing = false;
    const complete = await (await fetch(url)).json();
    expect(complete.openCodeSkillsUnavailable).toBeUndefined();
    expect(complete.skills.map((skill) => skill.name)).toContain('disk-skill');
  });
});

describe('skills list route upstream payload mapping', () => {
  let projectRoot;
  let servers = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    if (projectRoot) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('accepts the OpenCode v2 `path` field, keeps the v1 `location` fallback, and normalizes v2 built-ins', async () => {
    // Upstream ca99eb0f8: with the v2 `path` field alone, the whole
    // authoritative list used to be dropped and the panel fell back to the
    // smaller local disk scan.
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-skills-'));
    const stub = express();
    stub.get('/skill', (_req, res) => {
      res.json([
        {
          id: 'v2-path-skill',
          name: 'v2-path-skill',
          path: path.join(projectRoot, '.agents', 'skills', 'v2-path-skill'),
          description: 'Delivered with the v2 path field',
        },
        {
          id: 'v1-location-skill',
          name: 'v1-location-skill',
          location: path.join(projectRoot, '.agents', 'skills', 'v1-location-skill'),
          description: 'Delivered with the legacy location field',
        },
        {
          id: 'opencode',
          name: 'OpenCode',
          path: '/builtin/opencode.md',
          description: 'v2 built-in skill with a synthetic path',
        },
        {
          id: 'unlocated-skill',
          name: 'unlocated-skill',
          description: 'Has neither field; must be dropped',
        },
      ]);
    });
    const stubServer = await listen(stub);
    servers.push(stubServer);
    const stubPort = stubServer.address().port;

    const appServer = await listen(createSkillsApp({ stubPort }));
    servers.push(appServer);
    const appPort = appServer.address().port;

    const listResponse = await fetch(
      `http://127.0.0.1:${appPort}/api/config/skills?directory=${encodeURIComponent(projectRoot)}`,
    );
    expect(listResponse.status).toBe(200);
    const payload = await listResponse.json();
    const byName = new Map(payload.skills.map((skill) => [skill.name, skill]));

    expect(byName.has('v2-path-skill')).toBe(true);
    expect(byName.get('v2-path-skill').path).toContain('v2-path-skill');

    expect(byName.has('v1-location-skill')).toBe(true);
    expect(byName.get('v1-location-skill').path).toContain('v1-location-skill');

    expect(byName.get('OpenCode')?.path).toBe('<built-in>');
    expect(byName.get('OpenCode')?.renamable).toBe(false);

    expect(byName.has('unlocated-skill')).toBe(false);
  });
});
