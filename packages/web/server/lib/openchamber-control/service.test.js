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

  test('tells the browser which project and chat the action came from', async () => {
    const requests = [];
    const request = async (action, parameters, options) => {
      requests.push(options?.context ?? null);
      return { action, parameters, title: 'Page' };
    };
    const service = createService({ browserControl: { request } });

    await service.execute('browser.open', { serverId: 'default', url: 'https://example.com/path' }, '/repo', { contextSessionId: 'ses_1' });
    await service.execute('browser.open', { serverId: 'default', url: 'https://example.com/path' });

    expect(requests).toEqual([
      { directory: '/repo', sessionId: 'ses_1' },
      { directory: null, sessionId: null },
    ]);
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

  test('refuses projectId and directory together and resolves reads through the project', async () => {
    const service = createService({
      sessionService: {
        resolveDirectory: async ({ projectId }) => {
          if (projectId === 'unknown') throw Object.assign(new Error('Project not found'), { statusCode: 404 });
          return { directory: '/resolved-repo', projectId };
        },
        create: async () => ({ sessionId: 'ses_created', directory: '/repo' }),
        send: async () => ({ sessionId: 'ses_existing', directory: '/repo' }),
        fork: async () => ({ sessionId: 'ses_forked', directory: '/repo' }),
      },
      createClient: () => ({
        session: {
          list: async () => ({ data: [{ id: 'ses_1' }] }),
          status: async () => ({ data: {} }),
        },
      }),
    });

    await expect(service.execute('session.list', {
      serverId: 'default',
      projectId: 'proj-1',
      directory: '/repo',
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(service.execute('session.list', {
      serverId: 'default',
      projectId: 'unknown',
    })).rejects.toMatchObject({ statusCode: 404 });

    const result = await service.execute('session.list', {
      serverId: 'default',
      projectId: 'proj-1',
    });
    expect(result.directory).toBe('/resolved-repo');
  });
});

describe('file.open', () => {
  test('hands the path, the session directory and the session to the file viewer', async () => {
    const request = async (input) => ({ path: '/repo/out.csv', size: 3, opened: true, input });
    const service = createService({ fileOpen: { request } });

    const result = await service.execute('file.open', { serverId: 'default', path: 'out.csv' }, '/repo', { contextSessionId: 'ses_1' });

    expect(result.path).toBe('/repo/out.csv');
    expect(result.input).toEqual({ path: 'out.csv', directory: '/repo', sessionId: 'ses_1' });
  });

  test('lets an explicit directory win over the session directory', async () => {
    const request = async (input) => ({ path: '/other/out.csv', size: 3, opened: true, input });
    const service = createService({ fileOpen: { request } });

    const result = await service.execute('file.open', { serverId: 'default', path: 'out.csv', directory: '/other' }, '/repo');

    expect(result.input).toEqual({ path: 'out.csv', directory: '/other', sessionId: null });
  });

  test('answers 503 when this server has no file viewer wired', async () => {
    const service = createService({});
    await expect(service.execute('file.open', { serverId: 'default', path: 'out.csv' }, '/repo')).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('notify.send', () => {
  test('sends the notice for the calling session and returns what was delivered', async () => {
    const notifyCalls = [];
    const notifyUser = async (payload) => {
      notifyCalls.push(payload);
      return { status: 200, body: { delivered: true } };
    };
    const service = createService({ notifyUser });

    const result = await service.execute('notify.send', { serverId: 'default', title: 'Done', body: 'All green', showWhenFocused: true }, '/repo', { contextSessionId: 'ses_1' });

    expect(notifyCalls).toEqual([{ title: 'Done', body: 'All green', showWhenFocused: true, sessionId: 'ses_1', directory: '/repo' }]);
    expect(result).toEqual({ delivered: true });
  });

  test('turns a refused notice into an error the agent can read', async () => {
    const notifyUser = async () => ({ status: 429, retryAfter: 4, body: { error: 'too many notifications' } });
    const service = createService({ notifyUser });

    await expect(service.execute('notify.send', { serverId: 'default', title: 'Done' }, '/repo'))
      .rejects.toMatchObject({ statusCode: 429, message: 'too many notifications' });
  });

  test('answers 503 when this server has no notifier wired', async () => {
    const service = createService({});
    await expect(service.execute('notify.send', { serverId: 'default', title: 'Done' }, '/repo')).rejects.toMatchObject({ statusCode: 503 });
  });
});
