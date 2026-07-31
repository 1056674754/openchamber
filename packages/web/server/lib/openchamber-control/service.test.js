import { describe, expect, test } from 'bun:test';
import { createOpenChamberControlService } from './service.js';

const createService = (overrides = {}) => createOpenChamberControlService({
  readSettingsFromDiskMigrated: async () => ({ projects: [] }),
  sanitizeProjects: (projects) => projects,
  buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
  getOpenCodeAuthHeaders: () => ({}),
  sessionService: {
    create: async () => ({ sessionId: 'ses_created', directory: '/repo' }),
    send: async () => ({ sessionId: 'ses_existing', directory: '/repo' }),
    fork: async () => ({ sessionId: 'ses_forked', directory: '/repo' }),
  },
  scheduledTaskService: {
    status: async () => ({}),
  },
  createClient: () => ({
    session: {
      list: async () => ({ data: [] }),
      status: async () => ({ data: {} }),
    },
  }),
  ...overrides,
});

describe('OpenChamber control authority', () => {
  test('rejects session actions without an explicit serverId', async () => {
    const service = createService();

    await expect(service.execute('session.create', { directory: '/repo' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects managed-local actions for a remote serverId', async () => {
    const service = createService();

    await expect(service.execute('session.create', {
      serverId: 'remote-dev-1',
      directory: '/repo',
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('rejects session listing without an authoritative directory', async () => {
    const service = createService();

    await expect(service.execute('session.list', {
      serverId: 'default',
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});
