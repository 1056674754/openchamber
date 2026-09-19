import { afterEach, describe, expect, test } from 'bun:test';
import { createSessionAssistRuntime } from './runtime.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('session assist runtime', () => {
  test('sends the latest user and assistant part text to the small model', async () => {
    let generatedPrompt = '';
    const messages = [
      {
        info: { id: 'user-message', role: 'user' },
        parts: [{ type: 'text', text: '继续完成生产采样' }],
      },
      {
        info: {
          id: 'assistant-message',
          role: 'assistant',
          providerID: 'openai',
          modelID: 'gpt-test',
        },
        parts: [{ type: 'text', text: '已完成五个接口的采样。' }],
      },
    ];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === 'PATCH') {
        return new Response('{}', { status: 200 });
      }
      if (url.includes('/message')) {
        return Response.json(messages);
      }
      return Response.json({ id: 'session', metadata: {} });
    };

    const runtime = createSessionAssistRuntime({
      buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
      getOpenCodeAuthHeaders: () => ({}),
      getSmallModelService: async () => ({
        generateSmallModelText: async ({ prompt }) => {
          generatedPrompt = prompt;
          return {
            text: JSON.stringify({
              recap: '已完成五个接口采样。',
              suggestion: '继续整理采样结论。',
            }),
          };
        },
      }),
      readSettings: async () => ({
        sessionRecapEnabled: true,
        sessionSuggestionEnabled: true,
      }),
      quietMs: 1,
    });

    runtime.processPayload(
      {
        properties: {
          sessionID: 'session',
          status: { type: 'idle' },
        },
      },
      '/workspace',
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    runtime.stop();

    expect(generatedPrompt).toContain('User: 继续完成生产采样');
    expect(generatedPrompt).toContain('Assistant: 已完成五个接口的采样。');
  });
});
