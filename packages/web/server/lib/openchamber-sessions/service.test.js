import { afterEach, describe, expect, mock, test } from 'bun:test';

import { createOpenChamberSessionService } from './service.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenChamber Session selection inheritance', () => {
  test('reuses the latest user model, Agent, and variant for an existing Session', async () => {
    // Given
    const messages = [
      {
        info: {
          id: 'msg_user_old',
          role: 'user',
          model: { providerID: 'old-provider', modelID: 'old-model', variant: 'low' },
          agent: 'old-agent',
          time: { created: 1 },
        },
      },
      {
        info: {
          id: 'msg_assistant',
          role: 'assistant',
          time: { created: 2, completed: 3 },
        },
      },
      {
        info: {
          id: 'msg_user_latest',
          role: 'user',
          model: { providerID: 'selected-provider', modelID: 'selected-model', variant: 'high' },
          agent: 'selected-agent',
          time: { created: 4 },
        },
      },
    ];
    let promptAccepted = false;
    const client = {
      session: {
        messages: mock(async () => ({
          data: promptAccepted
            ? [...messages, { info: { id: 'msg_user_sent', role: 'user', time: { created: 5 } } }]
            : messages,
        })),
      },
      command: {
        list: mock(async () => ({ data: [] })),
      },
    };
    let dispatchedBody = null;
    const recordDelivered = mock(async () => undefined);
    globalThis.fetch = mock(async (_input, init) => {
      dispatchedBody = JSON.parse(String(init?.body));
      promptAccepted = true;
      return {
        ok: true,
        text: async () => '',
      };
    });
    const service = createOpenChamberSessionService({
      readSettingsFromDiskMigrated: mock(async () => ({})),
      sanitizeProjects: (projects) => projects,
      validateDirectoryPath: mock(async (directory) => ({ ok: true, directory })),
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      createClient: () => client,
      sessionKnowledgeRuntime: {
        resolvePendingForSession: mock(async () => ({ text: 'Pinned project knowledge', signature: 'knowledge-v1' })),
        recordDelivered,
      },
    });

    // When
    const result = await service.send('ses_existing', {
      serverId: 'default',
      directory: '/workspace/current',
      prompt: 'Continue the task',
    });

    // Then
    expect(dispatchedBody).toEqual({
      model: { providerID: 'selected-provider', modelID: 'selected-model' },
      agent: 'selected-agent',
      variant: 'high',
      parts: [
        { type: 'text', text: 'Pinned project knowledge', synthetic: true },
        { type: 'text', text: 'Continue the task' },
      ],
    });
    expect(result).toMatchObject({
      serverId: 'default',
      sessionId: 'ses_existing',
      directory: '/workspace/current',
      model: { providerID: 'selected-provider', modelID: 'selected-model' },
      agent: 'selected-agent',
      variant: 'high',
    });
    expect(recordDelivered).toHaveBeenCalledWith('ses_existing', '/workspace/current', 'knowledge-v1');
  });
});

