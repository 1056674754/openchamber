import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNotificationTriggerRuntime } from './runtime.js';

const createRuntime = (settings = {}) => {
  const sendPushToAllUiSessions = vi.fn(async () => undefined);
  const emitDesktopNotification = vi.fn(() => false);
  const broadcastUiNotification = vi.fn();
  const runtime = createNotificationTriggerRuntime({
    readSettingsFromDisk: async () => ({
      notificationMode: 'always',
      nativeNotificationsEnabled: false,
      notifyOnCompletion: true,
      notifyOnError: true,
      notifyOnSubtasks: true,
      ...settings,
    }),
    prepareNotificationLastMessage: async ({ message }) => message,
    buildTemplateVariables: async () => ({
      agent_name: 'Agent',
      model_name: 'Model',
      last_message: '',
    }),
    extractLastMessageText: (payload) => payload.properties?.info?.parts?.[0]?.text ?? '',
    fetchLastAssistantMessageText: async () => '',
    resolveNotificationTemplate: (template, variables) => template
      .replaceAll('{agent_name}', variables.agent_name)
      .replaceAll('{model_name}', variables.model_name)
      .replaceAll('{last_message}', variables.last_message),
    shouldApplyResolvedTemplateMessage: () => true,
    emitDesktopNotification,
    broadcastUiNotification,
    sendPushToAllUiSessions,
    buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
    getOpenCodeAuthHeaders: () => ({}),
  });

  return {
    runtime,
    sendPushToAllUiSessions,
  };
};

const assistantStop = (sessionID, directory) => ({
  type: 'message.updated',
  properties: {
    directory,
    info: {
      id: `message-${sessionID}`,
      sessionID,
      role: 'assistant',
      finish: 'stop',
      mode: 'build',
      modelID: 'gpt-5',
    },
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notification trigger runtime', () => {
  it('looks up subagent parent state through the directory-scoped session endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'child', parentID: 'parent' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { runtime, sendPushToAllUiSessions } = createRuntime({
      notificationTemplates: {
        subtask: { title: 'Subtask ready', message: 'Child finished' },
      },
    });

    await runtime.maybeSendPushForTrigger(assistantStop('child', '/workspace/project'));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://opencode.test/session/child?directory=%2Fworkspace%2Fproject',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(sendPushToAllUiSessions).toHaveBeenCalledTimes(1);
    expect(sendPushToAllUiSessions.mock.calls[0][0]).toEqual(expect.objectContaining({
      title: 'Subtask ready',
      body: 'Child finished',
    }));
  });

  it('suppresses a subagent completion when subtask notifications are disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'child', parentID: 'parent' }),
    })));
    const { runtime, sendPushToAllUiSessions } = createRuntime({ notifyOnSubtasks: false });

    await runtime.maybeSendPushForTrigger(assistantStop('child', '/workspace/project'));

    expect(sendPushToAllUiSessions).not.toHaveBeenCalled();
  });

  it('suppresses only subagent errors when subtask notifications are disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes('/session/child')
        ? { id: 'child', parentID: 'parent' }
        : { id: 'main' },
    })));
    const { runtime, sendPushToAllUiSessions } = createRuntime({ notifyOnSubtasks: false });

    await runtime.maybeSendPushForTrigger({
      type: 'session.error',
      properties: {
        sessionID: 'child',
        directory: '/workspace/project',
        error: { message: 'User aborted' },
      },
    });

    expect(sendPushToAllUiSessions).not.toHaveBeenCalled();

    await runtime.maybeSendPushForTrigger({
      type: 'session.error',
      properties: {
        sessionID: 'main',
        directory: '/workspace/project',
        error: { message: 'Connection failed' },
      },
    });

    expect(sendPushToAllUiSessions).toHaveBeenCalledTimes(1);
    expect(sendPushToAllUiSessions.mock.calls[0][0]).toEqual(expect.objectContaining({
      body: 'Connection failed',
      data: expect.objectContaining({ sessionId: 'main', type: 'error' }),
    }));
  });

  it('suppresses ready notifications while a session goal is active', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'main',
        metadata: { openchamber: { goal: { id: 'g1', status: 'active', objective: 'Ship it' } } },
      }),
    })));
    const { runtime, sendPushToAllUiSessions } = createRuntime();

    await runtime.maybeSendPushForTrigger(assistantStop('main', '/workspace/project'));

    expect(sendPushToAllUiSessions).not.toHaveBeenCalled();
  });

  it('sends a completion from session idle when no final message event arrived', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'main' }),
    })));
    const { runtime, sendPushToAllUiSessions } = createRuntime();

    await runtime.maybeSendPushForTrigger({
      type: 'session.idle',
      properties: { sessionID: 'main', directory: '/workspace/project' },
    });

    expect(sendPushToAllUiSessions).toHaveBeenCalledTimes(1);
    expect(sendPushToAllUiSessions.mock.calls[0][0].data.type).toBe('ready');
  });

  it('normalizes session errors and suppresses duplicate error notifications', async () => {
    const { runtime, sendPushToAllUiSessions } = createRuntime({
      notificationTemplates: {
        error: { title: 'Agent failed', message: '{last_message}' },
      },
    });
    const errorEvent = {
      type: 'session.error',
      properties: {
        sessionID: 'main',
        directory: '/workspace/project',
        error: {
          name: 'APIError',
          data: {
            message: 'Connection failed',
            statusCode: 503,
            isRetryable: true,
          },
        },
      },
    };

    await runtime.maybeSendPushForTrigger(errorEvent);
    await runtime.maybeSendPushForTrigger(errorEvent);

    expect(sendPushToAllUiSessions).toHaveBeenCalledTimes(1);
    expect(sendPushToAllUiSessions.mock.calls[0][0]).toEqual(expect.objectContaining({
      title: 'Agent failed',
      body: 'Connection failed',
      data: expect.objectContaining({ type: 'error' }),
    }));
  });

  it('skips a permission notification the per-request getter answered automatically', async () => {
    const { runtime, sendPushToAllUiSessions } = createRuntime();
    runtime.setGetIsSessionAutoAccepting(async (sessionId, directory, permissionId) => (
      sessionId === 'main' && permissionId === 'answered'
    ));

    await runtime.maybeSendPushForTrigger({
      type: 'permission.asked',
      properties: { sessionID: 'main', directory: '/workspace/project', id: 'answered', permission: 'bash' },
    });
    expect(sendPushToAllUiSessions).not.toHaveBeenCalled();

    // A different request in the same session is not covered by that answer.
    await runtime.maybeSendPushForTrigger({
      type: 'permission.asked',
      properties: { sessionID: 'main', directory: '/workspace/project', id: 'held', permission: 'bash' },
    });
    await vi.waitFor(() => {
      expect(sendPushToAllUiSessions).toHaveBeenCalledTimes(1);
    });
  });

  it('notifies about a safety-held request even though the session auto-accepts', async () => {
    // The session is registered as auto-accepting, but the per-request getter
    // (the permission runtime) says this request was held, not answered: the
    // user must hear about it (upstream segb 1bc709ed0).
    const { runtime, sendPushToAllUiSessions } = createRuntime();
    runtime.setAutoAcceptSession('main', true);
    runtime.setGetIsSessionAutoAccepting(async () => false);

    await runtime.maybeSendPushForTrigger({
      type: 'permission.asked',
      properties: { sessionID: 'main', directory: '/workspace/project', id: 'held', permission: 'bash' },
    });

    await vi.waitFor(() => {
      expect(sendPushToAllUiSessions).toHaveBeenCalledTimes(1);
    });
  });
});
