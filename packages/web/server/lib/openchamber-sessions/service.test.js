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
    const client = {
      session: {
        messages: mock(async () => ({ data: messages })),
      },
      command: {
        list: mock(async () => ({ data: [] })),
      },
    };
    let dispatchedBody = null;
    globalThis.fetch = mock(async (_input, init) => {
      dispatchedBody = JSON.parse(String(init?.body));
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
      parts: [{ type: 'text', text: 'Continue the task' }],
    });
    expect(result).toMatchObject({
      serverId: 'default',
      sessionId: 'ses_existing',
      directory: '/workspace/current',
      model: { providerID: 'selected-provider', modelID: 'selected-model' },
      agent: 'selected-agent',
      variant: 'high',
    });
  });
});
