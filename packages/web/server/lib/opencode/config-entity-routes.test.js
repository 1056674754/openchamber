import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerConfigEntityRoutes } from './config-entity-routes.js';
import { resetProtocolModes } from './protocol-mode.js';

const originalProtocolMode = process.env.OPENCHAMBER_PROTOCOL_MODE;

const createApp = () => {
  const app = express();
  app.use(express.json());
  const markPendingConfigRestart = vi.fn(() => ({ count: 1, reasons: ['agent creation'] }));
  registerConfigEntityRoutes(app, {
    resolveProjectDirectory: vi.fn(async () => ({ directory: '/tmp/project', error: null })),
    resolveOptionalProjectDirectory: vi.fn(async () => ({ directory: '/tmp/project', error: null })),
    markPendingConfigRestart,
    getAgentSources: vi.fn(),
    getAgentConfig: vi.fn(),
    getAgentPermissions: vi.fn(() => ({
      global: [],
      agent: [{ action: 'edit', resource: '*', effect: 'allow' }],
      effective: [{ action: 'edit', resource: '*', effect: 'allow', source: 'agent' }],
      source: 'md',
      path: '/tmp/project/.opencode/agents/build.md',
    })),
    createAgent: vi.fn(() => ({ path: '/tmp/project/.opencode/agents/build.md', scope: 'project', source: 'md' })),
    updateAgent: vi.fn(() => ({ path: '/tmp/project/.opencode/agents/build.md' })),
    deleteAgent: vi.fn(),
    getCommandSources: vi.fn(),
    getCommandConfig: vi.fn(() => ({
      source: 'md',
      scope: 'project',
      path: '/tmp/project/.opencode/commands/ship.md',
      legacy: false,
      config: { template: 'Ship {{args}}' },
    })),
    createCommand: vi.fn(() => ({ path: '/tmp/project/.opencode/commands/ship.md' })),
    updateCommand: vi.fn(() => ({ path: '/tmp/project/.opencode/commands/ship.md' })),
    deleteCommand: vi.fn(),
    listMcpConfigs: vi.fn(),
    getMcpConfig: vi.fn(),
    createMcpConfig: vi.fn(() => ({ path: '/tmp/opencode.json' })),
    updateMcpConfig: vi.fn(() => ({ path: '/tmp/opencode.json' })),
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

afterEach(() => {
  resetProtocolModes();
  if (typeof originalProtocolMode === 'string') {
    process.env.OPENCHAMBER_PROTOCOL_MODE = originalProtocolMode;
  } else {
    delete process.env.OPENCHAMBER_PROTOCOL_MODE;
  }
});

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

  it('answers plain applied success with the mutation location on the v2 track', async () => {
    process.env.OPENCHAMBER_PROTOCOL_MODE = 'v2';
    resetProtocolModes();
    const app = createApp();

    const created = await request(app)
      .post('/api/config/agents/build')
      .send({ scope: 'project', mode: 'subagent' });

    expect(created.status).toBe(200);
    expect(created.body).toEqual({
      success: true,
      message: 'Agent build created successfully.',
      path: '/tmp/project/.opencode/agents/build.md',
      scope: 'project',
      source: 'md',
    });

    const updated = await request(app)
      .patch('/api/config/agents/build')
      .send({ description: 'Builds things' });
    expect(updated.body).toEqual({
      success: true,
      message: 'Agent build updated successfully.',
      path: '/tmp/project/.opencode/agents/build.md',
    });

    const deleted = await request(app)
      .delete('/api/config/agents/build')
      .send({});
    expect(deleted.body).toEqual({
      success: true,
      message: 'Agent build deleted successfully.',
    });

    const mcp = await request(app)
      .post('/api/config/mcp/fetcher')
      .send({ type: 'local', command: ['uvx', 'mcp-fetch'] });
    expect(mcp.body).toEqual({
      success: true,
      message: 'MCP server "fetcher" created.',
      path: '/tmp/opencode.json',
    });
  });
});

describe('v2-only entity route shapes', () => {
  it('answers ordered agent permission rules on the v2 track', async () => {
    process.env.OPENCHAMBER_PROTOCOL_MODE = 'v2';
    resetProtocolModes();
    const app = createApp();

    const response = await request(app).get('/api/config/agents/build/permissions');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      global: [],
      agent: [{ action: 'edit', resource: '*', effect: 'allow' }],
      effective: [{ action: 'edit', resource: '*', effect: 'allow', source: 'agent' }],
      source: 'md',
      path: '/tmp/project/.opencode/agents/build.md',
    });
  });

  it('answers the canonical v2 command entity on the v2 track', async () => {
    process.env.OPENCHAMBER_PROTOCOL_MODE = 'v2';
    resetProtocolModes();
    const app = createApp();

    const response = await request(app).get('/api/config/commands/ship/config');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      source: 'md',
      scope: 'project',
      path: '/tmp/project/.opencode/commands/ship.md',
      legacy: false,
      config: { template: 'Ship {{args}}' },
    });
  });

  it('answers 404 on the v1 track where those shapes do not exist', async () => {
    resetProtocolModes();
    const app = createApp();

    const permissions = await request(app).get('/api/config/agents/build/permissions');
    expect(permissions.status).toBe(404);

    const commandConfig = await request(app).get('/api/config/commands/ship/config');
    expect(commandConfig.status).toBe(404);
  });
});
