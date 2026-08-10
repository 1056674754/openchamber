import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerConfigEntityRoutes } from './config-entity-routes.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  registerConfigEntityRoutes(app, {
    resolveProjectDirectory: vi.fn(async () => ({ directory: '/tmp/project', error: null })),
    resolveOptionalProjectDirectory: vi.fn(async () => ({ directory: '/tmp/project', error: null })),
    markPendingConfigRestart: vi.fn(() => ({ count: 1, reasons: ['agent creation'] })),
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
  it('defers restart and returns the authoritative pending snapshot', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/config/agents/build')
      .send({ scope: 'project', mode: 'subagent' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      requiresReload: false,
      requiresRestart: true,
      restartDeferred: true,
      pendingRestart: { count: 1, reasons: ['agent creation'] },
    });
    expect(response.body).not.toHaveProperty('reloadDelayMs');
  });
});
