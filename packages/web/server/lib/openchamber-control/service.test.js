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
  test('validates and forwards browser actions to the broker', async () => {
    const request = async (action, parameters) => ({ action, parameters, title: 'Page' });
    const service = createService({ browserControl: { request } });

    await expect(service.execute('browser.open', {
      serverId: 'default',
      url: 'file:///tmp/page.html',
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(service.execute('browser.open', {
      serverId: 'default',
      url: 'https://example.com/path',
      viewport: 'mobile',
    })).resolves.toEqual({
      action: 'browser.open',
      parameters: { url: 'https://example.com/path', viewport: 'mobile' },
      title: 'Page',
    });
  });

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
