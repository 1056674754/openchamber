import { afterEach, describe, expect, test } from 'bun:test';
import { createSessionAssistRuntime } from './runtime.js';
import { collectRecentTurns } from './context.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, recordProtocolMode, resetProtocolModes } from '../opencode/protocol-mode.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetProtocolModes();
});

describe('session assist runtime', () => {
  test('sends the recent turns with their part text to the small model', async () => {
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
          finish: 'stop',
          time: { completed: Date.now() },
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

    expect(generatedPrompt).toContain('继续完成生产采样');
    expect(generatedPrompt).toContain('已完成五个接口的采样。');
  });

  test('skips generation when the tail has no eligible final answer', async () => {
    let generated = false;
    const messages = [
      {
        info: { id: 'user-message', role: 'user' },
        parts: [{ type: 'text', text: '还在吗' }],
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
        generateSmallModelText: async () => {
          generated = true;
          return { text: '{}' };
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

    expect(generated).toBe(false);
  });

  test('on the v2 track a new turn retires the assist this process wrote', async () => {
    recordProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID, { mode: 'v2', source: 'test' });
    const patchBodies = [];
    const messages = [
      { info: { id: 'user-message', role: 'user' }, parts: [{ type: 'text', text: 'do the thing' }] },
      {
        info: { id: 'assistant-message', role: 'assistant', finish: 'stop', time: { completed: Date.now() } },
        parts: [{ type: 'text', text: 'done.' }],
      },
    ];
    let storedMetadata = {};

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === 'PATCH') {
        const body = JSON.parse(init.body);
        patchBodies.push(body);
        storedMetadata = body.metadata;
        return new Response('{}', { status: 200 });
      }
      if (url.includes('/message')) {
        return Response.json(messages);
      }
      return Response.json({ id: 'session', metadata: storedMetadata });
    };

    const runtime = createSessionAssistRuntime({
      buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
      getOpenCodeAuthHeaders: () => ({}),
      getSmallModelService: async () => ({
        generateSmallModelText: async () => ({
          text: JSON.stringify({ recap: 'did the thing.', suggestion: 'verify it.' }),
        }),
      }),
      readSettings: async () => ({ sessionRecapEnabled: true, sessionSuggestionEnabled: true }),
      quietMs: 1,
    });

    // Idle: the assist is generated and persisted.
    runtime.processPayload({ properties: { sessionID: 'session', status: { type: 'idle' } } }, '/workspace');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(patchBodies.length).toBe(1);
    expect(patchBodies[0].metadata.openchamber.assist.suggestion).toBe('verify it.');

    // A new turn starts: the stored assist is retired (key removed).
    runtime.processPayload({ properties: { sessionID: 'session', status: { type: 'busy' } } }, '/workspace');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(patchBodies.length).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(patchBodies[1].metadata.openchamber, 'assist')).toBe(false);

    // A second busy event has nothing left to retire — no extra write.
    runtime.processPayload({ properties: { sessionID: 'session', status: { type: 'busy' } } }, '/workspace');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(patchBodies.length).toBe(2);
    runtime.stop();
  });

  test('the v1 track never retires a stored assist', async () => {
    recordProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID, { mode: 'v1', source: 'test' });
    const patchBodies = [];
    const messages = [
      { info: { id: 'user-message', role: 'user' }, parts: [{ type: 'text', text: 'do the thing' }] },
      {
        info: { id: 'assistant-message', role: 'assistant', finish: 'stop', time: { completed: Date.now() } },
        parts: [{ type: 'text', text: 'done.' }],
      },
    ];
    let storedMetadata = {};

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === 'PATCH') {
        const body = JSON.parse(init.body);
        patchBodies.push(body);
        storedMetadata = body.metadata;
        return new Response('{}', { status: 200 });
      }
      if (url.includes('/message')) {
        return Response.json(messages);
      }
      return Response.json({ id: 'session', metadata: storedMetadata });
    };

    const runtime = createSessionAssistRuntime({
      buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
      getOpenCodeAuthHeaders: () => ({}),
      getSmallModelService: async () => ({
        generateSmallModelText: async () => ({
          text: JSON.stringify({ recap: 'did the thing.', suggestion: 'verify it.' }),
        }),
      }),
      readSettings: async () => ({ sessionRecapEnabled: true, sessionSuggestionEnabled: true }),
      quietMs: 1,
    });

    runtime.processPayload({ properties: { sessionID: 'session', status: { type: 'idle' } } }, '/workspace');
    await new Promise((resolve) => setTimeout(resolve, 25));
    runtime.processPayload({ properties: { sessionID: 'session', status: { type: 'busy' } } }, '/workspace');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(patchBodies.length).toBe(1);
    runtime.stop();
  });
});

describe('collectRecentTurns', () => {
  test('carries substantive work across a short closing exchange', () => {
    const completed = (id, parentID) => ({
      info: { id, role: 'assistant', parentID, finish: 'stop', time: { completed: 1 } },
      parts: [{ type: 'text', text: `answer ${id}` }],
    });
    const records = [
      { info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: 'fix the login bug' }] },
      completed('a1', 'u1'),
      { info: { id: 'u2', role: 'user' }, parts: [{ type: 'text', text: 'thanks, pushed' }] },
      completed('a2', 'u2'),
    ];
    const context = collectRecentTurns(records);
    expect(context).not.toBeNull();
    expect(context.turns).toHaveLength(2);
    expect(context.last.id).toBe('a2');
    // The earlier substantive turn survives the closing exchange.
    expect(context.turns[0].user.text).toBe('fix the login bug');
  });
});

