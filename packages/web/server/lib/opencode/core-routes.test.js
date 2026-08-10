import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  registerCommonRequestMiddleware,
  registerServerStatusRoutes,
  registerSettingsUtilityRoutes,
} from './core-routes.js';

describe('core-routes', () => {
  it('should call gracefulShutdown with exitProcess: true on /api/system/shutdown', async () => {
    const app = express();
    let shutdownOpts = null;
    const dependencies = {
      gracefulShutdown: vi.fn(async (opts) => {
        shutdownOpts = opts;
      }),
      getHealthSnapshot: () => ({ status: 'ok' }),
      openchamberVersion: '1.0.0',
      runtimeName: 'test',
      express,
    };

    registerServerStatusRoutes(app, dependencies);

    await request(app).post('/api/system/shutdown');

    expect(dependencies.gracefulShutdown).toHaveBeenCalled();
    expect(shutdownOpts).toEqual({ exitProcess: true });
  });

  it('should advertise sessionGoals on /api/system/info', async () => {
    const app = express();
    const dependencies = {
      gracefulShutdown: vi.fn(async () => {}),
      getHealthSnapshot: () => ({ status: 'ok' }),
      openchamberVersion: '1.0.0',
      runtimeName: 'test',
      serverStartedAt: 1,
      process,
      express,
    };
    registerServerStatusRoutes(app, dependencies);

    const response = await request(app).get('/api/system/info').expect(200);
    expect(response.body.features).toEqual({
      sessionGoals: { apiVersion: 1 },
    });
  });

  it('should parse JSON bodies for snippet config routes', async () => {
    const app = express();
    registerCommonRequestMiddleware(app, { express });
    app.post('/api/config/snippets/example', (req, res) => {
      res.json({ body: req.body });
    });

    const response = await request(app)
      .post('/api/config/snippets/example')
      .send({ content: 'Snippet body' })
      .expect(200);

    expect(response.body).toEqual({ body: { content: 'Snippet body' } });
  });

  it('should parse JSON bodies for custom provider upsert routes', async () => {
    const app = express();
    registerCommonRequestMiddleware(app, { express });
    app.put('/api/provider', (req, res) => {
      res.json({ body: req.body });
    });

    const response = await request(app)
      .put('/api/provider')
      .send({
        providerID: 'campus-llm',
        config: {
          name: 'Campus LLM',
          options: { baseURL: 'https://llm.example.edu/v1' },
          models: { fast: { name: 'Fast' } },
        },
      })
      .expect(200);

    expect(response.body).toEqual({
      body: {
        providerID: 'campus-llm',
        config: {
          name: 'Campus LLM',
          options: { baseURL: 'https://llm.example.edu/v1' },
          models: { fast: { name: 'Fast' } },
        },
      },
    });
  });

  it('should expose and apply pending OpenCode config restarts', async () => {
    const app = express();
    const pending = {
      count: 2,
      reasons: ['agent update', 'plugin update'],
      changes: [],
      affectedSessions: [{ sessionId: 'session-1', status: 'busy' }],
      isApplying: false,
    };
    const applyPendingConfigRestart = vi.fn(async () => ({
      appliedCount: 2,
      restart: { reloaded: true, external: false },
      pending: { ...pending, count: 0, reasons: [], affectedSessions: [] },
    }));

    registerSettingsUtilityRoutes(app, {
      readCustomThemesFromDisk: async () => [],
      refreshOpenCodeAfterConfigChange: vi.fn(async () => ({ reloaded: true, external: false })),
      getPendingConfigRestart: () => pending,
      applyPendingConfigRestart,
      clientReloadDelayMs: 25,
    });

    const getResponse = await request(app).get('/api/opencode/restart/pending').expect(200);
    expect(getResponse.body).toEqual(pending);

    const applyResponse = await request(app).post('/api/opencode/restart/apply').expect(200);
    expect(applyPendingConfigRestart).toHaveBeenCalledTimes(1);
    expect(applyResponse.body).toMatchObject({
      success: true,
      appliedCount: 2,
      requiresReload: true,
      reloadDelayMs: 25,
    });
  });
});
