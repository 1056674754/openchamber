import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerConfigEntityRoutes } from './config-entity-routes.js';

const createApp = ({ refreshResult }) => {
  const app = express();
  app.use(express.json());
  registerConfigEntityRoutes(app, {
    resolveProjectDirectory: vi.fn(async () => ({ directory: '/tmp/project', error: null })),
    resolveOptionalProjectDirectory: vi.fn(async () => ({ directory: '/tmp/project', error: null })),
    refreshOpenCodeAfterConfigChange: vi.fn(async () => refreshResult),
    clientReloadDelayMs: 250,
    getAgentSources: vi.fn(),
    getAgentConfig: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    getCommandSources: vi.fn(),
    createCommand: vi.fn(),
    updateCommand: vi.fn(),
    deleteCommand: vi.fn(),
    listMcpConfigs: vi.fn(),
    getMcpConfig: vi.fn(),
    createMcpConfig: vi.fn(),
    updateMcpConfig: vi.fn(),
    deleteMcpConfig: vi.fn(),
    listSnippets: vi.fn(),
    getSnippet: vi.fn(),
    createSnippet: vi.fn(),
    updateSnippet: vi.fn(),
    deleteSnippet: vi.fn(),
    expandSnippets: vi.fn(),
  });
  return app;
};

describe('agent config mutation responses', () => {
  it('requires a manual restart when the connected OpenCode server is external', async () => {
    const app = createApp({ refreshResult: { reloaded: false, external: true } });

    const response = await request(app)
      .post('/api/config/agents/build')
      .send({ scope: 'project', mode: 'subagent' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      requiresReload: false,
      requiresManualRestart: true,
    });
    expect(response.body).not.toHaveProperty('reloadDelayMs');
  });
});