describe('OpenChamber Session archive batch', () => {
  const buildService = (client) => createOpenChamberSessionService({
    readSettingsFromDiskMigrated: mock(async () => ({})),
    sanitizeProjects: (projects) => projects,
    validateDirectoryPath: mock(async (directory) => ({ ok: true, directory })),
    buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
    getOpenCodeAuthHeaders: () => ({}),
    createClient: () => client,
  });

  test('archives every session and reports each server payload', async () => {
    const archivedBy = new Map([
      ['ses_1', { id: 'ses_1', title: 'one', time: { archived: 111 } }],
      ['ses_2', { id: 'ses_2', title: 'two', time: { archived: 111 } }],
    ]);
    const client = {
      session: {
        update: mock(async ({ sessionID, time }) => ({ data: archivedBy.get(sessionID) && { ...archivedBy.get(sessionID), time } })),
      },
    };
    const service = buildService(client);

    const result = await service.archive({
      serverId: 'default',
      directory: '/workspace/current',
      ids: ['ses_1', 'ses_2'],
      archivedAt: 111,
    });

    expect(client.session.update).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      directory: '/workspace/current',
      archived: [
        { id: 'ses_1', title: 'one', time: { archived: 111 } },
        { id: 'ses_2', title: 'two', time: { archived: 111 } },
      ],
      failedIds: [],
    });
  });

  test('keeps archiving the rest when one session fails', async () => {
    const client = {
      session: {
        update: mock(async ({ sessionID }) => {
          if (sessionID === 'ses_bad') throw new Error('boom');
          return { data: { id: sessionID, time: { archived: 222 } } };
        }),
      },
    };
    const service = buildService(client);

    const result = await service.archive({
      serverId: 'default',
      directory: '/workspace/current',
      ids: ['ses_bad', 'ses_good'],
      archivedAt: 222,
    });

    expect(client.session.update).toHaveBeenCalledTimes(2);
    expect(result.archived).toEqual([{ id: 'ses_good', time: { archived: 222 } }]);
    expect(result.failedIds).toEqual(['ses_bad']);
  });

  test('rejects empty id lists and bad timestamps', async () => {
    const service = buildService({ session: { update: mock(async () => ({ data: null })) } });

    await expect(service.archive({ serverId: 'default', directory: '/w', ids: [] }))
      .rejects.toThrow('ids must be a non-empty array of session ids');
    await expect(service.archive({ serverId: 'default', directory: '/w', ids: ['ses_1'], archivedAt: 0 }))
      .rejects.toThrow('archivedAt must be a positive integer timestamp');
  });

  test('rejects a foreign serverId', async () => {
    const service = buildService({ session: { update: mock(async () => ({ data: null })) } });

    await expect(service.archive({ serverId: 'remote-x', directory: '/w', ids: ['ses_1'] }))
      .rejects.toThrow(/does not support server/i);
  });
});

describe('OpenChamber Session auto routing default', () => {
  test('lets the routing hook replace an Auto default before the prompt leaves', async () => {
    // Given — Session Defaults name the Auto sentinel; no provider lists it.
    const messages = [
      {
        info: {
          id: 'msg_user_old',
          role: 'user',
          model: { providerID: 'old-provider', modelID: 'old-model' },
          time: { created: 1 },
        },
      },
    ];
    let promptAccepted = false;
    const client = {
      session: {
        messages: mock(async () => ({
          data: promptAccepted
            ? [...messages, { info: { id: 'msg_user_sent', role: 'user', time: { created: 5 } } }]
            : messages,
        })),
      },
      command: {
        list: mock(async () => ({ data: [] })),
      },
    };
    const seen = [];
    const dispatchedBodies = [];
    globalThis.fetch = mock(async (input, init) => {
      const url = String(input instanceof URL ? input : input?.url ?? input);
      if (url.includes('/prompt_async')) {
        dispatchedBodies.push(JSON.parse(String(init?.body)));
        promptAccepted = true;
        return { ok: true, text: async () => '' };
      }
      if (url.includes('/session') && (init?.method ?? 'GET') === 'POST') {
        return { ok: true, json: async () => ({ id: 'ses_auto_default' }) };
      }
      if (url.includes('/config/providers')) {
        return { ok: true, json: async () => ({ providers: [] }) };
      }
      if (url.includes('/agent')) {
        return { ok: true, json: async () => [{ name: 'build', mode: 'primary' }] };
      }
      if (url.includes('/config')) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const resolvePromptBody = mock(async (body, target) => {
      seen.push({ model: body.model, target });
      if (body.model?.modelID === 'auto') body.model = { providerID: 'openai', modelID: 'gpt-5.5' };
    });
    const service = createOpenChamberSessionService({
      readSettingsFromDiskMigrated: mock(async () => ({
        defaultModel: 'openchamber/auto',
        defaultAgent: 'build',
        projects: [],
      })),
      sanitizeProjects: (projects) => projects,
      validateDirectoryPath: mock(async (directory) => ({ ok: true, directory })),
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      waitForOpenCodeReady: async () => true,
      createClient: () => client,
      resolvePromptBody,
    });

    // When
    const result = await service.create({
      serverId: 'default',
      directory: '/repo/app',
      prompt: 'Run this',
    });

    // Then — the hook saw the sentinel and the dispatch carried the rewrite.
    expect(seen).toEqual([{
      model: { providerID: 'openchamber', modelID: 'auto' },
      target: { sessionId: 'ses_auto_default', directory: '/repo/app' },
    }]);
    expect(dispatchedBodies[0]?.model).toEqual({ providerID: 'openai', modelID: 'gpt-5.5' });
    expect(result.model).toEqual({ providerID: 'openchamber', modelID: 'auto' });
    expect(result.promptDispatched).toBe(true);
  });
});
