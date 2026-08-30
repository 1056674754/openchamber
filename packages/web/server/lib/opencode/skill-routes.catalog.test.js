import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';

import { registerSkillRoutes } from './skill-routes.js';

describe('skills catalog route', () => {
  it('returns curated GitHub metadata without removing ClawHub', async () => {
    const app = express();
    registerSkillRoutes(app, {
      fs,
      os,
      path,
      resolveOptionalProjectDirectory: async () => ({ directory: null, error: null }),
      readSettingsFromDisk: async () => ({ skillCatalogs: [] }),
      sanitizeSkillCatalogs: () => [],
      getCuratedSkillsSources: () => [
        { id: 'anthropic', label: 'Anthropic', source: 'anthropics/skills', sourceType: 'github' },
        { id: 'clawdhub', label: 'ClawHub', source: 'clawdhub:registry', sourceType: 'clawdhub' },
      ],
      parseSkillRepoSource: (source) => source === 'anthropics/skills'
        ? { ok: true, host: 'github.com', normalizedRepo: source }
        : { ok: false },
      fetchGitHubRepoMetas: async () => ({
        'anthropics/skills': { stars: 123, repoUpdatedAt: '2026-08-01T00:00:00Z' },
      }),
    });

    const response = await request(app).get('/api/config/skills/catalog').expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      sources: [
        { id: 'anthropic', stars: 123, repoUpdatedAt: '2026-08-01T00:00:00Z' },
        { id: 'clawdhub', stars: null, repoUpdatedAt: null },
      ],
    });
  });
});
