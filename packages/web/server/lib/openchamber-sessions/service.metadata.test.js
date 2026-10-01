import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerOpenChamberSessionRoutes } from './routes.js';
import { createOpenChamberSessionService } from './service.js';
import { createSessionMetadataStore } from './session-metadata-store.js';

const tempDirs = [];

const makeDataDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-sessions-metadata-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

const createApp = ({
  dataDir = makeDataDir(),
  client,
  sessionMetadataStore,
  persistSessionMetadata,
  broadcastGlobalUiEvent,
} = {}) => {
  const service = createOpenChamberSessionService({
    readSettingsFromDiskMigrated: async () => ({}),
    sanitizeProjects: (projects) => projects,
    validateDirectoryPath: async (directory) => ({ ok: true, directory }),
    buildOpenCodeUrl: (pathname) => `http://opencode.test${pathname}`,
    getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test' }),
    createClient: () => client ?? {
      session: {
        get: async ({ sessionID }) => ({ data: { id: sessionID, metadata: {} } }),
      },
    },
    dataDir,
    ...(sessionMetadataStore ? { sessionMetadataStore } : {}),
    ...(persistSessionMetadata ? { persistSessionMetadata } : {}),
    ...(broadcastGlobalUiEvent ? { broadcastGlobalUiEvent } : {}),
  });
  const app = express();
  registerOpenChamberSessionRoutes(app, { sessionService: service });
  return { app, service, dataDir };
};

describe('openchamber session metadata routes', () => {
  it('seeds the store from what v1 left on the OpenCode record before the first patch', async () => {
    const sessionGet = vi.fn(async ({ sessionID }) => ({
      data: {
        id: sessionID,
        metadata: { openchamber: { kind: 'review', assist: { recap: 'from v1' } } },
      },
    }));
    const client = { session: { get: sessionGet } };
    const { app, service } = createApp({ client });

    const response = await request(app)
      .post('/api/openchamber/sessions/ses_v1/metadata')
      .send({ patch: { openchamber: { goal: { status: 'active' } } }, directory: '/repo/app' })
      .expect(200);

    // The goal joined the v1 data instead of replacing it.
    expect(response.body.metadata).toEqual({
      openchamber: { kind: 'review', assist: { recap: 'from v1' }, goal: { status: 'active' } },
    });
    await expect(service.sessionMetadataStore.get('ses_v1')).resolves.toEqual(response.body.metadata);
    // Seeding happens once: the next write does not consult OpenCode again.
    sessionGet.mockClear();
    await request(app)
      .post('/api/openchamber/sessions/ses_v1/metadata')
      .send({ patch: { openchamber: { goal: { status: 'paused' } } } })
      .expect(200);
    expect(sessionGet).not.toHaveBeenCalled();
  });

  it('merge-patches metadata, returns the merged object, and announces it', async () => {
    const broadcastGlobalUiEvent = vi.fn();
    const { app, service } = createApp({ broadcastGlobalUiEvent });

    await request(app)
      .post('/api/openchamber/sessions/ses_a/metadata')
      .send({ patch: { openchamber: { assist: { recap: 'first' } } } })
      .expect(200);

    const response = await request(app)
      .post('/api/openchamber/sessions/ses_a/metadata')
      .send({ patch: { openchamber: { goal: { status: 'active' } } } })
      .expect(200);

    // The second write must not erase the first: OpenCode's PATCH merged, so
    // this does too.
    expect(response.body).toEqual({
      metadata: { openchamber: { assist: { recap: 'first' }, goal: { status: 'active' } } },
    });
    await expect(service.sessionMetadataStore.get('ses_a')).resolves.toEqual(response.body.metadata);
    expect(broadcastGlobalUiEvent).toHaveBeenLastCalledWith({
      type: 'openchamber:session-metadata',
      properties: { sessionID: 'ses_a', metadata: response.body.metadata },
    });
  });

  it('deletes a key when the patch value is null', async () => {
    const { app } = createApp();
    await request(app)
      .post('/api/openchamber/sessions/ses_a/metadata')
      .send({ patch: { openchamber: { goal: { id: 'g1' }, assist: { recap: 'r' } } } })
      .expect(200);

    const response = await request(app)
      .post('/api/openchamber/sessions/ses_a/metadata')
      .send({ patch: { openchamber: { assist: null } } })
      .expect(200);

    expect(response.body).toEqual({ metadata: { openchamber: { goal: { id: 'g1' } } } });
  });

  it('reads back what it stored, per session', async () => {
    const { app } = createApp();
    await request(app).post('/api/openchamber/sessions/ses_a/metadata').send({ patch: { a: 1 } }).expect(200);

    await expect(request(app).get('/api/openchamber/sessions/ses_a/metadata').expect(200))
      .resolves.toMatchObject({ body: { metadata: { a: 1 } } });
    await expect(request(app).get('/api/openchamber/sessions/ses_b/metadata').expect(200))
      .resolves.toMatchObject({ body: { metadata: {} } });
  });

  it('rejects a missing or non-object patch without announcing anything', async () => {
    const broadcastGlobalUiEvent = vi.fn();
    const { app } = createApp({ broadcastGlobalUiEvent });

    await request(app).post('/api/openchamber/sessions/ses_a/metadata').send({}).expect(400);
    await request(app).post('/api/openchamber/sessions/ses_a/metadata').send({ patch: 'nope' }).expect(400);
    await request(app).post('/api/openchamber/sessions/ses_a/metadata').send({ patch: ['a'] }).expect(400);

    expect(broadcastGlobalUiEvent).not.toHaveBeenCalled();
  });

  it('routes every write through the server-owned writer when one is injected', async () => {
    const persistSessionMetadata = vi.fn(async () => ({ openchamber: { goal: { status: 'active' } } }));
    const sessionMetadataStore = createSessionMetadataStore({ dataDir: makeDataDir() });
    const { app } = createApp({ persistSessionMetadata, sessionMetadataStore });

    const response = await request(app)
      .post('/api/openchamber/sessions/ses_a/metadata')
      .send({ patch: { openchamber: { goal: { status: 'active' } } }, directory: '/repo/app' })
      .expect(200);

    expect(persistSessionMetadata).toHaveBeenCalledWith(
      'ses_a',
      { openchamber: { goal: { status: 'active' } } },
      { directory: '/repo/app' },
    );
    expect(response.body.metadata).toEqual({ openchamber: { goal: { status: 'active' } } });
    // The injected writer owns the store; the route must not write twice.
    await expect(sessionMetadataStore.get('ses_a')).resolves.toEqual({});
  });

  it('keeps the v1 archive path on the OpenCode session record', async () => {
    // The archive route is the v1 track's session.update batch — the store
    // base must not have rerouted it.
    const sessionUpdate = vi.fn(async ({ sessionID, time }) => ({
      data: { id: sessionID, time },
    }));
    const client = { session: { update: sessionUpdate, get: async () => ({ data: { id: 'x' } }) } };
    const { app } = createApp({ client });

    const response = await request(app)
      .post('/api/openchamber/sessions/archive')
      .send({ serverId: 'default', directory: '/workspace/current', ids: ['ses_1'], archivedAt: 111 })
      .expect(200);

    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    expect(response.body.archived).toEqual([{ id: 'ses_1', time: { archived: 111 } }]);
    expect(response.body.failedIds).toEqual([]);
  });
});
